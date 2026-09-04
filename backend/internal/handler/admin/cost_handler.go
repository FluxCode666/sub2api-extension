package admin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sub2api-extension/internal/ops"
	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

type costProvider interface {
	Query(ctx context.Context, query ops.ConsumptionQuery) (*ops.ConsumptionResponse, error)
	GetConfig(ctx context.Context) (ops.CostConfigResponse, error)
	SaveConfig(ctx context.Context, config ops.CostConfig) (ops.CostConfig, error)
	SaveAccountConfig(ctx context.Context, config ops.AccountCostConfig) (ops.AccountCostConfig, error)
	Sync(ctx context.Context) (ops.CostConfigResponse, error)
}

type CostHandler struct{ provider costProvider }

func NewCostHandler(provider *service.CostService) *CostHandler {
	return &CostHandler{provider: provider}
}

func (h *CostHandler) GetConsumption(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.Error(c, http.StatusServiceUnavailable, "sub2api database is unavailable")
		return
	}
	query, err := parseConsumptionQuery(c)
	if err != nil {
		response.BadRequest(c, err.Error())
		return
	}
	data, err := h.provider.Query(c.Request.Context(), query)
	if err != nil {
		if errors.Is(err, service.ErrSub2APIDatabaseUnavailable) {
			response.Error(c, http.StatusServiceUnavailable, "sub2api database is unavailable")
			return
		}
		response.Error(c, http.StatusInternalServerError, "failed to query consumption data")
		return
	}
	response.Success(c, data)
}

func (h *CostHandler) GetConfig(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.Error(c, http.StatusServiceUnavailable, "cost config is unavailable")
		return
	}
	data, err := h.provider.GetConfig(c.Request.Context())
	if err != nil {
		response.Error(c, http.StatusInternalServerError, "failed to read cost config")
		return
	}
	response.Success(c, data)
}

func (h *CostHandler) UpdateConfig(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.Error(c, http.StatusServiceUnavailable, "cost config is unavailable")
		return
	}
	var config ops.CostConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		response.BadRequest(c, "invalid cost config")
		return
	}
	if config.OAuthAccountCost < 0 || config.APICostMultiplier <= 0 || config.TaxRate < 0 || config.TaxRate > 100 || strings.TrimSpace(config.Currency) == "" {
		response.BadRequest(c, "oauth account cost must be non-negative, api multiplier must be positive, tax rate must be between 0 and 100, and currency is required")
		return
	}
	saved, err := h.provider.SaveConfig(c.Request.Context(), config)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, "failed to save cost config")
		return
	}
	response.Success(c, saved)
}

func (h *CostHandler) UpdateAccountConfig(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.Error(c, http.StatusServiceUnavailable, "cost config is unavailable")
		return
	}
	accountID, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || accountID <= 0 {
		response.BadRequest(c, "invalid account id")
		return
	}
	var config ops.AccountCostConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		response.BadRequest(c, "invalid account cost config")
		return
	}
	config.AccountID = accountID
	if config.OAuthAccountCost != nil && *config.OAuthAccountCost < 0 {
		response.BadRequest(c, "oauth account cost must be non-negative")
		return
	}
	if config.APIMultiplierOverride != nil && *config.APIMultiplierOverride <= 0 {
		response.BadRequest(c, "api multiplier override must be positive")
		return
	}
	saved, err := h.provider.SaveAccountConfig(c.Request.Context(), config)
	if err != nil {
		response.Error(c, http.StatusInternalServerError, "failed to save account cost config")
		return
	}
	response.Success(c, saved)
}

func (h *CostHandler) SyncAccounts(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.Error(c, http.StatusServiceUnavailable, "cost account sync is unavailable")
		return
	}
	data, err := h.provider.Sync(c.Request.Context())
	if err != nil {
		if errors.Is(err, service.ErrSub2APIDatabaseUnavailable) {
			response.Error(c, http.StatusServiceUnavailable, "sub2api database is unavailable")
			return
		}
		response.Error(c, http.StatusInternalServerError, "failed to sync account cost config")
		return
	}
	response.Success(c, data)
}

func parseConsumptionQuery(c *gin.Context) (ops.ConsumptionQuery, error) {
	startRaw, endRaw := strings.TrimSpace(c.Query("start")), strings.TrimSpace(c.Query("end"))
	if startRaw == "" {
		startRaw = strings.TrimSpace(c.Query("from"))
	}
	if endRaw == "" {
		endRaw = strings.TrimSpace(c.Query("to"))
	}
	if startRaw == "" && endRaw == "" {
		end := time.Now().UTC()
		return ops.ConsumptionQuery{StartTime: end.Add(-14 * 24 * time.Hour), EndTime: end}, nil
	}
	if startRaw == "" || endRaw == "" {
		return ops.ConsumptionQuery{}, fmt.Errorf("start and end time are required")
	}
	start, err := parseConsumptionTime(startRaw)
	if err != nil {
		return ops.ConsumptionQuery{}, fmt.Errorf("invalid start time")
	}
	end, err := parseConsumptionTime(endRaw)
	if err != nil {
		return ops.ConsumptionQuery{}, fmt.Errorf("invalid end time")
	}
	if !start.Before(end) {
		return ops.ConsumptionQuery{}, fmt.Errorf("start time must be before end time")
	}
	if end.Sub(start) > 93*24*time.Hour {
		return ops.ConsumptionQuery{}, fmt.Errorf("time range cannot exceed 93 days")
	}
	return ops.ConsumptionQuery{StartTime: start, EndTime: end}, nil
}

func parseConsumptionTime(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	for _, layout := range []string{"2006-01-02T15:04", "2006-01-02 15:04:05", "2006-01-02"} {
		if parsed, err := time.ParseInLocation(layout, value, time.Local); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid timestamp")
}
