package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"aux-system/internal/asynctask"

	"github.com/stretchr/testify/require"
)

type asyncTaskStoreStub struct {
	images, videos, batches []AsyncTask
	imageErr, videoErr      error
	batchErr, namesErr      error
	names                   map[int64]string
	userIDs                 []int64
}

func (s *asyncTaskStoreStub) ListImageTasks(_ context.Context, userID int64) (AsyncTaskSourceResult, error) {
	s.userIDs = append(s.userIDs, userID)
	return AsyncTaskSourceResult{Tasks: s.images, Truncated: true}, s.imageErr
}

func (s *asyncTaskStoreStub) ListVideoTasks(context.Context, int64) (AsyncTaskSourceResult, error) {
	return AsyncTaskSourceResult{Tasks: s.videos}, s.videoErr
}

func (s *asyncTaskStoreStub) ListBatchTasks(context.Context, int64) (AsyncTaskSourceResult, error) {
	return AsyncTaskSourceResult{Tasks: s.batches}, s.batchErr
}

func (s *asyncTaskStoreStub) APIKeyNames(context.Context, int64) (map[int64]string, error) {
	return s.names, s.namesErr
}

func asyncTaskAt(id string, kind asynctask.Kind, status asynctask.Status, minute int) AsyncTask {
	return AsyncTask{ID: id, Kind: kind, Status: status, APIKeyID: 7, CreatedAt: time.Date(2026, 9, 27, 0, minute, 0, 0, time.UTC)}
}

func TestAsyncTaskServiceMergesSourcesAndFilters(t *testing.T) {
	store := &asyncTaskStoreStub{
		images:  []AsyncTask{asyncTaskAt("img-1", asynctask.KindImage, asynctask.StatusProcessing, 5), asyncTaskAt("img-2", asynctask.KindImage, asynctask.StatusFailed, 1)},
		videos:  []AsyncTask{asyncTaskAt("vid-1", asynctask.KindVideo, asynctask.StatusPending, 3)},
		batches: []AsyncTask{asyncTaskAt("batch-1", asynctask.KindBatch, asynctask.StatusCompleted, 4)},
		names:   map[int64]string{7: "生产 Key"},
	}
	svc := NewAsyncTaskService(store)

	all, err := svc.ListForUser(context.Background(), 42, AsyncTaskQuery{})
	require.NoError(t, err)
	require.Equal(t, []int64{42}, store.userIDs)
	require.Equal(t, 4, all.Total)
	require.Equal(t, []string{"img-1", "batch-1", "vid-1", "img-2"}, asyncTaskIDs(all.Items))
	require.Equal(t, "生产 Key", all.Items[0].APIKeyName)
	require.Equal(t, AsyncTaskSummary{Total: 4, Image: 2, Video: 1, Batch: 1, Processing: 1, Pending: 1, Completed: 1, Failed: 1}, all.Summary)
	require.Len(t, all.Sources, 3)
	require.True(t, all.Sources[0].Truncated)

	images, err := svc.ListForUser(context.Background(), 42, AsyncTaskQuery{Kind: "image", Status: "failed"})
	require.NoError(t, err)
	require.Equal(t, []string{"img-2"}, asyncTaskIDs(images.Items))
	require.Equal(t, 4, images.Summary.Total, "kind counts ignore the active filter")
	require.Equal(t, 1, images.Summary.Processing, "status counts follow the kind filter")
	require.Equal(t, 0, images.Summary.Completed)

	paged, err := svc.ListForUser(context.Background(), 42, AsyncTaskQuery{Page: 2, PageSize: 3})
	require.NoError(t, err)
	require.Equal(t, []string{"img-2"}, asyncTaskIDs(paged.Items))
	require.Equal(t, 4, paged.Total)
}

func TestAsyncTaskServiceReturnsPartialResultsWhenSourceFails(t *testing.T) {
	store := &asyncTaskStoreStub{
		imageErr: asynctask.ErrSourceUnavailable,
		videoErr: errors.New("redis timeout"),
		batches:  []AsyncTask{asyncTaskAt("batch-1", asynctask.KindBatch, asynctask.StatusProcessing, 1)},
		namesErr: errors.New("names failed"),
	}

	result, err := NewAsyncTaskService(store).ListForUser(context.Background(), 1, AsyncTaskQuery{})

	require.NoError(t, err)
	require.Equal(t, []string{"batch-1"}, asyncTaskIDs(result.Items))
	require.False(t, result.Sources[0].Available)
	require.Contains(t, result.Sources[0].Message, "Redis")
	require.False(t, result.Sources[1].Available)
	require.NotEmpty(t, result.Sources[1].Message)
	require.NotContains(t, result.Sources[1].Message, "redis timeout", "internal errors must not leak to users")
	require.True(t, result.Sources[2].Available)
}

func TestAsyncTaskServiceFailsWhenEverySourceFails(t *testing.T) {
	store := &asyncTaskStoreStub{imageErr: asynctask.ErrSourceUnavailable, videoErr: asynctask.ErrSourceUnavailable, batchErr: errors.New("db down")}
	_, err := NewAsyncTaskService(store).ListForUser(context.Background(), 1, AsyncTaskQuery{})
	require.ErrorIs(t, err, ErrAsyncTaskUnavailable)

	_, err = NewAsyncTaskService(nil).ListForUser(context.Background(), 1, AsyncTaskQuery{})
	require.ErrorIs(t, err, ErrAsyncTaskUnavailable)
}

func TestAsyncTaskServiceRejectsUnknownFilters(t *testing.T) {
	svc := NewAsyncTaskService(&asyncTaskStoreStub{})
	_, err := svc.ListForUser(context.Background(), 1, AsyncTaskQuery{Kind: "audio"})
	require.ErrorIs(t, err, ErrInvalidAsyncTaskFilter)
	_, err = svc.ListForUser(context.Background(), 1, AsyncTaskQuery{Status: "done"})
	require.ErrorIs(t, err, ErrInvalidAsyncTaskFilter)
	day := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)
	_, err = svc.ListForUser(context.Background(), 1, AsyncTaskQuery{CreatedFrom: day, CreatedTo: day})
	require.ErrorIs(t, err, ErrInvalidAsyncTaskFilter, "empty date range")
	_, err = svc.ListForUser(context.Background(), 1, AsyncTaskQuery{Keyword: strings.Repeat("长", 129)})
	require.ErrorIs(t, err, ErrInvalidAsyncTaskFilter)
	_, err = svc.ListForUser(context.Background(), 1, AsyncTaskQuery{APIKeyID: -1})
	require.ErrorIs(t, err, ErrInvalidAsyncTaskFilter)
}

func TestAsyncTaskServiceAppliesDateModelKeyAndKeywordFilters(t *testing.T) {
	img := asyncTaskAt("imgtask_Alpha", asynctask.KindImage, asynctask.StatusCompleted, 10)
	img.Model = "gpt-image-2"
	vid := asyncTaskAt("grok-video:req-1", asynctask.KindVideo, asynctask.StatusPending, 20)
	vid.Model, vid.APIKeyID = "grok-video", 9
	batch := asyncTaskAt("batch-1", asynctask.KindBatch, asynctask.StatusFailed, 30)
	batch.Model, batch.TaskName = "gpt-image-2", "海报 Alpha 批次"
	old := asyncTaskAt("imgtask_old", asynctask.KindImage, asynctask.StatusCompleted, 0)
	old.CreatedAt = old.CreatedAt.Add(-48 * time.Hour)
	store := &asyncTaskStoreStub{images: []AsyncTask{img, old}, videos: []AsyncTask{vid}, batches: []AsyncTask{batch}, names: map[int64]string{7: "生产 Key", 9: "视频 Key"}}
	svc := NewAsyncTaskService(store)
	day := time.Date(2026, 9, 27, 0, 0, 0, 0, time.UTC)

	byDate, err := svc.ListForUser(context.Background(), 1, AsyncTaskQuery{CreatedFrom: day, CreatedTo: day.Add(30 * time.Minute)})
	require.NoError(t, err)
	require.Equal(t, []string{"grok-video:req-1", "imgtask_Alpha"}, asyncTaskIDs(byDate.Items), "created_to is exclusive")
	require.Equal(t, AsyncTaskSummary{Total: 2, Image: 1, Video: 1, Pending: 1, Completed: 1}, byDate.Summary)
	require.Equal(t, []string{"gpt-image-2", "grok-video"}, byDate.FilterOptions.Models, "options come from every task")
	require.Equal(t, []AsyncTaskAPIKeyOption{{ID: 7, Name: "生产 Key"}, {ID: 9, Name: "视频 Key"}}, byDate.FilterOptions.APIKeys)

	byModel, err := svc.ListForUser(context.Background(), 1, AsyncTaskQuery{Model: "gpt-image-2", APIKeyID: 7, CreatedFrom: day})
	require.NoError(t, err)
	require.Equal(t, []string{"batch-1", "imgtask_Alpha"}, asyncTaskIDs(byModel.Items))

	byKeyword, err := svc.ListForUser(context.Background(), 1, AsyncTaskQuery{Keyword: "  alpha "})
	require.NoError(t, err)
	require.Equal(t, []string{"batch-1", "imgtask_Alpha"}, asyncTaskIDs(byKeyword.Items), "keyword matches id and task name case-insensitively")

	byKey, err := svc.ListForUser(context.Background(), 1, AsyncTaskQuery{APIKeyID: 9})
	require.NoError(t, err)
	require.Equal(t, []string{"grok-video:req-1"}, asyncTaskIDs(byKey.Items))
}

func asyncTaskIDs(tasks []AsyncTask) []string {
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		ids = append(ids, task.ID)
	}
	return ids
}
