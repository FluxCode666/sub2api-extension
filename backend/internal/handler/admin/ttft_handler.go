package admin

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

type ttftProvider interface {
	Query(ctx context.Context, query service.TTFTQuery) (*service.TTFTResponse, error)
}

// TTFTHandler serves the operations first-token latency view. The handler is
// deliberately backed by a provider rather than the Sub2API HTTP client: the
// provider reads the configured Sub2API PostgreSQL database directly.
type TTFTHandler struct {
	provider ttftProvider
}

func NewTTFTHandler(provider *service.TTFTService) *TTFTHandler {
	return &TTFTHandler{provider: provider}
}

// GetTTFT handles GET /api/aux/admin/ops/ttft.
//
// Supported filters:
//   - start/end: RFC3339 or local "YYYY-MM-DDTHH:mm" timestamps
//   - date + start_time/end_time: convenient date/time controls for the UI
//   - group_id and account_id: exact Sub2API database IDs
//   - granularity: minute, hour (default), or day
func (h *TTFTHandler) GetTTFT(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.Error(c, http.StatusServiceUnavailable, "sub2api database is unavailable")
		return
	}
	query, err := parseTTFTQuery(c)
	if err != nil {
		log.Printf("[TTFTHandler.GetTTFT] invalid query: %v", err)
		response.BadRequest(c, err.Error())
		return
	}
	data, err := h.provider.Query(c.Request.Context(), query)
	if err != nil {
		log.Printf("[TTFTHandler.GetTTFT] query failed: %v", err)
		if errors.Is(err, service.ErrSub2APIDatabaseUnavailable) {
			response.Error(c, http.StatusServiceUnavailable, "sub2api database is unavailable")
			return
		}
		response.Error(c, http.StatusInternalServerError, "failed to query sub2api usage data")
		return
	}
	response.Success(c, data)
}

func parseTTFTQuery(c *gin.Context) (service.TTFTQuery, error) {
	if c == nil {
		return service.TTFTQuery{}, fmt.Errorf("invalid request")
	}
	now := time.Now().UTC()
	startRaw := firstQueryValue(c, "start", "from")
	endRaw := firstQueryValue(c, "end", "to")
	dateRaw := strings.TrimSpace(c.Query("date"))
	startClock := strings.TrimSpace(c.Query("start_time"))
	endClock := strings.TrimSpace(c.Query("end_time"))

	// The date/time controls are intentionally accepted by the backend too,
	// making bookmarked filter URLs portable and easy to inspect.
	if startRaw == "" && dateRaw != "" {
		if startClock == "" {
			startClock = "00:00"
		}
		startRaw = dateRaw + "T" + startClock
	}
	if endRaw == "" && dateRaw != "" {
		if endClock == "" {
			endClock = "23:59"
		}
		endRaw = dateRaw + "T" + endClock
	}

	var start, end time.Time
	var err error
	switch {
	case startRaw == "" && endRaw == "":
		end = now
		start = end.Add(-24 * time.Hour)
	case startRaw == "":
		end, err = parseTTFTTime(endRaw)
		if err != nil {
			return service.TTFTQuery{}, fmt.Errorf("invalid end time")
		}
		start = end.Add(-24 * time.Hour)
	case endRaw == "":
		start, err = parseTTFTTime(startRaw)
		if err != nil {
			return service.TTFTQuery{}, fmt.Errorf("invalid start time")
		}
		end = now
	default:
		start, err = parseTTFTTime(startRaw)
		if err != nil {
			return service.TTFTQuery{}, fmt.Errorf("invalid start time")
		}
		end, err = parseTTFTTime(endRaw)
		if err != nil {
			return service.TTFTQuery{}, fmt.Errorf("invalid end time")
		}
	}
	if !start.Before(end) {
		return service.TTFTQuery{}, fmt.Errorf("start time must be before end time")
	}
	if end.Sub(start) > 31*24*time.Hour {
		return service.TTFTQuery{}, fmt.Errorf("time range cannot exceed 31 days")
	}

	groupID, err := positiveQueryID(c.Query("group_id"), "group_id")
	if err != nil {
		return service.TTFTQuery{}, err
	}
	accountID, err := positiveQueryID(c.Query("account_id"), "account_id")
	if err != nil {
		return service.TTFTQuery{}, err
	}
	granularity, err := parseTTFTGranularity(c.Query("granularity"))
	if err != nil {
		return service.TTFTQuery{}, err
	}
	return service.TTFTQuery{StartTime: start, EndTime: end, GroupID: groupID, AccountID: accountID, Granularity: granularity}, nil
}

func parseTTFTGranularity(raw string) (service.TTFTGranularity, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	if value == "" {
		return service.TTFTGranularityHour, nil
	}
	granularity := service.TTFTGranularity(value)
	switch granularity {
	case service.TTFTGranularityMinute, service.TTFTGranularityHour, service.TTFTGranularityDay:
		return granularity, nil
	default:
		return "", fmt.Errorf("invalid granularity: must be minute, hour, or day")
	}
}

func firstQueryValue(c *gin.Context, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(c.Query(key)); value != "" {
			return value
		}
	}
	return ""
}

func parseTTFTTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
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

func positiveQueryID(raw, name string) (*int64, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || id <= 0 {
		return nil, fmt.Errorf("invalid %s", name)
	}
	return &id, nil
}
