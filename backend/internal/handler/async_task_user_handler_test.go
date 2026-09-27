package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"aux-system/internal/integration"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type asyncTaskVerifierStub struct{}

func (asyncTaskVerifierStub) VerifyUserJWT(_ context.Context, token string) (*integration.Sub2APIUserInfo, error) {
	if token != "valid-token" {
		return nil, integration.ErrInvalidToken
	}
	return &integration.Sub2APIUserInfo{ID: 42, Role: "user"}, nil
}

type asyncTaskListerStub struct {
	userID int64
	query  service.AsyncTaskQuery
	err    error
}

func (s *asyncTaskListerStub) ListForUser(_ context.Context, userID int64, query service.AsyncTaskQuery) (service.AsyncTaskList, error) {
	s.userID = userID
	s.query = query
	if s.err != nil {
		return service.AsyncTaskList{}, s.err
	}
	return service.AsyncTaskList{Items: []service.AsyncTask{{ID: "imgtask_1"}}, Total: 1, Page: query.Page, PageSize: query.PageSize}, nil
}

func asyncTaskTestRouter(lister *asyncTaskListerStub) *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := NewAsyncTaskUserHandler(lister, asyncTaskVerifierStub{})
	router := gin.New()
	group := router.Group("/api/aux/async-tasks")
	group.Use(h.Guard())
	group.GET("", h.List)
	return router
}

func TestAsyncTaskUserHandlerRequiresSub2APIToken(t *testing.T) {
	lister := &asyncTaskListerStub{}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/aux/async-tasks?user_id=42", nil)
	asyncTaskTestRouter(lister).ServeHTTP(response, request)

	require.Equal(t, http.StatusUnauthorized, response.Code)
	require.Zero(t, lister.userID)
}

func TestAsyncTaskUserHandlerUsesVerifiedUserAndFilters(t *testing.T) {
	lister := &asyncTaskListerStub{}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/aux/async-tasks?user_id=99&kind=video&status=pending&page=2&page_size=10"+
		"&model=grok-video&api_key_id=7&keyword=task_1&created_from=2026-09-01T00:00:00%2B08:00&created_to=2026-09-03T00:00:00%2B08:00", nil)
	request.Header.Set("X-Aux-Token", "valid-token")
	asyncTaskTestRouter(lister).ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, int64(42), lister.userID, "query user_id must never select the owner")
	shanghai := time.FixedZone("", 8*3600)
	require.Equal(t, "video", lister.query.Kind)
	require.Equal(t, "pending", lister.query.Status)
	require.Equal(t, "grok-video", lister.query.Model)
	require.Equal(t, int64(7), lister.query.APIKeyID)
	require.Equal(t, "task_1", lister.query.Keyword)
	require.True(t, lister.query.CreatedFrom.Equal(time.Date(2026, 9, 1, 0, 0, 0, 0, shanghai)))
	require.True(t, lister.query.CreatedTo.Equal(time.Date(2026, 9, 3, 0, 0, 0, 0, shanghai)))
	require.Equal(t, 2, lister.query.Page)
	require.Equal(t, 10, lister.query.PageSize)
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Total int `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
	require.Equal(t, 0, envelope.Code)
	require.Equal(t, 1, envelope.Data.Total)
}

func TestAsyncTaskUserHandlerMapsServiceErrors(t *testing.T) {
	cases := map[error]int{
		service.ErrInvalidAsyncTaskFilter: http.StatusBadRequest,
		service.ErrAsyncTaskUnavailable:   http.StatusServiceUnavailable,
	}
	for serviceErr, status := range cases {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/aux/async-tasks", nil)
		request.Header.Set("X-Aux-Token", "valid-token")
		asyncTaskTestRouter(&asyncTaskListerStub{err: serviceErr}).ServeHTTP(response, request)
		require.Equal(t, status, response.Code, serviceErr.Error())
	}

	for _, rawQuery := range []string{"page_size=500", "api_key_id=abc", "api_key_id=0", "created_from=2026-09-01", "created_to=yesterday"} {
		lister := &asyncTaskListerStub{}
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/api/aux/async-tasks?"+rawQuery, nil)
		request.Header.Set("X-Aux-Token", "valid-token")
		asyncTaskTestRouter(lister).ServeHTTP(response, request)
		require.Equal(t, http.StatusBadRequest, response.Code, rawQuery)
		require.Zero(t, lister.userID, rawQuery)
	}
}
