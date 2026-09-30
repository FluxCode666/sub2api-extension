// Package asynctask 定义用户异步任务视图的中立类型，供 integration 与
// service 共享，避免两层之间出现循环依赖。
package asynctask

import (
	"errors"
	"time"
)

var (
	// ErrSourceUnavailable 表示某个数据源（Sub2API PostgreSQL 或 Redis）未配置。
	ErrSourceUnavailable = errors.New("async task source is unavailable")
	// ErrTaskNotFound 表示指定任务不存在、已过期或不属于当前用户。
	ErrTaskNotFound = errors.New("async task not found")
)

// Kind 是任务来源类别。
type Kind string

const (
	KindImage Kind = "image"
	KindVideo Kind = "video"
	KindBatch Kind = "batch"
)

// 视频任务的上游来源。Sub2API 把 Seedance 任务与 Grok 视频放在同一套
// 挂起/计费键中，仅以 request ID 的 "seedance:" 前缀区分。
const (
	ProviderGrok     = "grok"
	ProviderSeedance = "seedance"
)

// Status 是跨来源归一化后的任务状态；RawStatus 保留 Sub2API 原始值。
type Status string

const (
	StatusProcessing Status = "processing"
	StatusPending    Status = "pending"
	StatusCompleted  Status = "completed"
	StatusFailed     Status = "failed"
	StatusCancelled  Status = "cancelled"
)

// Task 是返回给用户端的只读任务快照，不包含 API Key 明文、b64 图片或上游凭据。
type Task struct {
	ID              string     `json:"id"`
	Kind            Kind       `json:"kind"`
	Provider        string     `json:"provider,omitempty"`
	Status          Status     `json:"status"`
	RawStatus       string     `json:"raw_status"`
	Model           string     `json:"model,omitempty"`
	APIKeyID        int64      `json:"api_key_id,omitempty"`
	APIKeyName      string     `json:"api_key_name,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
	ExpiresAt       *time.Time `json:"expires_at,omitempty"`
	ImageURLs       []string   `json:"image_urls,omitempty"`
	ImageCount      int        `json:"image_count,omitempty"`
	ErrorMessage    string     `json:"error_message,omitempty"`
	HTTPStatus      int        `json:"http_status,omitempty"`
	Resolution      string     `json:"resolution,omitempty"`
	DurationSeconds int        `json:"duration_seconds,omitempty"`
	TaskName        string     `json:"task_name,omitempty"`
	ItemCount       int        `json:"item_count,omitempty"`
	SuccessCount    int        `json:"success_count,omitempty"`
	FailCount       int        `json:"fail_count,omitempty"`
	CancelledCount  int        `json:"cancelled_count,omitempty"`
	Cost            *float64   `json:"cost,omitempty"`
	CostEstimated   bool       `json:"cost_estimated,omitempty"`
	Currency        string     `json:"currency,omitempty"`
}

// SourceState 描述单个来源本次是否可读，前端据此展示降级提示。
type SourceState struct {
	Kind      Kind   `json:"kind"`
	Available bool   `json:"available"`
	Truncated bool   `json:"truncated,omitempty"`
	Message   string `json:"message,omitempty"`
}

// SourceResult 是单个来源的读取结果。Truncated 表示扫描达到保护上限。
type SourceResult struct {
	Tasks     []Task
	Truncated bool
}
