// Package service 提供附属内容系统的业务逻辑层。
//
// telemetry_store 是 TelemetryStore 接口的 ent 实现(适配器)。
// 将 service 层的存储抽象桥接到 ent 生成的 client。
package service

import (
	"context"

	"sub2api-extension/ent"
)

// entTelemetryStore 用 *ent.Client 实现 TelemetryStore。
type entTelemetryStore struct {
	client *ent.Client
}

// NewEntTelemetryStore 用 ent client 创建存储适配器。
func NewEntTelemetryStore(client *ent.Client) TelemetryStore {
	return &entTelemetryStore{client: client}
}

// CreatePageView 插入一条页面访问记录到 page_views 表。
func (s *entTelemetryStore) CreatePageView(ctx context.Context, rec PageViewRecord) error {
	return s.client.PageView.Create().
		SetPageID(rec.PageID).
		SetVisitorID(rec.VisitorID).
		SetIsAdmin(rec.IsAdmin).
		SetCreatedAt(rec.CreatedAt).
		Exec(ctx)
}

// CreateFeatureClick 插入一条功能点击记录到 feature_clicks 表。
func (s *entTelemetryStore) CreateFeatureClick(ctx context.Context, rec FeatureClickRecord) error {
	return s.client.FeatureClick.Create().
		SetPageID(rec.PageID).
		SetFeatureID(rec.FeatureID).
		SetVisitorID(rec.VisitorID).
		SetIsAdmin(rec.IsAdmin).
		SetCreatedAt(rec.CreatedAt).
		Exec(ctx)
}
