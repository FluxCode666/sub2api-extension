package admin

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

type menuAvailabilityStub struct{ available bool }

func (s menuAvailabilityStub) MenuPublishAvailable(context.Context) bool { return s.available }

func TestMenuPublishAvailable(t *testing.T) {
	ctx := context.Background()
	var missing promotionMenuPublisher
	require.False(t, menuPublishAvailable(ctx, missing), "no Sub2API database means no publication")
	require.False(t, menuPublishAvailable(ctx, menuAvailabilityStub{available: false}), "missing public URL must disable publication")
	require.True(t, menuPublishAvailable(ctx, menuAvailabilityStub{available: true}))
	require.True(t, menuPublishAvailable(ctx, struct{}{}), "publishers without probing are treated as available")
}
