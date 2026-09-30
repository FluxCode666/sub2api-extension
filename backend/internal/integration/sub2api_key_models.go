package integration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
)

// maxKeyModelsBodyBytes 限制网关模型列表响应体；正常列表远小于该值。
const maxKeyModelsBodyBytes = 2 << 20

// maxKeyModels 限制返回给导入页的模型数量，避免异常上游撑大下拉列表。
const maxKeyModels = 500

// ErrAPIKeyModelsRejected 表示 Sub2API 网关拒绝用该 API Key 读取模型列表
// （密钥失效、被禁用、额度或分组状态不允许等）。
var ErrAPIKeyModelsRejected = errors.New("sub2api gateway rejected the api key model list request")

type sub2APIKeyModelList struct {
	// OpenAI / Anthropic 风格：{"data":[{"id":"..."}]}
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
	// Gemini 原生风格：{"models":[{"name":"models/..."}]}
	Models []struct {
		Name string `json:"name"`
	} `json:"models"`
}

// ListAPIKeyModels 使用用户 API Key 读取 Sub2API 网关 GET /v1/models。
//
// 网关按密钥所属分组的平台与模型白名单返回列表，因此结果即该密钥实际可调用的模型。
// apiKey 只放在请求头中，不写入日志或错误信息。
func (c *Sub2APIClient) ListAPIKeyModels(ctx context.Context, apiKey string) ([]string, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil, ErrAPIKeyModelsRejected
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, fmt.Errorf("building api key model request to sub2api: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrSub2APIUnreachable, err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("[Sub2APIClient.ListAPIKeyModels] failed to close response body: %v", closeErr)
		}
	}()

	switch resp.StatusCode {
	case http.StatusUnauthorized, http.StatusForbidden, http.StatusPaymentRequired, http.StatusTooManyRequests:
		return nil, fmt.Errorf("%w: status %d", ErrAPIKeyModelsRejected, resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: sub2api gateway models returned status %d", ErrSub2APIUnreachable, resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxKeyModelsBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("reading sub2api gateway models response: %w", err)
	}
	if len(body) > maxKeyModelsBodyBytes {
		return nil, fmt.Errorf("%w: sub2api gateway models response exceeds %d bytes", ErrSub2APIUnreachable, maxKeyModelsBodyBytes)
	}

	var list sub2APIKeyModelList
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("%w: decoding sub2api gateway models response: %w", ErrSub2APIUnreachable, err)
	}

	ids := make([]string, 0, len(list.Data)+len(list.Models))
	seen := make(map[string]struct{}, cap(ids))
	add := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || len(ids) >= maxKeyModels {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	for _, model := range list.Data {
		add(model.ID)
	}
	for _, model := range list.Models {
		add(strings.TrimPrefix(strings.TrimSpace(model.Name), "models/"))
	}
	return ids, nil
}
