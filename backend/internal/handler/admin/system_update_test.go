package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"sub2api-extension/internal/update"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type updateControllerStub struct {
	startedVersion string
	job            *update.Job
}

func (s *updateControllerStub) Status(context.Context) update.Status {
	return update.Status{Enabled: true}
}

func (s *updateControllerStub) Start(_ context.Context, version string) (*update.Job, error) {
	s.startedVersion = version
	if s.job == nil {
		s.job = &update.Job{ID: "test-job", Version: version, Phase: "succeeded", Message: "更新完成，请重启应用"}
	}
	return s.job, nil
}

func TestSystemHandlerStartAllowsEmptyBodyAndReturnsRestartSignal(t *testing.T) {
	gin.SetMode(gin.TestMode)
	controller := &updateControllerStub{}
	router := gin.New()
	router.POST("/system/update", NewSystemHandler(update.Build{}, nil, controller).Start)

	req := httptest.NewRequest(http.MethodPost, "/system/update", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	require.Equal(t, http.StatusOK, resp.Code)
	require.Empty(t, controller.startedVersion)
	var envelope struct {
		Code int `json:"code"`
		Data struct {
			Phase       string `json:"phase"`
			NeedRestart bool   `json:"need_restart"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(resp.Body.Bytes(), &envelope))
	require.Equal(t, 0, envelope.Code)
	require.Equal(t, "succeeded", envelope.Data.Phase)
	require.True(t, envelope.Data.NeedRestart)
}
