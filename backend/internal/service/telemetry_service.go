// Package service 提供附属内容系统的业务逻辑层。
//
// telemetry_service 负责埋点数据的入库与校验。
//
// 设计要点:
//   - 依赖存储抽象接口 TelemetryStore,使测试可注入 mock(不依赖真实 DB)。
//   - 校验: page_id / feature_id / visitor_id 非空(归一/校验)。
//   - 只追加: 仅提供 Create 方法,不提供更新/删除。
//   - 访问量按访问计: 每次调用 CreatePageView 都新增一条记录(非去重)。
//
// Covers KTD4(埋点 = 前端 SDK + 后端存储), R8(页面访问埋点), R9(功能使用埋点), R11(自有采集)。
package service

import (
	"context"
	"errors"
	"strings"
	"time"
)

// ErrEmptyPageID page_id 为空。
var ErrEmptyPageID = errors.New("page_id must not be empty")

// ErrEmptyFeatureID feature_id 为空。
var ErrEmptyFeatureID = errors.New("feature_id must not be empty")

// ErrEmptyVisitorID visitor_id 为空。
var ErrEmptyVisitorID = errors.New("visitor_id must not be empty")

// ErrTooLongField 标识/访客 id 超出最大长度。
var ErrTooLongField = errors.New("field exceeds maximum length")

// maxIDLength 埋点标识(page_id/feature_id/visitor_id)最大长度。
// 与 Ent schema 的 MaxLen(128) 对齐; 在 DB 前校验, 超长直接返回 400 而非 500(#7)。
const maxIDLength = 128

// PageViewRecord 页面访问埋点记录(入库用)。
type PageViewRecord struct {
	PageID    string
	VisitorID string
	IsAdmin   bool
	CreatedAt time.Time
}

// FeatureClickRecord 功能点击埋点记录(入库用)。
type FeatureClickRecord struct {
	PageID    string
	FeatureID string
	VisitorID string
	IsAdmin   bool
	CreatedAt time.Time
}

// TelemetryStore 抽象埋点存储能力。
// *ent.Client 实现该接口(通过 adapter,见 telemetry_store.go)。
// 测试可注入 mock 验证入库逻辑。
type TelemetryStore interface {
	// CreatePageView 插入一条页面访问记录。
	CreatePageView(ctx context.Context, rec PageViewRecord) error
	// CreateFeatureClick 插入一条功能点击记录。
	CreateFeatureClick(ctx context.Context, rec FeatureClickRecord) error
}

// TelemetryService 埋点入库服务。
type TelemetryService struct {
	store TelemetryStore
}

// NewTelemetryService 创建埋点服务。
func NewTelemetryService(store TelemetryStore) *TelemetryService {
	return &TelemetryService{store: store}
}

// RecordPageView 记录一次页面访问。
//
// 校验 page_id / visitor_id 非空,然后入库。
// CreatedAt 由调用方传入或由 DB 默认值填充;此处若为零值则用 time.Now。
// 每次调用都新增一条记录(按访问计,非去重)。
func (s *TelemetryService) RecordPageView(ctx context.Context, pageID, visitorID string, isAdmin bool) error {
	pageID = strings.TrimSpace(pageID)
	visitorID = strings.TrimSpace(visitorID)
	if pageID == "" {
		return ErrEmptyPageID
	}
	if visitorID == "" {
		return ErrEmptyVisitorID
	}
	if len(pageID) > maxIDLength || len(visitorID) > maxIDLength {
		return ErrTooLongField
	}

	rec := PageViewRecord{
		PageID:    pageID,
		VisitorID: visitorID,
		IsAdmin:   isAdmin,
		CreatedAt: time.Now(),
	}
	return s.store.CreatePageView(ctx, rec)
}

// RecordFeatureClick 记录一次功能点击。
//
// 校验 page_id / feature_id / visitor_id 非空,然后入库。
func (s *TelemetryService) RecordFeatureClick(ctx context.Context, pageID, featureID, visitorID string, isAdmin bool) error {
	pageID = strings.TrimSpace(pageID)
	featureID = strings.TrimSpace(featureID)
	visitorID = strings.TrimSpace(visitorID)
	if pageID == "" {
		return ErrEmptyPageID
	}
	if featureID == "" {
		return ErrEmptyFeatureID
	}
	if visitorID == "" {
		return ErrEmptyVisitorID
	}
	if len(pageID) > maxIDLength || len(featureID) > maxIDLength || len(visitorID) > maxIDLength {
		return ErrTooLongField
	}

	rec := FeatureClickRecord{
		PageID:    pageID,
		FeatureID: featureID,
		VisitorID: visitorID,
		IsAdmin:   isAdmin,
		CreatedAt: time.Now(),
	}
	return s.store.CreateFeatureClick(ctx, rec)
}
