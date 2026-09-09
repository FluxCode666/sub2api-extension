package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Installed struct {
	Image   string `json:"image"`
	Version string `json:"version"`
}

type Engine interface {
	Current(context.Context) (Installed, error)
	Pull(context.Context, string) error
	Migrate(context.Context, string) error
	Restart(context.Context, string) error
	Healthy(context.Context, string) error
	Commit(string, string) error
	Cleanup(context.Context) error
}

type savedJob struct {
	Job      *Job      `json:"job"`
	Previous Installed `json:"previous"`
}

type Manager struct {
	mu        sync.Mutex
	releases  ReleaseSource
	engine    Engine
	statePath string
	saved     savedJob
	running   bool
}

func NewManager(source ReleaseSource, engine Engine, statePath string) (*Manager, error) {
	m := &Manager{releases: source, engine: engine, statePath: statePath}
	data, err := os.ReadFile(statePath)
	if err == nil {
		if err := json.Unmarshal(data, &m.saved); err != nil {
			return nil, errors.New("更新状态文件损坏，请检查后恢复")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if m.saved.Job.Active() {
		// 上一轮进程退出时任务可能已替换应用，先恢复旧镜像再接受新任务。
		if !digestPattern.MatchString(m.saved.Previous.Image) || !ValidVersion(m.saved.Previous.Version) {
			return nil, errors.New("未完成任务缺少回退信息，需要人工检查")
		}
		m.running = true
		go m.rollback("更新服务曾中断，正在恢复原版本")
	}
	return m, nil
}

func atomicWrite(path string, data []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".update-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer func() { _ = os.Remove(name) }()
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, path)
}

func (m *Manager) saveLocked() error {
	data, err := json.Marshal(m.saved)
	if err != nil {
		return err
	}
	return atomicWrite(m.statePath, data, 0600)
}

func (m *Manager) phase(phase, message string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.saved.Job.Phase, m.saved.Job.Message, m.saved.Job.UpdatedAt = phase, message, time.Now().UTC()
	log.Printf("更新 %s [%s]: %s", m.saved.Job.Version, phase, message)
	return m.saveLocked()
}

func (m *Manager) Status(_ context.Context) Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := Status{Enabled: true}
	if m.saved.Job != nil {
		job := *m.saved.Job
		s.Job = &job
		if job.Phase == "rollback_failed" {
			s.Enabled = false
			s.Reason = "上次自动回退未完成，请先人工恢复服务并检查更新状态文件"
		}
	}
	return s
}

func (m *Manager) Start(ctx context.Context, version string) (*Job, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.running || m.saved.Job.Active() {
		return nil, errors.New("已有更新任务正在执行")
	}
	if m.saved.Job != nil && m.saved.Job.Phase == "rollback_failed" {
		return nil, errors.New("上次回退失败，请先人工恢复服务并检查更新状态文件")
	}
	if !ValidVersion(version) {
		return nil, errors.New("版本号无效")
	}
	release, err := m.releases.Latest(ctx, true)
	if err != nil {
		return nil, err
	}
	if release.Version != version {
		return nil, errors.New("最新版本已变化，请重新检查更新")
	}
	if release.Manifest == nil {
		return nil, errors.New("此版本不支持自动更新")
	}
	previous, err := m.engine.Current(ctx)
	if err != nil {
		return nil, err
	}
	if !Newer(version, previous.Version) {
		return nil, errors.New("当前已是此版本或更新版本，无需更新")
	}
	now := time.Now().UTC()
	m.saved = savedJob{Job: &Job{ID: fmt.Sprintf("%d", now.UnixNano()), Version: version, Phase: "queued", Message: "更新任务已创建", StartedAt: now, UpdatedAt: now}, Previous: previous}
	if err := m.saveLocked(); err != nil {
		m.saved.Job = nil
		return nil, errors.New("无法保存更新任务，请检查更新卷权限和磁盘空间")
	}
	m.running = true
	job := *m.saved.Job
	go m.run(release)
	return &job, nil
}

func (m *Manager) finish(phase, message string) {
	if err := m.phase(phase, message); err != nil {
		log.Printf("保存更新状态失败: %v", err)
	}
	m.mu.Lock()
	m.running = false
	m.mu.Unlock()
}

func (m *Manager) run(release *Release) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	ref := release.Manifest.Image + "@" + release.Manifest.Digest
	steps := []struct {
		phase, message string
		run            func() error
	}{
		{"pulling", "正在下载并校验新版本镜像", func() error { return m.engine.Pull(ctx, ref) }},
		{"migrating", "正在执行数据库迁移", func() error { return m.engine.Migrate(ctx, ref) }},
		{"restarting", "正在重启应用，控制台将自动重连", func() error { return m.engine.Restart(ctx, ref) }},
		{"checking", "正在检查新版本健康状态", func() error { return m.engine.Healthy(ctx, ref) }},
		{"recording", "正在保存已安装版本", func() error { return m.engine.Commit(release.Version, ref) }},
	}
	replaced := false
	for _, step := range steps {
		err := m.phase(step.phase, step.message)
		if err == nil {
			if step.phase == "restarting" {
				replaced = true
			}
			err = step.run()
		}
		if err == nil {
			continue
		}
		if replaced {
			m.rollback("更新失败：" + err.Error())
			return
		}
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), time.Minute)
		cleanupErr := m.engine.Cleanup(cleanupCtx)
		cleanupCancel()
		message := "更新失败：" + err.Error() + "。应用仍使用原版本；数据库迁移不会自动撤销。"
		if cleanupErr != nil {
			m.finish("rollback_failed", message+" 迁移容器清理失败，请人工检查。")
			return
		}
		m.finish("failed", message)
		return
	}
	if err := m.phase("succeeded", "更新完成，新版本已通过健康检查"); err != nil {
		m.rollback("无法持久化更新结果")
		return
	}
	m.mu.Lock()
	m.running = false
	m.mu.Unlock()
}

func (m *Manager) rollback(reason string) {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	_ = m.phase("rolling_back", reason+"，正在回退应用")
	m.mu.Lock()
	previous := m.saved.Previous
	m.mu.Unlock()
	err := m.engine.Cleanup(ctx)
	if err == nil {
		err = m.engine.Restart(ctx, previous.Image)
	}
	if err == nil {
		err = m.engine.Healthy(ctx, previous.Image)
	}
	if err == nil {
		err = m.engine.Commit(previous.Version, previous.Image)
	}
	if err != nil {
		m.finish("rollback_failed", "自动回退未完成，请人工检查 aux-updater 日志和应用健康状态。数据库迁移不会自动撤销。")
		return
	}
	m.finish("rolled_back", reason+"。已恢复原应用镜像；数据库迁移不会自动撤销。")
}

// Handler 只能绑定 Unix socket，不开放公网监听端口。
func (m *Manager) Handler() http.Handler {
	mux := http.NewServeMux()
	write := func(w http.ResponseWriter, status int, data any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(data)
	}
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) { write(w, 200, m.Status(r.Context())) })
	mux.HandleFunc("POST /update", func(w http.ResponseWriter, r *http.Request) {
		var request UpdateRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil {
			write(w, 400, map[string]string{"message": "更新请求无效"})
			return
		}
		job, err := m.Start(r.Context(), request.Version)
		if err != nil {
			write(w, 409, map[string]string{"message": err.Error()})
			return
		}
		write(w, 202, job)
	})
	return mux
}
