// Package service 提供附属内容系统的日志记录与查询能力。
//
// 日志同时写入标准输出和数据库：标准输出便于平台采集，数据库则为管理端
// 的系统日志/操作日志页面提供稳定的数据源。日志表只追加，查询支持分页。
package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"sub2api-extension/ent"
	"sub2api-extension/ent/operationlog"
	"sub2api-extension/ent/systemlog"
)

const (
	LogLevelDebug = "DEBUG"
	LogLevelInfo  = "INFO"
	LogLevelWarn  = "WARN"
	LogLevelError = "ERROR"

	OperationSuccess = "success"
	OperationFailure = "failure"
)

// SystemLog 是系统日志页面的展示模型。
type SystemLog struct {
	ID        int       `json:"id"`
	Level     string    `json:"level"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
	Details   string    `json:"details,omitempty"`
	RequestID string    `json:"request_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// OperationLog 是操作日志页面的展示模型。
type OperationLog struct {
	ID         int       `json:"id"`
	UserID     int64     `json:"user_id,omitempty"`
	Username   string    `json:"username,omitempty"`
	Action     string    `json:"action"`
	Resource   string    `json:"resource,omitempty"`
	ResourceID string    `json:"resource_id,omitempty"`
	Status     string    `json:"status"`
	Details    string    `json:"details,omitempty"`
	IPAddress  string    `json:"ip_address,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

// LogFilters 是两类日志共用的查询条件。
type LogFilters struct {
	Level    string
	Source   string
	Status   string
	Search   string
	From     time.Time
	To       time.Time
	Page     int
	PageSize int
}

// LogPage 是分页查询返回值。
type LogPage[T any] struct {
	Items    []T `json:"items"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"page_size"`
}

// SystemLogRecord / OperationLogRecord 是写入接口的输入模型。
type SystemLogRecord struct {
	Level     string
	Source    string
	Message   string
	Details   string
	RequestID string
	CreatedAt time.Time
}

type OperationLogRecord struct {
	UserID     int64
	Username   string
	Action     string
	Resource   string
	ResourceID string
	Status     string
	Details    string
	IPAddress  string
	CreatedAt  time.Time
}

// LogStore 抽象日志持久化，便于 handler/service 单测注入内存实现。
type LogStore interface {
	CreateSystemLog(context.Context, SystemLogRecord) error
	CreateOperationLog(context.Context, OperationLogRecord) error
	ListSystemLogs(context.Context, LogFilters) ([]SystemLog, int, error)
	ListOperationLogs(context.Context, LogFilters) ([]OperationLog, int, error)
}

// LogService 负责日志输出、持久化和查询。持久化失败不会被静默丢弃：
// 错误会明确写入标准错误日志，并向调用方返回，避免业务误以为审计成功。
type LogService struct {
	store LogStore
}

func NewLogService(store LogStore) *LogService { return &LogService{store: store} }

func (s *LogService) RecordSystem(ctx context.Context, record SystemLogRecord) error {
	record.Level = normalizeLevel(record.Level)
	record.Source = normalizeValue(record.Source, "system")
	record.Message = strings.TrimSpace(record.Message)
	if record.Message == "" {
		return errors.New("system log message must not be empty")
	}
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now()
	}
	log.Printf("[%s] [%s] %s%s", record.Level, record.Source, record.Message, detailSuffix(record.Details))
	if s == nil || s.store == nil {
		err := errors.New("log store is unavailable")
		log.Printf("[ERROR] [LogService.RecordSystem] persistence failed: %v", err)
		return err
	}
	if err := s.store.CreateSystemLog(ctx, record); err != nil {
		log.Printf("[ERROR] [LogService.RecordSystem] persistence failed source=%q: %v", record.Source, err)
		return fmt.Errorf("persist system log: %w", err)
	}
	return nil
}

func (s *LogService) RecordOperation(ctx context.Context, record OperationLogRecord) error {
	record.Action = strings.TrimSpace(record.Action)
	if record.Action == "" {
		return errors.New("operation log action must not be empty")
	}
	record.Status = normalizeStatus(record.Status)
	record.Resource = strings.TrimSpace(record.Resource)
	record.ResourceID = strings.TrimSpace(record.ResourceID)
	record.Username = strings.TrimSpace(record.Username)
	record.IPAddress = strings.TrimSpace(record.IPAddress)
	if record.CreatedAt.IsZero() {
		record.CreatedAt = time.Now()
	}
	log.Printf("[operation] action=%s resource=%s resource_id=%s status=%s user=%s", record.Action, record.Resource, record.ResourceID, record.Status, record.Username)
	if s == nil || s.store == nil {
		err := errors.New("log store is unavailable")
		log.Printf("[ERROR] [LogService.RecordOperation] persistence failed: %v", err)
		return err
	}
	if err := s.store.CreateOperationLog(ctx, record); err != nil {
		log.Printf("[ERROR] [LogService.RecordOperation] persistence failed action=%q: %v", record.Action, err)
		return fmt.Errorf("persist operation log: %w", err)
	}
	return nil
}

func (s *LogService) ListSystemLogs(ctx context.Context, filters LogFilters) (*LogPage[SystemLog], error) {
	filters = normalizeFilters(filters)
	if s == nil || s.store == nil {
		return nil, errors.New("log store is unavailable")
	}
	items, total, err := s.store.ListSystemLogs(ctx, filters)
	if err != nil {
		return nil, fmt.Errorf("list system logs: %w", err)
	}
	if items == nil {
		items = []SystemLog{}
	}
	return &LogPage[SystemLog]{Items: items, Total: total, Page: filters.Page, PageSize: filters.PageSize}, nil
}

func (s *LogService) ListOperationLogs(ctx context.Context, filters LogFilters) (*LogPage[OperationLog], error) {
	filters = normalizeFilters(filters)
	if s == nil || s.store == nil {
		return nil, errors.New("log store is unavailable")
	}
	items, total, err := s.store.ListOperationLogs(ctx, filters)
	if err != nil {
		return nil, fmt.Errorf("list operation logs: %w", err)
	}
	if items == nil {
		items = []OperationLog{}
	}
	return &LogPage[OperationLog]{Items: items, Total: total, Page: filters.Page, PageSize: filters.PageSize}, nil
}

func normalizeFilters(filters LogFilters) LogFilters {
	if filters.Page < 1 {
		filters.Page = 1
	}
	if filters.PageSize <= 0 {
		filters.PageSize = 50
	}
	if filters.PageSize > 200 {
		filters.PageSize = 200
	}
	filters.Level = strings.ToUpper(strings.TrimSpace(filters.Level))
	filters.Status = strings.ToLower(strings.TrimSpace(filters.Status))
	filters.Source = strings.TrimSpace(filters.Source)
	filters.Search = strings.TrimSpace(filters.Search)
	return filters
}

func normalizeLevel(level string) string {
	level = strings.ToUpper(strings.TrimSpace(level))
	switch level {
	case LogLevelDebug, LogLevelInfo, LogLevelWarn, LogLevelError:
		return level
	default:
		return LogLevelInfo
	}
}

func normalizeStatus(status string) string {
	if strings.EqualFold(strings.TrimSpace(status), OperationFailure) {
		return OperationFailure
	}
	return OperationSuccess
}

func normalizeValue(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}

func detailSuffix(details string) string {
	if details = strings.TrimSpace(details); details != "" {
		return " details=" + details
	}
	return ""
}

// NewEntLogStore 创建 Ent 日志存储适配器。
func NewEntLogStore(client *ent.Client) LogStore { return &entLogStore{client: client} }

type entLogStore struct{ client *ent.Client }

func (s *entLogStore) available() error {
	if s == nil || s.client == nil {
		return errors.New("log store is unavailable")
	}
	return nil
}

func (s *entLogStore) CreateSystemLog(ctx context.Context, record SystemLogRecord) error {
	if err := s.available(); err != nil {
		return err
	}
	if s.client.SystemLog == nil {
		return errors.New("system log client is unavailable")
	}
	b := s.client.SystemLog.Create().SetLevel(record.Level).SetSource(record.Source).SetMessage(record.Message).SetCreatedAt(record.CreatedAt)
	if record.Details != "" {
		b.SetDetails(record.Details)
	}
	if record.RequestID != "" {
		b.SetRequestID(record.RequestID)
	}
	return b.Exec(ctx)
}

func (s *entLogStore) CreateOperationLog(ctx context.Context, record OperationLogRecord) error {
	if err := s.available(); err != nil {
		return err
	}
	if s.client.OperationLog == nil {
		return errors.New("operation log client is unavailable")
	}
	b := s.client.OperationLog.Create().SetAction(record.Action).SetStatus(record.Status).SetCreatedAt(record.CreatedAt)
	if record.UserID != 0 {
		b.SetUserID(record.UserID)
	}
	if record.Username != "" {
		b.SetUsername(record.Username)
	}
	if record.Resource != "" {
		b.SetResource(record.Resource)
	}
	if record.ResourceID != "" {
		b.SetResourceID(record.ResourceID)
	}
	if record.Details != "" {
		b.SetDetails(record.Details)
	}
	if record.IPAddress != "" {
		b.SetIPAddress(record.IPAddress)
	}
	return b.Exec(ctx)
}

func (s *entLogStore) ListSystemLogs(ctx context.Context, filters LogFilters) ([]SystemLog, int, error) {
	if err := s.available(); err != nil {
		return nil, 0, err
	}
	if s.client.SystemLog == nil {
		return nil, 0, errors.New("system log client is unavailable")
	}
	query := s.client.SystemLog.Query()
	if filters.Level != "" {
		query.Where(systemlog.LevelEQ(filters.Level))
	}
	if filters.Source != "" {
		query.Where(systemlog.SourceEQ(filters.Source))
	}
	if filters.Search != "" {
		query.Where(systemlog.Or(systemlog.MessageContainsFold(filters.Search), systemlog.DetailsContainsFold(filters.Search)))
	}
	if !filters.From.IsZero() {
		query.Where(systemlog.CreatedAtGTE(filters.From))
	}
	if !filters.To.IsZero() {
		query.Where(systemlog.CreatedAtLTE(filters.To))
	}
	total, err := query.Count(ctx)
	if err != nil {
		return nil, 0, err
	}
	items, err := query.Order(ent.Desc(systemlog.FieldCreatedAt), ent.Desc(systemlog.FieldID)).Offset((filters.Page - 1) * filters.PageSize).Limit(filters.PageSize).All(ctx)
	if err != nil {
		return nil, 0, err
	}
	result := make([]SystemLog, 0, len(items))
	for _, item := range items {
		result = append(result, SystemLog{ID: item.ID, Level: item.Level, Source: item.Source, Message: item.Message, Details: item.Details, RequestID: item.RequestID, CreatedAt: item.CreatedAt})
	}
	return result, total, nil
}

func (s *entLogStore) ListOperationLogs(ctx context.Context, filters LogFilters) ([]OperationLog, int, error) {
	if err := s.available(); err != nil {
		return nil, 0, err
	}
	if s.client.OperationLog == nil {
		return nil, 0, errors.New("operation log client is unavailable")
	}
	query := s.client.OperationLog.Query()
	if filters.Status != "" {
		query.Where(operationlog.StatusEQ(filters.Status))
	}
	if filters.Search != "" {
		query.Where(operationlog.Or(operationlog.UsernameContainsFold(filters.Search), operationlog.ActionContainsFold(filters.Search), operationlog.ResourceContainsFold(filters.Search), operationlog.DetailsContainsFold(filters.Search)))
	}
	if !filters.From.IsZero() {
		query.Where(operationlog.CreatedAtGTE(filters.From))
	}
	if !filters.To.IsZero() {
		query.Where(operationlog.CreatedAtLTE(filters.To))
	}
	total, err := query.Count(ctx)
	if err != nil {
		return nil, 0, err
	}
	items, err := query.Order(ent.Desc(operationlog.FieldCreatedAt), ent.Desc(operationlog.FieldID)).Offset((filters.Page - 1) * filters.PageSize).Limit(filters.PageSize).All(ctx)
	if err != nil {
		return nil, 0, err
	}
	result := make([]OperationLog, 0, len(items))
	for _, item := range items {
		result = append(result, OperationLog{ID: item.ID, UserID: item.UserID, Username: item.Username, Action: item.Action, Resource: item.Resource, ResourceID: item.ResourceID, Status: item.Status, Details: item.Details, IPAddress: item.IPAddress, CreatedAt: item.CreatedAt})
	}
	return result, total, nil
}

// ParseLogTime 解析页面传入的 RFC3339 时间，供 handler 复用。
func ParseLogTime(value string) (time.Time, error) {
	if strings.TrimSpace(value) == "" {
		return time.Time{}, nil
	}
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid time %q: %w", value, err)
	}
	return parsed, nil
}

func ParseLogPage(value string) (int, error) {
	if strings.TrimSpace(value) == "" {
		return 1, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 {
		return 0, errors.New("page must be a positive integer")
	}
	return n, nil
}

func ParseLogPageSize(value string) (int, error) {
	if strings.TrimSpace(value) == "" {
		return 50, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > 200 {
		return 0, errors.New("page_size must be between 1 and 200")
	}
	return n, nil
}
