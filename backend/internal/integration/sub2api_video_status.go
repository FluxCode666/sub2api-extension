package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"

	"aux-system/internal/asynctask"
)

// maxVideoStatusBodyBytes 限制视频状态响应体；正常状态 JSON 只有几 KB。
const maxVideoStatusBodyBytes = 1 << 20

var (
	// ErrVideoTaskNotFound 表示网关找不到该任务：ID 已超过网关保留期，
	// 或创建任务时的 API Key、分组绑定已经变化。
	ErrVideoTaskNotFound = errors.New("sub2api gateway video task not found")
	// ErrVideoStatusRejected 表示网关拒绝用该 API Key 查询（密钥失效、余额不足、分组不支持等）。
	ErrVideoStatusRejected = errors.New("sub2api gateway rejected the video status request")
	// ErrVideoStatusRateLimited 表示触发了该 API Key 或用户的限流、并发限制。
	ErrVideoStatusRateLimited = errors.New("sub2api gateway rate limited the video status request")
	// ErrUnsupportedVideoProvider 表示调用方传入了未知的视频来源。
	ErrUnsupportedVideoProvider = errors.New("unsupported video provider")
)

// Sub2APIVideoTaskStatus 是网关视频状态响应中对用户有用的安全子集。
type Sub2APIVideoTaskStatus struct {
	// Status 是上游原始状态（小写），Grok 为 pending/done/expired/failed，
	// Seedance 为 queued/running/succeeded/failed/cancelled/expired。
	Status string
	// VideoURL 是可直接打开的 http(s) 地址（Seedance 签名地址或未被网关改写的 Grok 地址）。
	VideoURL string
	// ContentPath 是网关代理的相对下载路径，下载时必须携带创建任务的同一 API Key。
	ContentPath  string
	ErrorMessage string
}

// sub2APIVideoStatusBody 的嵌套字段使用 RawMessage 宽松解析，
// 上游字段类型变化时只丢弃该字段，不让整个状态查询失败。
type sub2APIVideoStatusBody struct {
	Status  string          `json:"status"`
	Video   json.RawMessage `json:"video"`
	Content json.RawMessage `json:"content"`
	Error   json.RawMessage `json:"error"`
	Message json.RawMessage `json:"message"`
}

// QueryVideoTaskStatus 用任务所属用户自己的 API Key 调用 Sub2API 网关查询视频任务状态：
// Grok 为 GET /v1/videos/{id}，Seedance 为 GET /v1/contents/generations/tasks/{id}。
//
// 该请求与用户在调用端轮询等价：网关会执行计费校验、计入 RPM，并在首次观察到完成时
// 按该任务计费一次（重复查询不会重复扣费）。apiKey 只放在请求头中，不写入日志或错误。
func (c *Sub2APIClient) QueryVideoTaskStatus(ctx context.Context, apiKey, provider, taskID string) (Sub2APIVideoTaskStatus, error) {
	apiKey = strings.TrimSpace(apiKey)
	taskID = strings.TrimSpace(taskID)
	if apiKey == "" {
		return Sub2APIVideoTaskStatus{}, ErrVideoStatusRejected
	}
	if taskID == "" {
		return Sub2APIVideoTaskStatus{}, ErrVideoTaskNotFound
	}
	var path string
	switch provider {
	case asynctask.ProviderGrok:
		path = "/v1/videos/" + url.PathEscape(taskID)
	case asynctask.ProviderSeedance:
		path = "/v1/contents/generations/tasks/" + url.PathEscape(taskID)
	default:
		return Sub2APIVideoTaskStatus{}, ErrUnsupportedVideoProvider
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return Sub2APIVideoTaskStatus{}, fmt.Errorf("building video status request to sub2api: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return Sub2APIVideoTaskStatus{}, fmt.Errorf("%w: %w", ErrSub2APIUnreachable, err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("[Sub2APIClient.QueryVideoTaskStatus] failed to close response body: %v", closeErr)
		}
	}()

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return Sub2APIVideoTaskStatus{}, ErrVideoTaskNotFound
	case http.StatusUnauthorized, http.StatusPaymentRequired, http.StatusForbidden:
		return Sub2APIVideoTaskStatus{}, fmt.Errorf("%w: status %d", ErrVideoStatusRejected, resp.StatusCode)
	case http.StatusTooManyRequests:
		return Sub2APIVideoTaskStatus{}, ErrVideoStatusRateLimited
	default:
		return Sub2APIVideoTaskStatus{}, fmt.Errorf("%w: sub2api video status returned status %d", ErrSub2APIUnreachable, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxVideoStatusBodyBytes+1))
	if err != nil {
		return Sub2APIVideoTaskStatus{}, fmt.Errorf("reading sub2api video status response: %w", err)
	}
	if len(body) > maxVideoStatusBodyBytes {
		return Sub2APIVideoTaskStatus{}, fmt.Errorf("%w: sub2api video status response exceeds %d bytes", ErrSub2APIUnreachable, maxVideoStatusBodyBytes)
	}
	var payload sub2APIVideoStatusBody
	if err := json.Unmarshal(body, &payload); err != nil {
		return Sub2APIVideoTaskStatus{}, fmt.Errorf("%w: decoding sub2api video status response: %w", ErrSub2APIUnreachable, err)
	}
	return parseVideoStatusBody(payload), nil
}

func parseVideoStatusBody(payload sub2APIVideoStatusBody) Sub2APIVideoTaskStatus {
	result := Sub2APIVideoTaskStatus{Status: strings.ToLower(strings.TrimSpace(payload.Status))}
	candidates := []string{jsonStringField(payload.Video, "url"), jsonStringField(payload.Content, "video_url")}
	for _, candidate := range candidates {
		if result.VideoURL == "" {
			result.VideoURL = safeHTTPURL(candidate)
		}
		if result.ContentPath == "" {
			result.ContentPath = safeVideoContentPath(candidate)
		}
	}
	result.ErrorMessage = truncateRunes(firstNonEmpty(videoErrorMessage(payload.Error), jsonString(payload.Message)), asyncTaskMaxErrorRunes)
	return result
}

// safeVideoContentPath 只接受网关改写后的 /v1/videos/<id>/content 相对路径，
// 避免把任意上游路径拼接成本站可点击链接。
func safeVideoContentPath(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 1024 || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host != "" || parsed.Scheme != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	segments := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
	if len(segments) < 3 || segments[len(segments)-1] != "content" || segments[len(segments)-3] != "videos" {
		return ""
	}
	return parsed.EscapedPath()
}

// videoErrorMessage 兼容 "error":"..." 与 "error":{"message":"...","code":"..."} 两种形态。
func videoErrorMessage(raw json.RawMessage) string {
	if text := jsonString(raw); text != "" {
		return text
	}
	return firstNonEmpty(jsonStringField(raw, "message"), jsonStringField(raw, "code"))
}

func jsonString(raw json.RawMessage) string {
	var text string
	if len(raw) == 0 || json.Unmarshal(raw, &text) != nil {
		return ""
	}
	return strings.TrimSpace(text)
}

func jsonStringField(raw json.RawMessage, field string) string {
	var object map[string]json.RawMessage
	if len(raw) == 0 || json.Unmarshal(raw, &object) != nil {
		return ""
	}
	return jsonString(object[field])
}
