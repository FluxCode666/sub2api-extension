package ttft

import (
	"context"
	"errors"
	"time"
)

// ErrSub2APIDatabaseUnavailable indicates that the optional Sub2API
// PostgreSQL connection has not been configured or is not available.
var ErrSub2APIDatabaseUnavailable = errors.New("sub2api database is unavailable")

type Granularity string

const (
	GranularityMinute Granularity = "minute"
	GranularityHour   Granularity = "hour"
	GranularityDay    Granularity = "day"
)

func (g Granularity) Normalize() Granularity {
	switch g {
	case GranularityMinute, GranularityHour, GranularityDay:
		return g
	default:
		return GranularityHour
	}
}

// Query describes the dimensions supported by the operations latency view.
type Query struct {
	StartTime   time.Time
	EndTime     time.Time
	GroupID     *int64
	AccountID   *int64
	Granularity Granularity
}

type FilterOption struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Platform string `json:"platform,omitempty"`
	Status   string `json:"status,omitempty"`
}

type Segment struct {
	Band      string `json:"band"`
	MinMs     int    `json:"min_ms"`
	MaxMs     *int   `json:"max_ms,omitempty"`
	BandOrder int    `json:"band_order"`
	Count     int64  `json:"count"`
}

type Bucket struct {
	Index       int        `json:"index"`
	StartTime   time.Time  `json:"start_time"`
	EndTime     time.Time  `json:"end_time"`
	SampleCount int64      `json:"sample_count"`
	P50Ms       *int       `json:"p50_ms,omitempty"`
	P95Ms       *int       `json:"p95_ms,omitempty"`
	P99Ms       *int       `json:"p99_ms,omitempty"`
	AvgMs       *int       `json:"avg_ms,omitempty"`
	MaxMs       *int       `json:"max_ms,omitempty"`
	Segments    []*Segment `json:"segments"`
}

type Response struct {
	StartTime    time.Time       `json:"start_time"`
	EndTime      time.Time       `json:"end_time"`
	Granularity  Granularity     `json:"granularity"`
	TotalSamples int64           `json:"total_samples"`
	P50Ms        *int            `json:"p50_ms,omitempty"`
	P95Ms        *int            `json:"p95_ms,omitempty"`
	P99Ms        *int            `json:"p99_ms,omitempty"`
	AvgMs        *int            `json:"avg_ms,omitempty"`
	MaxMs        *int            `json:"max_ms,omitempty"`
	Groups       []*FilterOption `json:"groups"`
	Accounts     []*FilterOption `json:"accounts"`
	Buckets      []*Bucket       `json:"buckets"`
}

// Store is the database adapter contract used by the service layer.
type Store interface {
	Query(ctx context.Context, query Query) (*Response, error)
}
