package integration

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"sub2api-extension/internal/ttft"
)

type ttftBandDefinition struct {
	Order int
	Label string
	Min   int
	Max   *int
}

var ttftBands = []ttftBandDefinition{
	{Order: 0, Label: "0–250 ms", Min: 0, Max: intPtr(250)},
	{Order: 1, Label: "250–500 ms", Min: 250, Max: intPtr(500)},
	{Order: 2, Label: "500 ms–1 s", Min: 500, Max: intPtr(1000)},
	{Order: 3, Label: "1–2 s", Min: 1000, Max: intPtr(2000)},
	{Order: 4, Label: "2–4 s", Min: 2000, Max: intPtr(4000)},
	{Order: 5, Label: "4 s+", Min: 4000},
}

// Sub2APITTFTStore reads the Sub2API usage_logs, groups and accounts tables
// directly. It intentionally does not use the Sub2API HTTP API: this view is
// an administrative database read owned by the extension backend.
type Sub2APITTFTStore struct {
	db *sql.DB
}

func NewSub2APITTFTStore(db *sql.DB) *Sub2APITTFTStore {
	return &Sub2APITTFTStore{db: db}
}

func (s *Sub2APITTFTStore) QueryTTFT(ctx context.Context, query ttft.Query) (*ttft.Response, error) {
	if s == nil || s.db == nil {
		return nil, ttft.ErrSub2APIDatabaseUnavailable
	}
	if !query.StartTime.Before(query.EndTime) {
		return nil, fmt.Errorf("ttft query start time must be before end time")
	}
	query.Granularity = query.Granularity.Normalize()

	groups, err := s.listGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("list sub2api groups: %w", err)
	}
	accounts, err := s.listAccounts(ctx)
	if err != nil {
		return nil, fmt.Errorf("list sub2api accounts: %w", err)
	}

	response := &ttft.Response{
		StartTime:   query.StartTime,
		EndTime:     query.EndTime,
		Granularity: query.Granularity,
		Groups:      groups,
		Accounts:    accounts,
		Buckets:     makeTTFTBuckets(query.StartTime, query.EndTime, query.Granularity),
	}
	if err := s.querySummary(ctx, query, response); err != nil {
		return nil, fmt.Errorf("query ttft summary: %w", err)
	}
	if err := s.queryBuckets(ctx, query, response); err != nil {
		return nil, fmt.Errorf("query ttft buckets: %w", err)
	}
	if err := s.queryBucketStats(ctx, query, response); err != nil {
		return nil, fmt.Errorf("query ttft bucket stats: %w", err)
	}
	return response, nil
}

func (s *Sub2APITTFTStore) listGroups(ctx context.Context) ([]*ttft.FilterOption, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(platform, ''), COALESCE(status, '')
		FROM groups
		WHERE deleted_at IS NULL
		ORDER BY sort_order ASC, name ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("[Sub2APITTFTStore.listGroups] failed to close rows: %v", closeErr)
		}
	}()

	result := make([]*ttft.FilterOption, 0)
	for rows.Next() {
		item := &ttft.FilterOption{}
		if err := rows.Scan(&item.ID, &item.Name, &item.Platform, &item.Status); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Sub2APITTFTStore) listAccounts(ctx context.Context) ([]*ttft.FilterOption, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, name, COALESCE(platform, ''), COALESCE(status, '')
		FROM accounts
		WHERE deleted_at IS NULL
		ORDER BY name ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("[Sub2APITTFTStore.listAccounts] failed to close rows: %v", closeErr)
		}
	}()

	result := make([]*ttft.FilterOption, 0)
	for rows.Next() {
		item := &ttft.FilterOption{}
		if err := rows.Scan(&item.ID, &item.Name, &item.Platform, &item.Status); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Sub2APITTFTStore) querySummary(ctx context.Context, query ttft.Query, response *ttft.Response) error {
	where, args := buildTTFTWhere(query)
	statement := `
		SELECT
			COUNT(*)::bigint,
			percentile_cont(0.50) WITHIN GROUP (ORDER BY first_token_ms),
			percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms),
			percentile_cont(0.99) WITHIN GROUP (ORDER BY first_token_ms),
			AVG(first_token_ms),
			MAX(first_token_ms)
		FROM usage_logs
		` + where
	var count int64
	var p50, p95, p99, avg, max sql.NullFloat64
	if err := s.db.QueryRowContext(ctx, statement, args...).Scan(&count, &p50, &p95, &p99, &avg, &max); err != nil {
		return err
	}
	response.TotalSamples = count
	response.P50Ms = nullableRoundedInt(p50)
	response.P95Ms = nullableRoundedInt(p95)
	response.P99Ms = nullableRoundedInt(p99)
	response.AvgMs = nullableRoundedInt(avg)
	response.MaxMs = nullableRoundedInt(max)
	return nil
}

func (s *Sub2APITTFTStore) queryBuckets(ctx context.Context, query ttft.Query, response *ttft.Response) error {
	where, args := buildTTFTWhere(query)
	bucketIndex := ttftBucketIndexExpression(query.Granularity, len(response.Buckets))
	statement := `
		WITH filtered AS (
			SELECT
				first_token_ms,
				` + bucketIndex + ` AS bucket_index
			FROM usage_logs
			` + where + `
		), labeled AS (
			SELECT
				bucket_index,
				CASE
					WHEN first_token_ms < 250 THEN 0
					WHEN first_token_ms < 500 THEN 1
					WHEN first_token_ms < 1000 THEN 2
					WHEN first_token_ms < 2000 THEN 3
					WHEN first_token_ms < 4000 THEN 4
					ELSE 5
				END AS band_order,
				CASE
					WHEN first_token_ms < 250 THEN '0–250 ms'
					WHEN first_token_ms < 500 THEN '250–500 ms'
					WHEN first_token_ms < 1000 THEN '500 ms–1 s'
					WHEN first_token_ms < 2000 THEN '1–2 s'
					WHEN first_token_ms < 4000 THEN '2–4 s'
					ELSE '4 s+'
				END AS band,
				CASE
					WHEN first_token_ms < 250 THEN 0
					WHEN first_token_ms < 500 THEN 250
					WHEN first_token_ms < 1000 THEN 500
					WHEN first_token_ms < 2000 THEN 1000
					WHEN first_token_ms < 4000 THEN 2000
					ELSE 4000
				END AS min_ms,
				CASE
					WHEN first_token_ms < 250 THEN 250
					WHEN first_token_ms < 500 THEN 500
					WHEN first_token_ms < 1000 THEN 1000
					WHEN first_token_ms < 2000 THEN 2000
					WHEN first_token_ms < 4000 THEN 4000
					ELSE NULL
				END AS max_ms
			FROM filtered
		)
		SELECT bucket_index, band_order, band, min_ms, max_ms, COUNT(*)::bigint
		FROM labeled
		GROUP BY bucket_index, band_order, band, min_ms, max_ms
		ORDER BY bucket_index ASC, band_order ASC`

	rows, err := s.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("[Sub2APITTFTStore.queryBuckets] failed to close rows: %v", closeErr)
		}
	}()
	for rows.Next() {
		var bucketIndex, bandOrder, minMs int
		var band string
		var maxMs sql.NullInt64
		var count int64
		if err := rows.Scan(&bucketIndex, &bandOrder, &band, &minMs, &maxMs, &count); err != nil {
			return err
		}
		if bucketIndex < 0 || bucketIndex >= len(response.Buckets) {
			continue
		}
		segment := &ttft.Segment{
			Band:      band,
			MinMs:     minMs,
			BandOrder: bandOrder,
			Count:     count,
		}
		if maxMs.Valid {
			v := int(maxMs.Int64)
			segment.MaxMs = &v
		}
		response.Buckets[bucketIndex].Segments = append(response.Buckets[bucketIndex].Segments, segment)
		response.Buckets[bucketIndex].SampleCount += count
	}
	return rows.Err()
}

func (s *Sub2APITTFTStore) queryBucketStats(ctx context.Context, query ttft.Query, response *ttft.Response) error {
	where, args := buildTTFTWhere(query)
	bucketIndex := ttftBucketIndexExpression(query.Granularity, len(response.Buckets))
	statement := `
		WITH filtered AS (
			SELECT
				first_token_ms,
				` + bucketIndex + ` AS bucket_index
			FROM usage_logs
			` + where + `
		)
		SELECT
			bucket_index,
			percentile_cont(0.50) WITHIN GROUP (ORDER BY first_token_ms),
			percentile_cont(0.95) WITHIN GROUP (ORDER BY first_token_ms),
			percentile_cont(0.99) WITHIN GROUP (ORDER BY first_token_ms),
			AVG(first_token_ms),
			MAX(first_token_ms)
		FROM filtered
		GROUP BY bucket_index
		ORDER BY bucket_index ASC`

	rows, err := s.db.QueryContext(ctx, statement, args...)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := rows.Close(); closeErr != nil {
			log.Printf("[Sub2APITTFTStore.queryBucketStats] failed to close rows: %v", closeErr)
		}
	}()
	for rows.Next() {
		var bucketIndex int
		var p50, p95, p99, avg, max sql.NullFloat64
		if err := rows.Scan(&bucketIndex, &p50, &p95, &p99, &avg, &max); err != nil {
			return err
		}
		if bucketIndex < 0 || bucketIndex >= len(response.Buckets) {
			continue
		}
		bucket := response.Buckets[bucketIndex]
		bucket.P50Ms = nullableRoundedInt(p50)
		bucket.P95Ms = nullableRoundedInt(p95)
		bucket.P99Ms = nullableRoundedInt(p99)
		bucket.AvgMs = nullableRoundedInt(avg)
		bucket.MaxMs = nullableRoundedInt(max)
	}
	return rows.Err()
}

func buildTTFTWhere(query ttft.Query) (string, []any) {
	clauses := []string{
		"WHERE created_at >= $1",
		"created_at < $2",
		"first_token_ms IS NOT NULL",
		"first_token_ms >= 0",
	}
	args := []any{query.StartTime, query.EndTime}
	if query.GroupID != nil && *query.GroupID > 0 {
		args = append(args, *query.GroupID)
		clauses = append(clauses, fmt.Sprintf("group_id = $%d", len(args)))
	}
	if query.AccountID != nil && *query.AccountID > 0 {
		args = append(args, *query.AccountID)
		clauses = append(clauses, fmt.Sprintf("account_id = $%d", len(args)))
	}
	return strings.Join(clauses, " AND "), args
}

func makeTTFTBuckets(start, end time.Time, granularity ttft.Granularity) []*ttft.Bucket {
	step := ttftBucketStep(granularity)
	duration := end.Sub(start)
	bucketCount := int((duration + step - 1) / step)
	if bucketCount < 1 {
		bucketCount = 1
	}
	buckets := make([]*ttft.Bucket, bucketCount)
	for i := range buckets {
		bucketStart := start.Add(step * time.Duration(i))
		bucketEnd := start.Add(step * time.Duration(i+1))
		if i == bucketCount-1 {
			bucketEnd = end
		}
		buckets[i] = &ttft.Bucket{
			Index:     i,
			StartTime: bucketStart,
			EndTime:   bucketEnd,
			Segments:  make([]*ttft.Segment, 0, len(ttftBands)),
		}
	}
	return buckets
}

func ttftBucketStep(granularity ttft.Granularity) time.Duration {
	switch granularity.Normalize() {
	case ttft.GranularityMinute:
		return time.Minute
	case ttft.GranularityDay:
		return 24 * time.Hour
	default:
		return time.Hour
	}
}

func ttftBucketIndexExpression(granularity ttft.Granularity, bucketCount int) string {
	if bucketCount < 1 {
		bucketCount = 1
	}
	stepSeconds := int64(ttftBucketStep(granularity) / time.Second)
	return fmt.Sprintf("LEAST(%d, GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (created_at - $1)) / %d)::int))", bucketCount-1, stepSeconds)
}

func nullableRoundedInt(value sql.NullFloat64) *int {
	if !value.Valid {
		return nil
	}
	result := int(value.Float64 + 0.5)
	return &result
}

func intPtr(value int) *int {
	return &value
}
