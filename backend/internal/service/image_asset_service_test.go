package service

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type memoryImageAssetStore struct {
	created *ImageAsset
	items   []ImageAsset
	err     error
}

func (s *memoryImageAssetStore) Create(_ context.Context, asset ImageAsset) (*ImageAsset, error) {
	if s.err != nil {
		return nil, s.err
	}
	asset.ID = 1
	s.created = &asset
	s.items = append(s.items, asset)
	return &asset, nil
}

func (s *memoryImageAssetStore) List(_ context.Context) ([]ImageAsset, error) {
	return s.items, s.err
}

func (s *memoryImageAssetStore) GetByID(_ context.Context, id int) (*ImageAsset, error) {
	for _, asset := range s.items {
		if asset.ID == id {
			copy := asset
			return &copy, nil
		}
	}
	return nil, ErrImageAssetNotFound
}

func TestImageAssetServiceUploadStoresFileAndRelativePath(t *testing.T) {
	storageDir := t.TempDir()
	store := &memoryImageAssetStore{}
	svc := NewImageAssetService(store, storageDir)
	// 1x1 透明 PNG。服务以文件签名判断类型，不信任文件名或客户端 MIME。
	png := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89,
	}

	asset, err := svc.Upload(context.Background(), "../brand-logo.png", bytes.NewReader(png))
	require.NoError(t, err)
	require.NotNil(t, asset)
	require.NotNil(t, store.created)
	assert.Equal(t, "brand-logo.png", asset.OriginalName)
	assert.Equal(t, "image/png", asset.MimeType)
	assert.Equal(t, int64(len(png)), asset.Size)
	assert.False(t, filepath.IsAbs(asset.Path), "database path must stay relative")
	assert.Equal(t, filepath.Base(asset.Path), asset.Path, "database path must not contain directories")

	written, err := os.ReadFile(filepath.Join(storageDir, asset.Path))
	require.NoError(t, err)
	assert.Equal(t, png, written)
}

func TestImageAssetServiceUploadRejectsNonImage(t *testing.T) {
	store := &memoryImageAssetStore{}
	svc := NewImageAssetService(store, t.TempDir())

	_, err := svc.Upload(context.Background(), "payload.svg", bytes.NewBufferString("<svg><script/></svg>"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid image file")
	assert.Nil(t, store.created)
}

func TestImageAssetServiceUploadRemovesFileWhenDatabaseWriteFails(t *testing.T) {
	storageDir := t.TempDir()
	store := &memoryImageAssetStore{err: errors.New("database unavailable")}
	svc := NewImageAssetService(store, storageDir)
	pngHeader := []byte{
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	}

	_, err := svc.Upload(context.Background(), "logo.png", bytes.NewReader(pngHeader))
	require.EqualError(t, err, "database unavailable")
	entries, readErr := os.ReadDir(storageDir)
	require.NoError(t, readErr)
	assert.Empty(t, entries, "failed database write must not leave an orphaned file")
}
