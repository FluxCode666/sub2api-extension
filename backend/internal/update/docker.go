package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Command func(context.Context, ...string) (string, error)

// DockerEngine 只操作配置目录中当前 project 的 aux-backend / aux-migrate。
type DockerEngine struct {
	Directory string
	Project   string
	StateDir  string
	Command   Command
}

type cappedOutput struct{ data []byte }

func (b *cappedOutput) Write(p []byte) (int, error) {
	n := len(p)
	if remaining := (64 << 10) - len(b.data); remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		b.data = append(b.data, p...)
	}
	return n, nil
}

func DockerCommand(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", append([]string{"--host", "unix:///var/run/docker.sock"}, args...)...)
	cmd.WaitDelay = 5 * time.Second
	// Compose 从部署目录 .env 取值，避免更新服务继承的旧标签覆盖 .env。
	for _, key := range []string{"PATH", "HOME", "DOCKER_CONFIG", "TZ"} {
		if value, ok := os.LookupEnv(key); ok {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	var stdout cappedOutput
	cmd.Stdout, cmd.Stderr = &stdout, io.Discard
	if err := cmd.Run(); err != nil {
		return "", errors.New("容器操作失败，请检查镜像访问权限、部署配置及容器日志")
	}
	return strings.TrimSpace(string(stdout.data)), nil
}

func (d *DockerEngine) Validate() error {
	if !filepath.IsAbs(d.Directory) || !regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`).MatchString(d.Project) {
		return errors.New("必须配置部署目录的绝对路径和有效的 Compose project 名")
	}
	for _, file := range []string{"docker-compose.yml", "docker-compose.update.yml", ".env"} {
		info, err := os.Stat(filepath.Join(d.Directory, file))
		if err != nil || !info.Mode().IsRegular() {
			return fmt.Errorf("部署目录缺少 %s", file)
		}
	}
	return nil
}

func (d *DockerEngine) compose(ctx context.Context, ref string, args ...string) (string, error) {
	command := []string{"compose", "--project-name", d.Project, "--project-directory", d.Directory, "--env-file", filepath.Join(d.Directory, ".env"), "-f", filepath.Join(d.Directory, "docker-compose.yml"), "-f", filepath.Join(d.Directory, "docker-compose.update.yml")}
	if ref != "" {
		override := map[string]any{"services": map[string]any{"aux-backend": map[string]string{"image": ref}, "aux-migrate": map[string]string{"image": ref}}}
		data, err := json.Marshal(override)
		if err != nil {
			return "", err
		}
		path := filepath.Join(d.StateDir, "image.json")
		if err := atomicWrite(path, data, 0600); err != nil {
			return "", errors.New("无法写入镜像配置")
		}
		command = append(command, "-f", path)
	}
	return d.Command(ctx, append(command, args...)...)
}

func (d *DockerEngine) container(ctx context.Context) (string, error) {
	id, err := d.compose(ctx, "", "ps", "--all", "--quiet", "aux-backend")
	if err != nil {
		return "", err
	}
	if !regexp.MustCompile(`^[a-f0-9]{12,64}$`).MatchString(id) {
		return "", errors.New("未找到唯一的 aux-backend 容器，请检查 Compose project 名")
	}
	return id, nil
}

func (d *DockerEngine) Current(ctx context.Context) (Installed, error) {
	if _, err := d.compose(ctx, "", "config", "--quiet"); err != nil {
		return Installed{}, err
	}
	id, err := d.container(ctx)
	if err != nil {
		return Installed{}, err
	}
	format := `{{.Image}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}`
	output, err := d.Command(ctx, "inspect", "--format", format, id)
	if err != nil {
		return Installed{}, err
	}
	fields := strings.Split(output, "|")
	if len(fields) != 4 || !digestPattern.MatchString(fields[0]) || !ValidVersion(fields[1]) || fields[2] != d.Project || fields[3] != "aux-backend" {
		return Installed{}, errors.New("当前容器缺少正式版本信息或不属于此部署，请先按文档完成首次安装")
	}
	return Installed{Image: fields[0], Version: fields[1]}, nil
}

func (d *DockerEngine) Pull(ctx context.Context, ref string) error {
	_, err := d.Command(ctx, "pull", ref)
	return err
}

func (d *DockerEngine) migrationName() string { return d.Project + "-aux-update-migrate" }

func (d *DockerEngine) Migrate(ctx context.Context, ref string) error {
	if err := d.Cleanup(ctx); err != nil {
		return err
	}
	id, err := d.compose(ctx, ref, "run", "--detach", "--no-deps", "--name", d.migrationName(), "aux-migrate")
	if err != nil {
		return errors.New("无法启动数据库迁移容器")
	}
	if !regexp.MustCompile(`^[a-f0-9]{12,64}$`).MatchString(id) {
		return errors.New("迁移容器标识无效")
	}
	code, err := d.Command(ctx, "wait", id)
	if err != nil || code != "0" {
		return errors.New("数据库迁移未成功，应用未切换，请检查迁移配置与数据库")
	}
	return d.Cleanup(ctx)
}

func (d *DockerEngine) Cleanup(ctx context.Context) error {
	ids, err := d.Command(ctx, "ps", "--all", "--quiet", "--filter", "name=^/"+d.migrationName()+"$")
	if err != nil {
		return err
	}
	if ids == "" {
		return nil
	}
	_, err = d.Command(ctx, "rm", "--force", d.migrationName())
	return err
}

func (d *DockerEngine) Restart(ctx context.Context, ref string) error {
	_, err := d.compose(ctx, ref, "up", "-d", "--no-deps", "--pull", "never", "--force-recreate", "aux-backend")
	return err
}

func (d *DockerEngine) Healthy(ctx context.Context, ref string) error {
	ctx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	expected, err := d.Command(ctx, "image", "inspect", "--format", "{{.Id}}", ref)
	if err != nil || !digestPattern.MatchString(expected) {
		return errors.New("无法核对新容器镜像")
	}
	for {
		id, err := d.container(ctx)
		if err == nil {
			state, err := d.Command(ctx, "inspect", "--format", "{{.Image}} {{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", id)
			if err == nil && state == expected+" running healthy" {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return errors.New("容器未在规定时间内通过健康检查")
		case <-time.After(3 * time.Second):
		}
	}
}

func (d *DockerEngine) Commit(version, ref string) error {
	path := filepath.Join(d.Directory, ".env")
	data, err := os.ReadFile(path)
	if err != nil {
		return errors.New("无法读取部署环境文件")
	}
	// 只改镜像字段，不写回 Compose 展开内容，保留密码、JWT、端口、project 等设置。
	lines := strings.Split(string(data), "\n")
	for key, value := range map[string]string{"SUB2API_EXTENSION_IMAGE_TAG": version, "SUB2API_EXTENSION_IMAGE_REF": ref} {
		found := false
		pattern := regexp.MustCompile(`^\s*(export\s+)?` + key + `\s*=`)
		for index, line := range lines {
			if pattern.MatchString(line) {
				lines[index], found = key+"="+value, true
			}
		}
		if !found {
			lines = append(lines, key+"="+value)
		}
	}
	if err := atomicWrite(path, []byte(strings.Join(lines, "\n")), 0600); err != nil {
		return errors.New("保存已安装版本失败，请检查部署目录权限")
	}
	return nil
}
