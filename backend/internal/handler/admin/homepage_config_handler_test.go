package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type homepageConfigStoreStub struct {
	config service.HomepageConfig
}

func (s *homepageConfigStoreStub) GetHomepageConfig(context.Context) (*service.HomepageConfig, error) {
	return &s.config, nil
}

func (s *homepageConfigStoreStub) SaveHomepageConfig(_ context.Context, config service.HomepageConfig) error {
	s.config = config
	return nil
}

type homepageMenuPublisherStub struct {
	homepageCalls     int
	clientImportCalls int
	clientImport      bool
	asyncTaskCalls    int
	asyncTask         bool
	asyncTaskErr      error
}

func (s *homepageMenuPublisherStub) SetHomepageMenu(context.Context, bool, string) error {
	s.homepageCalls++
	return nil
}

func (s *homepageMenuPublisherStub) SetClientImportMenu(_ context.Context, enabled bool) error {
	s.clientImportCalls++
	s.clientImport = enabled
	return nil
}

func (s *homepageMenuPublisherStub) SetAsyncTaskMenu(_ context.Context, enabled bool) error {
	s.asyncTaskCalls++
	s.asyncTask = enabled
	return s.asyncTaskErr
}

func TestHomepageConfigHandlerSyncsAsyncTaskMenu(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &homepageConfigStoreStub{}
	publisher := &homepageMenuPublisherStub{}
	handler := NewHomepageConfigHandler(service.NewHomepageConfigService(store), publisher)

	router := gin.New()
	router.PUT("/config", handler.UpdateConfig)
	request := httptest.NewRequest(http.MethodPut, "/config", strings.NewReader(`{"siteName":"Sub2API","model":"gpt-6-astra","asyncTasksPublished":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, 1, publisher.asyncTaskCalls)
	require.True(t, publisher.asyncTask)
	require.True(t, store.config.AsyncTasksPublished)
	require.NotContains(t, response.Body.String(), `"reason"`)
}

func TestHomepageConfigHandlerWarnsWhenAsyncTaskMenuSyncFails(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &homepageConfigStoreStub{}
	publisher := &homepageMenuPublisherStub{asyncTaskErr: errors.New("menu unavailable")}
	handler := NewHomepageConfigHandler(service.NewHomepageConfigService(store), publisher)

	router := gin.New()
	router.PUT("/config", handler.UpdateConfig)
	request := httptest.NewRequest(http.MethodPut, "/config", strings.NewReader(`{"siteName":"Sub2API","model":"gpt-6-astra","asyncTasksPublished":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	var envelope struct {
		Code   int    `json:"code"`
		Reason string `json:"reason"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
	require.Equal(t, 0, envelope.Code)
	require.NotEmpty(t, envelope.Reason)
	require.True(t, store.config.AsyncTasksPublished)
}

func TestHomepageConfigHandlerSyncsClientImportMenu(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &homepageConfigStoreStub{}
	publisher := &homepageMenuPublisherStub{}
	handler := NewHomepageConfigHandler(service.NewHomepageConfigService(store), publisher)

	router := gin.New()
	router.PUT("/config", handler.UpdateConfig)
	request := httptest.NewRequest(http.MethodPut, "/config", strings.NewReader(`{"siteName":"Sub2API","model":"gpt-6-astra","clientImportPublished":true}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, 1, publisher.homepageCalls)
	require.Equal(t, 1, publisher.clientImportCalls)
	require.True(t, publisher.clientImport)
	require.True(t, store.config.ClientImportPublished)
}
