package admin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"

	"aux-system/internal/ops"
	"aux-system/internal/service"
)

type costConfigErrorProvider struct {
	costProvider
	err error
}

func (p costConfigErrorProvider) GetConfig(context.Context) (ops.CostConfigResponse, error) {
	return ops.CostConfigResponse{}, p.err
}

func TestGetCostConfigMapsRefreshErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		body   string
	}{
		{"upstream unavailable", fmt.Errorf("read accounts: %w", service.ErrSub2APIDatabaseUnavailable), http.StatusServiceUnavailable, `{"code":503,"message":"sub2api database is unavailable"}`},
		{"storage failure", errors.New("internal database details"), http.StatusInternalServerError, `{"code":500,"message":"failed to read cost config"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			handler := &CostHandler{provider: costConfigErrorProvider{err: tc.err}}
			router := gin.New()
			router.GET("/cost-config", handler.GetConfig)
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/cost-config", nil))
			require.Equal(t, tc.status, recorder.Code)
			require.JSONEq(t, tc.body, recorder.Body.String())
		})
	}
}

func TestParseConsumptionTimeUsesShanghaiForPickerValues(t *testing.T) {
	parsed, err := parseConsumptionTime("2026-09-01")
	require.NoError(t, err)
	require.Equal(t, "2026-08-31T16:00:00Z", parsed.UTC().Format(time.RFC3339))

	parsed, err = parseConsumptionTime("2026-09-01T09:30")
	require.NoError(t, err)
	require.Equal(t, "2026-09-01T01:30:00Z", parsed.UTC().Format(time.RFC3339))
}

func TestParseConsumptionTimePreservesExplicitTimezone(t *testing.T) {
	parsed, err := parseConsumptionTime("2026-09-01T00:00:00+02:00")
	require.NoError(t, err)
	require.Equal(t, "2026-08-31T22:00:00Z", parsed.UTC().Format(time.RFC3339))
}
