package service

import (
	"context"

	"sub2api-extension/internal/ttft"
)

// Aliases keep the service API readable while the neutral data package avoids
// a service↔integration import cycle (the existing auth service uses the
// integration package for Sub2API HTTP authentication).
type TTFTQuery = ttft.Query
type TTFTGranularity = ttft.Granularity
type TTFTFilterOption = ttft.FilterOption
type TTFTSegment = ttft.Segment
type TTFTBucket = ttft.Bucket
type TTFTResponse = ttft.Response

var ErrSub2APIDatabaseUnavailable = ttft.ErrSub2APIDatabaseUnavailable

const (
	TTFTGranularityMinute = ttft.GranularityMinute
	TTFTGranularityHour   = ttft.GranularityHour
	TTFTGranularityDay    = ttft.GranularityDay
)

// TTFTStore is implemented by the Sub2API database adapter. Keeping the
// interface here makes the service and handler independently testable.
type TTFTStore interface {
	QueryTTFT(ctx context.Context, query TTFTQuery) (*TTFTResponse, error)
}

// TTFTService exposes the filtered first-token latency query to HTTP handlers.
type TTFTService struct {
	store TTFTStore
}

func NewTTFTService(store TTFTStore) *TTFTService {
	return &TTFTService{store: store}
}

func (s *TTFTService) Query(ctx context.Context, query TTFTQuery) (*TTFTResponse, error) {
	if s == nil || s.store == nil {
		return nil, ErrSub2APIDatabaseUnavailable
	}
	return s.store.QueryTTFT(ctx, query)
}
