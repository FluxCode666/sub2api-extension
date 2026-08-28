package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type mockPageProvider struct {
	page *service.Page
	err  error
}

func (m *mockPageProvider) Create(context.Context, service.PageInput) (*service.Page, error) {
	return m.page, m.err
}
func (m *mockPageProvider) List(context.Context) ([]service.PageListItem, error) { return nil, nil }
func (m *mockPageProvider) GetByID(context.Context, int) (*service.Page, error)  { return m.page, nil }
func (m *mockPageProvider) GetAdminBySlug(context.Context, string) (*service.Page, error) {
	return m.page, nil
}
func (m *mockPageProvider) Update(context.Context, int, service.PageInput) (*service.Page, error) {
	return m.page, m.err
}
func (m *mockPageProvider) Delete(context.Context, int) error { return nil }

func TestPageHandlerCreateReturnsPersistedPageWhenMenuSyncFails(t *testing.T) {
	provider := &mockPageProvider{
		page: &service.Page{ID: 7, Slug: "docs", Title: "Docs"},
		err:  &service.PublicationSyncError{Err: errors.New("settings write failed")},
	}
	h := &PageHandler{provider: provider}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/aux/admin/pages", h.Create)

	w := httptest.NewRecorder()
	// A valid JSON body is enough; the mock provider controls the result.
	req := httptest.NewRequest(http.MethodPost, "/api/aux/admin/pages", strings.NewReader(`{"slug":"docs","title":"Docs"}`))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusCreated, w.Code)
	var envelope struct {
		Code    int             `json:"code"`
		Message string          `json:"message"`
		Reason  string          `json:"reason"`
		Data    json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
	require.Equal(t, 0, envelope.Code)
	require.Contains(t, envelope.Message, "warning")
	require.Contains(t, envelope.Reason, "页面已保存")
	require.Contains(t, string(envelope.Data), `"id":7`)
}
