package integration

import (
	"encoding/json"
	"testing"

	"sub2api-extension/internal/sub2apimenu"

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

func TestSub2APIMenuStorePublishClearsPageSlugForIframeMode(t *testing.T) {
	existing := customMenuItem{ID: "aux-page-1", IconSVG: "<svg />", PageSlug: "stale-internal-page", SortOrder: 4}
	updated := mergePublishedMenuItem(existing, sub2apimenu.PagePublication{
		MenuID:     "aux-page-1",
		Label:      "Dashboard",
		Visibility: "admin",
	}, "https://aux.example.com/admin/dashboard")

	require.Empty(t, updated.PageSlug)
	raw, err := json.Marshal(updated)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "page_slug")
	require.Equal(t, 4, updated.SortOrder)
	require.Equal(t, "<svg />", updated.IconSVG)
}
