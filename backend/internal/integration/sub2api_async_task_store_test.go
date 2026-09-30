package integration

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"aux-system/internal/asynctask"

	"github.com/stretchr/testify/require"
)

func TestParseImageTaskRecordKeepsOnlySafeHTTPURLs(t *testing.T) {
	raw := []byte(`{
		"id":"imgtask_abc","user_id":42,"api_key_id":7,"status":"completed","http_status":200,
		"result":{"data":[{"url":"https://cdn.example.com/a.png"},{"b64_json":"AAAA"},{"url":"javascript:alert(1)"},{"url":"https://user:pass@cdn.example.com/b.png"}]},
		"created_at":1790000000,"completed_at":1790000030,"expires_at":1790086400
	}`)

	task, userID, ok := parseImageTaskRecord(raw)

	require.True(t, ok)
	require.Equal(t, int64(42), userID)
	require.Equal(t, "imgtask_abc", task.ID)
	require.Equal(t, asynctask.KindImage, task.Kind)
	require.Equal(t, asynctask.StatusCompleted, task.Status)
	require.Equal(t, []string{"https://cdn.example.com/a.png"}, task.ImageURLs)
	require.Equal(t, 4, task.ImageCount)
	require.Equal(t, time.Unix(1790000000, 0).UTC(), task.CreatedAt)
	require.NotNil(t, task.CompletedAt)
	require.NotNil(t, task.ExpiresAt)
}

func TestParseImageTaskRecordTruncatesErrorsAndRejectsForeignRecords(t *testing.T) {
	longMessage := strings.Repeat("错", asyncTaskMaxErrorRunes+20)
	task, _, ok := parseImageTaskRecord([]byte(`{"id":"imgtask_x","user_id":3,"status":"failed","error":{"type":"upstream_error","message":"` + longMessage + `"},"created_at":1}`))
	require.True(t, ok)
	require.Equal(t, asynctask.StatusFailed, task.Status)
	require.Equal(t, asyncTaskMaxErrorRunes+1, len([]rune(task.ErrorMessage)))

	_, _, ok = parseImageTaskRecord([]byte(`{"id":"imgtask_y","status":"processing"}`))
	require.False(t, ok, "records without an owner must be ignored")
	_, _, ok = parseImageTaskRecord([]byte(`not json`))
	require.False(t, ok)
}

func TestParsePendingVideoReadsOwnerFromKey(t *testing.T) {
	userID, snapshot, ok := parsePendingVideo("grok_video_pending:42:7:req-1", []byte(`{"model":"grok-imagine-video","video_resolution":"720p","video_duration_seconds":8,"created_at":"2026-09-27T01:02:03.456Z"}`))
	require.True(t, ok)
	require.Equal(t, int64(42), userID)
	require.Equal(t, "42:7:req-1", snapshot.suffix)
	require.Equal(t, "req-1", snapshot.requestID)
	require.Equal(t, int64(7), snapshot.apiKeyID)

	for _, key := range []string{"grok_video_pending:bad:7:req", "grok_video_pending:42:7", "image_task:42:7:req", "grok_video_pending:42:0:req"} {
		_, _, ok := parsePendingVideo(key, []byte(`{}`))
		require.False(t, ok, key)
	}
}

func TestMergeVideoTasksCombinesPendingClaimsAndUsageLogs(t *testing.T) {
	created := time.Date(2026, 9, 27, 1, 0, 0, 0, time.UTC)
	pending := []pendingVideoSnapshot{
		{suffix: "42:7:waiting", requestID: "waiting", apiKeyID: 7, payload: grokVideoPendingPayload{Model: "grok-video", VideoResolution: "720p", VideoDurationSeconds: 6, CreatedAt: created.Format(time.RFC3339Nano)}},
		{suffix: "42:7:claimed", requestID: "claimed", apiKeyID: 7, payload: grokVideoPendingPayload{Model: "grok-video", CreatedAt: created.Add(time.Minute).Format(time.RFC3339Nano)}},
		{suffix: "42:7:logged", requestID: "logged", apiKeyID: 7, payload: grokVideoPendingPayload{OriginalModel: "grok-imagine", Model: "grok-video", CreatedAt: created.Add(2 * time.Minute).Format(time.RFC3339Nano)}},
	}
	billed := []billedVideoRow{
		{requestID: "logged", apiKeyID: 7, model: "grok-video", cost: 0.5, createdAt: created.Add(5 * time.Minute), resolution: "1080p", durationSeconds: 10},
		{requestID: "expired-snapshot", apiKeyID: 8, model: "grok-video", cost: 0.25, createdAt: created.Add(-time.Hour)},
	}

	tasks := mergeVideoTasks(pending, map[string]bool{"claimed": true}, billed)

	require.Len(t, tasks, 4)
	byID := map[string]asynctask.Task{}
	for _, task := range tasks {
		byID[task.ID] = task
	}
	require.Equal(t, asynctask.StatusPending, byID["waiting"].Status)
	require.Equal(t, "720p", byID["waiting"].Resolution)
	require.Equal(t, asynctask.StatusCompleted, byID["claimed"].Status)
	require.Nil(t, byID["claimed"].Cost)
	require.Equal(t, asynctask.StatusCompleted, byID["logged"].Status)
	require.Equal(t, "grok-imagine", byID["logged"].Model)
	require.Equal(t, 0.5, *byID["logged"].Cost)
	require.Equal(t, "1080p", byID["logged"].Resolution)
	require.Equal(t, created.Add(2*time.Minute), byID["logged"].CreatedAt)
	require.Equal(t, asynctask.StatusCompleted, byID["expired-snapshot"].Status)
	require.Equal(t, "logged", tasks[0].ID, "tasks are ordered newest first")
	require.Equal(t, "expired-snapshot", tasks[3].ID)
}

func TestNormalizeBatchStatus(t *testing.T) {
	cases := map[string]asynctask.Status{
		"created": asynctask.StatusPending, "uploading": asynctask.StatusPending,
		"submitted": asynctask.StatusProcessing, "running": asynctask.StatusProcessing, "indexing": asynctask.StatusProcessing, "settling": asynctask.StatusProcessing,
		"completed": asynctask.StatusCompleted, "output_deleted": asynctask.StatusCompleted,
		"failed": asynctask.StatusFailed, "cancelled": asynctask.StatusCancelled,
	}
	for raw, want := range cases {
		require.Equal(t, want, normalizeBatchStatus(raw), raw)
	}
}

func TestSub2APIAsyncTaskStoreReportsMissingSources(t *testing.T) {
	store := NewSub2APIAsyncTaskStore(nil, nil)
	ctx := context.Background()
	_, err := store.ListImageTasks(ctx, 1)
	require.True(t, errors.Is(err, asynctask.ErrSourceUnavailable))
	_, err = store.ListVideoTasks(ctx, 1)
	require.True(t, errors.Is(err, asynctask.ErrSourceUnavailable))
	_, err = store.ListBatchTasks(ctx, 1)
	require.True(t, errors.Is(err, asynctask.ErrSourceUnavailable))
	_, err = store.APIKeyNames(ctx, 1)
	require.True(t, errors.Is(err, asynctask.ErrSourceUnavailable))
}

func TestMergeVideoTasksSplitsSeedanceProvider(t *testing.T) {
	created := time.Date(2026, 9, 27, 1, 0, 0, 0, time.UTC)
	pending := []pendingVideoSnapshot{
		{suffix: "42:7:seedance:cgt-1", requestID: "seedance:cgt-1", apiKeyID: 7, payload: grokVideoPendingPayload{Model: "doubao-seedance", CreatedAt: created.Format(time.RFC3339Nano)}},
		{suffix: "42:7:req-1", requestID: "req-1", apiKeyID: 7, payload: grokVideoPendingPayload{Model: "grok-video", CreatedAt: created.Add(time.Minute).Format(time.RFC3339Nano)}},
	}
	billed := []billedVideoRow{{requestID: "seedance:cgt-0", apiKeyID: 7, model: "doubao-seedance", createdAt: created.Add(-time.Hour)}}

	tasks := mergeVideoTasks(pending, nil, billed)

	require.Len(t, tasks, 3)
	require.Equal(t, "req-1", tasks[0].ID)
	require.Equal(t, asynctask.ProviderGrok, tasks[0].Provider)
	require.Equal(t, "cgt-1", tasks[1].ID)
	require.Equal(t, asynctask.ProviderSeedance, tasks[1].Provider)
	require.Equal(t, "cgt-0", tasks[2].ID)
	require.Equal(t, asynctask.ProviderSeedance, tasks[2].Provider)
}

func TestSub2APIAsyncTaskStoreSingleTaskReadsReportMissingSources(t *testing.T) {
	store := NewSub2APIAsyncTaskStore(nil, nil)
	ctx := context.Background()
	_, err := store.ImageTask(ctx, 1, "imgtask_1")
	require.ErrorIs(t, err, asynctask.ErrSourceUnavailable)
	_, err = store.VideoTask(ctx, 1, asynctask.ProviderGrok, "req-1")
	require.ErrorIs(t, err, asynctask.ErrSourceUnavailable)
	_, err = store.BatchTask(ctx, 1, "batch_1")
	require.ErrorIs(t, err, asynctask.ErrSourceUnavailable)
}
