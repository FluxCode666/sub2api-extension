package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"sub2api-extension/internal/sub2apimenu"
)

const customMenuItemsSettingKey = "custom_menu_items"

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
	items, err := s.readItems(ctx)
	if err != nil {
		return nil, err
	}
	result := make(map[string]sub2apimenu.PagePublication)
	for _, item := range items {
		if !strings.HasPrefix(item.ID, "aux-page-") {
			continue
		}
		result[item.ID] = sub2apimenu.PagePublication{
			MenuID:     item.ID,
			PageID:     strings.TrimPrefix(item.ID, "aux-page-"),
			Label:      item.Label,
			URL:        item.URL,
			Visibility: item.Visibility,
		}
	}
	return result, nil
}

func (s *Sub2APIMenuStore) Publish(ctx context.Context, publication sub2apimenu.PagePublication) error {
	if s == nil || s.db == nil {
		return errors.New("sub2api database is unavailable")
	}
	if publication.MenuID == "" || publication.Label == "" {
		return errors.New("sub2api menu id and label are required")
	}
	if publication.Visibility != "user" && publication.Visibility != "admin" {
		return fmt.Errorf("invalid sub2api menu visibility: %s", publication.Visibility)
	}
	menuURL, err := s.absoluteURL(publication.URL)
	if err != nil {
		return err
	}
	if len(menuURL) > 2048 {
		return errors.New("sub2api menu URL exceeds 2048 characters")
	}
	return s.mutate(ctx, func(items []customMenuItem) ([]customMenuItem, error) {
		updated := customMenuItem{
			ID:         publication.MenuID,
			Label:      publication.Label,
			URL:        menuURL,
			Visibility: publication.Visibility,
		}
		for i, item := range items {
			if item.ID == publication.MenuID {
				updated.IconSVG = item.IconSVG
				updated.PageSlug = item.PageSlug
				updated.SortOrder = item.SortOrder
				updated.extra = item.extra
				items[i] = updated
				return items, nil
			}
		}
		maxOrder := -1
		for _, item := range items {
			if item.SortOrder > maxOrder {
				maxOrder = item.SortOrder
			}
		}
		updated.SortOrder = maxOrder + 1
		return append(items, updated), nil
	})
}

func (s *Sub2APIMenuStore) Unpublish(ctx context.Context, menuID string) error {
	if menuID == "" {
		return nil
	}
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

func (s *Sub2APIMenuStore) mutate(ctx context.Context, fn func([]customMenuItem) ([]customMenuItem, error)) error {
	if s == nil || s.db == nil {
		return errors.New("sub2api database is unavailable")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin sub2api menu transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	items, err := readItemsTx(ctx, tx)
	if err != nil {
		return err
	}
	items, err = fn(items)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(items)
	if err != nil {
		return fmt.Errorf("encode sub2api custom menu items: %w", err)
	}
	const upsert = `
INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`
	if _, err := tx.ExecContext(ctx, upsert, customMenuItemsSettingKey, string(raw)); err != nil {
		return fmt.Errorf("write sub2api custom menu items: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit sub2api custom menu items: %w", err)
	}
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
	var raw string
	err := db.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = $1`, customMenuItemsSettingKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return []customMenuItem{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read sub2api custom menu items: %w", err)
	}
	return decodeItems(raw)
}

func readItemsTx(ctx context.Context, tx *sql.Tx) ([]customMenuItem, error) {
	var raw string
	err := tx.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = $1 FOR UPDATE`, customMenuItemsSettingKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return []customMenuItem{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read sub2api custom menu items: %w", err)
	}
	return decodeItems(raw)
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
