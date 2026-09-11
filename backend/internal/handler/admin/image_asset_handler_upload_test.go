package admin

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type unlimitedUploadProvider struct {
	bytesRead int64
}

func (p *unlimitedUploadProvider) Upload(_ context.Context, originalName string, source io.Reader) (*service.ImageAsset, error) {
	size, err := io.Copy(io.Discard, source)
	if err != nil {
		return nil, err
	}
	p.bytesRead = size
	return &service.ImageAsset{
		ID:           1,
		OriginalName: originalName,
		MimeType:     "image/png",
		Size:         size,
		CreatedAt:    time.Now(),
	}, nil
}

func (*unlimitedUploadProvider) List(context.Context) ([]service.ImageAsset, error) {
	return nil, nil
}

func (*unlimitedUploadProvider) OpenByID(context.Context, int) (*service.ImageAsset, *os.File, error) {
	return nil, nil, service.ErrImageAssetNotFound
}

func TestImageAssetHandlerUploadDoesNotLimitRequestToTenMegabytes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "large.png")
	require.NoError(t, err)
	payload := make([]byte, 11*1024*1024)
	_, err = part.Write(payload)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	request := httptest.NewRequest(http.MethodPost, "/api/aux/admin/assets", body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	responseRecorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(responseRecorder)
	context.Request = request
	provider := &unlimitedUploadProvider{}

	(&ImageAssetHandler{provider: provider}).Upload(context)

	assert.Equal(t, http.StatusCreated, responseRecorder.Code)
	assert.Equal(t, int64(len(payload)), provider.bytesRead)
}
