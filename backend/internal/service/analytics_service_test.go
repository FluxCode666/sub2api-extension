package service

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockAnalyticsStore 内存实现 AnalyticsStore, 用于 service 层测试。
type mockAnalyticsStore struct {
	pageViews     []PageViewCount
	featureClicks []FeatureClickCount
	pageViewErr   error
	featureErr    error
}

func (m *mockAnalyticsStore) CountPageViewsByPageID(_ context.Context) ([]PageViewCount, error) {
	if m.pageViewErr != nil {
		return nil, m.pageViewErr
	}
	return m.pageViews, nil
}

func (m *mockAnalyticsStore) CountFeatureClicksByFeature(_ context.Context) ([]FeatureClickCount, error) {
	if m.featureErr != nil {
		return nil, m.featureErr
	}
	return m.featureClicks, nil
}

func TestAnalyticsService_GetOverview_PageViewCounts(t *testing.T) {
	// 模拟埋点库中只有 home(2 次) 和 dashboard(1 次) 有记录。
	// "third-page" 零访问 → 不在列表(前端用 registry 显示 0)。
	store := &mockAnalyticsStore{
		pageViews: []PageViewCount{
			{PageID: "home", Count: 2},
			{PageID: "dashboard", Count: 1},
		},
	}
	svc := NewAnalyticsService(store)

	resp, err := svc.GetOverview(context.Background())
	require.NoError(t, err)
	require.NotNil(t, resp)

	// 应返回 2 个 page view 计数(零访问页不在列表, 前端显示 0)
	assert.Len(t, resp.PageViews, 2)

	counts := make(map[string]int)
	for _, pv := range resp.PageViews {
		counts[pv.PageID] = pv.Count
	}
	assert.Equal(t, 2, counts["home"])
	assert.Equal(t, 1, counts["dashboard"])
	// "third-page" 不在列表(零访问)
	_, exists := counts["third-page"]
	assert.False(t, exists, "零访问页不应在 PageViews 列表")
}

func TestAnalyticsService_GetOverview_OrphanPageInView(t *testing.T) {
	// 孤儿: "ghost-page" 在埋点库有记录但不在 page-registry(后端不感知 registry)。
	// 后端应原样返回此计数(前端识别为孤儿并标注)。
	store := &mockAnalyticsStore{
		pageViews: []PageViewCount{
			{PageID: "home", Count: 5},
			{PageID: "ghost-page", Count: 3}, // 孤儿
		},
	}
	svc := NewAnalyticsService(store)

	resp, err := svc.GetOverview(context.Background())
	require.NoError(t, err)

	counts := make(map[string]int)
	for _, pv := range resp.PageViews {
		counts[pv.PageID] = pv.Count
	}
	// 孤儿页计数应被返回(前端负责标注/过滤, 后端不耦合 registry)
	assert.Equal(t, 5, counts["home"])
	assert.Equal(t, 3, counts["ghost-page"], "孤儿页计数应被后端返回, 前端负责标注")
}

func TestAnalyticsService_GetOverview_FeatureClicksSortedDescending(t *testing.T) {
	// 功能使用度应按计数降序排序(R9/R10: 哪些功能用得更多)。
	// 故意传入乱序数据, 验证 service 排序。
	store := &mockAnalyticsStore{
		featureClicks: []FeatureClickCount{
			{PageID: "home", FeatureID: "btn-a", Count: 1},
			{PageID: "dashboard", FeatureID: "refresh-btn", Count: 5},
			{PageID: "home", FeatureID: "btn-b", Count: 3},
		},
	}
	svc := NewAnalyticsService(store)

	resp, err := svc.GetOverview(context.Background())
	require.NoError(t, err)
	require.Len(t, resp.FeatureClicks, 3)

	// 降序: refresh-btn(5) > btn-b(3) > btn-a(1)
	assert.Equal(t, "refresh-btn", resp.FeatureClicks[0].FeatureID)
	assert.Equal(t, 5, resp.FeatureClicks[0].Count)
	assert.Equal(t, "btn-b", resp.FeatureClicks[1].FeatureID)
	assert.Equal(t, 3, resp.FeatureClicks[1].Count)
	assert.Equal(t, "btn-a", resp.FeatureClicks[2].FeatureID)
	assert.Equal(t, 1, resp.FeatureClicks[2].Count)
}

func TestAnalyticsService_GetOverview_FeatureClicksStableSortSameCount(t *testing.T) {
	// 计数相同时按 page_id + feature_id 稳定排序(避免测试不确定)
	store := &mockAnalyticsStore{
		featureClicks: []FeatureClickCount{
			{PageID: "home", FeatureID: "zzz", Count: 2},
			{PageID: "home", FeatureID: "aaa", Count: 2},
			{PageID: "aaa-page", FeatureID: "mmm", Count: 2},
		},
	}
	svc := NewAnalyticsService(store)

	resp, err := svc.GetOverview(context.Background())
	require.NoError(t, err)
	require.Len(t, resp.FeatureClicks, 3)

	// 同计数 2: 按 page_id 再 feature_id 升序
	assert.Equal(t, "aaa-page", resp.FeatureClicks[0].PageID)
	assert.Equal(t, "home", resp.FeatureClicks[1].PageID)
	assert.Equal(t, "aaa", resp.FeatureClicks[1].FeatureID)
	assert.Equal(t, "home", resp.FeatureClicks[2].PageID)
	assert.Equal(t, "zzz", resp.FeatureClicks[2].FeatureID)
}

func TestAnalyticsService_GetOverview_EmptyData(t *testing.T) {
	// 无任何埋点数据 → 空列表(非 nil), 前端全部显示 0
	store := &mockAnalyticsStore{}
	svc := NewAnalyticsService(store)

	resp, err := svc.GetOverview(context.Background())
	require.NoError(t, err)
	require.NotNil(t, resp)
	assert.Empty(t, resp.PageViews)
	assert.Empty(t, resp.FeatureClicks)
}

func TestAnalyticsService_GetOverview_PageViewStoreError(t *testing.T) {
	store := &mockAnalyticsStore{pageViewErr: errors.New("db down")}
	svc := NewAnalyticsService(store)

	resp, err := svc.GetOverview(context.Background())
	require.Error(t, err)
	assert.Nil(t, resp)
}

func TestAnalyticsService_GetOverview_FeatureClickStoreError(t *testing.T) {
	store := &mockAnalyticsStore{featureErr: errors.New("db down")}
	svc := NewAnalyticsService(store)

	resp, err := svc.GetOverview(context.Background())
	require.Error(t, err)
	assert.Nil(t, resp)
}

// TestAnalyticsService_GetOverview_BothStoreErrorsPreservesBoth 验证两个并发查询
// 同时失败时, errors.Join 保留两个错误(而非静默吞掉第二个, #12)。
func TestAnalyticsService_GetOverview_BothStoreErrorsPreservesBoth(t *testing.T) {
	pageErr := errors.New("page_views db down")
	featureErr := errors.New("feature_clicks db down")
	store := &mockAnalyticsStore{pageViewErr: pageErr, featureErr: featureErr}
	svc := NewAnalyticsService(store)

	_, err := svc.GetOverview(context.Background())
	require.Error(t, err)
	// errors.Join 保留两个错误链, 两者均可通过 errors.Is 命中
	assert.True(t, errors.Is(err, pageErr), "应保留 page_views 错误")
	assert.True(t, errors.Is(err, featureErr), "应保留 feature_clicks 错误(不被吞掉)")
}

func TestAnalyticsService_GetOverview_FeatureClickAggregationByPageAndFeature(t *testing.T) {
	// 同一 page 的不同 feature 分别计数; 不同 page 的同名 feature 也分别计数。
	store := &mockAnalyticsStore{
		featureClicks: []FeatureClickCount{
			{PageID: "home", FeatureID: "btn-x", Count: 4},
			{PageID: "home", FeatureID: "btn-y", Count: 2},
			{PageID: "dashboard", FeatureID: "btn-x", Count: 1},
		},
	}
	svc := NewAnalyticsService(store)

	resp, err := svc.GetOverview(context.Background())
	require.NoError(t, err)
	require.Len(t, resp.FeatureClicks, 3)

	// 降序: home/btn-x(4) > home/btn-y(2) > dashboard/btn-x(1)
	assert.Equal(t, "home", resp.FeatureClicks[0].PageID)
	assert.Equal(t, "btn-x", resp.FeatureClicks[0].FeatureID)
	assert.Equal(t, 4, resp.FeatureClicks[0].Count)

	assert.Equal(t, "home", resp.FeatureClicks[1].PageID)
	assert.Equal(t, "btn-y", resp.FeatureClicks[1].FeatureID)

	assert.Equal(t, "dashboard", resp.FeatureClicks[2].PageID)
	assert.Equal(t, "btn-x", resp.FeatureClicks[2].FeatureID)
}
