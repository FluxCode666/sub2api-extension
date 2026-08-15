package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockTelemetryStore 内存实现 TelemetryStore, 用于 service 层测试。
type mockTelemetryStore struct {
	pageViews     []PageViewRecord
	featureClicks []FeatureClickRecord
	createErr     error // 若非 nil, Create 返回此错误
}

func (m *mockTelemetryStore) CreatePageView(_ context.Context, rec PageViewRecord) error {
	if m.createErr != nil {
		return m.createErr
	}
	m.pageViews = append(m.pageViews, rec)
	return nil
}

func (m *mockTelemetryStore) CreateFeatureClick(_ context.Context, rec FeatureClickRecord) error {
	if m.createErr != nil {
		return m.createErr
	}
	m.featureClicks = append(m.featureClicks, rec)
	return nil
}

func TestTelemetryService_RecordPageView_Success(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordPageView(context.Background(), "home", "visitor-abc", false)
	require.NoError(t, err)

	require.Len(t, store.pageViews, 1)
	rec := store.pageViews[0]
	assert.Equal(t, "home", rec.PageID)
	assert.Equal(t, "visitor-abc", rec.VisitorID)
	assert.False(t, rec.IsAdmin)
	assert.False(t, rec.CreatedAt.IsZero(), "CreatedAt 应被填充")
}

func TestTelemetryService_RecordPageView_AdminFlag(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordPageView(context.Background(), "sample-dynamic", "visitor-admin", true)
	require.NoError(t, err)

	require.Len(t, store.pageViews, 1)
	assert.True(t, store.pageViews[0].IsAdmin, "管理员访问应标记 is_admin=true")
}

func TestTelemetryService_RecordPageView_EmptyPageID(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordPageView(context.Background(), "", "visitor-abc", false)
	require.ErrorIs(t, err, ErrEmptyPageID)
	assert.Empty(t, store.pageViews, "校验失败不应入库")
}

func TestTelemetryService_RecordPageView_WhitespacePageID(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	// 空白字符 trim 后为空 → 应拒绝
	err := svc.RecordPageView(context.Background(), "   ", "visitor-abc", false)
	require.ErrorIs(t, err, ErrEmptyPageID)
	assert.Empty(t, store.pageViews)
}

func TestTelemetryService_RecordPageView_EmptyVisitorID(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordPageView(context.Background(), "home", "", false)
	require.ErrorIs(t, err, ErrEmptyVisitorID)
	assert.Empty(t, store.pageViews)
}

func TestTelemetryService_RecordPageView_TrimsWhitespace(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordPageView(context.Background(), "  home  ", "  visitor-abc  ", false)
	require.NoError(t, err)

	require.Len(t, store.pageViews, 1)
	assert.Equal(t, "home", store.pageViews[0].PageID, "应 trim 前后空白")
	assert.Equal(t, "visitor-abc", store.pageViews[0].VisitorID)
}

// 同一访客重复访问 → 多条记录(按访问计,非去重为 1)。
func TestTelemetryService_RecordPageView_RepeatVisitsProduceMultipleRecords(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	// 同一访客连续访问 3 次
	for i := 0; i < 3; i++ {
		err := svc.RecordPageView(context.Background(), "home", "visitor-same", false)
		require.NoError(t, err)
	}

	require.Len(t, store.pageViews, 3, "同一访客重复访问应产生多条记录(按访问计)")
	for _, rec := range store.pageViews {
		assert.Equal(t, "visitor-same", rec.VisitorID)
		assert.Equal(t, "home", rec.PageID)
	}
}

func TestTelemetryService_RecordPageView_StoreError(t *testing.T) {
	store := &mockTelemetryStore{createErr: assert.AnError}
	svc := NewTelemetryService(store)

	err := svc.RecordPageView(context.Background(), "home", "visitor-abc", false)
	require.Error(t, err)
}

func TestTelemetryService_RecordFeatureClick_Success(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordFeatureClick(context.Background(), "sample-dynamic", "refresh-btn", "visitor-xyz", true)
	require.NoError(t, err)

	require.Len(t, store.featureClicks, 1)
	rec := store.featureClicks[0]
	assert.Equal(t, "sample-dynamic", rec.PageID)
	assert.Equal(t, "refresh-btn", rec.FeatureID)
	assert.Equal(t, "visitor-xyz", rec.VisitorID)
	assert.True(t, rec.IsAdmin)
	assert.False(t, rec.CreatedAt.IsZero())
}

func TestTelemetryService_RecordFeatureClick_EmptyPageID(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordFeatureClick(context.Background(), "", "refresh-btn", "visitor-xyz", false)
	require.ErrorIs(t, err, ErrEmptyPageID)
	assert.Empty(t, store.featureClicks)
}

func TestTelemetryService_RecordFeatureClick_EmptyFeatureID(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordFeatureClick(context.Background(), "sample-dynamic", "", "visitor-xyz", false)
	require.ErrorIs(t, err, ErrEmptyFeatureID)
	assert.Empty(t, store.featureClicks)
}

func TestTelemetryService_RecordFeatureClick_EmptyVisitorID(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	err := svc.RecordFeatureClick(context.Background(), "sample-dynamic", "refresh-btn", "", false)
	require.ErrorIs(t, err, ErrEmptyVisitorID)
	assert.Empty(t, store.featureClicks)
}

func TestTelemetryService_RecordFeatureClick_StoreError(t *testing.T) {
	store := &mockTelemetryStore{createErr: assert.AnError}
	svc := NewTelemetryService(store)

	err := svc.RecordFeatureClick(context.Background(), "sample-dynamic", "refresh-btn", "visitor-xyz", false)
	require.Error(t, err)
}

// 验证记录可按 page id 聚合计数(模拟 U6 聚合场景)。
func TestTelemetryService_PageViewAggregatableByPageID(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	// home 访问 2 次, sample-dynamic 访问 1 次
	_ = svc.RecordPageView(context.Background(), "home", "v1", false)
	_ = svc.RecordPageView(context.Background(), "home", "v2", false)
	_ = svc.RecordPageView(context.Background(), "sample-dynamic", "v1", true)

	// 按 page_id 聚合
	counts := make(map[string]int)
	for _, rec := range store.pageViews {
		counts[rec.PageID]++
	}
	assert.Equal(t, 2, counts["home"])
	assert.Equal(t, 1, counts["sample-dynamic"])
}

// 验证记录含 created_at, 可按时间排序(供 U6 时间范围聚合)。
func TestTelemetryService_PageViewRecordsHaveCreatedAt(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	before := time.Now().Add(-time.Millisecond)
	_ = svc.RecordPageView(context.Background(), "home", "v1", false)
	after := time.Now().Add(time.Millisecond)

	require.Len(t, store.pageViews, 1)
	ts := store.pageViews[0].CreatedAt
	assert.True(t, ts.After(before) || ts.Equal(before), "created_at 应 >= 调用前时间")
	assert.True(t, ts.Before(after) || ts.Equal(after), "created_at 应 <= 调用后时间")
}

// 验证超长字段在 DB 前被拒绝, 返回 ErrTooLongField(#7)。
// 与 Ent schema MaxLen(128) 对齐, 避免超长输入到 DB 才报 500。
func TestTelemetryService_RejectsTooLongField(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	longID := strings.Repeat("x", maxIDLength+1)

	// page-view: page_id 超长
	err := svc.RecordPageView(context.Background(), longID, "v1", false)
	assert.True(t, errors.Is(err, ErrTooLongField), "超长 page_id 应返回 ErrTooLongField")
	// page-view: visitor_id 超长
	err = svc.RecordPageView(context.Background(), "home", longID, false)
	assert.True(t, errors.Is(err, ErrTooLongField), "超长 visitor_id 应返回 ErrTooLongField")

	// feature-click: 各字段超长
	err = svc.RecordFeatureClick(context.Background(), longID, "btn", "v1", false)
	assert.True(t, errors.Is(err, ErrTooLongField))
	err = svc.RecordFeatureClick(context.Background(), "home", longID, "v1", false)
	assert.True(t, errors.Is(err, ErrTooLongField))
	err = svc.RecordFeatureClick(context.Background(), "home", "btn", longID, false)
	assert.True(t, errors.Is(err, ErrTooLongField))

	// 超长输入不应入库
	assert.Empty(t, store.pageViews, "超长输入不应入库")
	assert.Empty(t, store.featureClicks, "超长输入不应入库")
}

// 边界: 恰好 maxIDLength 长度的字段应被接受。
func TestTelemetryService_AcceptsMaxLengthField(t *testing.T) {
	store := &mockTelemetryStore{}
	svc := NewTelemetryService(store)

	exactID := strings.Repeat("x", maxIDLength)

	err := svc.RecordPageView(context.Background(), exactID, exactID, false)
	require.NoError(t, err, "恰好 maxIDLength 长度应被接受")
	require.Len(t, store.pageViews, 1)
}
