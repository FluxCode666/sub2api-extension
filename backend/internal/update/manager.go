package update

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var ErrNoUpdateAvailable = errors.New("当前已是最新版本，无需更新")

type BinaryReleaseClient interface {
	DownloadFile(context.Context, string, string) error
	FetchChecksumFile(context.Context, string) ([]byte, error)
}

// Manager applies releases inside the running process. The process keeps the
// old executable open while a new file is downloaded, then atomically swaps
// the path and leaves a .backup beside it for rollback after restart.
type Manager struct {
	mu             sync.Mutex
	releases       ReleaseSource
	downloader     BinaryReleaseClient
	currentVersion string
	job            *Job
	running        bool
	executable     func() (string, error)
	ephemeralCheck func(string) bool // 可注入的临时环境检测，默认为 isEphemeralRuntime
	ephemeralOnce  bool               // 缓存检测结果（首次调用后锁定）
	ephemeralCache bool
}

func NewManager(source ReleaseSource, downloader BinaryReleaseClient, currentVersion string) *Manager {
	return &Manager{
		releases:       source,
		downloader:     downloader,
		currentVersion: strings.TrimSpace(currentVersion),
		executable:     executablePath,
	}
}

func (m *Manager) Status(_ context.Context) Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	status := Status{Enabled: true}
	if m.downloader == nil || m.releases == nil {
		status.Enabled = false
		status.Reason = "更新客户端未配置"
	}
	if status.Enabled {
		path, err := m.executable()
		if err != nil {
			status.Enabled = false
			status.Reason = "无法定位当前可执行文件"
		} else if info, err := os.Stat(filepath.Dir(path)); err != nil || info.Mode().Perm()&0222 == 0 {
			status.Enabled = false
			status.Reason = "当前运行环境不支持原地更新，请检查可执行文件目录权限"
		}
	}
	if m.job != nil {
		job := *m.job
		status.Job = &job
	}
	if m.running {
		status.Enabled = false
		status.Reason = "已有更新任务正在执行"
	}
	return status
}

func (m *Manager) Start(ctx context.Context, version string) (*Job, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	version = strings.TrimSpace(version)
	if version != "" && !ValidVersion(version) {
		return nil, errors.New("版本号无效")
	}

	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return nil, errors.New("已有更新任务正在执行")
	}
	if m.downloader == nil || m.releases == nil {
		m.mu.Unlock()
		return nil, errors.New("更新客户端未配置")
	}
	m.mu.Unlock()

	// Resolve the target from the server-side latest Release. An optional
	// requested version is only a stale-page guard; it never controls a URL.
	release, err := m.releases.Latest(ctx, true)
	if err != nil {
		return nil, err
	}
	if release == nil {
		return nil, errors.New("最新发布信息为空")
	}
	if version == "" {
		version = release.Version
	} else if release.Version != version {
		return nil, errors.New("最新版本已变化，请重新检查更新")
	}
	if !ValidVersion(version) {
		return nil, errors.New("最新发布版本号无效")
	}

	m.mu.Lock()
	if m.running {
		m.mu.Unlock()
		return nil, errors.New("已有更新任务正在执行")
	}
	if !Newer(version, m.currentVersion) {
		m.mu.Unlock()
		return nil, ErrNoUpdateAvailable
	}
	now := time.Now().UTC()
	m.running = true
	m.job = &Job{ID: fmt.Sprintf("%d", now.UnixNano()), Version: version, Phase: "queued", Message: "更新任务已创建", StartedAt: now, UpdatedAt: now}
	job := *m.job
	m.mu.Unlock()

	err = m.perform(ctx, version, release)
	m.mu.Lock()
	m.running = false
	if err != nil {
		m.job.Phase = "failed"
		m.job.Message = "更新失败：" + err.Error()
		m.job.UpdatedAt = time.Now().UTC()
		m.mu.Unlock()
		return nil, err
	}
	m.currentVersion = strings.TrimPrefix(version, "v")
	m.job.Phase = "succeeded"
	m.job.Message = "更新完成，请重启应用"
	m.job.UpdatedAt = time.Now().UTC()
	job = *m.job
	m.mu.Unlock()
	return &job, nil
}

// PerformUpdate mirrors Sub2API's synchronous update service API. The handler
// can call Start when it needs the compatibility job payload, while callers
// that only need the operation result can use this method.
func (m *Manager) PerformUpdate(ctx context.Context) error {
	_, err := m.Start(ctx, "")
	return err
}

func (m *Manager) perform(ctx context.Context, version string, release *Release) error {
	if release == nil || release.Version != version {
		return errors.New("最新版本已变化，请重新检查更新")
	}
	m.mu.Lock()
	current := m.currentVersion
	m.mu.Unlock()
	if !Newer(version, current) {
		return ErrNoUpdateAvailable
	}
	asset, ok := m.findBinaryAsset(release)
	if !ok {
		return fmt.Errorf("此版本没有适用于当前平台的更新包（%s）", archiveName())
	}
	path, err := m.executable()
	if err != nil {
		return fmt.Errorf("无法定位当前可执行文件：%w", err)
	}
	dir := filepath.Dir(path)
	tempDir, err := os.MkdirTemp(dir, ".sub2api-extension-update-")
	if err != nil {
		return fmt.Errorf("无法创建更新临时目录：%w", err)
	}
	defer func() { _ = os.RemoveAll(tempDir) }()

	archivePath := filepath.Join(tempDir, filepath.Base(asset.Name))
	if err := m.updatePhase("downloading", "正在下载当前平台更新包"); err != nil {
		return err
	}
	if err := m.downloader.DownloadFile(ctx, asset.DownloadURL, archivePath); err != nil {
		return fmt.Errorf("下载失败：%w", err)
	}
	if checksum := checksumAsset(release); checksum != nil {
		if err := m.updatePhase("checking", "正在校验更新包"); err != nil {
			return err
		}
		data, err := m.downloader.FetchChecksumFile(ctx, checksum.DownloadURL)
		if err != nil {
			return fmt.Errorf("下载校验文件失败：%w", err)
		}
		if err := verifyChecksum(archivePath, data); err != nil {
			return fmt.Errorf("校验失败：%w", err)
		}
	}

	newBinary := filepath.Join(tempDir, "aux-server")
	if err := extractBinary(archivePath, newBinary); err != nil {
		return fmt.Errorf("解压失败：%w", err)
	}
	if err := os.Chmod(newBinary, 0755); err != nil {
		return fmt.Errorf("设置可执行权限失败：%w", err)
	}
	if err := m.updatePhase("replacing", "正在原子替换应用二进制"); err != nil {
		return err
	}
	backup := path + ".backup"
	_ = os.Remove(backup)
	if err := os.Rename(path, backup); err != nil {
		return fmt.Errorf("备份当前二进制失败：%w", err)
	}
	if err := os.Rename(newBinary, path); err != nil {
		if restoreErr := os.Rename(backup, path); restoreErr != nil {
			return fmt.Errorf("替换失败且无法恢复旧二进制：%w（恢复错误：%v）", err, restoreErr)
		}
		return fmt.Errorf("替换失败（已恢复旧二进制）：%w", err)
	}
	return nil
}

func (m *Manager) updatePhase(phase, message string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.job == nil {
		return errors.New("更新任务不存在")
	}
	m.job.Phase, m.job.Message, m.job.UpdatedAt = phase, message, time.Now().UTC()
	return nil
}

func (m *Manager) findBinaryAsset(release *Release) (Asset, bool) {
	name := archiveName()
	for _, asset := range release.Assets {
		if asset.Name == name && asset.DownloadURL != "" {
			return asset, true
		}
	}
	return Asset{}, false
}

func checksumAsset(release *Release) *Asset {
	for i := range release.Assets {
		if release.Assets[i].Name == checksumsAssetName && release.Assets[i].DownloadURL != "" {
			return &release.Assets[i]
		}
	}
	return nil
}

func executablePath() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(path)
}

func verifyChecksum(path string, checksums []byte) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	hash := sha256.New()
	if _, err := io.Copy(hash, f); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	name := filepath.Base(path)
	scanner := bufio.NewScanner(strings.NewReader(string(checksums)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == name {
			if !strings.EqualFold(fields[0], actual) {
				return fmt.Errorf("SHA-256 不匹配：期望 %s，实际 %s", fields[0], actual)
			}
			return nil
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return fmt.Errorf("校验文件中没有 %s", name)
}

func extractBinary(archivePath, destPath string) error {
	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	var reader io.Reader = f
	if strings.HasSuffix(archivePath, ".gz") || strings.HasSuffix(archivePath, ".tgz") {
		gz, err := gzip.NewReader(f)
		if err != nil {
			return err
		}
		defer func() { _ = gz.Close() }()
		reader = gz
	}
	tr := tar.NewReader(reader)
	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		if header.Typeflag != tar.TypeReg || header.Size < 0 || header.Size > maxDownloadSize {
			continue
		}
		if strings.Contains(header.Name, "..") || filepath.Base(header.Name) != "aux-server" {
			continue
		}
		out, err := os.OpenFile(destPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
		if err != nil {
			return err
		}
		written, copyErr := io.Copy(out, io.LimitReader(tr, header.Size+1))
		closeErr := out.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if written != header.Size {
			return fmt.Errorf("更新包中的 aux-server 不完整")
		}
		return nil
	}
	return errors.New("更新包中没有 aux-server 二进制")
}
