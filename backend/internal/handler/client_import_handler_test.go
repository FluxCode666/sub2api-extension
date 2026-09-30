package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"aux-system/internal/integration"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type clientImportKeyListerStub struct {
	keys []integration.Sub2APIKeyInfo
}

func (s clientImportKeyListerStub) ListUserAPIKeys(context.Context, string) ([]integration.Sub2APIKeyInfo, error) {
	return s.keys, nil
}

type clientImportPolicyReaderStub struct {
	policy service.ClientImportPolicy
	err    error
}

func (s clientImportPolicyReaderStub) Get(context.Context) (service.ClientImportPolicy, error) {
	return s.policy, s.err
}

func serveClientImportKeys(t *testing.T, handler *ClientImportHandler) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/keys", handler.ListKeys)
	request := httptest.NewRequest(http.MethodGet, "/keys", nil)
	request.Header.Set("X-Aux-Token", "user-token")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func clientImportAllowed(t *testing.T, recorder *httptest.ResponseRecorder) map[int64][]string {
	t.Helper()
	var body struct {
		Data struct {
			Items []struct {
				ID             int64    `json:"id"`
				AllowedClients []string `json:"allowed_clients"`
			} `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	result := make(map[int64][]string, len(body.Data.Items))
	for _, item := range body.Data.Items {
		require.NotNil(t, item.AllowedClients, "allowed_clients must always be an array")
		result[item.ID] = item.AllowedClients
	}
	return result
}

func TestClientImportHandlerResolvesAllowedClientsPerKey(t *testing.T) {
	groupA, groupB := int64(5), int64(9)
	handler := &ClientImportHandler{
		keys: clientImportKeyListerStub{keys: []integration.Sub2APIKeyInfo{
			{ID: 1, GroupID: &groupA, Group: &integration.Sub2APIKeyGroup{Name: "Claude", Platform: "anthropic"}},
			{ID: 2, GroupID: &groupB, Group: &integration.Sub2APIKeyGroup{Name: "Claude 受限", Platform: "anthropic"}},
			{ID: 3, GroupID: &groupA, Group: &integration.Sub2APIKeyGroup{Name: "GPT", Platform: "openai"}},
			{ID: 4},
		}},
		policy: clientImportPolicyReaderStub{policy: service.ClientImportPolicy{
			Platforms: []service.ClientImportPlatformRule{{Platform: "anthropic", AllowedClients: []string{"claude-code"}}},
			Groups:    []service.ClientImportGroupRule{{GroupID: 9, AllowedClients: []string{}}},
		}},
	}

	recorder := serveClientImportKeys(t, handler)

	require.Equal(t, http.StatusOK, recorder.Code)
	allowed := clientImportAllowed(t, recorder)
	require.Equal(t, []string{"claude-code"}, allowed[1])
	require.Empty(t, allowed[2])
	require.Equal(t, service.ClientImportClientIDs, allowed[3])
	require.Empty(t, allowed[4], "ungrouped keys must not import any client")
}

func TestClientImportHandlerAllowsEveryClientWithoutPolicy(t *testing.T) {
	groupID := int64(5)
	handler := &ClientImportHandler{keys: clientImportKeyListerStub{keys: []integration.Sub2APIKeyInfo{{ID: 1, GroupID: &groupID}}}}

	recorder := serveClientImportKeys(t, handler)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, service.ClientImportClientIDs, clientImportAllowed(t, recorder)[1])
}

func TestClientImportHandlerFailsClosedWhenPolicyCannotLoad(t *testing.T) {
	groupID := int64(5)
	handler := &ClientImportHandler{
		keys:   clientImportKeyListerStub{keys: []integration.Sub2APIKeyInfo{{ID: 1, GroupID: &groupID, Key: "sk-secret"}}},
		policy: clientImportPolicyReaderStub{err: errors.New("database down")},
	}

	recorder := serveClientImportKeys(t, handler)

	require.Equal(t, http.StatusInternalServerError, recorder.Code)
	require.NotContains(t, recorder.Body.String(), "sk-secret")
}

type clientImportModelListerStub struct {
	models  []string
	err     error
	calls   int
	lastKey string
}

func (s *clientImportModelListerStub) ListAPIKeyModels(_ context.Context, apiKey string) ([]string, error) {
	s.calls++
	s.lastKey = apiKey
	return s.models, s.err
}

func serveClientImportKeyModels(t *testing.T, handler *ClientImportHandler, id string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/keys/:id/models", handler.ListKeyModels)
	request := httptest.NewRequest(http.MethodGet, "/keys/"+id+"/models", nil)
	request.Header.Set("X-Aux-Token", "user-token")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

func TestClientImportHandlerListsModelsWithTheOwnedKey(t *testing.T) {
	groupID := int64(5)
	models := &clientImportModelListerStub{models: []string{"claude-opus-5", "claude-sonnet-5"}}
	handler := &ClientImportHandler{
		keys: clientImportKeyListerStub{keys: []integration.Sub2APIKeyInfo{
			{ID: 1, Key: "sk-other", Status: "active", GroupID: &groupID},
			{ID: 3, Key: "sk-selected", Status: "active", GroupID: &groupID},
		}},
		models: models,
	}

	recorder := serveClientImportKeyModels(t, handler, "3")

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Equal(t, "sk-selected", models.lastKey)
	var body struct {
		Data struct {
			Items []string `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Equal(t, []string{"claude-opus-5", "claude-sonnet-5"}, body.Data.Items)
	require.NotContains(t, recorder.Body.String(), "sk-selected")
}

func TestClientImportHandlerRejectsKeysOutsideTheUserList(t *testing.T) {
	groupID := int64(5)
	tests := []struct {
		name string
		id   string
		want int
	}{
		{name: "invalid id", id: "abc", want: http.StatusBadRequest},
		{name: "foreign key", id: "99", want: http.StatusNotFound},
		{name: "inactive key", id: "2", want: http.StatusNotFound},
		{name: "ungrouped key", id: "4", want: http.StatusConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			models := &clientImportModelListerStub{models: []string{"claude-opus-5"}}
			handler := &ClientImportHandler{
				keys: clientImportKeyListerStub{keys: []integration.Sub2APIKeyInfo{
					{ID: 2, Key: "sk-disabled", Status: "disabled", GroupID: &groupID},
					{ID: 4, Key: "sk-ungrouped", Status: "active"},
				}},
				models: models,
			}

			recorder := serveClientImportKeyModels(t, handler, tt.id)

			require.Equal(t, tt.want, recorder.Code)
			require.Zero(t, models.calls, "gateway must not be called")
		})
	}
}

func TestClientImportHandlerMapsGatewayModelErrors(t *testing.T) {
	groupID := int64(5)
	tests := []struct {
		name string
		err  error
		want int
	}{
		{name: "rejected", err: integration.ErrAPIKeyModelsRejected, want: http.StatusUnprocessableEntity},
		{name: "unreachable", err: integration.ErrSub2APIUnreachable, want: http.StatusServiceUnavailable},
		{name: "unexpected", err: errors.New("boom"), want: http.StatusInternalServerError},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := &ClientImportHandler{
				keys:   clientImportKeyListerStub{keys: []integration.Sub2APIKeyInfo{{ID: 3, Key: "sk-secret", Status: "active", GroupID: &groupID}}},
				models: &clientImportModelListerStub{err: tt.err},
			}

			recorder := serveClientImportKeyModels(t, handler, "3")

			require.Equal(t, tt.want, recorder.Code)
			require.NotContains(t, recorder.Body.String(), "sk-secret")
		})
	}
}

func TestClientImportHandlerReturnsEmptyModelArray(t *testing.T) {
	groupID := int64(5)
	handler := &ClientImportHandler{
		keys:   clientImportKeyListerStub{keys: []integration.Sub2APIKeyInfo{{ID: 3, Key: "sk-key", Status: "active", GroupID: &groupID}}},
		models: &clientImportModelListerStub{},
	}

	recorder := serveClientImportKeyModels(t, handler, "3")

	require.Equal(t, http.StatusOK, recorder.Code)
	require.JSONEq(t, `{"code":0,"message":"success","data":{"items":[]}}`, recorder.Body.String())
}

func clientImportMultiModel(t *testing.T, recorder *httptest.ResponseRecorder) []string {
	t.Helper()
	var body struct {
		Data struct {
			MultiModelClients []string `json:"multi_model_clients"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.NotNil(t, body.Data.MultiModelClients, "multi_model_clients must always be an array")
	return body.Data.MultiModelClients
}

func TestClientImportHandlerReturnsMultiModelClients(t *testing.T) {
	groupID := int64(5)
	keys := clientImportKeyListerStub{keys: []integration.Sub2APIKeyInfo{{ID: 1, GroupID: &groupID}}}
	tests := []struct {
		name   string
		policy clientImportPolicyReader
		want   []string
	}{
		{name: "no policy service", want: service.ClientImportMultiModelCapableIDs},
		{name: "legacy policy without field", policy: clientImportPolicyReaderStub{policy: service.ClientImportPolicy{}}, want: service.ClientImportMultiModelCapableIDs},
		{name: "explicitly disabled", policy: clientImportPolicyReaderStub{policy: service.ClientImportPolicy{MultiModelClients: []string{}}}, want: []string{}},
		{name: "subset", policy: clientImportPolicyReaderStub{policy: service.ClientImportPolicy{MultiModelClients: []string{"pi"}}}, want: []string{"pi"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := serveClientImportKeys(t, &ClientImportHandler{keys: keys, policy: tt.policy})

			require.Equal(t, http.StatusOK, recorder.Code)
			require.Equal(t, tt.want, clientImportMultiModel(t, recorder))
		})
	}
}
