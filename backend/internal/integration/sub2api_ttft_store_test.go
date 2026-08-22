package integration

import (
	"testing"
	"time"

	"sub2api-extension/internal/ttft"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMakeTTFTBucketsUsesRequestedGranularity(t *testing.T) {
	start := time.Date(2026, 8, 21, 0, 0, 0, 0, time.UTC)
	end := start.Add(2*time.Hour + 15*time.Minute)

	minuteBuckets := makeTTFTBuckets(start, end, ttft.GranularityMinute)
	hourBuckets := makeTTFTBuckets(start, end, ttft.GranularityHour)
	dayBuckets := makeTTFTBuckets(start, end, ttft.GranularityDay)

	assert.Len(t, minuteBuckets, 135)
	assert.Len(t, hourBuckets, 3)
	assert.Len(t, dayBuckets, 1)
	assert.Equal(t, start.Add(2*time.Hour), hourBuckets[2].StartTime)
	assert.Equal(t, end, hourBuckets[2].EndTime)
}

func TestTTFTBucketIndexExpressionUsesUnitSeconds(t *testing.T) {
	minute := ttftBucketIndexExpression(ttft.GranularityMinute, 60)
	hour := ttftBucketIndexExpression(ttft.GranularityHour, 24)
	day := ttftBucketIndexExpression(ttft.GranularityDay, 31)

	require.Contains(t, minute, "/ 60")
	require.Contains(t, hour, "/ 3600")
	require.Contains(t, day, "/ 86400")
	assert.Contains(t, minute, "LEAST(59")
}
