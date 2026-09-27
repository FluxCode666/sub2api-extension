package integration

import (
	"encoding/json"
	"testing"

	"aux-system/internal/sub2apimenu"

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

func TestSub2APIMenuStoreManagedMenuID(t *testing.T) {
	require.True(t, isManagedMenuID("aux-page-1"))
	require.True(t, isManagedMenuID("aux-page-42"))
	require.False(t, isManagedMenuID("custom-menu"))
	require.False(t, isManagedMenuID("aux-page-dashboard"))
	require.False(t, isManagedMenuID("aux-page-"))
}

func TestSub2APIMenuStorePublicationMatchesManagedFields(t *testing.T) {
	store := NewSub2APIMenuStore(nil, "https://aux.example.com")
	expected := sub2apimenu.PagePublication{
		MenuID:     "aux-page-7",
		Label:      "Docs",
		URL:        "/p/docs",
		Visibility: "user",
	}
	actual := expected
	actual.URL = "https://aux.example.com/p/docs"

	matched, reason := store.PublicationMatches(expected, actual)
	require.True(t, matched, reason)

	tests := []struct {
		name   string
		mutate func(*sub2apimenu.PagePublication)
	}{
		{name: "label", mutate: func(p *sub2apimenu.PagePublication) { p.Label = "Renamed" }},
		{name: "label whitespace", mutate: func(p *sub2apimenu.PagePublication) { p.Label = " Docs" }},
		{name: "url path", mutate: func(p *sub2apimenu.PagePublication) { p.URL = "https://aux.example.com/p/other" }},
		{name: "url origin", mutate: func(p *sub2apimenu.PagePublication) { p.URL = "https://other.example.com/p/docs" }},
		{name: "visibility", mutate: func(p *sub2apimenu.PagePublication) { p.Visibility = "admin" }},
		{name: "page slug", mutate: func(p *sub2apimenu.PagePublication) { p.PageSlug = "docs" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			changed := actual
			tt.mutate(&changed)
			matched, reason := store.PublicationMatches(expected, changed)
			require.False(t, matched)
			require.NotEmpty(t, reason)
		})
	}
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

func TestSub2APIMenuStoreInvoiceMenuProvidesDefaultIcon(t *testing.T) {
	updated := mergeInvoiceMenuItem(customMenuItem{SortOrder: 7}, "https://aux.example.com/invoice")
	require.Equal(t, "aux-invoice", updated.ID)
	require.Equal(t, "发票管理", updated.Label)
	require.Equal(t, "user", updated.Visibility)
	require.Equal(t, 7, updated.SortOrder)
	require.Contains(t, updated.IconSVG, "<svg")
	require.Contains(t, updated.IconSVG, "currentColor")

	stale := mergeInvoiceMenuItem(customMenuItem{IconSVG: "<svg data-old=\"true\"></svg>", SortOrder: 2}, "https://aux.example.com/invoice")
	require.Equal(t, invoiceMenuIconSVG, stale.IconSVG)
}

func TestSub2APIMenuStoreTicketMenuProvidesDefaultIcon(t *testing.T) {
	updated := mergeTicketMenuItem(customMenuItem{SortOrder: 9}, "https://aux.example.com/tickets")
	require.Equal(t, "aux-tickets", updated.ID)
	require.Equal(t, "工单中心", updated.Label)
	require.Equal(t, "https://aux.example.com/tickets", updated.URL)
	require.Equal(t, "user", updated.Visibility)
	require.Equal(t, 9, updated.SortOrder)
	require.Contains(t, updated.IconSVG, "<svg")

	existing := mergeTicketMenuItem(customMenuItem{IconSVG: "<svg data-custom=\"true\"></svg>", SortOrder: 2}, "https://aux.example.com/tickets")
	require.Equal(t, "<svg data-custom=\"true\"></svg>", existing.IconSVG)
}

func TestSub2APIMenuStoreTicketMenuPreservesExtensionsAndRemovesDuplicates(t *testing.T) {
	items := []customMenuItem{
		{ID: "other", SortOrder: 1},
		{ID: "aux-tickets", IconSVG: "<svg />", SortOrder: 4, extra: map[string]json.RawMessage{"open_in_new_tab": json.RawMessage("true")}},
		{ID: "aux-tickets", SortOrder: 8},
	}

	updated := upsertTicketMenuItems(items, "https://aux.example.com/tickets")

	require.Len(t, updated, 2)
	require.Equal(t, "other", updated[0].ID)
	require.Equal(t, "aux-tickets", updated[1].ID)
	require.Equal(t, 4, updated[1].SortOrder)
	require.Equal(t, json.RawMessage("true"), updated[1].extra["open_in_new_tab"])
	raw, err := json.Marshal(updated[1])
	require.NoError(t, err)
	require.Contains(t, string(raw), `"open_in_new_tab":true`)
}

func TestSub2APIMenuStoreClientImportMenuPreservesExtensionsAndRemovesDuplicates(t *testing.T) {
	items := []customMenuItem{
		{ID: "other", SortOrder: 1},
		{ID: "aux-client-import", IconSVG: "<svg />", SortOrder: 4, extra: map[string]json.RawMessage{"open_in_new_tab": json.RawMessage("true")}},
		{ID: "aux-client-import", SortOrder: 8},
	}

	updated := upsertClientImportMenuItems(items, "https://aux.example.com/client-import")

	require.Len(t, updated, 2)
	require.Equal(t, "other", updated[0].ID)
	require.Equal(t, "aux-client-import", updated[1].ID)
	require.Equal(t, "客户端导入", updated[1].Label)
	require.Equal(t, "https://aux.example.com/client-import", updated[1].URL)
	require.Empty(t, updated[1].PageSlug)
	require.True(t, updated[1].pageSlugPresent)
	require.Equal(t, "user", updated[1].Visibility)
	require.Equal(t, 4, updated[1].SortOrder)
	require.Equal(t, json.RawMessage("true"), updated[1].extra["open_in_new_tab"])
	raw, err := json.Marshal(updated[1])
	require.NoError(t, err)
	require.Contains(t, string(raw), `"page_slug":""`)
}

func TestSub2APIMenuStoreDashboardMenuUsesIframeFields(t *testing.T) {
	item := customMenuItem{
		ID: "aux-dashboard", Label: "控制台", IconSVG: homepageMenuIconSVG,
		URL: "https://aux.example.com/admin/dashboard", Visibility: "admin",
		SortOrder: 3, pageSlugPresent: true,
	}
	raw, err := json.Marshal(item)
	require.NoError(t, err)
	require.Contains(t, string(raw), `"page_slug":""`)
	require.Contains(t, string(raw), `"visibility":"admin"`)
}

func TestSub2APIMenuStoreAsyncTaskMenuUpsertsUserIframeEntry(t *testing.T) {
	desired := customMenuItem{ID: "aux-async-tasks", Label: "异步任务", IconSVG: asyncTaskMenuIconSVG, URL: "https://aux.example.com/async-tasks"}

	appended := upsertUserPortalMenuItems([]customMenuItem{{ID: "other", SortOrder: 6}}, desired)
	require.Len(t, appended, 2)
	require.Equal(t, 7, appended[1].SortOrder)
	require.Equal(t, "user", appended[1].Visibility)
	require.Equal(t, asyncTaskMenuIconSVG, appended[1].IconSVG)

	items := []customMenuItem{
		{ID: "aux-async-tasks", Label: "旧名称", IconSVG: "<svg />", URL: "https://old.example.com", Visibility: "admin", SortOrder: 2, extra: map[string]json.RawMessage{"open_in_new_tab": json.RawMessage("false")}},
		{ID: "other", SortOrder: 5},
		{ID: "aux-async-tasks", SortOrder: 9},
	}
	updated := upsertUserPortalMenuItems(items, desired)

	require.Len(t, updated, 2)
	require.Equal(t, "aux-async-tasks", updated[0].ID)
	require.Equal(t, "异步任务", updated[0].Label)
	require.Equal(t, "https://aux.example.com/async-tasks", updated[0].URL)
	require.Equal(t, "<svg />", updated[0].IconSVG)
	require.Equal(t, "user", updated[0].Visibility)
	require.Equal(t, 2, updated[0].SortOrder)
	require.Equal(t, json.RawMessage("false"), updated[0].extra["open_in_new_tab"])
	raw, err := json.Marshal(updated[0])
	require.NoError(t, err)
	require.Contains(t, string(raw), `"page_slug":""`)
}
