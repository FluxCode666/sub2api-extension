// Package service 提供图片上传资源的落盘与数据库索引服务。
package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"sub2api-extension/ent"
	"sub2api-extension/ent/imageasset"
)

// MaxImageAssetBytes 限制单张上传图片大小，避免无界占用磁盘与内存。
const MaxImageAssetBytes int64 = 10 * 1024 * 1024

// ImageAsset 是管理端需要展示的图片资源记录。
// Path 是相对于配置上传目录的安全相对路径，不是公开 URL。
type ImageAsset struct {
	ID           int       `json:"id"`
	OriginalName string    `json:"original_name"`
	Path         string    `json:"path"`
	MimeType     string    `json:"mime_type"`
	Size         int64     `json:"size"`
	CreatedAt    time.Time `json:"created_at"`
}

// ImageAssetStore 是图片资源数据库索引的抽象，便于服务层测试。
type ImageAssetStore interface {
	Create(ctx context.Context, asset ImageAsset) (*ImageAsset, error)
	List(ctx context.Context) ([]ImageAsset, error)
	GetByID(ctx context.Context, id int) (*ImageAsset, error)
}

// ImageAssetService 将安全校验后的上传内容写入文件系统，并只把相对路径写入数据库。
type ImageAssetService struct {
	store      ImageAssetStore
	storageDir string
}

func NewImageAssetService(store ImageAssetStore, storageDir string) *ImageAssetService {
	return &ImageAssetService{
		store:      store,
		storageDir: strings.TrimSpace(storageDir),
	}
}

// Upload 验证图片内容、生成不可预测的文件名、落盘后创建数据库索引。
// 数据库写入失败时删除刚写入的文件，避免产生孤立上传文件。
func (s *ImageAssetService) Upload(ctx context.Context, originalName string, source io.Reader) (*ImageAsset, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("image asset store is unavailable")
	}
	if strings.TrimSpace(s.storageDir) == "" {
		return nil, errors.New("image asset directory is unavailable")
	}
	if source == nil {
		return nil, errors.New("image file is required")
	}

	contents, err := io.ReadAll(io.LimitReader(source, MaxImageAssetBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read image file: %w", err)
	}
	if len(contents) == 0 {
		return nil, errors.New("image file is required")
	}
	if int64(len(contents)) > MaxImageAssetBytes {
		return nil, fmt.Errorf("image file exceeds %d bytes", MaxImageAssetBytes)
	}

	mimeType, extension, ok := allowedImageType(contents)
	if !ok {
		return nil, errors.New("invalid image file: only PNG, JPEG, GIF, or WebP images are allowed")
	}

	fileName, err := randomAssetFileName(extension)
	if err != nil {
		return nil, fmt.Errorf("generate image file name: %w", err)
	}
	if err := os.MkdirAll(s.storageDir, 0o750); err != nil {
		return nil, fmt.Errorf("create image asset directory: %w", err)
	}
	absolutePath := filepath.Join(s.storageDir, fileName)
	file, err := os.OpenFile(absolutePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return nil, fmt.Errorf("create image file: %w", err)
	}
	_, writeErr := file.Write(contents)
	closeErr := file.Close()
	if writeErr != nil || closeErr != nil {
		if removeErr := os.Remove(absolutePath); removeErr != nil {
			log.Printf("[ImageAssetService.Upload] failed to remove incomplete file path=%q: %v", absolutePath, removeErr)
		}
		if writeErr != nil {
			return nil, fmt.Errorf("write image file: %w", writeErr)
		}
		return nil, fmt.Errorf("close image file: %w", closeErr)
	}

	asset, err := s.store.Create(ctx, ImageAsset{
		OriginalName: normalizedOriginalName(originalName),
		Path:         fileName,
		MimeType:     mimeType,
		Size:         int64(len(contents)),
	})
	if err != nil {
		if removeErr := os.Remove(absolutePath); removeErr != nil {
			log.Printf("[ImageAssetService.Upload] failed to remove orphan file path=%q: %v", absolutePath, removeErr)
		}
		return nil, err
	}
	return asset, nil
}

func (s *ImageAssetService) List(ctx context.Context) ([]ImageAsset, error) {
	if s == nil || s.store == nil {
		return nil, errors.New("image asset store is unavailable")
	}
	return s.store.List(ctx)
}

// OpenByID 打开已在数据库登记的图片。只根据数据库中的安全相对路径拼接路径，
// 不使用客户端传入的文件名，从而避免路径穿越和任意文件读取。
func (s *ImageAssetService) OpenByID(ctx context.Context, id int) (*ImageAsset, *os.File, error) {
	if s == nil || s.store == nil {
		return nil, nil, errors.New("image asset store is unavailable")
	}
	if id <= 0 {
		return nil, nil, ErrImageAssetNotFound
	}
	asset, err := s.store.GetByID(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if asset == nil || !isSafeAssetPath(asset.Path) {
		return nil, nil, ErrImageAssetNotFound
	}
	file, err := os.Open(filepath.Join(s.storageDir, asset.Path))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, ErrImageAssetNotFound
		}
		return nil, nil, fmt.Errorf("open image file: %w", err)
	}
	return asset, file, nil
}

var ErrImageAssetNotFound = errors.New("image asset not found")

func allowedImageType(contents []byte) (mimeType, extension string, ok bool) {
	switch http.DetectContentType(contents) {
	case "image/png":
		return "image/png", ".png", true
	case "image/jpeg":
		return "image/jpeg", ".jpg", true
	case "image/gif":
		return "image/gif", ".gif", true
	case "image/webp":
		return "image/webp", ".webp", true
	default:
		return "", "", false
	}
}

func randomAssetFileName(extension string) (string, error) {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "image-" + hex.EncodeToString(bytes) + extension, nil
}

func normalizedOriginalName(name string) string {
	name = strings.TrimSpace(filepath.Base(name))
	if name == "." || name == "" {
		return "image"
	}
	runes := []rune(name)
	if len(runes) > 255 {
		return string(runes[:255])
	}
	return name
}

func isSafeAssetPath(value string) bool {
	if value == "" || filepath.IsAbs(value) || filepath.Base(value) != value {
		return false
	}
	return !strings.Contains(value, string(filepath.Separator)) && !strings.Contains(value, "/") && !strings.Contains(value, "\\")
}

// entImageAssetStore 将图片索引写入 image_assets。二进制内容永远不进入 PostgreSQL。
type entImageAssetStore struct {
	client *ent.Client
}

func NewEntImageAssetStore(client *ent.Client) ImageAssetStore {
	return &entImageAssetStore{client: client}
}

func (s *entImageAssetStore) Create(ctx context.Context, asset ImageAsset) (*ImageAsset, error) {
	created, err := s.client.ImageAsset.Create().
		SetOriginalName(asset.OriginalName).
		SetPath(asset.Path).
		SetMimeType(asset.MimeType).
		SetSize(asset.Size).
		Save(ctx)
	if err != nil {
		return nil, err
	}
	return entImageAssetToImageAsset(created), nil
}

func (s *entImageAssetStore) List(ctx context.Context) ([]ImageAsset, error) {
	assets, err := s.client.ImageAsset.Query().Order(ent.Desc(imageasset.FieldCreatedAt)).All(ctx)
	if err != nil {
		return nil, err
	}
	items := make([]ImageAsset, 0, len(assets))
	for _, asset := range assets {
		items = append(items, *entImageAssetToImageAsset(asset))
	}
	return items, nil
}

func (s *entImageAssetStore) GetByID(ctx context.Context, id int) (*ImageAsset, error) {
	asset, err := s.client.ImageAsset.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return entImageAssetToImageAsset(asset), nil
}

func entImageAssetToImageAsset(asset *ent.ImageAsset) *ImageAsset {
	return &ImageAsset{
		ID:           asset.ID,
		OriginalName: asset.OriginalName,
		Path:         asset.Path,
		MimeType:     asset.MimeType,
		Size:         asset.Size,
		CreatedAt:    asset.CreatedAt,
	}
}
