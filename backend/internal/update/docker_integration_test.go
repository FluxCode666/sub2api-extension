//go:build dockerintegration

package update

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// 使用独立 Compose project、镜像和卷，验证真实 Docker 重建及资源保留。
// go test -tags=dockerintegration ./internal/update -run TestDockerLifecycle -v
func TestDockerLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	dir := t.TempDir()
	project := fmt.Sprintf("aux-update-check-%d", time.Now().UnixNano())
	oldTag, newTag := project+":old", project+":new"
	fixture := `FROM nginx:1.28-alpine
ARG VERSION
LABEL org.opencontainers.image.version=$VERSION
RUN echo ok > /usr/share/nginx/html/health
COPY entrypoint.sh /entrypoint.sh
HEALTHCHECK --interval=1s --timeout=1s --retries=2 CMD wget -q -O /dev/null http://127.0.0.1/health
ENTRYPOINT ["sh", "/entrypoint.sh"]
`
	require.NoError(t, os.WriteFile(filepath.Join(dir, "Dockerfile"), []byte(fixture), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "entrypoint.sh"), []byte("#!/bin/sh\nif [ \"${1:-}\" = '-migrate' ]; then exit 0; fi\nexec nginx -g 'daemon off;'\n"), 0600))
	for _, image := range []struct{ tag, version string }{{oldTag, "v0.5.0"}, {newTag, "v0.6.0"}} {
		_, err := DockerCommand(ctx, "build", "--build-arg", "VERSION="+image.version, "-t", image.tag, dir)
		require.NoError(t, err)
	}
	compose := fmt.Sprintf(`services:
  aux-backend:
    image: ${SUB2API_EXTENSION_IMAGE_REF:-%s}
    volumes:
      - data:/app/data
  aux-migrate:
    image: ${SUB2API_EXTENSION_IMAGE_REF:-%s}
    command: ["-migrate"]
volumes:
  data:
`, oldTag, oldTag)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "docker-compose.yml"), []byte(compose), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "docker-compose.update.yml"), []byte("services: {}\n"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(dir, ".env"), []byte("SUB2API_EXTENSION_IMAGE_TAG=v0.5.0\n"), 0600))
	d := &DockerEngine{Directory: dir, Project: project, StateDir: dir, Command: DockerCommand}
	require.NoError(t, d.Validate())
	t.Cleanup(func() {
		cleanupCtx, stop := context.WithTimeout(context.Background(), time.Minute)
		defer stop()
		_, _ = d.compose(cleanupCtx, "", "down", "--volumes", "--remove-orphans")
		_, _ = DockerCommand(cleanupCtx, "image", "rm", oldTag, newTag)
	})
	require.NoError(t, d.Restart(ctx, oldTag))
	require.NoError(t, d.Healthy(ctx, oldTag))
	installed, err := d.Current(ctx)
	require.NoError(t, err)
	require.Equal(t, "v0.5.0", installed.Version)
	id, err := d.container(ctx)
	require.NoError(t, err)
	_, err = DockerCommand(ctx, "exec", id, "sh", "-c", "echo retained > /app/data/sentinel")
	require.NoError(t, err)
	require.NoError(t, d.Migrate(ctx, newTag))
	require.NoError(t, d.Restart(ctx, newTag))
	require.NoError(t, d.Healthy(ctx, newTag))
	require.NoError(t, d.Commit("v0.6.0", newTag))
	current, err := d.Current(ctx)
	require.NoError(t, err)
	require.Equal(t, "v0.6.0", current.Version)
	newID, err := d.container(ctx)
	require.NoError(t, err)
	require.NotEqual(t, id, newID)
	data, err := DockerCommand(ctx, "exec", newID, "cat", "/app/data/sentinel")
	require.NoError(t, err)
	require.Equal(t, "retained", strings.TrimSpace(data))
	require.NoError(t, d.Restart(ctx, installed.Image))
	require.NoError(t, d.Healthy(ctx, installed.Image))
	require.NoError(t, d.Commit(installed.Version, installed.Image))
	restored, err := d.Current(ctx)
	require.NoError(t, err)
	require.Equal(t, installed, restored)
}
