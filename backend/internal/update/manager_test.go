package update

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type fakeSource struct{ release *Release }

func (f fakeSource) Latest(context.Context, bool) (*Release, error) { return f.release, nil }

var oldImage = "sha256:" + strings.Repeat("a", 64)

type fakeEngine struct {
	mu            sync.Mutex
	calls         []string
	fail          string
	rollbackFails bool
	pullGate      chan struct{}
}

func (e *fakeEngine) call(name string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls = append(e.calls, name)
	if name == e.fail || (e.rollbackFails && name == "restart-old") {
		return errors.New("操作失败")
	}
	return nil
}
func (e *fakeEngine) Current(context.Context) (Installed, error) {
	return Installed{Image: oldImage, Version: "v0.5.0"}, nil
}
func (e *fakeEngine) Pull(context.Context, string) error {
	if e.pullGate != nil {
		<-e.pullGate
	}
	return e.call("pull")
}
func (e *fakeEngine) Migrate(context.Context, string) error { return e.call("migrate") }
func (e *fakeEngine) Restart(_ context.Context, ref string) error {
	if ref == oldImage {
		return e.call("restart-old")
	}
	return e.call("restart")
}
func (e *fakeEngine) Healthy(_ context.Context, ref string) error {
	if ref == oldImage {
		return e.call("healthy-old")
	}
	return e.call("healthy")
}
func (e *fakeEngine) Commit(version, _ string) error {
	if version == "v0.5.0" {
		return e.call("commit-old")
	}
	return e.call("commit")
}
func (e *fakeEngine) Cleanup(context.Context) error { return e.call("cleanup") }

func releaseFixture() *Release {
	return &Release{Version: "v0.6.0", Manifest: &Manifest{Schema: 1, Version: "v0.6.0", Image: DefaultImage, Digest: "sha256:" + strings.Repeat("b", 64)}}
}

func waitJob(t *testing.T, m *Manager, phase string) {
	t.Helper()
	require.Eventually(t, func() bool { s := m.Status(context.Background()); return s.Job != nil && !s.Job.Active() }, 3*time.Second, time.Millisecond)
	require.Equal(t, phase, m.Status(context.Background()).Job.Phase)
}

func TestUpdateSuccessAndFailurePaths(t *testing.T) {
	for _, tc := range []struct {
		name, fail, phase string
		rollbackFails     bool
		expected          []string
	}{
		{"success", "", "succeeded", false, []string{"pull", "migrate", "restart", "healthy", "commit"}},
		{"pull failure", "pull", "failed", false, []string{"pull", "cleanup"}},
		{"migration failure", "migrate", "failed", false, []string{"pull", "migrate", "cleanup"}},
		{"restart failure", "restart", "rolled_back", false, []string{"pull", "migrate", "restart", "cleanup", "restart-old", "healthy-old", "commit-old"}},
		{"health failure", "healthy", "rolled_back", false, []string{"pull", "migrate", "restart", "healthy", "cleanup", "restart-old", "healthy-old", "commit-old"}},
		{"commit failure", "commit", "rolled_back", false, []string{"pull", "migrate", "restart", "healthy", "commit", "cleanup", "restart-old", "healthy-old", "commit-old"}},
		{"rollback failure", "healthy", "rollback_failed", true, []string{"pull", "migrate", "restart", "healthy", "cleanup", "restart-old"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine := &fakeEngine{fail: tc.fail, rollbackFails: tc.rollbackFails}
			path := filepath.Join(t.TempDir(), "job.json")
			m, err := NewManager(fakeSource{releaseFixture()}, engine, path)
			require.NoError(t, err)
			_, err = m.Start(context.Background(), "v0.6.0")
			require.NoError(t, err)
			waitJob(t, m, tc.phase)
			engine.mu.Lock()
			require.Equal(t, tc.expected, engine.calls)
			engine.mu.Unlock()
			reloaded, err := NewManager(fakeSource{releaseFixture()}, engine, path)
			require.NoError(t, err)
			require.Equal(t, tc.phase, reloaded.Status(context.Background()).Job.Phase)
		})
	}
}

func TestUpdateRejectsConcurrentAndChangedTarget(t *testing.T) {
	engine := &fakeEngine{pullGate: make(chan struct{})}
	m, err := NewManager(fakeSource{releaseFixture()}, engine, filepath.Join(t.TempDir(), "job.json"))
	require.NoError(t, err)
	_, err = m.Start(context.Background(), "v0.7.0")
	require.ErrorContains(t, err, "最新版本已变化")
	_, err = m.Start(context.Background(), "v0.6.0; curl attacker")
	require.ErrorContains(t, err, "版本号无效")
	_, err = m.Start(context.Background(), "v0.6.0")
	require.NoError(t, err)
	_, err = m.Start(context.Background(), "v0.6.0")
	require.ErrorContains(t, err, "已有更新任务")
	close(engine.pullGate)
	waitJob(t, m, "succeeded")
}

func TestInterruptedUpdateRollsBackBeforeNewRequests(t *testing.T) {
	path := filepath.Join(t.TempDir(), "job.json")
	data, err := json.Marshal(savedJob{Job: &Job{ID: "1", Version: "v0.6.0", Phase: "restarting"}, Previous: Installed{Image: oldImage, Version: "v0.5.0"}})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(path, data, 0600))
	engine := &fakeEngine{}
	m, err := NewManager(fakeSource{releaseFixture()}, engine, path)
	require.NoError(t, err)
	waitJob(t, m, "rolled_back")
	engine.mu.Lock()
	defer engine.mu.Unlock()
	require.Equal(t, []string{"cleanup", "restart-old", "healthy-old", "commit-old"}, engine.calls)
}

func TestCommitPreservesOtherEnvironmentAndPinsImage(t *testing.T) {
	dir := t.TempDir()
	before := "# credentials\nDATABASE_PASSWORD='test$with#symbols'\nCOMPOSE_PROJECT_NAME=existing\nSUB2API_EXTENSION_IMAGE_TAG=v0.5.0\nSUB2API_EXTENSION_IMAGE_REF=\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".env"), []byte(before), 0600))
	d := &DockerEngine{Directory: dir}
	require.NoError(t, d.Commit("v0.6.0", DefaultImage+"@sha256:"+strings.Repeat("b", 64)))
	after, err := os.ReadFile(filepath.Join(dir, ".env"))
	require.NoError(t, err)
	require.Contains(t, string(after), "DATABASE_PASSWORD='test$with#symbols'")
	require.Contains(t, string(after), "COMPOSE_PROJECT_NAME=existing")
	require.Contains(t, string(after), "SUB2API_EXTENSION_IMAGE_TAG=v0.6.0")
	require.Contains(t, string(after), "SUB2API_EXTENSION_IMAGE_REF="+DefaultImage+"@sha256:")
}
