package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"aux-system/internal/asynctask"
	"aux-system/internal/integration"

	"github.com/stretchr/testify/require"
)

type asyncTaskKeyListerStub struct {
	keys  []integration.Sub2APIKeyInfo
	err   error
	token string
	calls int
}

func (s *asyncTaskKeyListerStub) ListUserAPIKeys(_ context.Context, token string) ([]integration.Sub2APIKeyInfo, error) {
	s.calls++
	s.token = token
	return s.keys, s.err
}

type asyncTaskVideoGatewayStub struct {
	status           integration.Sub2APIVideoTaskStatus
	err              error
	apiKey, provider string
	taskID           string
	calls            int
}

func (s *asyncTaskVideoGatewayStub) QueryVideoTaskStatus(_ context.Context, apiKey, provider, taskID string) (integration.Sub2APIVideoTaskStatus, error) {
	s.calls++
	s.apiKey, s.provider, s.taskID = apiKey, provider, taskID
	return s.status, s.err
}

func refreshTestService(store *asyncTaskStoreStub, keys *asyncTaskKeyListerStub, gateway *asyncTaskVideoGatewayStub) *AsyncTaskService {
	svc := NewAsyncTaskService(store).WithVideoGateway(keys, gateway)
	svc.now = func() time.Time { return time.Date(2026, 9, 30, 8, 0, 0, 0, time.UTC) }
	return svc
}

func pendingVideo(provider, id string) AsyncTask {
	task := asyncTaskAt(id, asynctask.KindVideo, asynctask.StatusPending, 1)
	task.Provider = provider
	return task
}

func activeKeys() *asyncTaskKeyListerStub {
	return &asyncTaskKeyListerStub{keys: []integration.Sub2APIKeyInfo{
		{ID: 3, Key: "sk-other", Status: "active"},
		{ID: 7, Key: " sk-owner ", Status: "active"},
	}}
}

func TestAsyncTaskRefreshRereadsImageAndBatchWithoutGateway(t *testing.T) {
	img := asyncTaskAt("imgtask_1", asynctask.KindImage, asynctask.StatusProcessing, 1)
	batch := asyncTaskAt("batch_1", asynctask.KindBatch, asynctask.StatusCompleted, 2)
	store := &asyncTaskStoreStub{images: []AsyncTask{img}, batches: []AsyncTask{batch}}
	keys, gateway := activeKeys(), &asyncTaskVideoGatewayStub{}
	svc := refreshTestService(store, keys, gateway)

	result, err := svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: " IMAGE ", Provider: "grok", ID: " imgtask_1 "})
	require.NoError(t, err)
	require.Equal(t, img, result.Task)
	require.False(t, result.UpstreamChecked)
	require.Equal(t, time.Date(2026, 9, 30, 8, 0, 0, 0, time.UTC), result.CheckedAt)

	result, err = svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "batch", ID: "batch_1"})
	require.NoError(t, err)
	require.Equal(t, batch, result.Task)
	require.Equal(t, []int64{42, 42}, store.userIDs)
	require.Zero(t, keys.calls)
	require.Zero(t, gateway.calls)
}

func TestAsyncTaskRefreshSkipsGatewayForFinishedVideo(t *testing.T) {
	done := pendingVideo(asynctask.ProviderGrok, "req-done")
	done.Status = asynctask.StatusCompleted
	keys, gateway := activeKeys(), &asyncTaskVideoGatewayStub{}
	svc := refreshTestService(&asyncTaskStoreStub{videos: []AsyncTask{done}}, keys, gateway)

	result, err := svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "video", ID: "req-done"})
	require.NoError(t, err)
	require.Equal(t, asynctask.StatusCompleted, result.Task.Status)
	require.False(t, result.UpstreamChecked)
	require.Zero(t, keys.calls)
	require.Zero(t, gateway.calls)
}

func TestAsyncTaskRefreshQueriesGatewayWithOwningKey(t *testing.T) {
	store := &asyncTaskStoreStub{videos: []AsyncTask{pendingVideo(asynctask.ProviderGrok, "cgt-1"), pendingVideo(asynctask.ProviderSeedance, "cgt-1")}}
	keys := activeKeys()
	gateway := &asyncTaskVideoGatewayStub{status: integration.Sub2APIVideoTaskStatus{Status: "succeeded", VideoURL: "https://cdn.example.com/v.mp4"}}
	svc := refreshTestService(store, keys, gateway)

	result, err := svc.RefreshForUser(context.Background(), 42, "user-token", AsyncTaskRef{Kind: "video", Provider: "Seedance", ID: "cgt-1"})
	require.NoError(t, err)
	require.Equal(t, "user-token", keys.token)
	require.Equal(t, "sk-owner", gateway.apiKey)
	require.Equal(t, asynctask.ProviderSeedance, gateway.provider)
	require.Equal(t, "cgt-1", gateway.taskID)
	require.True(t, result.UpstreamChecked)
	require.Equal(t, asynctask.StatusCompleted, result.Task.Status)
	require.Equal(t, "succeeded", result.Task.RawStatus)
	require.Equal(t, asynctask.ProviderSeedance, result.Task.Provider)
	require.Equal(t, "https://cdn.example.com/v.mp4", result.VideoURL)
}

func TestAsyncTaskRefreshMapsUpstreamStatuses(t *testing.T) {
	cases := []struct {
		upstream integration.Sub2APIVideoTaskStatus
		status   asynctask.Status
		message  string
		hasURL   bool
	}{
		{integration.Sub2APIVideoTaskStatus{Status: "DONE", ContentPath: "/v1/videos/req/content"}, asynctask.StatusCompleted, "", true},
		{integration.Sub2APIVideoTaskStatus{Status: "pending", VideoURL: "https://cdn.example.com/partial.mp4"}, asynctask.StatusProcessing, "", false},
		{integration.Sub2APIVideoTaskStatus{Status: "running"}, asynctask.StatusProcessing, "", false},
		{integration.Sub2APIVideoTaskStatus{Status: "failed", ErrorMessage: "内容审核未通过"}, asynctask.StatusFailed, "内容审核未通过", false},
		{integration.Sub2APIVideoTaskStatus{Status: "expired"}, asynctask.StatusFailed, "上游任务已过期", false},
		{integration.Sub2APIVideoTaskStatus{Status: "cancelled"}, asynctask.StatusCancelled, "", false},
	}
	for _, tc := range cases {
		gateway := &asyncTaskVideoGatewayStub{status: tc.upstream}
		svc := refreshTestService(&asyncTaskStoreStub{videos: []AsyncTask{pendingVideo(asynctask.ProviderGrok, "req")}}, activeKeys(), gateway)
		result, err := svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "video", ID: "req"})
		require.NoError(t, err, tc.upstream.Status)
		require.Equal(t, tc.status, result.Task.Status, tc.upstream.Status)
		require.Equal(t, tc.message, result.Task.ErrorMessage, tc.upstream.Status)
		require.Equal(t, tc.hasURL, result.VideoURL != "" || result.VideoContentPath != "", tc.upstream.Status)
	}
}

func TestAsyncTaskRefreshRequiresOwningActiveKey(t *testing.T) {
	gateway := &asyncTaskVideoGatewayStub{}
	keys := &asyncTaskKeyListerStub{keys: []integration.Sub2APIKeyInfo{{ID: 3, Key: "sk-other", Status: "active"}, {ID: 7, Key: "sk-owner", Status: "disabled"}}}
	svc := refreshTestService(&asyncTaskStoreStub{videos: []AsyncTask{pendingVideo(asynctask.ProviderGrok, "req")}}, keys, gateway)

	_, err := svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "video", ID: "req"})
	require.ErrorIs(t, err, ErrAsyncTaskAPIKeyUnavailable)
	require.Zero(t, gateway.calls, "must not fall back to another key")
}

func TestAsyncTaskRefreshPropagatesErrors(t *testing.T) {
	video := pendingVideo(asynctask.ProviderGrok, "req")

	svc := refreshTestService(&asyncTaskStoreStub{videos: []AsyncTask{video}}, &asyncTaskKeyListerStub{err: integration.ErrInvalidToken}, &asyncTaskVideoGatewayStub{})
	_, err := svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "video", ID: "req"})
	require.ErrorIs(t, err, integration.ErrInvalidToken)

	svc = refreshTestService(&asyncTaskStoreStub{videos: []AsyncTask{video}}, activeKeys(), &asyncTaskVideoGatewayStub{err: integration.ErrVideoTaskNotFound})
	_, err = svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "video", ID: "req"})
	require.ErrorIs(t, err, integration.ErrVideoTaskNotFound)

	svc = refreshTestService(&asyncTaskStoreStub{}, activeKeys(), &asyncTaskVideoGatewayStub{})
	_, err = svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "video", ID: "missing"})
	require.ErrorIs(t, err, ErrAsyncTaskNotFound)

	svc = refreshTestService(&asyncTaskStoreStub{imageErr: asynctask.ErrSourceUnavailable}, activeKeys(), &asyncTaskVideoGatewayStub{})
	_, err = svc.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "image", ID: "imgtask_1"})
	require.ErrorIs(t, err, ErrAsyncTaskUnavailable)

	unconfigured := NewAsyncTaskService(&asyncTaskStoreStub{videos: []AsyncTask{video}})
	_, err = unconfigured.RefreshForUser(context.Background(), 42, "token", AsyncTaskRef{Kind: "video", ID: "req"})
	require.ErrorIs(t, err, ErrAsyncTaskUnavailable)
}

func TestAsyncTaskRefreshValidatesReference(t *testing.T) {
	svc := refreshTestService(&asyncTaskStoreStub{}, activeKeys(), &asyncTaskVideoGatewayStub{})
	for _, ref := range []AsyncTaskRef{
		{Kind: "video", ID: ""},
		{Kind: "video", ID: string(make([]byte, asyncTaskIDMaxBytes+1))},
		{Kind: "audio", ID: "x"},
		{Kind: "video", Provider: "sora", ID: "x"},
	} {
		_, err := svc.RefreshForUser(context.Background(), 42, "token", ref)
		require.True(t, errors.Is(err, ErrInvalidAsyncTaskRef), "%+v", ref)
	}
}
