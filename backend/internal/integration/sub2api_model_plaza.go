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

// maxModelPlazaBodyBytes 限制模型广场响应体。广场含定价明细，正常远小于该值；
// 上限防止异常上游把附属后端内存拖垮。
const maxModelPlazaBodyBytes = 4 << 20

// ErrModelPlazaDisabled 表示 Sub2API 未开启模型广场（上游 404）。
var ErrModelPlazaDisabled = errors.New("sub2api model plaza is disabled")

// ErrModelPlazaAuthRequired 表示 Sub2API 模型广场要求登录，而本次请求没有用户 token。
var ErrModelPlazaAuthRequired = errors.New("sub2api model plaza requires login")

// Sub2APIPlazaModel 是模型广场中的模型条目，只保留接入文档需要的模型 ID 与平台。
type Sub2APIPlazaModel struct {
	Name     string `json:"name"`
	Platform string `json:"platform"`
}

// Sub2APIPlazaGroup 是模型广场分组的最小投影；价格、倍率等字段不在附属系统中使用。
type Sub2APIPlazaGroup struct {
	Name     string              `json:"name"`
	Platform string              `json:"platform"`
	Models   []Sub2APIPlazaModel `json:"models"`
}

type sub2APIModelPlazaData struct {
	Groups []Sub2APIPlazaGroup `json:"groups"`
}

// ListModelPlaza 读取 Sub2API GET /api/v1/model-plaza。
//
// 广场在 Sub2API 侧挂可选 JWT：token 为空时匿名读取公开分组；带 token 时上游按用户
// 返回其可见分组，token 无效会得到 ErrInvalidToken，由调用方决定是否回退匿名视图。
func (c *Sub2APIClient) ListModelPlaza(ctx context.Context, token string) ([]Sub2APIPlazaGroup, error) {
	token = strings.TrimSpace(token)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/v1/model-plaza", nil)
	if err != nil {
		return nil, fmt.Errorf("building model plaza request to sub2api: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrSub2APIUnreachable, err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("[Sub2APIClient.ListModelPlaza] failed to close response body: %v", closeErr)
		}
	}()

	switch resp.StatusCode {
	case http.StatusUnauthorized:
		if token != "" {
			return nil, ErrInvalidToken
		}
		return nil, ErrModelPlazaAuthRequired
	case http.StatusNotFound:
		return nil, ErrModelPlazaDisabled
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxModelPlazaBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("reading sub2api model plaza response: %w", err)
	}
	if len(body) > maxModelPlazaBodyBytes {
		return nil, fmt.Errorf("%w: sub2api model plaza response exceeds %d bytes", ErrSub2APIUnreachable, maxModelPlazaBodyBytes)
	}

	var envelope sub2APIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("%w: decoding sub2api model plaza response: %w", ErrSub2APIUnreachable, err)
	}
	if resp.StatusCode != http.StatusOK || envelope.Code != 0 {
		return nil, fmt.Errorf("%w: sub2api model plaza returned status %d: %s", ErrSub2APIUnreachable, resp.StatusCode, envelope.Message)
	}

	var data sub2APIModelPlazaData
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		return nil, fmt.Errorf("%w: decoding sub2api model plaza data: %w", ErrSub2APIUnreachable, err)
	}
	return data.Groups, nil
}
