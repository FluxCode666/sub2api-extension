package integration

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSub2APIMenuStoreAbsoluteURL(t *testing.T) {
	store := NewSub2APIMenuStore(nil, "https://aux.example.com/")

	got, err := store.absoluteURL("/admin/p/docs")
	require.NoError(t, err)
	require.Equal(t, "https://aux.example.com/admin/p/docs", got)

	got, err = store.absoluteURL("https://other.example.com/p/docs")
	require.NoError(t, err)
	require.Equal(t, "https://other.example.com/p/docs", got)
}

func TestSub2APIMenuStoreAbsoluteURLRequiresPublicOrigin(t *testing.T) {
	store := NewSub2APIMenuStore(nil, "")
	_, err := store.absoluteURL("/p/docs")
	require.ErrorContains(t, err, "public URL is required")
}

func TestDecodeItems(t *testing.T) {
	items, err := decodeItems(`[{"id":"other","label":"Other","url":"https://example.com","visibility":"user","sort_order":2,"future_flag":true}]`)
	require.NoError(t, err)
	require.Len(t, items, 1)
	require.Equal(t, "other", items[0].ID)
	require.Equal(t, 2, items[0].SortOrder)
	raw, err := json.Marshal(items)
	require.NoError(t, err)
	require.Contains(t, string(raw), `"future_flag":true`)
}
