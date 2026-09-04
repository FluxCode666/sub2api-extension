// Package admin 提供管理员图片上传、兼容列表和公开读取端点。
package admin

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"

	"sub2api-extension/ent"
	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

type imageAssetProvider interface {
	Upload(ctx context.Context, originalName string, source io.Reader) (*service.ImageAsset, error)
	List(ctx context.Context) ([]service.ImageAsset, error)
	OpenByID(ctx context.Context, id int) (*service.ImageAsset, *os.File, error)
}

// ImageAssetHandler 处理图片资源兼容端点。上传/列表受管理员守卫保护，读取 URL 公开可访问，
// 这样复制后的 HTTP URL 可直接被官网动态页的 metadata.logo 使用。
type ImageAssetHandler struct {
	provider imageAssetProvider
}

func NewImageAssetHandler(svc *service.ImageAssetService) *ImageAssetHandler {
	return &ImageAssetHandler{provider: svc}
}

type imageAssetResponse struct {
	ID           int    `json:"id"`
	OriginalName string `json:"original_name"`
	Note         string `json:"note"`
	MimeType     string `json:"mime_type"`
	Size         int64  `json:"size"`
	CreatedAt    string `json:"created_at"`
	URL          string `json:"url"`
}

type imageAssetListResponse struct {
	Items []imageAssetResponse `json:"items"`
}

// Upload POST /api/aux/admin/assets, multipart field name: file.
func (h *ImageAssetHandler) Upload(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "image asset store is unavailable")
		return
	}
	// Header 及 multipart 边界也占用少量空间，额外预留 1 MiB；服务层继续严格检查文件本体 10 MiB。
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxImageAssetBytes+1024*1024)
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		log.Printf("[ImageAssetHandler.Upload] invalid multipart upload: %v", err)
		response.BadRequest(c, "image file is required and must not exceed 10MB")
		return
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			log.Printf("[ImageAssetHandler.Upload] failed to close upload: %v", closeErr)
		}
	}()

	asset, err := h.provider.Upload(c.Request.Context(), header.Filename, file)
	if err != nil {
		log.Printf("[ImageAssetHandler.Upload] upload failed filename=%q: %v", header.Filename, err)
		handleImageAssetError(c, err)
		return
	}
	response.Created(c, toImageAssetResponse(c, *asset))
}

// List GET /api/aux/admin/assets.
func (h *ImageAssetHandler) List(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "image asset store is unavailable")
		return
	}
	assets, err := h.provider.List(c.Request.Context())
	if err != nil {
		log.Printf("[ImageAssetHandler.List] query failed: %v", err)
		response.InternalError(c, "failed to list image assets")
		return
	}
	items := make([]imageAssetResponse, 0, len(assets))
	for _, asset := range assets {
		items = append(items, toImageAssetResponse(c, asset))
	}
	response.Success(c, imageAssetListResponse{Items: items})
}

// ServePublic GET /api/aux/assets/:id. 只读取数据库中已登记的文件。
func (h *ImageAssetHandler) ServePublic(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.Error(c, http.StatusNotFound, "image asset not found")
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.Error(c, http.StatusNotFound, "image asset not found")
		return
	}
	asset, file, err := h.provider.OpenByID(c.Request.Context(), id)
	if err != nil {
		log.Printf("[ImageAssetHandler.ServePublic] open failed id=%d: %v", id, err)
		handlePublicImageAssetError(c, err)
		return
	}
	defer func() {
		if closeErr := file.Close(); closeErr != nil {
			log.Printf("[ImageAssetHandler.ServePublic] failed to close asset: %v", closeErr)
		}
	}()
	c.Header("Content-Type", asset.MimeType)
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, asset.OriginalName, asset.CreatedAt, file)
}

func toImageAssetResponse(c *gin.Context, asset service.ImageAsset) imageAssetResponse {
	return imageAssetResponse{
		ID:           asset.ID,
		OriginalName: asset.OriginalName,
		Note:         asset.Note,
		MimeType:     asset.MimeType,
		Size:         asset.Size,
		CreatedAt:    asset.CreatedAt.UTC().Format(timeFormat),
		URL:          publicImageAssetURL(c, asset.ID),
	}
}

const timeFormat = "2006-01-02T15:04:05Z07:00"

func publicImageAssetURL(_ *gin.Context, id int) string {
	return "/api/aux/assets/" + strconv.Itoa(id)
}

func handleImageAssetError(c *gin.Context, err error) {
	if isImageAssetValidationError(err) {
		response.BadRequest(c, err.Error())
		return
	}
	response.InternalError(c, "image upload failed")
}

func handlePublicImageAssetError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrImageAssetNotFound) || ent.IsNotFound(err) {
		response.Error(c, http.StatusNotFound, "image asset not found")
		return
	}
	response.InternalError(c, "failed to read image asset")
}

func isImageAssetValidationError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, "invalid image") || strings.Contains(message, "image file") || strings.Contains(message, "required")
}
