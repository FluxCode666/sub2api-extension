package admin

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strconv"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

type fileAssetProvider interface {
	List(context.Context) ([]service.FileAsset, error)
	UpdateNote(context.Context, string, int, string) (*service.FileAsset, error)
}

// FileAssetHandler exposes a unified metadata list for every file uploaded by
// the extension, including images and issued invoice documents.
type FileAssetHandler struct {
	provider fileAssetProvider
}

func NewFileAssetHandler(provider fileAssetProvider) *FileAssetHandler {
	return &FileAssetHandler{provider: provider}
}

type fileAssetResponse struct {
	Source       string `json:"source"`
	SourceID     int    `json:"source_id"`
	Name         string `json:"name"` // Deprecated compatibility alias.
	OriginalName string `json:"original_name"`
	Note         string `json:"note"`
	MimeType     string `json:"mime_type"`
	Size         int64  `json:"size"`
	CreatedAt    string `json:"created_at"`
}

type fileAssetListResponse struct {
	Items []fileAssetResponse `json:"items"`
}

type updateFileAssetNoteRequest struct {
	// A pointer lets the handler distinguish a missing note (invalid request)
	// from an explicit empty string (clear the existing note).
	Note *string `json:"note"`
}

// List GET /api/aux/admin/files.
func (h *FileAssetHandler) List(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "file asset store is unavailable")
		return
	}
	files, err := h.provider.List(c.Request.Context())
	if err != nil {
		log.Printf("[FileAssetHandler.List] query failed: %v", err)
		response.InternalError(c, "failed to list files")
		return
	}
	items := make([]fileAssetResponse, 0, len(files))
	for _, file := range files {
		items = append(items, fileAssetResponse{
			Source:       file.Source,
			SourceID:     file.SourceID,
			Name:         file.Name,
			OriginalName: file.OriginalName,
			Note:         file.Note,
			MimeType:     file.MimeType,
			Size:         file.Size,
			CreatedAt:    file.CreatedAt.UTC().Format(timeFormat),
		})
	}
	response.Success(c, fileAssetListResponse{Items: items})
}

// UpdateNote PATCH /api/aux/admin/files/:source/:id updates only the
// administrator note for one uploaded file record.
func (h *FileAssetHandler) UpdateNote(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "file asset store is unavailable")
		return
	}

	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid file asset ID")
		return
	}

	var input updateFileAssetNoteRequest
	if err := c.ShouldBindJSON(&input); err != nil || input.Note == nil {
		response.BadRequest(c, "note is required")
		return
	}

	asset, err := h.provider.UpdateNote(c.Request.Context(), c.Param("source"), id, *input.Note)
	if err != nil {
		handleFileAssetError(c, err)
		return
	}
	if asset == nil {
		response.InternalError(c, "file asset store returned an empty result")
		return
	}
	response.Success(c, toFileAssetResponse(*asset))
}

func toFileAssetResponse(file service.FileAsset) fileAssetResponse {
	return fileAssetResponse{
		Source:       file.Source,
		SourceID:     file.SourceID,
		Name:         file.Name,
		OriginalName: file.OriginalName,
		Note:         file.Note,
		MimeType:     file.MimeType,
		Size:         file.Size,
		CreatedAt:    file.CreatedAt.UTC().Format(timeFormat),
	}
}

func handleFileAssetError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrFileAssetSource), errors.Is(err, service.ErrFileAssetID), errors.Is(err, service.ErrFileAssetNoteTooLong):
		response.BadRequest(c, err.Error())
	case errors.Is(err, service.ErrFileAssetNotFound):
		response.Error(c, http.StatusNotFound, "file asset not found")
	default:
		log.Printf("[FileAssetHandler.UpdateNote] update failed: %v", err)
		response.InternalError(c, "failed to update file note")
	}
}
