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

// publicURLMenuPublisherStub 模拟菜单存储：系统配置值优先，其次环境变量。
type publicURLMenuPublisherStub struct {
	homepageMenuPublisherStub
	store       *homepageConfigStoreStub
	env         string
	rebaseCalls [][2]string
	rebaseErr   error
}

func (s *publicURLMenuPublisherStub) EffectivePublicURL(context.Context) (string, string) {
	if s.store.config.ExtensionPublicURL != "" {
		return s.store.config.ExtensionPublicURL, "config"
	}
	if s.env != "" {
		return s.env, "env"
	}
	return "", ""
}

func (s *publicURLMenuPublisherStub) MenuPublishAvailable(ctx context.Context) bool {
	base, _ := s.EffectivePublicURL(ctx)
	return base != ""
}

func (s *publicURLMenuPublisherStub) RebasePublicURL(_ context.Context, oldBase, newBase string) error {
	s.rebaseCalls = append(s.rebaseCalls, [2]string{oldBase, newBase})
	return s.rebaseErr
}

func putHomepageConfig(t *testing.T, handler *HomepageConfigHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PUT("/config", handler.UpdateConfig)
	request := httptest.NewRequest(http.MethodPut, "/config", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	return response
}

type homepageConfigEnvelope struct {
	Code   int    `json:"code"`
	Reason string `json:"reason"`
	Data   struct {
		ExtensionPublicURL string               `json:"extensionPublicUrl"`
		MenuPublication    *menuPublicationView `json:"menuPublication"`
	} `json:"data"`
}

func TestHomepageConfigHandlerReconcilesMenusWhenPublicURLFirstConfigured(t *testing.T) {
	store := &homepageConfigStoreStub{}
	publisher := &publicURLMenuPublisherStub{store: store}
	handler := NewHomepageConfigHandler(service.NewHomepageConfigService(store), publisher)
	reconciled := 0
	handler.SetMenuReconciler(func(context.Context) error {
		reconciled++
		return nil
	})

	response := putHomepageConfig(t, handler, `{"siteName":"Sub2API","extensionPublicUrl":"https://code.example.com/aux/"}`)

	require.Equal(t, http.StatusOK, response.Code)
	var envelope homepageConfigEnvelope
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
	require.Empty(t, envelope.Reason)
	require.Equal(t, "https://code.example.com/aux", envelope.Data.ExtensionPublicURL)
	require.NotNil(t, envelope.Data.MenuPublication)
	require.Equal(t, menuPublicationView{Available: true, EffectiveURL: "https://code.example.com/aux", Source: "config"}, *envelope.Data.MenuPublication)
	require.Equal(t, 1, reconciled)
	require.Empty(t, publisher.rebaseCalls, "nothing to rebase when there was no previous URL")
}

func TestHomepageConfigHandlerRebasesMenusWhenPublicURLChanges(t *testing.T) {
	store := &homepageConfigStoreStub{}
	publisher := &publicURLMenuPublisherStub{store: store, env: "https://old.example.com/aux", rebaseErr: errors.New("tx failed")}
	handler := NewHomepageConfigHandler(service.NewHomepageConfigService(store), publisher)
	reconciled := 0
	handler.SetMenuReconciler(func(context.Context) error {
		reconciled++
		return nil
	})

	response := putHomepageConfig(t, handler, `{"siteName":"Sub2API","extensionPublicUrl":"https://code.example.com/aux"}`)

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, [][2]string{{"https://old.example.com/aux", "https://code.example.com/aux"}}, publisher.rebaseCalls)
	require.Zero(t, reconciled, "reconcile only runs when the URL becomes available for the first time")
	var envelope homepageConfigEnvelope
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &envelope))
	require.NotEmpty(t, envelope.Reason, "rebase failure must surface as a save warning")
	require.Equal(t, "https://code.example.com/aux", store.config.ExtensionPublicURL)
}

func TestHomepageConfigHandlerRejectsInvalidExtensionPublicURL(t *testing.T) {
	store := &homepageConfigStoreStub{}
	publisher := &publicURLMenuPublisherStub{store: store}
	handler := NewHomepageConfigHandler(service.NewHomepageConfigService(store), publisher)

	response := putHomepageConfig(t, handler, `{"siteName":"Sub2API","extensionPublicUrl":"https://user:pass@code.example.com"}`)

	require.Equal(t, http.StatusBadRequest, response.Code)
	require.Zero(t, publisher.homepageCalls)
	require.Empty(t, store.config.ExtensionPublicURL)
}

func TestHomepageConfigHandlerPublicConfigHidesExtensionPublicURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := &homepageConfigStoreStub{config: service.HomepageConfig{SiteName: "Sub2API", ExtensionPublicURL: "https://code.example.com/aux", Sub2APIPublished: true}}
	publisher := &publicURLMenuPublisherStub{store: store}
	handler := NewHomepageConfigHandler(service.NewHomepageConfigService(store), publisher)

	router := gin.New()
	router.GET("/public", handler.GetPublicConfig)
	router.GET("/admin", handler.GetConfig)

	publicResponse := httptest.NewRecorder()
	router.ServeHTTP(publicResponse, httptest.NewRequest(http.MethodGet, "/public", nil))
	require.Equal(t, http.StatusOK, publicResponse.Code)
	require.NotContains(t, publicResponse.Body.String(), "code.example.com")
	require.NotContains(t, publicResponse.Body.String(), "menuPublication")

	adminResponse := httptest.NewRecorder()
	router.ServeHTTP(adminResponse, httptest.NewRequest(http.MethodGet, "/admin", nil))
	var envelope homepageConfigEnvelope
	require.NoError(t, json.Unmarshal(adminResponse.Body.Bytes(), &envelope))
	require.Equal(t, "https://code.example.com/aux", envelope.Data.ExtensionPublicURL)
	require.NotNil(t, envelope.Data.MenuPublication)
	require.Equal(t, "config", envelope.Data.MenuPublication.Source)
}
