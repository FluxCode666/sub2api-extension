package integration

import (
	"context"
	"testing"

	"aux-system/internal/ttft"

	"github.com/stretchr/testify/require"
)

func TestSub2APIGroupStoreRequiresDatabase(t *testing.T) {
	_, err := NewSub2APIGroupStore(nil).ListGroups(context.Background())
	require.ErrorIs(t, err, ttft.ErrSub2APIDatabaseUnavailable)

	var store *Sub2APIGroupStore
	_, err = store.ListGroups(context.Background())
	require.ErrorIs(t, err, ttft.ErrSub2APIDatabaseUnavailable)
}
