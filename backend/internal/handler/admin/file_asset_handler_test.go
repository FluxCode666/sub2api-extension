package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type mockFileAssetProvider struct {
	items       []service.FileAsset
	updated     *service.FileAsset
	updateError error
	lastSource  string
	lastID      int
	lastNote    string
}

func (m *mockFileAssetProvider) List(context.Context) ([]service.FileAsset, error) {
	return m.items, nil
}

func (m *mockFileAssetProvider) UpdateNote(_ context.Context, source string, id int, note string) (*service.FileAsset, error) {
	m.lastSource, m.lastID, m.lastNote = source, id, note
	if m.updateError != nil {
		return nil, m.updateError
	}
	return m.updated, nil
}

func TestFileAssetHandlerListIncludesOriginalNameAndNote(t *testing.T) {
	gin.SetMode(gin.TestMode)
	provider := &mockFileAssetProvider{items: []service.FileAsset{{
		Source: "image", SourceID: 7, Name: "legacy.png", OriginalName: "客户 Logo.png", Note: "首页品牌图",
		MimeType: "image/png", Size: 42, CreatedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
	}}}
	r := gin.New()
	r.GET("/files", NewFileAssetHandler(provider).List)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/files", nil))

	require.Equal(t, http.StatusOK, w.Code)
	var envelope struct {
		Data fileAssetListResponse `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
	require.Len(t, envelope.Data.Items, 1)
	require.Equal(t, "客户 Logo.png", envelope.Data.Items[0].OriginalName)
	require.Equal(t, "首页品牌图", envelope.Data.Items[0].Note)
}

func TestFileAssetHandlerUpdateNote(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		path        string
		providerErr error
		wantStatus  int
		wantNote    string
	}{
		{name: "updates note", body: `{"note":"用途说明"}`, path: "/files/image/7", wantStatus: http.StatusOK, wantNote: "用途说明"},
		{name: "clears note", body: `{"note":""}`, path: "/files/image/7", wantStatus: http.StatusOK, wantNote: ""},
		{name: "missing note", body: `{}`, path: "/files/image/7", wantStatus: http.StatusBadRequest},
		{name: "invalid source", body: `{"note":"x"}`, path: "/files/video/7", providerErr: service.ErrFileAssetSource, wantStatus: http.StatusBadRequest},
		{name: "invalid id", body: `{"note":"x"}`, path: "/files/image/nope", wantStatus: http.StatusBadRequest},
		{name: "not found", body: `{"note":"x"}`, path: "/files/image/7", providerErr: service.ErrFileAssetNotFound, wantStatus: http.StatusNotFound},
		{name: "too long", body: `{"note":"x"}`, path: "/files/image/7", providerErr: service.ErrFileAssetNoteTooLong, wantStatus: http.StatusBadRequest},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			provider := &mockFileAssetProvider{
				updated:     &service.FileAsset{Source: "image", SourceID: 7, OriginalName: "a.png", Name: "a.png", Note: tt.wantNote},
				updateError: tt.providerErr,
			}
			h := NewFileAssetHandler(provider)
			r := gin.New()
			r.PATCH("/files/:source/:id", h.UpdateNote)

			w := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPatch, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)

			require.Equal(t, tt.wantStatus, w.Code)
			if tt.wantStatus == http.StatusOK {
				require.Equal(t, tt.wantNote, provider.lastNote)
				require.Contains(t, w.Body.String(), `"original_name":"a.png"`)
			} else if tt.name == "invalid id" || tt.name == "missing note" {
				require.Empty(t, provider.lastNote)
			}
		})
	}
}
