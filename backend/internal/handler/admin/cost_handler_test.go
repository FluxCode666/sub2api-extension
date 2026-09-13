package admin

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

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
