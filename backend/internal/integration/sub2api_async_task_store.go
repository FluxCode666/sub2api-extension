package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"aux-system/internal/asynctask"

	"github.com/redis/go-redis/v9"
)

const (
	imageTaskKeyPrefix        = "image_task:"
	grokVideoPendingKeyPrefix = "grok_video_pending:"
	grokVideoBilledKeyPrefix  = "grok_video_billed:"
	grokVideoRequestPrefix    = "grok-video:"

	// Sub2API 的异步生图和 Grok 视频快照没有按用户建立索引，只能 SCAN。
	// 扫描结果在进程内短暂共享，并限制单轮扫描规模，避免用户频繁刷新时
	// 在网关共用的 Redis 上反复遍历整个 keyspace。
	asyncTaskSnapshotTTL      = 10 * time.Second
	asyncTaskScanTimeout      = 4 * time.Second
	asyncTaskScanCount        = 1000
	asyncTaskScanMaxCalls     = 200
	asyncTaskScanMaxKeys      = 20000
	asyncTaskMGetChunk        = 200
	asyncTaskMaxImageURLs     = 8
	asyncTaskMaxErrorRunes    = 300
	asyncTaskPerUserLimit     = 200
	asyncTaskDatabaseLookback = 30 * 24 * time.Hour
)

// Sub2APIAsyncTaskStore 只读查询 Sub2API 中属于某个用户的异步任务。
//
// 数据来源：
//   - Redis image_task:<id>：异步生图任务记录，24 小时 TTL；
//   - Redis grok_video_pending:<user>:<key>:<request>：Grok 视频创建快照，
//     grok_video_billed:<同一后缀> 表示已观察到完成并计费；
//   - PostgreSQL usage_logs(request_id = 'grok-video:<request>')：视频计费记录；
//   - PostgreSQL batch_image_jobs：批量生图任务。
//
// 这里从不调用 Sub2API 网关或上游，也不读取 API Key 明文。
type Sub2APIAsyncTaskStore struct {
	db    *sql.DB
	redis *redis.Client
	now   func() time.Time

	mu       sync.Mutex
	snapshot *asyncTaskRedisSnapshot
}

type asyncTaskRedisSnapshot struct {
	loadedAt       time.Time
	images         map[int64][]asynctask.Task
	imageTruncated bool
	videos         map[int64][]pendingVideoSnapshot
	videoTruncated bool
}

type pendingVideoSnapshot struct {
	suffix    string
	requestID string
	apiKeyID  int64
	payload   grokVideoPendingPayload
}

type imageTaskRecord struct {
	ID          string          `json:"id"`
	UserID      int64           `json:"user_id"`
	APIKeyID    int64           `json:"api_key_id"`
	Status      string          `json:"status"`
	HTTPStatus  int             `json:"http_status,omitempty"`
	Result      json.RawMessage `json:"result,omitempty"`
	Error       json.RawMessage `json:"error,omitempty"`
	CreatedAt   int64           `json:"created_at"`
	CompletedAt *int64          `json:"completed_at,omitempty"`
	ExpiresAt   int64           `json:"expires_at"`
}

type grokVideoPendingPayload struct {
	Model                string `json:"model"`
	BillingModel         string `json:"billing_model,omitempty"`
	VideoResolution      string `json:"video_resolution,omitempty"`
	VideoDurationSeconds int    `json:"video_duration_seconds,omitempty"`
	OriginalModel        string `json:"original_model,omitempty"`
	CreatedAt            string `json:"created_at,omitempty"`
}

func NewSub2APIAsyncTaskStore(db *sql.DB, redisClient *redis.Client) *Sub2APIAsyncTaskStore {
	return &Sub2APIAsyncTaskStore{db: db, redis: redisClient, now: time.Now}
}

// RedisAvailable 表示异步生图与视频等待快照是否可读。
func (s *Sub2APIAsyncTaskStore) RedisAvailable() bool { return s != nil && s.redis != nil }

// DatabaseAvailable 表示批量任务与视频计费记录是否可读。
func (s *Sub2APIAsyncTaskStore) DatabaseAvailable() bool { return s != nil && s.db != nil }

// ListImageTasks 返回 Redis 中仍未过期的异步生图任务。
func (s *Sub2APIAsyncTaskStore) ListImageTasks(ctx context.Context, userID int64) (asynctask.SourceResult, error) {
	if !s.RedisAvailable() {
		return asynctask.SourceResult{}, asynctask.ErrSourceUnavailable
	}
	snapshot, err := s.redisSnapshot(ctx)
	if err != nil {
		return asynctask.SourceResult{}, err
	}
	tasks := append([]asynctask.Task(nil), snapshot.images[userID]...)
	return asynctask.SourceResult{Tasks: tasks, Truncated: snapshot.imageTruncated}, nil
}

// ListVideoTasks 合并 Redis 创建快照与 usage_logs 计费记录。
//
// Sub2API 只在用户轮询到 done 时计费，本系统不代替用户查询上游，因此
// 只有创建快照的任务显示为“等待结果”，而不是断言其仍在生成。
func (s *Sub2APIAsyncTaskStore) ListVideoTasks(ctx context.Context, userID int64) (asynctask.SourceResult, error) {
	if !s.RedisAvailable() && !s.DatabaseAvailable() {
		return asynctask.SourceResult{}, asynctask.ErrSourceUnavailable
	}
	var pending []pendingVideoSnapshot
	billedClaims := map[string]bool{}
	truncated := false
	if s.RedisAvailable() {
		snapshot, err := s.redisSnapshot(ctx)
		if err != nil {
			return asynctask.SourceResult{}, err
		}
		pending = snapshot.videos[userID]
		truncated = snapshot.videoTruncated
		claims, err := s.billedClaims(ctx, pending)
		if err != nil {
			return asynctask.SourceResult{}, err
		}
		billedClaims = claims
	}
	var billed []billedVideoRow
	if s.DatabaseAvailable() {
		rows, err := s.billedVideos(ctx, userID)
		if err != nil {
			return asynctask.SourceResult{}, err
		}
		billed = rows
	}
	return asynctask.SourceResult{Tasks: mergeVideoTasks(pending, billedClaims, billed), Truncated: truncated}, nil
}

// ListBatchTasks 返回近 30 天内用户未删除的批量生图任务。
func (s *Sub2APIAsyncTaskStore) ListBatchTasks(ctx context.Context, userID int64) (asynctask.SourceResult, error) {
	if !s.DatabaseAvailable() {
		return asynctask.SourceResult{}, asynctask.ErrSourceUnavailable
	}
	columns, err := s.columns(ctx, "batch_image_jobs")
	if err != nil {
		return asynctask.SourceResult{}, fmt.Errorf("inspect batch_image_jobs: %w", err)
	}
	if len(columns) == 0 {
		// 旧版 Sub2API 没有批量生图，视为空列表而不是错误。
		return asynctask.SourceResult{}, nil
	}
	deletedFilter := ""
	if columns["user_deleted_at"] {
		deletedFilter = " AND b.user_deleted_at IS NULL"
	}
	query := fmt.Sprintf(`
		SELECT b.batch_id, COALESCE(b.api_key_id, 0), COALESCE(b.model, ''), COALESCE(b.status, ''),
		       COALESCE(b.item_count, 0), COALESCE(b.success_count, 0), COALESCE(b.fail_count, 0), COALESCE(b.cancelled_count, 0),
		       COALESCE(b.estimated_cost, 0)::double precision, b.actual_cost::double precision, COALESCE(b.currency, ''),
		       %s, COALESCE(b.last_error_message, ''), b.created_at, b.finished_at, b.output_expires_at
		FROM batch_image_jobs b
		WHERE b.user_id = $1 AND b.created_at >= $2%s
		ORDER BY b.created_at DESC
		LIMIT %d`, textColumnExpression("b", columns, "task_name"), deletedFilter, asyncTaskPerUserLimit)
	rows, err := s.db.QueryContext(ctx, query, userID, s.now().Add(-asyncTaskDatabaseLookback))
	if err != nil {
		return asynctask.SourceResult{}, fmt.Errorf("query batch_image_jobs: %w", err)
	}
	defer func() { _ = rows.Close() }()
	tasks := make([]asynctask.Task, 0)
	for rows.Next() {
		var (
			task                  asynctask.Task
			estimated             float64
			actual                sql.NullFloat64
			finishedAt, expiresAt sql.NullTime
		)
		if err := rows.Scan(&task.ID, &task.APIKeyID, &task.Model, &task.RawStatus,
			&task.ItemCount, &task.SuccessCount, &task.FailCount, &task.CancelledCount,
			&estimated, &actual, &task.Currency, &task.TaskName, &task.ErrorMessage,
			&task.CreatedAt, &finishedAt, &expiresAt); err != nil {
			return asynctask.SourceResult{}, fmt.Errorf("scan batch_image_jobs: %w", err)
		}
		task.Kind = asynctask.KindBatch
		task.Status = normalizeBatchStatus(task.RawStatus)
		task.ErrorMessage = truncateRunes(task.ErrorMessage, asyncTaskMaxErrorRunes)
		if actual.Valid {
			cost := actual.Float64
			task.Cost = &cost
		} else if estimated > 0 {
			cost := estimated
			task.Cost = &cost
			task.CostEstimated = true
		}
		if finishedAt.Valid {
			value := finishedAt.Time
			task.CompletedAt = &value
		}
		if expiresAt.Valid {
			value := expiresAt.Time
			task.ExpiresAt = &value
		}
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return asynctask.SourceResult{}, fmt.Errorf("iterate batch_image_jobs: %w", err)
	}
	return asynctask.SourceResult{Tasks: tasks}, nil
}

// APIKeyNames 返回用户 API Key 的 ID 与名称，不读取 key 字段。
func (s *Sub2APIAsyncTaskStore) APIKeyNames(ctx context.Context, userID int64) (map[int64]string, error) {
	if !s.DatabaseAvailable() {
		return nil, asynctask.ErrSourceUnavailable
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(name, '') FROM api_keys WHERE user_id = $1 ORDER BY id DESC LIMIT 500`, userID)
	if err != nil {
		return nil, fmt.Errorf("query api key names: %w", err)
	}
	defer func() { _ = rows.Close() }()
	names := make(map[int64]string)
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("scan api key names: %w", err)
		}
		names[id] = name
	}
	return names, rows.Err()
}

type billedVideoRow struct {
	requestID       string
	apiKeyID        int64
	model           string
	cost            float64
	createdAt       time.Time
	resolution      string
	durationSeconds int
}

func (s *Sub2APIAsyncTaskStore) billedVideos(ctx context.Context, userID int64) ([]billedVideoRow, error) {
	columns, err := s.columns(ctx, "usage_logs")
	if err != nil {
		return nil, fmt.Errorf("inspect usage_logs: %w", err)
	}
	if len(columns) == 0 || !columns["request_id"] {
		return nil, nil
	}
	resolution := textColumnExpression("u", columns, "video_resolution")
	duration := "0"
	if columns["video_duration_seconds"] {
		duration = `COALESCE(u."video_duration_seconds", 0)::bigint`
	}
	query := fmt.Sprintf(`
		SELECT u.request_id, COALESCE(u.api_key_id, 0), %s, %s::double precision, u.created_at, %s, %s
		FROM usage_logs u
		WHERE u.user_id = $1 AND u.created_at >= $2 AND u.request_id LIKE 'grok-video:%%'
		ORDER BY u.created_at DESC
		LIMIT %d`,
		textColumnExpression("u", columns, "model"),
		numericColumnExpression("u", columns, []string{"actual_cost", "total_cost"}),
		resolution, duration, asyncTaskPerUserLimit)
	rows, err := s.db.QueryContext(ctx, query, userID, s.now().Add(-asyncTaskDatabaseLookback))
	if err != nil {
		return nil, fmt.Errorf("query video usage logs: %w", err)
	}
	defer func() { _ = rows.Close() }()
	result := make([]billedVideoRow, 0)
	for rows.Next() {
		var row billedVideoRow
		var duration int64
		if err := rows.Scan(&row.requestID, &row.apiKeyID, &row.model, &row.cost, &row.createdAt, &row.resolution, &duration); err != nil {
			return nil, fmt.Errorf("scan video usage logs: %w", err)
		}
		row.requestID = strings.TrimPrefix(strings.TrimSpace(row.requestID), grokVideoRequestPrefix)
		row.durationSeconds = int(duration)
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *Sub2APIAsyncTaskStore) columns(ctx context.Context, table string) (map[string]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, table)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	result := make(map[string]bool)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		result[strings.ToLower(name)] = true
	}
	return result, rows.Err()
}

func (s *Sub2APIAsyncTaskStore) billedClaims(ctx context.Context, pending []pendingVideoSnapshot) (map[string]bool, error) {
	claims := make(map[string]bool, len(pending))
	if len(pending) == 0 {
		return claims, nil
	}
	pipe := s.redis.Pipeline()
	commands := make([]*redis.IntCmd, len(pending))
	for i, item := range pending {
		commands[i] = pipe.Exists(ctx, grokVideoBilledKeyPrefix+item.suffix)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, fmt.Errorf("check grok video billed claims: %w", err)
	}
	for i, item := range pending {
		claims[item.requestID] = commands[i].Val() > 0
	}
	return claims, nil
}

func (s *Sub2APIAsyncTaskStore) redisSnapshot(ctx context.Context) (*asyncTaskRedisSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.snapshot != nil && s.now().Sub(s.snapshot.loadedAt) < asyncTaskSnapshotTTL {
		return s.snapshot, nil
	}
	scanCtx, cancel := context.WithTimeout(ctx, asyncTaskScanTimeout)
	defer cancel()

	imageKeys, imageTruncated, err := s.scanKeys(scanCtx, imageTaskKeyPrefix+"*")
	if err != nil {
		return nil, fmt.Errorf("scan image tasks: %w", err)
	}
	images, err := s.loadImageTasks(scanCtx, imageKeys)
	if err != nil {
		return nil, err
	}
	videoKeys, videoTruncated, err := s.scanKeys(scanCtx, grokVideoPendingKeyPrefix+"*")
	if err != nil {
		return nil, fmt.Errorf("scan grok video tasks: %w", err)
	}
	videos, err := s.loadPendingVideos(scanCtx, videoKeys)
	if err != nil {
		return nil, err
	}
	s.snapshot = &asyncTaskRedisSnapshot{
		loadedAt: s.now(), images: images, imageTruncated: imageTruncated,
		videos: videos, videoTruncated: videoTruncated,
	}
	return s.snapshot, nil
}

func (s *Sub2APIAsyncTaskStore) scanKeys(ctx context.Context, pattern string) ([]string, bool, error) {
	var cursor uint64
	keys := make([]string, 0)
	seen := make(map[string]struct{})
	for calls := 0; ; calls++ {
		if calls >= asyncTaskScanMaxCalls || len(keys) >= asyncTaskScanMaxKeys {
			return keys, true, nil
		}
		batch, next, err := s.redis.Scan(ctx, cursor, pattern, asyncTaskScanCount).Result()
		if err != nil {
			return nil, false, err
		}
		for _, key := range batch {
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			keys = append(keys, key)
		}
		if next == 0 {
			return keys, false, nil
		}
		cursor = next
	}
}

func (s *Sub2APIAsyncTaskStore) loadImageTasks(ctx context.Context, keys []string) (map[int64][]asynctask.Task, error) {
	result := make(map[int64][]asynctask.Task)
	for start := 0; start < len(keys); start += asyncTaskMGetChunk {
		end := min(start+asyncTaskMGetChunk, len(keys))
		values, err := s.redis.MGet(ctx, keys[start:end]...).Result()
		if err != nil {
			return nil, fmt.Errorf("load image tasks: %w", err)
		}
		for _, value := range values {
			raw, ok := value.(string)
			if !ok {
				continue
			}
			task, userID, ok := parseImageTaskRecord([]byte(raw))
			if !ok {
				continue
			}
			result[userID] = append(result[userID], task)
		}
	}
	return result, nil
}

func (s *Sub2APIAsyncTaskStore) loadPendingVideos(ctx context.Context, keys []string) (map[int64][]pendingVideoSnapshot, error) {
	result := make(map[int64][]pendingVideoSnapshot)
	for start := 0; start < len(keys); start += asyncTaskMGetChunk {
		end := min(start+asyncTaskMGetChunk, len(keys))
		values, err := s.redis.MGet(ctx, keys[start:end]...).Result()
		if err != nil {
			return nil, fmt.Errorf("load grok video tasks: %w", err)
		}
		for i, value := range values {
			raw, ok := value.(string)
			if !ok {
				continue
			}
			userID, snapshot, ok := parsePendingVideo(keys[start+i], []byte(raw))
			if !ok {
				continue
			}
			result[userID] = append(result[userID], snapshot)
		}
	}
	return result, nil
}

// parseImageTaskRecord 将 Sub2API 的 ImageTaskRecord 转为安全视图：
// 只保留 http(s) 图片地址，丢弃 b64 数据和上游原始响应。
func parseImageTaskRecord(raw []byte) (asynctask.Task, int64, bool) {
	var record imageTaskRecord
	if err := json.Unmarshal(raw, &record); err != nil || record.UserID <= 0 || strings.TrimSpace(record.ID) == "" {
		return asynctask.Task{}, 0, false
	}
	task := asynctask.Task{
		ID:         strings.TrimSpace(record.ID),
		Kind:       asynctask.KindImage,
		RawStatus:  record.Status,
		Status:     normalizeImageStatus(record.Status),
		APIKeyID:   record.APIKeyID,
		CreatedAt:  unixTime(record.CreatedAt),
		HTTPStatus: record.HTTPStatus,
	}
	if record.CompletedAt != nil && *record.CompletedAt > 0 {
		value := unixTime(*record.CompletedAt)
		task.CompletedAt = &value
	}
	if record.ExpiresAt > 0 {
		value := unixTime(record.ExpiresAt)
		task.ExpiresAt = &value
	}
	task.ImageURLs, task.ImageCount = imageResultURLs(record.Result)
	task.ErrorMessage = imageErrorMessage(record.Error)
	return task, record.UserID, true
}

func imageResultURLs(raw json.RawMessage) ([]string, int) {
	if len(raw) == 0 {
		return nil, 0
	}
	var result struct {
		Data []struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, 0
	}
	urls := make([]string, 0, min(len(result.Data), asyncTaskMaxImageURLs))
	for _, item := range result.Data {
		if len(urls) >= asyncTaskMaxImageURLs {
			break
		}
		if safe := safeHTTPURL(item.URL); safe != "" {
			urls = append(urls, safe)
		}
	}
	return urls, len(result.Data)
}

func imageErrorMessage(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var payload struct {
		Message string `json:"message"`
		Error   *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return ""
	}
	message := payload.Message
	if message == "" && payload.Error != nil {
		message = payload.Error.Message
	}
	return truncateRunes(strings.TrimSpace(message), asyncTaskMaxErrorRunes)
}

// parsePendingVideo 解析 grok_video_pending:<user>:<api_key>:<request_id>。
func parsePendingVideo(key string, raw []byte) (int64, pendingVideoSnapshot, bool) {
	suffix := strings.TrimPrefix(key, grokVideoPendingKeyPrefix)
	if suffix == key {
		return 0, pendingVideoSnapshot{}, false
	}
	parts := strings.SplitN(suffix, ":", 3)
	if len(parts) != 3 {
		return 0, pendingVideoSnapshot{}, false
	}
	userID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || userID <= 0 {
		return 0, pendingVideoSnapshot{}, false
	}
	apiKeyID, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || apiKeyID <= 0 || strings.TrimSpace(parts[2]) == "" {
		return 0, pendingVideoSnapshot{}, false
	}
	var payload grokVideoPendingPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return 0, pendingVideoSnapshot{}, false
	}
	requestID := strings.TrimPrefix(strings.TrimSpace(parts[2]), grokVideoRequestPrefix)
	return userID, pendingVideoSnapshot{suffix: suffix, requestID: requestID, apiKeyID: apiKeyID, payload: payload}, true
}

func mergeVideoTasks(pending []pendingVideoSnapshot, billedClaims map[string]bool, billed []billedVideoRow) []asynctask.Task {
	byID := make(map[string]*asynctask.Task, len(pending)+len(billed))
	order := make([]string, 0, len(pending)+len(billed))
	for _, item := range pending {
		if _, exists := byID[item.requestID]; exists {
			continue
		}
		model := firstNonEmpty(item.payload.OriginalModel, item.payload.Model, item.payload.BillingModel)
		createdAt, _ := time.Parse(time.RFC3339Nano, strings.TrimSpace(item.payload.CreatedAt))
		task := &asynctask.Task{
			ID: item.requestID, Kind: asynctask.KindVideo, Status: asynctask.StatusPending, RawStatus: "pending",
			Model: model, APIKeyID: item.apiKeyID, CreatedAt: createdAt,
			Resolution: item.payload.VideoResolution, DurationSeconds: item.payload.VideoDurationSeconds,
		}
		if billedClaims[item.requestID] {
			task.Status = asynctask.StatusCompleted
			task.RawStatus = "billed"
		}
		byID[item.requestID] = task
		order = append(order, item.requestID)
	}
	for _, row := range billed {
		if row.requestID == "" {
			continue
		}
		cost := row.cost
		completedAt := row.createdAt
		task, exists := byID[row.requestID]
		if !exists {
			task = &asynctask.Task{ID: row.requestID, Kind: asynctask.KindVideo, APIKeyID: row.apiKeyID, Model: row.model, CreatedAt: row.createdAt}
			byID[row.requestID] = task
			order = append(order, row.requestID)
		}
		task.Status = asynctask.StatusCompleted
		task.RawStatus = "billed"
		task.CompletedAt = &completedAt
		task.Cost = &cost
		if task.Model == "" {
			task.Model = row.model
		}
		if task.Resolution == "" {
			task.Resolution = row.resolution
		}
		if task.DurationSeconds == 0 {
			task.DurationSeconds = row.durationSeconds
		}
		if task.CreatedAt.IsZero() {
			task.CreatedAt = row.createdAt
		}
	}
	tasks := make([]asynctask.Task, 0, len(order))
	for _, id := range order {
		tasks = append(tasks, *byID[id])
	}
	sort.SliceStable(tasks, func(i, j int) bool { return tasks[i].CreatedAt.After(tasks[j].CreatedAt) })
	return tasks
}

func normalizeImageStatus(status string) asynctask.Status {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "succeeded", "success":
		return asynctask.StatusCompleted
	case "failed", "error":
		return asynctask.StatusFailed
	default:
		return asynctask.StatusProcessing
	}
}

func normalizeBatchStatus(status string) asynctask.Status {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "completed", "output_deleted":
		return asynctask.StatusCompleted
	case "failed":
		return asynctask.StatusFailed
	case "cancelled", "canceled":
		return asynctask.StatusCancelled
	case "created", "uploading":
		return asynctask.StatusPending
	default:
		return asynctask.StatusProcessing
	}
}

func safeHTTPURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 4096 {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return ""
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return ""
	}
	return parsed.String()
}

func unixTime(value int64) time.Time {
	if value <= 0 {
		return time.Time{}
	}
	return time.Unix(value, 0).UTC()
}

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "…"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
