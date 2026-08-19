// Package service 提供附属内容系统的业务逻辑层。
//
// analytics_store 是 AnalyticsStore 接口的 ent 实现(适配器)。
// 与 telemetry_store 共享同一 ent client, 但职责分离:
//   - telemetry_store(TelemetryStore): 写入埋点记录(Create)
//   - analytics_store(AnalyticsStore): 聚合读取埋点记录(GroupBy + Count)
//
// 后端不持有 page-registry(KTD7: registry 在前端), 只返回埋点库中存在的
// page id 及其计数(含已删除页面的历史记录)。前端用 registry 关联:
//   - registry 有但埋点库无 → 零访问(前端显示 0)
//   - 埋点库有但 registry 无 → 历史数据(前端过滤)
//
// Covers U6(R5/R8/R9/R10), KTD7(按 page id 关联)。
package service

import (
	"context"

	"sub2api-extension/ent"
	"sub2api-extension/ent/featureclick"
	"sub2api-extension/ent/pageview"
)

// PageViewCount 按 page_id 聚合的页面访问计数(U6 仪表盘用)。
type PageViewCount struct {
	PageID string
	Count  int
}

// FeatureClickCount 按 page_id + feature_id 聚合的功能点击计数(U6 仪表盘用)。
type FeatureClickCount struct {
	PageID    string
	FeatureID string
	Count     int
}

// AnalyticsStore 抽象埋点聚合读取能力。
// *ent.Client 通过 entTelemetryStore(同结构体, 见 telemetry_store.go) 实现该接口。
// 测试可注入 mock 验证聚合逻辑(不依赖真实 DB)。
type AnalyticsStore interface {
	// CountPageViewsByPageID 按 page_id 分组聚合计数 page_views。
	// 返回埋点库中存在记录的每个 page_id 及其计数(无记录的 page 不在此列表)。
	CountPageViewsByPageID(ctx context.Context) ([]PageViewCount, error)
	// CountFeatureClicksByFeature 按 page_id + feature_id 分组聚合计数 feature_clicks。
	CountFeatureClicksByFeature(ctx context.Context) ([]FeatureClickCount, error)
}

// NewEntAnalyticsStore 用 ent client 创建聚合读取存储适配器。
// 与 NewEntTelemetryStore 共享同一 ent client(写入与读取互不干扰)。
func NewEntAnalyticsStore(client *ent.Client) AnalyticsStore {
	return &entTelemetryStore{client: client}
}

// CountPageViewsByPageID 按 page_id 分组聚合计数 page_views。
//
// 用 ent GroupBy + ent.Count() 聚合(效率优于查全部在内存聚合)。
// 返回结果未排序(排序由 service 层负责)。
func (s *entTelemetryStore) CountPageViewsByPageID(ctx context.Context) ([]PageViewCount, error) {
	var v []struct {
		PageID string `json:"page_id"`
		Count  int    `json:"count"`
	}
	err := s.client.PageView.Query().
		GroupBy(pageview.FieldPageID).
		Aggregate(ent.Count()).
		Scan(ctx, &v)
	if err != nil {
		return nil, err
	}
	result := make([]PageViewCount, 0, len(v))
	for _, r := range v {
		result = append(result, PageViewCount{PageID: r.PageID, Count: r.Count})
	}
	return result, nil
}

// CountFeatureClicksByFeature 按 page_id + feature_id 分组聚合计数 feature_clicks。
//
// 用 ent GroupBy(两字段) + ent.Count() 聚合。
// 返回结果未排序(排序由 service 层负责)。
func (s *entTelemetryStore) CountFeatureClicksByFeature(ctx context.Context) ([]FeatureClickCount, error) {
	var v []struct {
		PageID    string `json:"page_id"`
		FeatureID string `json:"feature_id"`
		Count     int    `json:"count"`
	}
	err := s.client.FeatureClick.Query().
		GroupBy(featureclick.FieldPageID, featureclick.FieldFeatureID).
		Aggregate(ent.Count()).
		Scan(ctx, &v)
	if err != nil {
		return nil, err
	}
	result := make([]FeatureClickCount, 0, len(v))
	for _, r := range v {
		result = append(result, FeatureClickCount{
			PageID:    r.PageID,
			FeatureID: r.FeatureID,
			Count:     r.Count,
		})
	}
	return result, nil
}
