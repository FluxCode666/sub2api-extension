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
	"mime"
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
// optionalHandlers 中传入 TTFTHandler 时注册 Sub2API 数据库首字延迟看板路由。
// optionalHandlers 中传入 LogService 与 LogHandler 时启用请求/操作审计和日志查询路由。
// optionalHandlers 中传入 CostHandler 时注册运营中心成本核算路由。
// pagePublicHandler 为 nil 时跳过公开页面获取端点。
// pageAdminHandler 为 nil 时跳过管理端页面 CRUD 端点。
// optionalHandlers 可传 HomepageConfigHandler、ImageAssetHandler、FileAssetHandler、TTFTHandler 与 CostHandler，保留可选形式以兼容
// 最小启动场景和既有路由测试。
func SetupRouter(cfg *config.Config, healthHandler *web.HealthHandler, authHandler *handler.AuthHandler, authService *service.AuthService, telemetryHandler *handler.TelemetryHandler, analyticsHandler *adminhandler.AnalyticsHandler, pagePublicHandler *handler.PagePublicHandler, pageAdminHandler *adminhandler.PageHandler, optionalHandlers ...any) *gin.Engine {
	if cfg.Server.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger())
	// 可选的持久化请求日志；最小启动/路由测试场景传 nil 时仍保留 Gin access log。
	var logService *service.LogService
	for _, optionalHandler := range optionalHandlers {
		if typed, ok := optionalHandler.(*service.LogService); ok {
			logService = typed
		}
	}
	r.Use(middleware.RequestLogger(logService))
	// Recovery 放在请求日志内层，使请求日志能记录 panic 恢复后的 500。
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
	registerFrontendStatic(r, cfg)

	// NoRoute: 始终注册, 保证未匹配的 API/health 路径返回标准错误 envelope(#11),
	// 不依赖是否设置了前端静态托管。
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path
		if strings.HasPrefix(path, "/api/") || path == "/health" {
			response.Error(c, http.StatusNotFound, "not found")
			return
		}
		// 已知静态资源路径找不到文件时返回 404，不能被 SPA fallback 覆盖成 index.html。
		if isFrontendStaticPath(path) {
			c.Status(http.StatusNotFound)
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

func isFrontendStaticPath(path string) bool {
	return strings.HasPrefix(path, "/assets/") ||
		strings.HasPrefix(path, "/client-docs/") ||
		strings.HasPrefix(path, "/client-icons/") ||
		path == "/favicon.svg"
}

// indexHandler 由 registerFrontendStatic 设置, 指向 dist/index.html 的 SPA fallback;
// 为 nil 时表示未配置前端静态托管。
var indexHandler gin.HandlerFunc

// registerFrontendStatic 注册前端 SPA 静态托管。
//
// 前端构建产物(/assets/*、favicon.svg)在 embed 构建中随二进制内嵌，在源码构建中
// 从 SUB2API_EXTENSION_FRONTEND_DIST 指向的 dist 目录托管。
// 客户端接入文档截图(/client-docs/*)与客户端图标(/client-icons/*)属于系统统一
// 资源目录(assets.dir)，两种构建模式都经 registerClientAssetRoutes 从资源目录提供，
// 不随前端 dist 打包，可由管理员在持久卷上直接更新。
//
// 环境变量未设置或目录不存在时静默跳过（不影响 API 与健康检查）。
func registerFrontendStatic(r *gin.Engine, cfg *config.Config) {
	// Release builds embed the frontend in aux-server so an in-process binary
	// update replaces API and UI together. Source builds keep the existing
	// directory-based mode for local frontend development.
	if web.RegisterEmbeddedFrontend(r) {
		indexHandler = web.EmbeddedFrontendIndex
	} else {
		distDir := strings.TrimSpace(os.Getenv("SUB2API_EXTENSION_FRONTEND_DIST"))
		if distDir != "" {
			if info, err := os.Stat(distDir); err == nil && info.IsDir() {
				if abs, err := filepath.Abs(distDir); err == nil {
					indexPath := filepath.Join(abs, "index.html")
					// 静态资源（JS/CSS 等构建产物）
					r.Static("/assets", filepath.Join(abs, "assets"))
					r.StaticFile("/favicon.svg", filepath.Join(abs, "favicon.svg"))
					// SPA history fallback 由外层 NoRoute 调用。
					indexHandler = func(c *gin.Context) {
						c.File(indexPath)
					}
				}
			}
		}
	}

	// 客户端接入文档截图与客户端图标统一从资源目录提供。
	registerClientAssetRoutes(r, cfg.Assets.Dir)
}

// registerClientAssetRoutes 从系统统一资源目录提供客户端接入文档截图与客户端图标。
//
// 公开路径保持不变(/client-docs/* 与 /client-icons/*)，前端无需改引用。
// 资源位于 assets.dir 对应子目录，生产持久卷可独立更新，不依赖前端重新构建。
func registerClientAssetRoutes(r *gin.Engine, assetDir string) {
	docsRoot := filepath.Join(assetDir, "client-docs")
	iconsRoot := filepath.Join(assetDir, "client-icons")

	r.GET("/client-docs/*filepath", func(c *gin.Context) {
		serveClientAsset(c, docsRoot, "client-docs", c.Param("filepath"), true)
	})
	// /client-docs（无尾斜杠）是 React 路由入口，返回 SPA index。
	r.GET("/client-docs", func(c *gin.Context) {
		serveClientDocsIndex(c)
	})
	r.GET("/client-icons/*filepath", func(c *gin.Context) {
		serveClientAsset(c, iconsRoot, "client-icons", c.Param("filepath"), false)
	})
}

// serveClientDocsIndex 返回 SPA 入口；静态托管未配置时返回标准 404 envelope。
func serveClientDocsIndex(c *gin.Context) {
	if indexHandler != nil {
		indexHandler(c)
		return
	}
	response.Error(c, http.StatusNotFound, "not found")
}

// serveClientAsset 从资源子目录安全地提供单个文件，绝不输出目录列表。
//
// spaEntry 为 true 时(客户端接入文档)，根路径 /client-docs/ 返回 SPA index；
// 为 false 时(客户端图标)，根路径直接 404。
// 资源目录缺失文件时回退到内嵌种子(embed 构建)，保证生产持久卷未灌入种子时
// 图标与截图仍可渲染；持久卷上的文件始终优先，管理员可直接覆盖。
func serveClientAsset(c *gin.Context, root, seedPrefix, rel string, spaEntry bool) {
	// 根路径(/client-docs/、/client-icons/)不列出目录内容。
	if rel == "" || rel == "/" {
		if spaEntry {
			serveClientDocsIndex(c)
			return
		}
		c.Status(http.StatusNotFound)
		return
	}
	rel = strings.TrimPrefix(rel, "/")
	cleaned := filepath.Clean(rel)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		c.Status(http.StatusNotFound)
		return
	}
	root = filepath.Clean(root)
	abs := filepath.Join(root, cleaned)
	// 校验拼接结果仍位于 root 内，防路径穿越。
	if relPath, err := filepath.Rel(root, abs); err != nil ||
		relPath == ".." || strings.HasPrefix(relPath, ".."+string(filepath.Separator)) {
		c.Status(http.StatusNotFound)
		return
	}
	if info, err := os.Stat(abs); err == nil && !info.IsDir() {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		c.File(abs)
		return
	}

	// 资源目录无此文件：回退到内嵌种子(非 embed 构建无内容，直接 404)。
	if data, ok := web.OpenSeededClientAsset(filepath.ToSlash(filepath.Join(seedPrefix, cleaned))); ok {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		c.Data(http.StatusOK, contentTypeByName(cleaned), data)
		return
	}
	c.Status(http.StatusNotFound)
}

// contentTypeByName 按文件扩展名推断 Content-Type，无法识别时退回 octet-stream。
func contentTypeByName(name string) string {
	if ct := mime.TypeByExtension(filepath.Ext(name)); ct != "" {
		return ct
	}
	return "application/octet-stream"
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
	var fileAssetHandler *adminhandler.FileAssetHandler
	var ttftHandler *adminhandler.TTFTHandler
	var costHandler *adminhandler.CostHandler
	var logHandler *adminhandler.LogHandler
	var systemHandler *adminhandler.SystemHandler
	var logService *service.LogService
	var invoiceUserHandler *handler.InvoiceUserHandler
	var invoiceAdminHandler *adminhandler.InvoiceAdminHandler
	var notificationAdminHandler *adminhandler.NotificationAdminHandler
	for _, optionalHandler := range optionalHandlers {
		switch typed := optionalHandler.(type) {
		case *adminhandler.SystemHandler:
			systemHandler = typed
		case *adminhandler.HomepageConfigHandler:
			homepageHandler = typed
		case *adminhandler.ImageAssetHandler:
			imageAssetHandler = typed
		case *adminhandler.FileAssetHandler:
			fileAssetHandler = typed
		case *adminhandler.TTFTHandler:
			ttftHandler = typed
		case *adminhandler.CostHandler:
			costHandler = typed
		case *adminhandler.LogHandler:
			logHandler = typed
		case *service.LogService:
			logService = typed
		case *handler.InvoiceUserHandler:
			invoiceUserHandler = typed
		case *adminhandler.InvoiceAdminHandler:
			invoiceAdminHandler = typed
		case *adminhandler.NotificationAdminHandler:
			notificationAdminHandler = typed
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
		if invoiceUserHandler != nil {
			aux.GET("/invoices/config", invoiceUserHandler.Config)
			invoices := aux.Group("/invoices")
			invoices.Use(invoiceUserHandler.Guard())
			invoices.GET("/profile", invoiceUserHandler.GetProfile)
			invoices.PUT("/profile", invoiceUserHandler.SaveProfile)
			invoices.GET("/eligible-orders", invoiceUserHandler.ListEligibleOrders)
			invoices.GET("/requests", invoiceUserHandler.ListRequests)
			invoices.POST("/requests", invoiceUserHandler.Create)
			invoices.GET("/requests/:id/document", invoiceUserHandler.Download)
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
		if systemHandler != nil {
			guarded.GET("/system/version", systemHandler.Version)
			guarded.GET("/system/release", systemHandler.Latest)
			guarded.GET("/system/update", systemHandler.Status)
		}
		if logService != nil {
			guarded.Use(middleware.OperationLogger(logService))
		}
		{
			if systemHandler != nil {
				guarded.POST("/system/update", systemHandler.Start)
			}
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
			if fileAssetHandler != nil {
				guarded.GET("/files", fileAssetHandler.List)
				guarded.PATCH("/files/:source/:id", fileAssetHandler.UpdateNote)
			}

			// 运维首字延迟看板：handler 内部通过 database/sql 直读
			// Sub2API PostgreSQL，不调用 Sub2API HTTP API。
			if ttftHandler != nil {
				guarded.GET("/ops/ttft", ttftHandler.GetTTFT)
			}
			if costHandler != nil {
				guarded.GET("/ops/consumption", costHandler.GetConsumption)
				guarded.GET("/ops/cost-config", costHandler.GetConfig)
				guarded.PUT("/ops/cost-config", costHandler.UpdateConfig)
				guarded.POST("/ops/cost-config/sync", costHandler.SyncAccounts)
				guarded.PUT("/ops/cost-config/billing-groups", costHandler.UpdateBillingGroup)
				guarded.PUT("/ops/cost-config/accounts/:id", costHandler.UpdateAccountConfig)
			}
			if logHandler != nil {
				guarded.GET("/logs/system", logHandler.ListSystem)
				guarded.GET("/logs/operations", logHandler.ListOperation)
				// Singular/explicit aliases keep bookmarked integrations compatible.
				guarded.GET("/logs/operation", logHandler.ListOperation)
				guarded.GET("/system-logs", logHandler.ListSystem)
				guarded.GET("/operation-logs", logHandler.ListOperation)
			}
			if invoiceAdminHandler != nil {
				guarded.GET("/invoices/config", invoiceAdminHandler.GetFeature)
				guarded.PUT("/invoices/config", invoiceAdminHandler.SetFeature)
				guarded.GET("/invoices", invoiceAdminHandler.List)
				guarded.GET("/invoices/users", invoiceAdminHandler.ListUsers)
				guarded.POST("/invoices/manual", invoiceAdminHandler.CreateManual)
				guarded.PUT("/invoices/:id/status", invoiceAdminHandler.UpdateStatus)
				guarded.POST("/invoices/:id/document", invoiceAdminHandler.UploadDocument)
				guarded.GET("/invoices/:id/document", invoiceAdminHandler.Download)
			}
			if notificationAdminHandler != nil {
				guarded.GET("/notifications/channels", notificationAdminHandler.ListChannels)
				guarded.POST("/notifications/channels", notificationAdminHandler.CreateChannel)
				guarded.POST("/notifications/channels/:id/test", notificationAdminHandler.TestChannel)
				guarded.PUT("/notifications/channels/:id", notificationAdminHandler.UpdateChannel)
				guarded.DELETE("/notifications/channels/:id", notificationAdminHandler.DeleteChannel)
				// Explicit resource aliases keep API clients from having to know the
				// UI grouping name; both paths share the same guarded handlers.
				guarded.GET("/notification-channels", notificationAdminHandler.ListChannels)
				guarded.POST("/notification-channels", notificationAdminHandler.CreateChannel)
				guarded.POST("/notification-channels/:id/test", notificationAdminHandler.TestChannel)
				guarded.PUT("/notification-channels/:id", notificationAdminHandler.UpdateChannel)
				guarded.DELETE("/notification-channels/:id", notificationAdminHandler.DeleteChannel)
				guarded.GET("/notifications/events/:event", notificationAdminHandler.GetEventConfig)
				guarded.PUT("/notifications/events/:event", notificationAdminHandler.SetEventConfig)
				guarded.GET("/notifications/deliveries", notificationAdminHandler.ListDeliveries)
				guarded.GET("/notifications/records", notificationAdminHandler.ListDeliveries)
				guarded.GET("/notifications/logs", notificationAdminHandler.ListDeliveries)
			}

			// 管理端 API 请求示例: 无数据库或 sub2api 依赖。
			exampleHandler := adminhandler.NewExampleHandler()
			guarded.GET("/examples/status", exampleHandler.GetStatus)
		}
	}
}
