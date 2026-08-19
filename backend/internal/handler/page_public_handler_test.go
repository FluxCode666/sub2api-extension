package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type publicPageProviderForTest struct {
	items []service.PageListItem
}

func (p *publicPageProviderForTest) List(context.Context) ([]service.PageListItem, error) {
	return p.items, nil
}

func (p *publicPageProviderForTest) GetPublicBySlug(context.Context, string) (*service.Page, error) {
	return nil, service.ErrPageNotFound
}

func TestPagePublicHandlerListOnlyReturnsEnabledPublicPages(t *testing.T) {
	gin.SetMode(gin.TestMode)
	now := time.Now()
	provider := &publicPageProviderForTest{items: []service.PageListItem{
		{Slug: "public-page", Title: "公开页面", Visibility: service.VisibilityPublic, Enabled: true, UpdatedAt: now},
		{Slug: "admin-secret", Title: "管理员页面", Visibility: service.VisibilityAdmin, Enabled: true, UpdatedAt: now},
		{Slug: "disabled-page", Title: "已停用页面", Visibility: service.VisibilityPublic, Enabled: false, UpdatedAt: now},
	}}

	r := gin.New()
	r.GET("/api/aux/pages", newPagePublicHandlerWithProvider(provider).List)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/aux/pages", nil))

	require.Equal(t, http.StatusOK, w.Code)
	var envelope struct {
		Data struct {
			Items []service.PageListItem `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &envelope))
	require.Len(t, envelope.Data.Items, 1)
	require.Equal(t, "public-page", envelope.Data.Items[0].Slug)
}
