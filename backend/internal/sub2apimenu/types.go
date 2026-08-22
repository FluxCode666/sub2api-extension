package sub2apimenu

import "context"

// PagePublication 是扩展页面在 sub2api custom_menu_items 中的映射。
// MenuID 使用稳定的扩展页面 ID，避免页面 slug 改名时遗留重复菜单。
type PagePublication struct {
	MenuID     string
	PageID     string
	Slug       string
	Label      string
	URL        string
	Visibility string
}

// Publisher 将页面上架配置同步到 sub2api。
type Publisher interface {
	List(ctx context.Context) (map[string]PagePublication, error)
	Publish(ctx context.Context, publication PagePublication) error
	Unpublish(ctx context.Context, menuID string) error
}
