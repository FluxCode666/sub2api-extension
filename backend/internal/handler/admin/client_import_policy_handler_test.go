package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"aux-system/internal/integration"
	"aux-system/internal/service"
	"aux-system/internal/ttft"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type clientImportPolicyStoreStub struct {
	policy *service.ClientImportPolicy
}

func (s *clientImportPolicyStoreStub) GetClientImportPolicy(context.Context) (*service.ClientImportPolicy, error) {
	return s.policy, nil
}

func (s *clientImportPolicyStoreStub) SaveClientImportPolicy(_ context.Context, policy service.ClientImportPolicy) error {
	s.policy = &policy
	return nil
}

type clientImportGroupListerStub struct {
	groups []integration.Sub2APIGroup
	err    error
}

func (s clientImportGroupListerStub) ListGroups(context.Context) ([]integration.Sub2APIGroup, error) {
	return s.groups, s.err
}

func newClientImportPolicyRouter(handler *ClientImportPolicyHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/policy", handler.GetPolicy)
	router.PUT("/policy", handler.UpdatePolicy)
	router.GET("/groups", handler.ListGroups)
	return router
}

func TestClientImportPolicyHandlerReturnsUnrestrictedDefault(t *testing.T) {
	handler := &ClientImportPolicyHandler{provider: service.NewClientImportPolicyService(&clientImportPolicyStoreStub{})}
	recorder := httptest.NewRecorder()
	newClientImportPolicyRouter(handler).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/policy", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	var body struct {
		Data service.ClientImportPolicy `json:"data"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Empty(t, body.Data.Platforms)
	require.Empty(t, body.Data.Groups)
	require.Contains(t, recorder.Body.String(), `"platforms":[]`)
	require.Equal(t, service.ClientImportMultiModelCapableIDs, body.Data.MultiModelClients)
}

func TestClientImportPolicyHandlerSavesNormalizedPolicy(t *testing.T) {
	store := &clientImportPolicyStoreStub{}
	handler := &ClientImportPolicyHandler{provider: service.NewClientImportPolicyService(store)}
	request := httptest.NewRequest(http.MethodPut, "/policy", strings.NewReader(`{"platforms":[{"platform":"OpenAI","allowedClients":["pi","codex"]}],"groups":[{"groupId":3,"allowedClients":[]}],"multiModelClients":["pi","chatbox"]}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	newClientImportPolicyRouter(handler).ServeHTTP(recorder, request)

	require.Equal(t, http.StatusOK, recorder.Code)
	require.NotNil(t, store.policy)
	require.Equal(t, []service.ClientImportPlatformRule{{Platform: "openai", AllowedClients: []string{"codex", "pi"}}}, store.policy.Platforms)
	require.Equal(t, []service.ClientImportGroupRule{{GroupID: 3, AllowedClients: []string{}}}, store.policy.Groups)
	require.Equal(t, []string{"chatbox", "pi"}, store.policy.MultiModelClients)
}

func TestClientImportPolicyHandlerRejectsUnknownClients(t *testing.T) {
	store := &clientImportPolicyStoreStub{}
	handler := &ClientImportPolicyHandler{provider: service.NewClientImportPolicyService(store)}
	for _, payload := range []string{`{"platforms":[{"platform":"openai","allowedClients":["cursor"]}]}`, `{"multiModelClients":["claude-code"]}`, `not json`} {
		request := httptest.NewRequest(http.MethodPut, "/policy", strings.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		newClientImportPolicyRouter(handler).ServeHTTP(recorder, request)

		require.Equal(t, http.StatusBadRequest, recorder.Code, payload)
	}
	require.Nil(t, store.policy)
}

func TestClientImportPolicyHandlerListsGroups(t *testing.T) {
	handler := &ClientImportPolicyHandler{groups: clientImportGroupListerStub{groups: []integration.Sub2APIGroup{{ID: 2, Name: "Claude", Platform: "anthropic", Status: "active"}}}}
	recorder := httptest.NewRecorder()
	newClientImportPolicyRouter(handler).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/groups", nil))

	require.Equal(t, http.StatusOK, recorder.Code)
	require.Contains(t, recorder.Body.String(), `"items":[{"id":2,"name":"Claude","platform":"anthropic","status":"active"}]`)
}

func TestClientImportPolicyHandlerReportsUnavailableGroupDatabase(t *testing.T) {
	for _, handler := range []*ClientImportPolicyHandler{
		{},
		{groups: clientImportGroupListerStub{err: ttft.ErrSub2APIDatabaseUnavailable}},
	} {
		recorder := httptest.NewRecorder()
		newClientImportPolicyRouter(handler).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/groups", nil))
		require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	}
}
