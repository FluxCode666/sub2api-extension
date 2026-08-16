// Package service 提供附属内容系统的业务逻辑层。
//
// analytics_service 负责埋点数据的聚合查询(U6 仪表盘数据源)。
//
// 设计要点(KTD7: page-registry 与埋点按 page id 关联):
//   - 后端不持有 page-registry, 只从埋点库聚合计数。
//   - 后端返回埋点库中所有 page_id 的 page view 计数, 不判断页面是否仍存在。
//   - 前端用 page-registry 派生当前清单, 与后端计数按 id 关联:
//   - registry 有但埋点库无 → 零访问(前端显示 0, 后端不返回此项)
//   - 埋点库有但 registry 无 → 历史数据保留, 前端不展示
//   - 功能使用度按 feature click 计数降序排序(R9/R10: 哪些功能用得更多)。
//
// Covers U6(R5/R8/R9/R10), KTD7(按 page id 关联)。
package service

import (
	"context"
	"errors"
	"sort"
	"sync"
)

// OverviewResponse 仪表盘概览响应(U6 端点返回)。
//
// 后端不耦合 page-registry, 只返回埋点库中存在的 page id 及计数。
// 前端用 registry 关联(见 DashboardPage.tsx)。
type OverviewResponse struct {
	// PageViews 按 page_id 分组的页面访问计数(仅含有记录的 page, 未排序)。
	// registry 有但此列表无的 page → 零访问(前端显示 0)。
	// 此列表有但 registry 无的 page → 历史数据(前端过滤)。
	PageViews []PageViewCountDTO `json:"page_views"`
	// FeatureClicks 按 feature 聚合的功能点击计数, 已按计数降序排序(R9/R10)。
	FeatureClicks []FeatureClickCountDTO `json:"feature_clicks"`
}

// PageViewCountDTO 页面访问计数(传输用)。
type PageViewCountDTO struct {
	PageID string `json:"page_id"`
	Count  int    `json:"count"`
}

// FeatureClickCountDTO 功能点击计数(传输用)。
type FeatureClickCountDTO struct {
	PageID    string `json:"page_id"`
	FeatureID string `json:"feature_id"`
	Count     int    `json:"count"`
}

// AnalyticsService 聚合查询服务(U6 仪表盘数据源)。
type AnalyticsService struct {
	store AnalyticsStore
}

// NewAnalyticsService 创建聚合服务。
func NewAnalyticsService(store AnalyticsStore) *AnalyticsService {
	return &AnalyticsService{store: store}
}

// GetOverview 返回仪表盘概览数据:
//   - 各 page_id 的访问计数(按 page_id 分组, 仅含有记录的 page)
//   - 各 feature 的点击计数(按 page_id+feature_id 分组, 按计数降序排序)
//
// 后端不耦合 page-registry(见 KTD7): 零访问页不在 PageViews 列表(前端显示 0);
// 已删除页面仍在 PageViews 列表中, 由前端按当前 registry 过滤。
//
// 两次聚合查询互不依赖(分别读 page_views 与 feature_clicks 表), 并发执行。
func (s *AnalyticsService) GetOverview(ctx context.Context) (*OverviewResponse, error) {
	var (
		pageViews     []PageViewCount
		featureClicks []FeatureClickCount
		mu            sync.Mutex
		firstErr      error
		secondErr     error // 保留第二个并发错误,避免被静默吞掉(#12)
		wg            sync.WaitGroup
	)

	wg.Add(2)
	go func() {
		defer wg.Done()
		pv, err := s.store.CountPageViewsByPageID(ctx)
		mu.Lock()
		if err != nil {
			if firstErr == nil {
				firstErr = err
			} else {
				secondErr = err
			}
		} else {
			pageViews = pv
		}
		mu.Unlock()
	}()
	go func() {
		defer wg.Done()
		fc, err := s.store.CountFeatureClicksByFeature(ctx)
		mu.Lock()
		if err != nil {
			if firstErr == nil {
				firstErr = err
			} else {
				secondErr = err
			}
		} else {
			featureClicks = fc
		}
		mu.Unlock()
	}()
	wg.Wait()

	if firstErr != nil {
		// 用 errors.Join 保留两个并发错误,使双失败场景可诊断(#12)。
		// 调用方仍据 firstErr 的 errors.Is 判定错误类型(Join 保留链)。
		return nil, errors.Join(firstErr, secondErr)
	}

	// 功能使用度按计数降序排序(R9/R10: 哪些功能用得更多)。
	sort.Slice(featureClicks, func(i, j int) bool {
		if featureClicks[i].Count != featureClicks[j].Count {
			return featureClicks[i].Count > featureClicks[j].Count
		}
		// 计数相同时按 page_id + feature_id 稳定排序(避免测试不确定)
		if featureClicks[i].PageID != featureClicks[j].PageID {
			return featureClicks[i].PageID < featureClicks[j].PageID
		}
		return featureClicks[i].FeatureID < featureClicks[j].FeatureID
	})

	return &OverviewResponse{
		PageViews:     toPageViewCountDTOs(pageViews),
		FeatureClicks: toFeatureClickCountDTOs(featureClicks),
	}, nil
}

func toPageViewCountDTOs(counts []PageViewCount) []PageViewCountDTO {
	result := make([]PageViewCountDTO, 0, len(counts))
	for _, c := range counts {
		result = append(result, PageViewCountDTO{PageID: c.PageID, Count: c.Count})
	}
	return result
}

func toFeatureClickCountDTOs(counts []FeatureClickCount) []FeatureClickCountDTO {
	result := make([]FeatureClickCountDTO, 0, len(counts))
	for _, c := range counts {
		result = append(result, FeatureClickCountDTO{
			PageID:    c.PageID,
			FeatureID: c.FeatureID,
			Count:     c.Count,
		})
	}
	return result
}
