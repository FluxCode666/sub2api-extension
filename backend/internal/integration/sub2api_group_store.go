package integration

import (
	"context"
	"database/sql"
	"fmt"
	"log"

	"aux-system/internal/ttft"
)

// Sub2APIGroup 是管理端选择分组规则时展示的 Sub2API 分组。
type Sub2APIGroup struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Platform string `json:"platform"`
	Status   string `json:"status"`
}

// Sub2APIGroupStore 只读查询 Sub2API groups 表，供管理端配置客户端导入限制时选择分组。
type Sub2APIGroupStore struct {
	db *sql.DB
}

func NewSub2APIGroupStore(db *sql.DB) *Sub2APIGroupStore {
	return &Sub2APIGroupStore{db: db}
}

// ListGroups 返回未删除的分组；未配置 Sub2API 数据库时返回 ErrSub2APIDatabaseUnavailable。
func (s *Sub2APIGroupStore) ListGroups(ctx context.Context) ([]Sub2APIGroup, error) {
	if s == nil || s.db == nil {
		return nil, ttft.ErrSub2APIDatabaseUnavailable
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(platform, ''), COALESCE(status, '')
		FROM groups
		WHERE deleted_at IS NULL
		ORDER BY sort_order ASC, name ASC, id ASC`)
	if err != nil {
		return nil, fmt.Errorf("list sub2api groups: %w", err)
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("[Sub2APIGroupStore.ListGroups] failed to close rows: %v", closeErr)
		}
	}()

	result := make([]Sub2APIGroup, 0)
	for rows.Next() {
		var item Sub2APIGroup
		if err := rows.Scan(&item.ID, &item.Name, &item.Platform, &item.Status); err != nil {
			return nil, fmt.Errorf("scan sub2api group: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sub2api groups: %w", err)
	}
	return result, nil
}
