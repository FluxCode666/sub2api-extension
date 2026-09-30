package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"aux-system/internal/integration"
)

// clientModelCacheTTL 是匿名模型列表的缓存时长。接入文档是公开页，缓存避免每次访问
// 都穿透到 Sub2API；模型上下架通常不需要秒级生效。
const clientModelCacheTTL = time.Minute

// ClientModelSource 读取 Sub2API 模型广场；生产实现为 integration.Sub2APIClient。
type ClientModelSource interface {
	ListModelPlaza(ctx context.Context, token string) ([]integration.Sub2APIPlazaGroup, error)
}

// ClientModel 是接入文档模型下拉中的一个选项。
type ClientModel struct {
	ID        string   `json:"id"`
	Platforms []string `json:"platforms"`
}

// ClientModelList 是按模型 ID 去重、排序后的模型列表。
type ClientModelList struct {
	Items []ClientModel `json:"items"`
}

// ClientModelService 为客户端接入文档提供 Sub2API 模型列表。
type ClientModelService struct {
	source ClientModelSource
	ttl    time.Duration
	now    func() time.Time

	mu        sync.Mutex
	cached    ClientModelList
	expiresAt time.Time
}

// NewClientModelService 创建模型列表服务。
func NewClientModelService(source ClientModelSource) *ClientModelService {
	return &ClientModelService{source: source, ttl: clientModelCacheTTL, now: time.Now}
}

// List 返回当前访问者可见的模型。
//
// 带 Sub2API token 时按用户可见分组读取且不缓存；token 失效时回退匿名视图，
// 以免嵌入页 token 过期后整个下拉不可用。匿名结果在进程内短暂缓存，错误不缓存。
func (s *ClientModelService) List(ctx context.Context, token string) (ClientModelList, error) {
	if token = strings.TrimSpace(token); token != "" {
		groups, err := s.source.ListModelPlaza(ctx, token)
		if err == nil {
			return aggregateClientModels(groups), nil
		}
		if !errors.Is(err, integration.ErrInvalidToken) {
			return ClientModelList{}, err
		}
	}
	return s.listAnonymous(ctx)
}

func (s *ClientModelService) listAnonymous(ctx context.Context) (ClientModelList, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.now().Before(s.expiresAt) {
		return s.cached, nil
	}
	groups, err := s.source.ListModelPlaza(ctx, "")
	if err != nil {
		return ClientModelList{}, err
	}
	s.cached = aggregateClientModels(groups)
	s.expiresAt = s.now().Add(s.ttl)
	return s.cached, nil
}

// aggregateClientModels 按模型 ID 合并各分组，平台优先取模型自身，缺失时沿用分组平台。
func aggregateClientModels(groups []integration.Sub2APIPlazaGroup) ClientModelList {
	platforms := make(map[string]map[string]struct{})
	for _, group := range groups {
		for _, model := range group.Models {
			id := strings.TrimSpace(model.Name)
			if id == "" {
				continue
			}
			if platforms[id] == nil {
				platforms[id] = make(map[string]struct{})
			}
			platform := strings.TrimSpace(model.Platform)
			if platform == "" {
				platform = strings.TrimSpace(group.Platform)
			}
			if platform != "" {
				platforms[id][platform] = struct{}{}
			}
		}
	}

	items := make([]ClientModel, 0, len(platforms))
	for id, set := range platforms {
		list := make([]string, 0, len(set))
		for platform := range set {
			list = append(list, platform)
		}
		sort.Strings(list)
		items = append(items, ClientModel{ID: id, Platforms: list})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return ClientModelList{Items: items}
}
