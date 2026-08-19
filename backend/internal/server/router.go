// Package server 提供附属内容系统的 Gin 路由装配。
//
// 镜像 sub2api backend/internal/server/router.go 的 SetupRouter 风格。
// 路由分组:
//   - /health：健康检查（公开）
//   - /api/aux/*：公开端点 + 埋点上报（U5 实现）
//   - /api/aux/admin/session：会话换取端点（守卫外，用 sub2api token 换附属会话）
//   - /api/aux/admin/*（其余）：受 AdminGuard 保护的管理员端点
package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"sub2api-extension/internal/config"
	"sub2api-extension/internal/handler"
	adminhandler "sub2api-extension/internal/handler/admin"
	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/server/middleware"
	"sub2api-extension/internal/service"
	"sub2api-extension/internal/web"

	"github.com/gin-gonic/gin"
)

// SetupRouter 配置路由器中间件和路由，镜像 sub2api 的 SetupRouter 风格。
//
// authHandler 为 nil 时跳过管理员会话路由(用于健康检查等最小启动场景)。
// telemetryHandler 为 nil 时跳过埋点上报路由(U5 端点)。
// analyticsHandler 为 nil 时跳过分析仪表盘路由(U6 端点)。
// pagePublicHandler 为 nil 时跳过公开页面获取端点。
// pageAdminHandler 为 nil 时跳过管理端页面 CRUD 端点。
// optionalHandlers 可传 HomepageConfigHandler 与 ImageAssetHandler，保留可选形式以兼容
// 最小启动场景和既有路由测试。
func SetupRouter(cfg *config.Config, healthHandler *web.HealthHandler, authHandler *handler.AuthHandler, authService *service.AuthService, telemetryHandler *handler.TelemetryHandler, analyticsHandler *adminhandler.AnalyticsHandler, pagePublicHandler *handler.PagePublicHandler, pageAdminHandler *adminhandler.PageHandler, optionalHandlers ...any) *gin.Engine {
	if cfg.Server.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger())
	r.Use(gin.Recovery())

	// 重置前端 fallback: 每次 SetupRouter 从干净状态开始, 避免包级变量跨测试残留。
	indexHandler = nil

	// 通用路由（健康检查）
	registerCommonRoutes(r, healthHandler)

	// 附属系统 API 路由分组
	registerAuxRoutes(r, authHandler, authService, telemetryHandler, analyticsHandler, pagePublicHandler, pageAdminHandler, optionalHandlers...)

	// 静态前端托管（U7）：当 SUB2API_EXTENSION_FRONTEND_DIST 环境变量指向已构建的前端 dist 目录时，
	// 由后端托管 SPA。前端 api-client 使用相对路径 /api/aux，同源托管避免 CORS。
	// 不设置环境变量时跳过（开发模式前后端分离运行）。
	// 不影响 /health 与 /api/aux/* 路由。
	registerFrontendStatic(r)

	// NoRoute: 始终注册, 保证未匹配的 API/health 路径返回标准错误 envelope(#11),
	// 不依赖是否设置了前端静态托管。
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/") || path == "/health" {
			response.Error(c, http.StatusNotFound, "not found")
			return
		}
		// 非 API 路径: 若有前端 index.html 则 fallback(SPA history), 否则标准 404。
		if indexHandler != nil {
			indexHandler(c)
			return
		}
		response.Error(c, http.StatusNotFound, "not found")
	})

	return r
}

// indexHandler 由 registerFrontendStatic 设置, 指向 dist/index.html 的 SPA fallback;
// 为 nil 时表示未配置前端静态托管。
var indexHandler gin.HandlerFunc

// registerFrontendStatic 注册前端 SPA 静态托管。
//
// 当 SUB2API_EXTENSION_FRONTEND_DIST 指向存在的目录时：
//   - /assets/* 直接映射到 dist/assets/*
//   - 其余非 /health、非 /api/ 路径返回 index.html（SPA history fallback, 经 NoRoute）
//
// 环境变量未设置或目录不存在时静默跳过（不影响 API 与健康检查）。
func registerFrontendStatic(r *gin.Engine) {
	distDir := strings.TrimSpace(os.Getenv("SUB2API_EXTENSION_FRONTEND_DIST"))
	if distDir == "" {
		return
	}
	if info, err := os.Stat(distDir); err != nil || !info.IsDir() {
		return
	}
	abs, err := filepath.Abs(distDir)
	if err != nil {
		return
	}
	indexPath := filepath.Join(abs, "index.html")

	// 静态资源（JS/CSS/图片等）
	r.Static("/assets", filepath.Join(abs, "assets"))

	// SPA history fallback 由外层 NoRoute 调用: 设置 indexHandler 指向 index.html。
	indexHandler = func(c *gin.Context) {
		c.File(indexPath)
	}
}

// registerCommonRoutes 注册通用路由（健康检查等）。
func registerCommonRoutes(r *gin.Engine, healthHandler *web.HealthHandler) {
	// 健康检查
	r.GET("/health", healthHandler.Health)
}

// SetPageHandlers 已废弃 —— page handlers 现在直接作为 SetupRouter 参数传入。
// 保留空函数避免外部调用方编译错误, 但不再有任何效果。
func SetPageHandlers(public *handler.PagePublicHandler, admin *adminhandler.PageHandler) {
	// no-op: handlers now passed via SetupRouter parameters
}

// registerAuxRoutes 注册附属系统 API 路由分组。
//
// /api/aux/*                  —— 公开端点 + 埋点上报（U5 实现具体路由）
// /api/aux/admin/session      —— 会话换取(守卫外,用 sub2api token 换附属会话)
// /api/aux/admin/*（其余）     —— 受 AdminGuard 保护(U4+ 实现具体路由)
func registerAuxRoutes(r *gin.Engine, authHandler *handler.AuthHandler, authService *service.AuthService, telemetryHandler *handler.TelemetryHandler, analyticsHandler *adminhandler.AnalyticsHandler, pagePublicHandler *handler.PagePublicHandler, pageAdminHandler *adminhandler.PageHandler, optionalHandlers ...any) {
	var homepageHandler *adminhandler.HomepageConfigHandler
	var imageAssetHandler *adminhandler.ImageAssetHandler
	for _, optionalHandler := range optionalHandlers {
		switch typed := optionalHandler.(type) {
		case *adminhandler.HomepageConfigHandler:
			homepageHandler = typed
		case *adminhandler.ImageAssetHandler:
			imageAssetHandler = typed
		}
	}
	if homepageHandler == nil {
		// 测试或最小启动场景没有数据库时，公开首页仍返回默认文案。
		homepageHandler = adminhandler.NewHomepageConfigHandler(nil)
	}
	// 公开 + 埋点上报分组（U5 实现具体路由）
	aux := r.Group("/api/aux")
	{
		aux.GET("", func(c *gin.Context) {
			response.Success(c, gin.H{"group": "aux", "status": "ok"})
		})
		aux.GET("/homepage/config", homepageHandler.GetPublicConfig)
		if imageAssetHandler != nil {
			aux.GET("/assets/:id", imageAssetHandler.ServePublic)
		}

		// 动态页面公开获取(bootstrap 注册表合并 + 公开页内容渲染)
		if pagePublicHandler != nil {
			aux.GET("/pages", pagePublicHandler.List)
			aux.GET("/pages/:slug", pagePublicHandler.GetBySlug)
		}

		// U5: 埋点上报端点(匿名可写,不经 AdminGuard)。
		// 公开访客也要能埋点(R8/R11),端点在公开分组 /api/aux/telemetry/*。
		// 加 TelemetryGuard: body 大小限制 + per-IP 限流, 防止无界写入滥用(#7)。
		if telemetryHandler != nil {
			telemetry := aux.Group("/telemetry")
			telemetry.Use(middleware.TelemetryGuard())
			telemetry.POST("/page-view", telemetryHandler.RecordPageView)
			telemetry.POST("/feature-click", telemetryHandler.RecordFeatureClick)
		}
	}

	// 管理员分组
	admin := r.Group("/api/aux/admin")

	// session 与 login 端点: 在守卫之外。
	// session 接收 sub2api JWT(iframe 流程), 转发验证后签发附属会话。
	// login 接收账号密码(独立登录入口), 代理 sub2api 登录后签发附属会话。
	// 两者调用时尚无附属会话, 不能被 AdminGuard 保护。
	if authHandler != nil {
		admin.POST("/session", authHandler.CreateSession)
		admin.POST("/login", authHandler.Login)
	}

	// 受守卫保护的 admin 端点: AdminGuard 校验附属系统会话 JWT。
	// U4+ 的具体路由(analytics 等)在此分组内注册。
	if authService != nil {
		guarded := admin.Group("")
		guarded.Use(middleware.AdminGuard(authService))
		{
			// 占位: 确认守卫生效。U4+ 替换为具体路由。
			guarded.GET("", func(c *gin.Context) {
				response.Success(c, gin.H{"group": "aux-admin", "status": "guarded", "ok": true})
			})

			// U6: 分析仪表盘聚合查询。
			// analyticsHandler 为 nil 时跳过(最小启动场景)。
			// 后端不耦合 page-registry, 只返回埋点库聚合计数;
			// 前端用 registry 关联(零访问页显示 0, 已删除页面过滤)。KTD7。
			if analyticsHandler != nil {
				guarded.GET("/analytics/overview", analyticsHandler.GetOverview)
			}
			guarded.GET("/homepage/config", homepageHandler.GetConfig)
			guarded.PUT("/homepage/config", homepageHandler.UpdateConfig)

			// 动态页面管理 CRUD(受 AdminGuard 保护)
			if pageAdminHandler != nil {
				guarded.GET("/pages", pageAdminHandler.List)
				guarded.POST("/pages", pageAdminHandler.Create)
				guarded.GET("/pages/slug/:slug", pageAdminHandler.GetBySlug)
				guarded.GET("/pages/:id", pageAdminHandler.GetByID)
				guarded.PUT("/pages/:id", pageAdminHandler.Update)
				guarded.DELETE("/pages/:id", pageAdminHandler.Delete)
			}

			if imageAssetHandler != nil {
				guarded.GET("/assets", imageAssetHandler.List)
				guarded.POST("/assets", imageAssetHandler.Upload)
			}

			// 管理端 API 请求示例: 无数据库或 sub2api 依赖。
			exampleHandler := adminhandler.NewExampleHandler()
			guarded.GET("/examples/status", exampleHandler.GetStatus)
		}
	}
}
