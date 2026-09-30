package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"aux-system/internal/asynctask"
	"aux-system/internal/integration"
)

var (
	// ErrAsyncTaskNotFound 表示任务不存在、已过期或不属于当前用户。
	ErrAsyncTaskNotFound = errors.New("async task not found")
	// ErrInvalidAsyncTaskRef 表示刷新请求的类型、来源或任务 ID 不合法。
	ErrInvalidAsyncTaskRef = errors.New("invalid async task reference")
	// ErrAsyncTaskAPIKeyUnavailable 表示创建视频任务的 API Key 已删除、停用或过期，
	// 网关按创建密钥绑定任务归属，换用其他密钥查询只会得到 404。
	ErrAsyncTaskAPIKeyUnavailable = errors.New("async task api key is unavailable")
)

const (
	asyncTaskRefreshTimeout = 20 * time.Second
	asyncTaskIDMaxBytes     = 256
)

// AsyncTaskKeyLister 按用户 Sub2API token 读取其有效 API Key（含明文）。
type AsyncTaskKeyLister interface {
	ListUserAPIKeys(ctx context.Context, token string) ([]integration.Sub2APIKeyInfo, error)
}

// AsyncTaskVideoGateway 用用户 API Key 调用 Sub2API 网关查询视频任务状态。
type AsyncTaskVideoGateway interface {
	QueryVideoTaskStatus(ctx context.Context, apiKey, provider, taskID string) (integration.Sub2APIVideoTaskStatus, error)
}

// AsyncTaskRef 定位用户的一条任务；Provider 只对视频任务有意义。
type AsyncTaskRef struct {
	Kind     string
	Provider string
	ID       string
}

// AsyncTaskRefreshResult 是单条任务的最新状态。
//
// VideoURL/VideoContentPath 只在本次上游查询确认完成时返回给任务所属用户，
// 不写入本系统数据库；上游签名地址可能有时效。
type AsyncTaskRefreshResult struct {
	Task             AsyncTask `json:"task"`
	UpstreamChecked  bool      `json:"upstream_checked"`
	VideoURL         string    `json:"video_url,omitempty"`
	VideoContentPath string    `json:"video_content_path,omitempty"`
	CheckedAt        time.Time `json:"checked_at"`
}

// WithVideoGateway 启用视频任务的上游代查；未配置时视频刷新返回 ErrAsyncTaskUnavailable。
func (s *AsyncTaskService) WithVideoGateway(keys AsyncTaskKeyLister, gateway AsyncTaskVideoGateway) *AsyncTaskService {
	if s != nil {
		s.keys, s.videoGateway = keys, gateway
	}
	return s
}

// RefreshForUser 读取指定任务的最新状态。
//
// 异步生图与批量生图由 Sub2API 后台推进，这里只重新读取该条记录；视频任务只有调用端
// 轮询才会推进，未结束时用创建任务的同一 API Key 向网关查询一次。该查询与用户自行轮询
// 等价：受网关计费校验与限流约束，首次观察到完成时按该任务计费一次。
// token 与 API Key 明文只用于本次请求，不记录、不返回。
func (s *AsyncTaskService) RefreshForUser(ctx context.Context, userID int64, token string, ref AsyncTaskRef) (AsyncTaskRefreshResult, error) {
	if s == nil || s.store == nil {
		return AsyncTaskRefreshResult{}, ErrAsyncTaskUnavailable
	}
	ref, err := normalizeAsyncTaskRef(ref)
	if err != nil {
		return AsyncTaskRefreshResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, asyncTaskRefreshTimeout)
	defer cancel()

	var task AsyncTask
	switch asynctask.Kind(ref.Kind) {
	case asynctask.KindImage:
		task, err = s.store.ImageTask(ctx, userID, ref.ID)
	case asynctask.KindBatch:
		task, err = s.store.BatchTask(ctx, userID, ref.ID)
	default:
		task, err = s.store.VideoTask(ctx, userID, ref.Provider, ref.ID)
	}
	if err != nil {
		return AsyncTaskRefreshResult{}, asyncTaskLookupError(err)
	}
	result := AsyncTaskRefreshResult{Task: task, CheckedAt: s.now()}
	if task.Kind != asynctask.KindVideo || !isActiveAsyncTaskStatus(task.Status) {
		return result, nil
	}
	return s.refreshVideo(ctx, token, result)
}

func (s *AsyncTaskService) refreshVideo(ctx context.Context, token string, result AsyncTaskRefreshResult) (AsyncTaskRefreshResult, error) {
	if s.keys == nil || s.videoGateway == nil {
		return AsyncTaskRefreshResult{}, ErrAsyncTaskUnavailable
	}
	keys, err := s.keys.ListUserAPIKeys(ctx, token)
	if err != nil {
		return AsyncTaskRefreshResult{}, err
	}
	apiKey := ""
	for _, key := range keys {
		if key.ID == result.Task.APIKeyID && key.Status == "active" {
			apiKey = strings.TrimSpace(key.Key)
			break
		}
	}
	if apiKey == "" {
		return AsyncTaskRefreshResult{}, ErrAsyncTaskAPIKeyUnavailable
	}
	status, err := s.videoGateway.QueryVideoTaskStatus(ctx, apiKey, result.Task.Provider, result.Task.ID)
	if err != nil {
		return AsyncTaskRefreshResult{}, err
	}
	applyVideoTaskStatus(&result.Task, status)
	result.UpstreamChecked = true
	result.CheckedAt = s.now()
	if result.Task.Status == asynctask.StatusCompleted {
		result.VideoURL, result.VideoContentPath = status.VideoURL, status.ContentPath
	}
	return result, nil
}

// applyVideoTaskStatus 把 Grok（pending/done/expired/failed）与 Seedance
// （queued/running/succeeded/failed/cancelled/expired）状态映射到统一状态。
func applyVideoTaskStatus(task *AsyncTask, status integration.Sub2APIVideoTaskStatus) {
	raw := strings.ToLower(strings.TrimSpace(status.Status))
	task.RawStatus = raw
	switch raw {
	case "done", "succeeded", "success", "completed":
		task.Status = asynctask.StatusCompleted
	case "failed", "error":
		task.Status = asynctask.StatusFailed
		task.ErrorMessage = status.ErrorMessage
	case "expired":
		task.Status = asynctask.StatusFailed
		task.ErrorMessage = status.ErrorMessage
		if task.ErrorMessage == "" {
			task.ErrorMessage = "上游任务已过期"
		}
	case "cancelled", "canceled":
		task.Status = asynctask.StatusCancelled
	default:
		task.Status = asynctask.StatusProcessing
	}
}

func normalizeAsyncTaskRef(ref AsyncTaskRef) (AsyncTaskRef, error) {
	ref.Kind = strings.ToLower(strings.TrimSpace(ref.Kind))
	ref.Provider = strings.ToLower(strings.TrimSpace(ref.Provider))
	ref.ID = strings.TrimSpace(ref.ID)
	if ref.ID == "" || len(ref.ID) > asyncTaskIDMaxBytes {
		return ref, ErrInvalidAsyncTaskRef
	}
	switch asynctask.Kind(ref.Kind) {
	case asynctask.KindImage, asynctask.KindBatch:
		ref.Provider = ""
	case asynctask.KindVideo:
		if ref.Provider == "" {
			ref.Provider = asynctask.ProviderGrok
		}
		if ref.Provider != asynctask.ProviderGrok && ref.Provider != asynctask.ProviderSeedance {
			return ref, ErrInvalidAsyncTaskRef
		}
	default:
		return ref, ErrInvalidAsyncTaskRef
	}
	return ref, nil
}

func asyncTaskLookupError(err error) error {
	switch {
	case errors.Is(err, asynctask.ErrTaskNotFound):
		return ErrAsyncTaskNotFound
	case errors.Is(err, asynctask.ErrSourceUnavailable):
		return ErrAsyncTaskUnavailable
	default:
		return err
	}
}

func isActiveAsyncTaskStatus(status asynctask.Status) bool {
	return status == asynctask.StatusProcessing || status == asynctask.StatusPending
}
