// Package handler 提供附属内容系统的 HTTP 处理器。
//
// ProxyHandler 实现 GET /api/aux/admin/sub2api/dashboard-stats:
// 用 Admin API Key 代理读 sub2api /admin/dashboard/stats,返回给前端。
// 最小调用面: 只暴露 dashboard stats 一个端点,不透传整个 /admin/*(KTD5)。
//
// 此端点注册在 AdminGuard 守卫子组内(需附属管理员会话)。
package handler

import (
	"context"
	"errors"
	"log"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

// dashboardStatsReader 抽象读取 sub2api dashboard stats 的能力,
// 使测试可注入 mock(不依赖真实 HTTP)。*integration.Sub2APIClient 实现该接口。
type dashboardStatsReader interface {
	GetDashboardStats(ctx context.Context) (*integration.DashboardStats, error)
}

// ProxyHandler 代理读 sub2api 受保护数据给前端。
type ProxyHandler struct {
	client dashboardStatsReader
}

// NewProxyHandler 创建 proxy handler。
// client 为已配置 Admin API Key 的 sub2api 客户端。
func NewProxyHandler(client *integration.Sub2APIClient) *ProxyHandler {
	return &ProxyHandler{client: client}
}

// GetDashboardStats 处理 GET /api/aux/admin/sub2api/dashboard-stats。
//
// 流程:
//  1. 用 Admin API Key 调 sub2api /admin/dashboard/stats(经 Sub2APIClient)
//  2. 成功 → 返回统计快照(标准 envelope)
//  3. 失败 → 降级: 返回明确错误码(不崩)
//     - Admin API Key 未配置 → 503
//     - sub2api 不可达/超时 → 503
//     - sub2api 返回非 200(含合规拦截) → 502
func (h *ProxyHandler) GetDashboardStats(c *gin.Context) {
	stats, err := h.client.GetDashboardStats(c.Request.Context())
	if err != nil {
		switch {
		case errors.Is(err, integration.ErrAdminAPIKeyMissing), errors.Is(err, integration.ErrSub2APIUnreachable):
			response.ServiceUnavailable(c, "sub2api unreachable")
		default:
			// 不向客户端透传 sub2api 内部错误详情(err.Error() 可能含状态码/内部消息/路径),
			// 仅服务端日志记录详情供运维诊断。客户端只收到通用 502(信息泄露治理 #5)。
			log.Printf("proxy GetDashboardStats failed: %v", err)
			response.Error(c, 502, "sub2api request failed")
		}
		return
	}

	response.Success(c, stats)
}
