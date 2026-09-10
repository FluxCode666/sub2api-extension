package update

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
)

type fakeReleaseSource struct{ release *Release }

func (f fakeReleaseSource) Latest(context.Context, bool) (*Release, error) { return f.release, nil }

type fakeBinaryClient struct {
	archive   string
	checksums []byte
}

func (f fakeBinaryClient) DownloadFile(_ context.Context, _ string, dest string) error {
	in, err := os.Open(f.archive)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
	out, err := os.Create(dest)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func (f fakeBinaryClient) FetchChecksumFile(context.Context, string) ([]byte, error) {
	return f.checksums, nil
}

func makeArchive(t *testing.T, content []byte) (string, []byte) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "release.tar.gz")
	f, err := os.Create(path)
	require.NoError(t, err)
	gz := gzip.NewWriter(f)
	tarWriter := tar.NewWriter(gz)
	require.NoError(t, tarWriter.WriteHeader(&tar.Header{Name: "aux-server", Mode: 0755, Size: int64(len(content))}))
	_, err = tarWriter.Write(content)
	require.NoError(t, err)
	require.NoError(t, tarWriter.Close())
	require.NoError(t, gz.Close())
	require.NoError(t, f.Close())
	hash := sha256.Sum256(mustRead(t, path))
	return path, []byte(fmt.Sprintf("%x  %s\n", hash, filepath.Base(path)))
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	return data
}

func testArchiveName() string {
	return fmt.Sprintf("sub2api-extension_%s_%s.tar.gz", runtime.GOOS, runtime.GOARCH)
}

func TestManagerAtomicallyReplacesBinaryAndKeepsBackup(t *testing.T) {
	oldPath := filepath.Join(t.TempDir(), "aux-server")
	require.NoError(t, os.WriteFile(oldPath, []byte("old"), 0755))
	archive, _ := makeArchive(t, []byte("new"))
	checksums := sha256.Sum256(mustRead(t, archive))
	checksumData := []byte(fmt.Sprintf("%x  %s\n", checksums, testArchiveName()))
	release := &Release{Version: "v0.6.0", Assets: []Asset{
		{Name: testArchiveName(), DownloadURL: "https://github.com/FluxCode666/sub2api-extension/releases/download/v0.6.0/" + testArchiveName()},
		{Name: checksumsAssetName, DownloadURL: "https://github.com/FluxCode666/sub2api-extension/releases/download/v0.6.0/checksums.txt"},
	}}
	m := NewManager(fakeReleaseSource{release}, fakeBinaryClient{archive: archive, checksums: checksumData}, "v0.5.0")
	m.executable = func() (string, error) { return oldPath, nil }
	job, err := m.Start(context.Background(), "v0.6.0")
	require.NoError(t, err)
	require.Equal(t, "succeeded", job.Phase)
	require.Equal(t, []byte("new"), mustRead(t, oldPath))
	require.Equal(t, []byte("old"), mustRead(t, oldPath+".backup"))
	require.Equal(t, "v0.6.0", m.Status(context.Background()).Job.Version)
}

func TestManagerRejectsMissingCompatibleAsset(t *testing.T) {
	m := NewManager(fakeReleaseSource{&Release{Version: "v0.6.0"}}, fakeBinaryClient{}, "v0.5.0")
	_, err := m.Start(context.Background(), "v0.6.0")
	require.ErrorContains(t, err, "没有适用于当前平台")
	require.Equal(t, "failed", m.Status(context.Background()).Job.Phase)
}

func TestManagerRejectsConcurrentAndStaleVersions(t *testing.T) {
	release := &Release{Version: "v0.6.0", Assets: []Asset{{Name: testArchiveName(), DownloadURL: "https://github.com/example/release"}}}
	m := NewManager(fakeReleaseSource{release}, fakeBinaryClient{}, "v0.5.0")
	_, err := m.Start(context.Background(), "v0.7.0")
	require.ErrorContains(t, err, "最新版本已变化")
	_, err = m.Start(context.Background(), "v0.6.0;id")
	require.ErrorContains(t, err, "版本号无效")
	m.currentVersion = "v0.6.0"
	_, err = m.Start(context.Background(), "v0.6.0")
	require.ErrorIs(t, err, ErrNoUpdateAvailable)
}

func TestVerifyChecksumAcceptsGNUForms(t *testing.T) {
	path := filepath.Join(t.TempDir(), "archive.tar.gz")
	require.NoError(t, os.WriteFile(path, []byte("payload"), 0600))
	hash := sha256.Sum256([]byte("payload"))
	require.NoError(t, verifyChecksum(path, []byte(fmt.Sprintf("%x *%s\n", hash, filepath.Base(path)))))
	require.Error(t, verifyChecksum(path, []byte("not-a-checksum")))
}
