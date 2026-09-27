package service

import (
	"context"
	"errors"
	"log"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"aux-system/internal/asynctask"
)

type (
	AsyncTask             = asynctask.Task
	AsyncTaskKind         = asynctask.Kind
	AsyncTaskStatus       = asynctask.Status
	AsyncTaskSourceState  = asynctask.SourceState
	AsyncTaskSourceResult = asynctask.SourceResult
)

var (
	// ErrAsyncTaskUnavailable 表示所有 Sub2API 数据源都无法读取。
	ErrAsyncTaskUnavailable = errors.New("async task sources are unavailable")
	// ErrInvalidAsyncTaskFilter 表示类型、状态、日期范围或关键词等过滤条件不合法。
	ErrInvalidAsyncTaskFilter = errors.New("invalid async task filter")
)

const (
	asyncTaskQueryTimeout   = 8 * time.Second
	asyncTaskKeywordMaxRune = 128
)

// AsyncTaskStore 是 Sub2API 异步任务只读来源。
type AsyncTaskStore interface {
	ListImageTasks(ctx context.Context, userID int64) (AsyncTaskSourceResult, error)
	ListVideoTasks(ctx context.Context, userID int64) (AsyncTaskSourceResult, error)
	ListBatchTasks(ctx context.Context, userID int64) (AsyncTaskSourceResult, error)
	APIKeyNames(ctx context.Context, userID int64) (map[int64]string, error)
}

// AsyncTaskQuery 的 CreatedFrom 为包含边界，CreatedTo 为不包含边界；零值表示不限制。
type AsyncTaskQuery struct {
	Kind        string
	Status      string
	Model       string
	APIKeyID    int64
	Keyword     string
	CreatedFrom time.Time
	CreatedTo   time.Time
	Page        int
	PageSize    int
}

// AsyncTaskSummary 中类别计数基于日期、模型、Key 与关键词过滤后的任务，状态计数再叠加类别过滤。
type AsyncTaskSummary struct {
	Total      int `json:"total"`
	Image      int `json:"image"`
	Video      int `json:"video"`
	Batch      int `json:"batch"`
	Processing int `json:"processing"`
	Pending    int `json:"pending"`
	Completed  int `json:"completed"`
	Failed     int `json:"failed"`
	Cancelled  int `json:"cancelled"`
}

type AsyncTaskAPIKeyOption struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// AsyncTaskFilterOptions 来自用户全部近期任务，不随当前过滤条件收窄，避免下拉项互相锁死。
type AsyncTaskFilterOptions struct {
	Models  []string                `json:"models"`
	APIKeys []AsyncTaskAPIKeyOption `json:"api_keys"`
}

type AsyncTaskList struct {
	Items         []AsyncTask            `json:"items"`
	Total         int                    `json:"total"`
	Page          int                    `json:"page"`
	PageSize      int                    `json:"page_size"`
	Summary       AsyncTaskSummary       `json:"summary"`
	FilterOptions AsyncTaskFilterOptions `json:"filter_options"`
	Sources       []AsyncTaskSourceState `json:"sources"`
	GeneratedAt   time.Time              `json:"generated_at"`
}

type AsyncTaskService struct {
	store AsyncTaskStore
	now   func() time.Time
}

func NewAsyncTaskService(store AsyncTaskStore) *AsyncTaskService {
	return &AsyncTaskService{store: store, now: time.Now}
}

// ListForUser 并发读取三个来源，单个来源失败时返回其余结果并标记降级。
func (s *AsyncTaskService) ListForUser(ctx context.Context, userID int64, query AsyncTaskQuery) (AsyncTaskList, error) {
	if s == nil || s.store == nil {
		return AsyncTaskList{}, ErrAsyncTaskUnavailable
	}
	kind, status, err := normalizeAsyncTaskFilter(query)
	if err != nil {
		return AsyncTaskList{}, err
	}
	model := strings.TrimSpace(query.Model)
	keyword := strings.ToLower(strings.TrimSpace(query.Keyword))
	if query.APIKeyID < 0 || utf8.RuneCountInString(keyword) > asyncTaskKeywordMaxRune ||
		(!query.CreatedFrom.IsZero() && !query.CreatedTo.IsZero() && !query.CreatedTo.After(query.CreatedFrom)) {
		return AsyncTaskList{}, ErrInvalidAsyncTaskFilter
	}
	page, pageSize := normalizeAsyncTaskPage(query.Page, query.PageSize)

	ctx, cancel := context.WithTimeout(ctx, asyncTaskQueryTimeout)
	defer cancel()

	loaders := []struct {
		kind asynctask.Kind
		load func(context.Context, int64) (AsyncTaskSourceResult, error)
	}{
		{asynctask.KindImage, s.store.ListImageTasks},
		{asynctask.KindVideo, s.store.ListVideoTasks},
		{asynctask.KindBatch, s.store.ListBatchTasks},
	}
	results := make([]AsyncTaskSourceResult, len(loaders))
	errs := make([]error, len(loaders))
	var names map[int64]string
	var wg sync.WaitGroup
	for i, loader := range loaders {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], errs[i] = loader.load(ctx, userID)
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		// Key 名称只用于展示；读取失败不影响任务列表。
		if loaded, err := s.store.APIKeyNames(ctx, userID); err == nil {
			names = loaded
		} else if !errors.Is(err, asynctask.ErrSourceUnavailable) {
			log.Printf("[AsyncTaskService.ListForUser] api key names unavailable user_id=%d: %v", userID, err)
		}
	}()
	wg.Wait()

	sources := make([]AsyncTaskSourceState, 0, len(loaders))
	all := make([]AsyncTask, 0)
	available := 0
	for i, loader := range loaders {
		state := AsyncTaskSourceState{Kind: loader.kind, Available: errs[i] == nil, Truncated: results[i].Truncated}
		if errs[i] != nil {
			state.Message = asyncTaskSourceMessage(loader.kind, errs[i])
			if !errors.Is(errs[i], asynctask.ErrSourceUnavailable) {
				log.Printf("[AsyncTaskService.ListForUser] source=%s failed user_id=%d: %v", loader.kind, userID, errs[i])
			}
		} else {
			available++
			all = append(all, results[i].Tasks...)
		}
		sources = append(sources, state)
	}
	if available == 0 {
		return AsyncTaskList{}, ErrAsyncTaskUnavailable
	}

	for i := range all {
		if name := strings.TrimSpace(names[all[i].APIKeyID]); name != "" {
			all[i].APIKeyName = name
		}
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].CreatedAt.Equal(all[j].CreatedAt) {
			return all[i].ID > all[j].ID
		}
		return all[i].CreatedAt.After(all[j].CreatedAt)
	})

	summary := AsyncTaskSummary{}
	filtered := make([]AsyncTask, 0, len(all))
	for _, task := range all {
		if !query.CreatedFrom.IsZero() && task.CreatedAt.Before(query.CreatedFrom) ||
			!query.CreatedTo.IsZero() && !task.CreatedAt.Before(query.CreatedTo) ||
			model != "" && task.Model != model ||
			query.APIKeyID > 0 && task.APIKeyID != query.APIKeyID ||
			keyword != "" && !asyncTaskMatchesKeyword(task, keyword) {
			continue
		}
		switch task.Kind {
		case asynctask.KindImage:
			summary.Image++
		case asynctask.KindVideo:
			summary.Video++
		case asynctask.KindBatch:
			summary.Batch++
		}
		summary.Total++
		if kind != "" && task.Kind != kind {
			continue
		}
		switch task.Status {
		case asynctask.StatusProcessing:
			summary.Processing++
		case asynctask.StatusPending:
			summary.Pending++
		case asynctask.StatusCompleted:
			summary.Completed++
		case asynctask.StatusFailed:
			summary.Failed++
		case asynctask.StatusCancelled:
			summary.Cancelled++
		}
		if status != "" && task.Status != status {
			continue
		}
		filtered = append(filtered, task)
	}

	start := min((page-1)*pageSize, len(filtered))
	end := min(start+pageSize, len(filtered))
	return AsyncTaskList{
		Items: filtered[start:end], Total: len(filtered), Page: page, PageSize: pageSize,
		Summary: summary, FilterOptions: asyncTaskFilterOptions(all), Sources: sources, GeneratedAt: s.now().UTC(),
	}, nil
}

func asyncTaskMatchesKeyword(task AsyncTask, keyword string) bool {
	return strings.Contains(strings.ToLower(task.ID), keyword) || strings.Contains(strings.ToLower(task.TaskName), keyword)
}

func asyncTaskFilterOptions(tasks []AsyncTask) AsyncTaskFilterOptions {
	models := make([]string, 0)
	seenModels := make(map[string]struct{})
	keys := make([]AsyncTaskAPIKeyOption, 0)
	seenKeys := make(map[int64]struct{})
	for _, task := range tasks {
		if name := strings.TrimSpace(task.Model); name != "" {
			if _, ok := seenModels[name]; !ok {
				seenModels[name] = struct{}{}
				models = append(models, name)
			}
		}
		if task.APIKeyID > 0 {
			if _, ok := seenKeys[task.APIKeyID]; !ok {
				seenKeys[task.APIKeyID] = struct{}{}
				keys = append(keys, AsyncTaskAPIKeyOption{ID: task.APIKeyID, Name: task.APIKeyName})
			}
		}
	}
	sort.Strings(models)
	sort.Slice(keys, func(i, j int) bool { return keys[i].ID < keys[j].ID })
	return AsyncTaskFilterOptions{Models: models, APIKeys: keys}
}

func normalizeAsyncTaskFilter(query AsyncTaskQuery) (asynctask.Kind, asynctask.Status, error) {
	kind := asynctask.Kind(strings.ToLower(strings.TrimSpace(query.Kind)))
	switch kind {
	case "", "all":
		kind = ""
	case asynctask.KindImage, asynctask.KindVideo, asynctask.KindBatch:
	default:
		return "", "", ErrInvalidAsyncTaskFilter
	}
	status := asynctask.Status(strings.ToLower(strings.TrimSpace(query.Status)))
	switch status {
	case "", "all":
		status = ""
	case asynctask.StatusProcessing, asynctask.StatusPending, asynctask.StatusCompleted, asynctask.StatusFailed, asynctask.StatusCancelled:
	default:
		return "", "", ErrInvalidAsyncTaskFilter
	}
	return kind, status, nil
}

func normalizeAsyncTaskPage(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func asyncTaskSourceMessage(kind asynctask.Kind, err error) string {
	if errors.Is(err, asynctask.ErrSourceUnavailable) {
		switch kind {
		case asynctask.KindImage:
			return "未配置 Sub2API Redis，暂不能显示异步生图任务"
		case asynctask.KindBatch:
			return "未配置 Sub2API 数据库，暂不能显示批量生图任务"
		default:
			return "未配置 Sub2API 数据源，暂不能显示视频任务"
		}
	}
	switch kind {
	case asynctask.KindImage:
		return "异步生图任务暂时无法读取"
	case asynctask.KindBatch:
		return "批量生图任务暂时无法读取"
	default:
		return "视频任务暂时无法读取"
	}
}
