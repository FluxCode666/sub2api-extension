package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"aux-system/internal/asynctask"
	"aux-system/internal/integration"
	"aux-system/internal/server/middleware"
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
	userID     int64
	query      service.AsyncTaskQuery
	err        error
	token      string
	ref        service.AsyncTaskRef
	refreshErr error
}

func (s *asyncTaskListerStub) ListForUser(_ context.Context, userID int64, query service.AsyncTaskQuery) (service.AsyncTaskList, error) {
	s.userID = userID
	s.query = query
	if s.err != nil {
		return service.AsyncTaskList{}, s.err
	}
	return service.AsyncTaskList{Items: []service.AsyncTask{{ID: "imgtask_1"}}, Total: 1, Page: query.Page, PageSize: query.PageSize}, nil
}

func (s *asyncTaskListerStub) RefreshForUser(_ context.Context, userID int64, token string, ref service.AsyncTaskRef) (service.AsyncTaskRefreshResult, error) {
	s.userID, s.token, s.ref = userID, token, ref
	if s.refreshErr != nil {
		return service.AsyncTaskRefreshResult{}, s.refreshErr
	}
	return service.AsyncTaskRefreshResult{
		Task:            service.AsyncTask{ID: ref.ID, Kind: asynctask.KindVideo, Provider: ref.Provider, Status: asynctask.StatusCompleted},
		UpstreamChecked: true,
		VideoURL:        "https://cdn.example.com/v.mp4",
	}, nil
}

func asyncTaskTestRouter(lister *asyncTaskListerStub) *gin.Engine {
	gin.SetMode(gin.TestMode)
	h := NewAsyncTaskUserHandler(lister, asyncTaskVerifierStub{})
	router := gin.New()
	group := router.Group("/api/aux/async-tasks")
	group.Use(h.Guard())
	group.GET("", h.List)
	group.POST("/refresh", middleware.UserRateLimit(0.5, 5), h.Refresh)
	return router
}

func newAsyncTaskRefreshRequest(body, token string) *http.Request {
	request := httptest.NewRequest(http.MethodPost, "/api/aux/async-tasks/refresh", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("X-Aux-Token", token)
	}
	return request
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

func TestAsyncTaskUserHandlerRefreshRequiresSub2APIToken(t *testing.T) {
	lister := &asyncTaskListerStub{}
	response := httptest.NewRecorder()
	asyncTaskTestRouter(lister).ServeHTTP(response, newAsyncTaskRefreshRequest(`{"kind":"video","id":"req-1","user_id":42}`, ""))

	require.Equal(t, http.StatusUnauthorized, response.Code)
	require.Zero(t, lister.userID)
}

func TestAsyncTaskUserHandlerRefreshUsesVerifiedUser(t *testing.T) {
	lister := &asyncTaskListerStub{}
	response := httptest.NewRecorder()
	asyncTaskTestRouter(lister).ServeHTTP(response, newAsyncTaskRefreshRequest(`{"kind":"video","provider":"seedance","id":"cgt-1","user_id":99}`, "valid-token"))

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, int64(42), lister.userID, "body user_id must never select the owner")
	require.Equal(t, "valid-token", lister.token)
	require.Equal(t, service.AsyncTaskRef{Kind: "video", Provider: "seedance", ID: "cgt-1"}, lister.ref)
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Task            service.AsyncTask `json:"task"`
			UpstreamChecked bool              `json:"upstream_checked"`
			VideoURL        string            `json:"video_url"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
	require.Equal(t, 0, envelope.Code)
	require.Equal(t, "seedance", envelope.Data.Task.Provider)
	require.True(t, envelope.Data.UpstreamChecked)
	require.Equal(t, "https://cdn.example.com/v.mp4", envelope.Data.VideoURL)
}

func TestAsyncTaskUserHandlerRefreshMapsErrors(t *testing.T) {
	cases := []struct {
		err    error
		status int
		reason string
	}{
		{service.ErrInvalidAsyncTaskRef, http.StatusBadRequest, ""},
		{service.ErrAsyncTaskNotFound, http.StatusNotFound, "ASYNC_TASK_NOT_FOUND"},
		{integration.ErrVideoTaskNotFound, http.StatusNotFound, "VIDEO_TASK_NOT_FOUND"},
		{service.ErrAsyncTaskAPIKeyUnavailable, http.StatusConflict, "API_KEY_UNAVAILABLE"},
		{integration.ErrInvalidToken, http.StatusUnauthorized, ""},
		{fmt.Errorf("%w: status 403", integration.ErrVideoStatusRejected), http.StatusUnprocessableEntity, "VIDEO_STATUS_REJECTED"},
		{integration.ErrVideoStatusRateLimited, http.StatusTooManyRequests, "VIDEO_STATUS_RATE_LIMITED"},
		{service.ErrAsyncTaskUnavailable, http.StatusServiceUnavailable, ""},
		{fmt.Errorf("%w: dial", integration.ErrSub2APIUnreachable), http.StatusServiceUnavailable, ""},
		{context.DeadlineExceeded, http.StatusServiceUnavailable, ""},
		{fmt.Errorf("boom"), http.StatusInternalServerError, ""},
	}
	for _, tc := range cases {
		response := httptest.NewRecorder()
		asyncTaskTestRouter(&asyncTaskListerStub{refreshErr: tc.err}).ServeHTTP(response, newAsyncTaskRefreshRequest(`{"kind":"video","id":"req-1"}`, "valid-token"))
		require.Equal(t, tc.status, response.Code, tc.err.Error())
		var envelope struct {
			Code   int    `json:"code"`
			Reason string `json:"reason"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope), tc.err.Error())
		require.Equal(t, tc.status, envelope.Code)
		require.Equal(t, tc.reason, envelope.Reason, tc.err.Error())
		require.NotContains(t, response.Body.String(), "boom")
	}

	for _, body := range []string{`not json`, `{"kind":` + `"` + strings.Repeat("x", 5000) + `"}`} {
		lister := &asyncTaskListerStub{}
		response := httptest.NewRecorder()
		asyncTaskTestRouter(lister).ServeHTTP(response, newAsyncTaskRefreshRequest(body, "valid-token"))
		require.Equal(t, http.StatusBadRequest, response.Code)
		require.Zero(t, lister.userID)
	}
}

func TestAsyncTaskUserHandlerRefreshIsRateLimitedPerUser(t *testing.T) {
	router := asyncTaskTestRouter(&asyncTaskListerStub{})
	codes := make([]int, 0, 7)
	for range 7 {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, newAsyncTaskRefreshRequest(`{"kind":"image","id":"imgtask_1"}`, "valid-token"))
		codes = append(codes, response.Code)
	}
	require.Equal(t, http.StatusOK, codes[0])
	require.Equal(t, http.StatusTooManyRequests, codes[len(codes)-1])
}
