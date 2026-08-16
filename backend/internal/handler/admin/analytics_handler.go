// Package admin 提供附属内容系统的管理端 HTTP 处理器。
//
// AnalyticsHandler 实现 GET /api/aux/admin/analytics/overview:
// 返回埋点库聚合的页面访问量与功能使用度(U6 仪表盘数据源)。
//
// 关键设计(KTD7):
//   - 后端不持有 page-registry, 只返回埋点库中存在的 page id 及计数。
//   - 前端用 page-registry 派生完整清单, 与后端计数按 id 关联。
//   - 零访问页: registry 有但埋点库无 → 后端不返回此项, 前端显示 0。
//   - 历史页: 埋点库有但 registry 无 → 后端照常返回, 前端从当前视图过滤。
//
// 此端点注册在 AdminGuard 守卫子组内(需附属管理员会话, U3 守卫)。
//
// Covers U6(R5/R8/R9/R10), AE2(管理员看到页面清单与访问量), F2(管理员看到埋点分析)。
package admin

import (
	"context"

	"aux-system/internal/pkg/response"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

// analyticsProvider 抽象聚合查询能力, 使测试可注入 mock(不依赖真实 DB)。
// *service.AnalyticsService 实现该接口。
type analyticsProvider interface {
	GetOverview(ctx context.Context) (*service.OverviewResponse, error)
}

// AnalyticsHandler 处理分析仪表盘聚合查询。
// 依赖 analyticsProvider 接口, 使 handler 测试可注入 mock service。
type AnalyticsHandler struct {
	provider analyticsProvider
}

// NewAnalyticsHandler 创建 analytics handler。
// svc 为聚合服务; 传入后包装为 analyticsProvider。
func NewAnalyticsHandler(svc *service.AnalyticsService) *AnalyticsHandler {
	return &AnalyticsHandler{provider: svc}
}

// newAnalyticsHandlerWithProvider 用任意 analyticsProvider 构造 handler(测试友好)。
func newAnalyticsHandlerWithProvider(provider analyticsProvider) *AnalyticsHandler {
	return &AnalyticsHandler{provider: provider}
}

// GetOverview 处理 GET /api/aux/admin/analytics/overview。
//
// 返回标准 envelope:
//   - 成功 → 200 {code:0, data:{page_views, feature_clicks}}
//   - 聚合查询失败 → 500
//
// 守卫(AdminGuard)在路由层注册, handler 不重复校验会话。
func (h *AnalyticsHandler) GetOverview(c *gin.Context) {
	resp, err := h.provider.GetOverview(c.Request.Context())
	if err != nil {
		response.InternalError(c, "failed to fetch analytics overview")
		return
	}

	response.Success(c, resp)
}
