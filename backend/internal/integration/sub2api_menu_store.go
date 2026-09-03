package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"

	"sub2api-extension/internal/sub2apimenu"
)

const customMenuItemsSettingKey = "custom_menu_items"

// invoiceMenuIconSVG is intentionally inline so the user-facing menu remains
// self-contained in Sub2API's settings and does not depend on an extension
// asset URL. It follows the same currentColor/24px SVG convention used by
// Sub2API's built-in sidebar icons.
const invoiceMenuIconSVG = `<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1 1 0 0 1 20 3v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6A1.3 1.3 0 0 1 4 21V3Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M8 9h8M8 13h8M8 17h5"/></svg>`

// Sub2APIMenuStore 直接读写 sub2api settings 表中的 custom_menu_items 设置。
// 只修改由本扩展创建的菜单项，其余 sub2api 菜单字段会原样保留。
type Sub2APIMenuStore struct {
	db        *sql.DB
	publicURL string
}

func NewSub2APIMenuStore(db *sql.DB, publicURL string) *Sub2APIMenuStore {
	return &Sub2APIMenuStore{db: db, publicURL: strings.TrimRight(strings.TrimSpace(publicURL), "/")}
}

type customMenuItem struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	IconSVG    string `json:"icon_svg"`
	URL        string `json:"url"`
	PageSlug   string `json:"page_slug,omitempty"`
	Visibility string `json:"visibility"`
	SortOrder  int    `json:"sort_order"`
	extra      map[string]json.RawMessage
}

func (item *customMenuItem) UnmarshalJSON(data []byte) error {
	type plain customMenuItem
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	for _, key := range []string{"id", "label", "icon_svg", "url", "page_slug", "visibility", "sort_order"} {
		delete(fields, key)
	}
	*item = customMenuItem(decoded)
	item.extra = fields
	return nil
}

func (item customMenuItem) MarshalJSON() ([]byte, error) {
	fields := make(map[string]json.RawMessage, len(item.extra)+7)
	for key, value := range item.extra {
		fields[key] = value
	}
	put := func(key string, value any) error {
		raw, err := json.Marshal(value)
		if err != nil {
			return err
		}
		fields[key] = raw
		return nil
	}
	if err := put("id", item.ID); err != nil {
		return nil, err
	}
	if err := put("label", item.Label); err != nil {
		return nil, err
	}
	if err := put("icon_svg", item.IconSVG); err != nil {
		return nil, err
	}
	if err := put("url", item.URL); err != nil {
		return nil, err
	}
	if item.PageSlug != "" {
		if err := put("page_slug", item.PageSlug); err != nil {
			return nil, err
		}
	} else {
		delete(fields, "page_slug")
	}
	if err := put("visibility", item.Visibility); err != nil {
		return nil, err
	}
	if err := put("sort_order", item.SortOrder); err != nil {
		return nil, err
	}
	return json.Marshal(fields)
}

func (s *Sub2APIMenuStore) List(ctx context.Context) (map[string]sub2apimenu.PagePublication, error) {
	started := time.Now()
	items, err := s.readItems(ctx)
	if err != nil {
		log.Printf("[Sub2APIMenuStore.List] failed elapsed=%s: %v", time.Since(started), err)
		return nil, err
	}
	result := make(map[string]sub2apimenu.PagePublication)
	for _, item := range items {
		if !isManagedMenuID(item.ID) {
			continue
		}
		result[item.ID] = sub2apimenu.PagePublication{
			MenuID:     item.ID,
			PageID:     strings.TrimPrefix(item.ID, "aux-page-"),
			Label:      item.Label,
			URL:        item.URL,
			PageSlug:   item.PageSlug,
			Visibility: item.Visibility,
		}
	}
	log.Printf("[Sub2APIMenuStore.List] loaded total_items=%d aux_items=%d elapsed=%s", len(items), len(result), time.Since(started))
	return result, nil
}

func (s *Sub2APIMenuStore) Publish(ctx context.Context, publication sub2apimenu.PagePublication) error {
	started := time.Now()
	if s == nil || s.db == nil {
		log.Printf("[Sub2APIMenuStore.Publish] unavailable menu_id=%q slug=%q", publication.MenuID, publication.Slug)
		return errors.New("sub2api database is unavailable")
	}
	if publication.MenuID == "" || publication.Label == "" {
		log.Printf("[Sub2APIMenuStore.Publish] invalid publication menu_id=%q label_present=%t slug=%q", publication.MenuID, publication.Label != "", publication.Slug)
		return errors.New("sub2api menu id and label are required")
	}
	if !isManagedMenuID(publication.MenuID) {
		log.Printf("[Sub2APIMenuStore.Publish] refusing to manage foreign menu_id=%q slug=%q", publication.MenuID, publication.Slug)
		return errors.New("sub2api menu id is not managed by this extension")
	}
	if publication.Visibility != "user" && publication.Visibility != "admin" {
		log.Printf("[Sub2APIMenuStore.Publish] invalid visibility menu_id=%q slug=%q visibility=%q", publication.MenuID, publication.Slug, publication.Visibility)
		return fmt.Errorf("invalid sub2api menu visibility: %s", publication.Visibility)
	}
	menuURL, err := s.absoluteURL(publication.URL)
	if err != nil {
		log.Printf("[Sub2APIMenuStore.Publish] invalid URL menu_id=%q slug=%q: %v", publication.MenuID, publication.Slug, err)
		return err
	}
	// 仅记录 URL 的 host/path，避免误把配置中的 query/userinfo（可能含敏感信息）写入日志。
	if parsed, parseErr := url.Parse(menuURL); parseErr == nil {
		log.Printf("[Sub2APIMenuStore.Publish] resolved URL menu_id=%q slug=%q host=%q path=%q", publication.MenuID, publication.Slug, parsed.Host, parsed.Path)
	}
	if len(menuURL) > 2048 {
		log.Printf("[Sub2APIMenuStore.Publish] URL too long menu_id=%q slug=%q length=%d", publication.MenuID, publication.Slug, len(menuURL))
		return errors.New("sub2api menu URL exceeds 2048 characters")
	}
	err = s.mutate(ctx, func(items []customMenuItem) ([]customMenuItem, error) {
		for i, item := range items {
			if item.ID == publication.MenuID {
				log.Printf("[Sub2APIMenuStore.Publish] updating existing menu_id=%q previous_label=%q previous_visibility=%q", item.ID, item.Label, item.Visibility)
				items[i] = mergePublishedMenuItem(item, publication, menuURL)
				return items, nil
			}
		}
		maxOrder := -1
		for _, item := range items {
			if item.SortOrder > maxOrder {
				maxOrder = item.SortOrder
			}
		}
		log.Printf("[Sub2APIMenuStore.Publish] inserting new menu_id=%q sort_order=%d existing_items=%d", publication.MenuID, maxOrder+1, len(items))
		updated := mergePublishedMenuItem(customMenuItem{SortOrder: maxOrder + 1}, publication, menuURL)
		return append(items, updated), nil
	})
	if err != nil {
		log.Printf("[Sub2APIMenuStore.Publish] failed menu_id=%q page_id=%q slug=%q visibility=%q elapsed=%s: %v", publication.MenuID, publication.PageID, publication.Slug, publication.Visibility, time.Since(started), err)
		return err
	}
	log.Printf("[Sub2APIMenuStore.Publish] succeeded menu_id=%q page_id=%q slug=%q visibility=%q elapsed=%s", publication.MenuID, publication.PageID, publication.Slug, publication.Visibility, time.Since(started))
	return nil
}

// PublicationMatches reports whether a custom menu item still represents the
// extension's desired publication. The menu ID alone is not sufficient: an
// administrator can edit custom_menu_items directly and change the label,
// URL, role, or page_slug while leaving aux-page-<id> intact.
func (s *Sub2APIMenuStore) PublicationMatches(expected, actual sub2apimenu.PagePublication) (bool, string) {
	if s == nil {
		return false, "sub2api menu store unavailable"
	}
	if expected.MenuID != actual.MenuID {
		return false, "menu id changed"
	}
	if expected.Label != actual.Label {
		return false, "menu label changed"
	}
	if expected.Visibility != actual.Visibility {
		return false, "menu visibility changed"
	}
	if expected.PageSlug != actual.PageSlug {
		return false, "menu page_slug changed"
	}
	expectedURL, err := s.absoluteURL(expected.URL)
	if err != nil {
		return false, fmt.Sprintf("expected URL is invalid: %v", err)
	}
	canonicalExpected, err := canonicalMenuURL(expectedURL)
	if err != nil {
		return false, fmt.Sprintf("expected URL is invalid: %v", err)
	}
	canonicalActual, err := canonicalMenuURL(actual.URL)
	if err != nil {
		return false, "actual menu URL is invalid"
	}
	if canonicalExpected != canonicalActual {
		return false, "menu URL changed"
	}
	return true, ""
}

func canonicalMenuURL(raw string) (string, error) {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(raw))
	if err != nil {
		return "", err
	}
	if parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", errors.New("URL must include an http or https host")
	}
	parsed.Scheme = strings.ToLower(parsed.Scheme)
	parsed.Host = strings.ToLower(parsed.Host)
	return parsed.String(), nil
}

// mergePublishedMenuItem keeps sub2api-owned presentation fields while
// enforcing iframe mode for extension URLs. A stale page_slug would make
// sub2api render an internal Markdown page and skip buildEmbeddedUrl, which
// means the extension would not receive the logged-in user's token.
func mergePublishedMenuItem(existing customMenuItem, publication sub2apimenu.PagePublication, menuURL string) customMenuItem {
	return customMenuItem{
		ID:         publication.MenuID,
		Label:      publication.Label,
		IconSVG:    existing.IconSVG,
		URL:        menuURL,
		Visibility: publication.Visibility,
		SortOrder:  existing.SortOrder,
		extra:      existing.extra,
	}
}

func (s *Sub2APIMenuStore) Unpublish(ctx context.Context, menuID string) error {
	started := time.Now()
	if menuID == "" {
		return nil
	}
	if !isManagedMenuID(menuID) {
		log.Printf("[Sub2APIMenuStore.Unpublish] refusing to remove foreign menu_id=%q", menuID)
		return nil
	}
	err := s.mutate(ctx, func(items []customMenuItem) ([]customMenuItem, error) {
		filtered := make([]customMenuItem, 0, len(items))
		removed := 0
		for _, item := range items {
			if item.ID != menuID {
				filtered = append(filtered, item)
			} else {
				removed++
			}
		}
		log.Printf("[Sub2APIMenuStore.Unpublish] filtered menu_id=%q removed=%d remaining_items=%d", menuID, removed, len(filtered))
		return filtered, nil
	})
	if err != nil {
		log.Printf("[Sub2APIMenuStore.Unpublish] failed menu_id=%q elapsed=%s: %v", menuID, time.Since(started), err)
		return err
	}
	log.Printf("[Sub2APIMenuStore.Unpublish] succeeded menu_id=%q elapsed=%s", menuID, time.Since(started))
	return nil
}

// SetInvoiceMenu publishes or removes the customer-facing invoice portal in
// Sub2API's custom menu.  The dedicated stable ID keeps this capability
// separate from database-managed content pages while still preserving every
// unrelated menu item and its ordering.
func (s *Sub2APIMenuStore) SetInvoiceMenu(ctx context.Context, enabled bool) error {
	const menuID = "aux-invoice"
	if s == nil || s.db == nil {
		return errors.New("sub2api database is unavailable")
	}
	if !enabled {
		return s.mutate(ctx, func(items []customMenuItem) ([]customMenuItem, error) {
			filtered := make([]customMenuItem, 0, len(items))
			for _, item := range items {
				if item.ID != menuID {
					filtered = append(filtered, item)
				}
			}
			return filtered, nil
		})
	}
	menuURL, err := s.absoluteURL("/invoice")
	if err != nil {
		return err
	}
	return s.mutate(ctx, func(items []customMenuItem) ([]customMenuItem, error) {
		for i, item := range items {
			if item.ID == menuID {
				items[i] = mergeInvoiceMenuItem(item, menuURL)
				return items, nil
			}
		}
		maxOrder := -1
		for _, item := range items {
			if item.SortOrder > maxOrder {
				maxOrder = item.SortOrder
			}
		}
		return append(items, customMenuItem{ID: menuID, Label: "发票管理", IconSVG: invoiceMenuIconSVG, URL: menuURL, Visibility: "user", SortOrder: maxOrder + 1}), nil
	})
}

func mergeInvoiceMenuItem(existing customMenuItem, menuURL string) customMenuItem {
	return customMenuItem{
		ID:         "aux-invoice",
		Label:      "发票管理",
		IconSVG:    invoiceMenuIconSVG,
		URL:        menuURL,
		Visibility: "user",
		SortOrder:  existing.SortOrder,
		extra:      existing.extra,
	}
}

func (s *Sub2APIMenuStore) absoluteURL(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", errors.New("sub2api menu URL is required")
	}
	if strings.HasPrefix(strings.ToLower(path), "http://") || strings.HasPrefix(strings.ToLower(path), "https://") {
		parsed, err := url.ParseRequestURI(path)
		if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			if err == nil {
				err = errors.New("URL must use http or https")
			}
			return "", fmt.Errorf("invalid sub2api menu URL: %w", err)
		}
		return path, nil
	}
	if s.publicURL == "" {
		return "", errors.New("sub2api public URL is required to publish a page")
	}
	full := s.publicURL + "/" + strings.TrimLeft(path, "/")
	parsed, err := url.ParseRequestURI(full)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		if err == nil {
			err = errors.New("URL must include a host")
		}
		return "", fmt.Errorf("invalid sub2api public URL: %w", err)
	}
	return full, nil
}

// isManagedMenuID reserves the aux-page-<numeric page ID> namespace for this
// extension. All mutations are restricted to this namespace so publishing a
// page can append/update its own entry without replacing unrelated sub2api
// custom menus.
func isManagedMenuID(menuID string) bool {
	const prefix = "aux-page-"
	if !strings.HasPrefix(menuID, prefix) || len(menuID) == len(prefix) {
		return false
	}
	for _, r := range menuID[len(prefix):] {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (s *Sub2APIMenuStore) mutate(ctx context.Context, fn func([]customMenuItem) ([]customMenuItem, error)) (retErr error) {
	started := time.Now()
	log.Printf("[Sub2APIMenuStore.mutate] begin")
	if s == nil || s.db == nil {
		retErr = errors.New("sub2api database is unavailable")
		log.Printf("[Sub2APIMenuStore.mutate] unavailable elapsed=%s: %v", time.Since(started), retErr)
		return retErr
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		retErr = fmt.Errorf("begin sub2api menu transaction: %w", err)
		log.Printf("[Sub2APIMenuStore.mutate] begin transaction failed elapsed=%s: %v", time.Since(started), retErr)
		return retErr
	}
	defer func() {
		if rollbackErr := tx.Rollback(); rollbackErr != nil && !errors.Is(rollbackErr, sql.ErrTxDone) {
			log.Printf("[Sub2APIMenuStore.mutate] rollback failed elapsed=%s: %v", time.Since(started), rollbackErr)
		}
	}()
	log.Printf("[Sub2APIMenuStore.mutate] transaction started")

	items, err := readItemsTx(ctx, tx)
	if err != nil {
		retErr = err
		log.Printf("[Sub2APIMenuStore.mutate] select custom_menu_items FOR UPDATE failed elapsed=%s: %v", time.Since(started), retErr)
		return retErr
	}
	log.Printf("[Sub2APIMenuStore.mutate] loaded items=%d", len(items))
	items, err = fn(items)
	if err != nil {
		retErr = err
		log.Printf("[Sub2APIMenuStore.mutate] mutation callback failed elapsed=%s: %v", time.Since(started), retErr)
		return retErr
	}
	log.Printf("[Sub2APIMenuStore.mutate] mutation produced items=%d", len(items))
	raw, err := json.Marshal(items)
	if err != nil {
		retErr = fmt.Errorf("encode sub2api custom menu items: %w", err)
		log.Printf("[Sub2APIMenuStore.mutate] encode custom_menu_items failed elapsed=%s: %v", time.Since(started), retErr)
		return retErr
	}
	log.Printf("[Sub2APIMenuStore.mutate] encoded custom_menu_items bytes=%d", len(raw))
	const upsert = `
INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
	if _, err := tx.ExecContext(ctx, upsert, customMenuItemsSettingKey, string(raw)); err != nil {
		retErr = fmt.Errorf("write sub2api custom menu items: %w", err)
		log.Printf("[Sub2APIMenuStore.mutate] upsert settings key=%q failed elapsed=%s: %v", customMenuItemsSettingKey, time.Since(started), retErr)
		return retErr
	}
	log.Printf("[Sub2APIMenuStore.mutate] upsert settings key=%q succeeded", customMenuItemsSettingKey)
	if err := tx.Commit(); err != nil {
		retErr = fmt.Errorf("commit sub2api custom menu items: %w", err)
		log.Printf("[Sub2APIMenuStore.mutate] commit failed elapsed=%s: %v", time.Since(started), retErr)
		return retErr
	}
	log.Printf("[Sub2APIMenuStore.mutate] commit succeeded elapsed=%s", time.Since(started))
	return nil
}

func (s *Sub2APIMenuStore) readItems(ctx context.Context) ([]customMenuItem, error) {
	if s == nil || s.db == nil {
		return nil, errors.New("sub2api database is unavailable")
	}
	return readItemsDB(ctx, s.db)
}

type queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func readItemsDB(ctx context.Context, db queryer) ([]customMenuItem, error) {
	started := time.Now()
	var raw string
	err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = $1`, customMenuItemsSettingKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		log.Printf("[Sub2APIMenuStore.readItemsDB] settings key=%q not found elapsed=%s", customMenuItemsSettingKey, time.Since(started))
		return []customMenuItem{}, nil
	}
	if err != nil {
		wrapped := fmt.Errorf("read sub2api custom menu items: %w", err)
		log.Printf("[Sub2APIMenuStore.readItemsDB] query settings key=%q failed elapsed=%s: %v", customMenuItemsSettingKey, time.Since(started), wrapped)
		return nil, wrapped
	}
	items, err := decodeItems(raw)
	if err != nil {
		log.Printf("[Sub2APIMenuStore.readItemsDB] decode settings key=%q failed bytes=%d elapsed=%s: %v", customMenuItemsSettingKey, len(raw), time.Since(started), err)
		return nil, err
	}
	log.Printf("[Sub2APIMenuStore.readItemsDB] loaded settings key=%q bytes=%d items=%d elapsed=%s", customMenuItemsSettingKey, len(raw), len(items), time.Since(started))
	return items, nil
}

func readItemsTx(ctx context.Context, tx *sql.Tx) ([]customMenuItem, error) {
	started := time.Now()
	var raw string
	err := tx.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = $1 FOR UPDATE`, customMenuItemsSettingKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		log.Printf("[Sub2APIMenuStore.readItemsTx] settings key=%q not found elapsed=%s", customMenuItemsSettingKey, time.Since(started))
		return []customMenuItem{}, nil
	}
	if err != nil {
		wrapped := fmt.Errorf("read sub2api custom menu items: %w", err)
		log.Printf("[Sub2APIMenuStore.readItemsTx] SELECT FOR UPDATE key=%q failed elapsed=%s: %v", customMenuItemsSettingKey, time.Since(started), wrapped)
		return nil, wrapped
	}
	items, err := decodeItems(raw)
	if err != nil {
		log.Printf("[Sub2APIMenuStore.readItemsTx] decode key=%q failed bytes=%d elapsed=%s: %v", customMenuItemsSettingKey, len(raw), time.Since(started), err)
		return nil, err
	}
	log.Printf("[Sub2APIMenuStore.readItemsTx] loaded key=%q bytes=%d items=%d elapsed=%s", customMenuItemsSettingKey, len(raw), len(items), time.Since(started))
	return items, nil
}

func decodeItems(raw string) ([]customMenuItem, error) {
	var items []customMenuItem
	if strings.TrimSpace(raw) == "" {
		return []customMenuItem{}, nil
	}
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, fmt.Errorf("decode sub2api custom menu items: %w", err)
	}
	if items == nil {
		items = []customMenuItem{}
	}
	return items, nil
}
