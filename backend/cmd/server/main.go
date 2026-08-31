// Package main 是附属内容系统后端的入口。
//
// 镜像 sub2api backend/cmd/server/main.go 的入口结构。
// 独立 module（sub2api-extension），不导入 sub2api 的包。
package main

import (
	"context"
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"sub2api-extension/ent"
	"sub2api-extension/ent/migrate"
	"sub2api-extension/internal/config"
	"sub2api-extension/internal/handler"
	adminhandler "sub2api-extension/internal/handler/admin"
	"sub2api-extension/internal/integration"
	"sub2api-extension/internal/server"
	"sub2api-extension/internal/service"
	"sub2api-extension/internal/web"

	entsql "entgo.io/ent/dialect/sql"
	_ "github.com/lib/pq"
)

// Build-time variables (can be set by ldflags)
var (
	Version = "0.1.0-dev"
	Commit  = "unknown"
	Date    = "unknown"
)

func main() {
	showVersion := flag.Bool("version", false, "Show version information")
	migrateOnly := flag.Bool("migrate", false, "Create database tables (ent auto-migration) and exit")
	flag.Parse()

	if *showVersion {
		log.Printf("sub2api-extension %s (commit: %s, built: %s)\n", Version, Commit, Date)
		return
	}

	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	// -migrate: 建表后退出, 不启动 HTTP 服务。
	// 后端启动时不会自动迁移(避免生产环境意外改 schema),
	// 开发环境用 `go run ./cmd/server -migrate` 或 `make migrate` 一次性建表。
	if *migrateOnly {
		if err := runMigration(cfg); err != nil {
			log.Fatalf("Migration failed: %v", err)
		}
		log.Println("Migration completed successfully")
		return
	}

	log.Printf("sub2api-extension %s starting in %s mode", Version, cfg.Server.Mode)

	// 初始化 Ent 客户端（连接 PostgreSQL）
	entClient, err := initEnt(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize ent client: %v", err)
	}
	defer func() {
		if err := entClient.Close(); err != nil {
			log.Printf("Failed to close ent client: %v", err)
		}
	}()

	// 页面上架需要直接修改 sub2api 的 settings.custom_menu_items。
	// 未配置 SUB2API_DATABASE_HOST 时保持兼容：页面 CRUD 可用，但上架功能不可用。
	var sub2apiMenuPublisher service.PagePublisher
	var invoiceMenuPublisher interface {
		SetInvoiceMenu(context.Context, bool) error
	}
	var sub2apiDB *sql.DB
	if cfg.Sub2API.Database.Host != "" {
		if strings.TrimSpace(cfg.Sub2API.PublicURL) == "" {
			// The database connection is still useful for reads (for example the
			// operations dashboard), but publishing a page needs a browser-reachable
			// origin to build the custom_menu_items URL. Keep startup successful and
			// make the missing setting explicit instead of hiding it until a toggle is
			// clicked in the admin UI.
			log.Printf("[main] sub2api menu publication configured without public URL; set SUB2API_EXTENSION_PUBLIC_URL (for local Vite: http://localhost:3100, Docker: the mapped extension origin)")
		} else {
			// Do not print the URL itself: deployments may include credentials or
			// other sensitive query material even though a plain origin is expected.
			log.Printf("[main] sub2api menu publication public URL configured=true")
		}
		sub2apiDB, err = initSub2APIDatabase(cfg)
		if err != nil {
			log.Fatalf("Failed to initialize sub2api database: %v", err)
		}
		defer func() { _ = sub2apiDB.Close() }()
		menuStore := integration.NewSub2APIMenuStore(sub2apiDB, cfg.Sub2API.PublicURL)
		sub2apiMenuPublisher = menuStore
		invoiceMenuPublisher = menuStore
	} else {
		log.Printf("[main] sub2api database integration disabled: SUB2API_DATABASE_HOST is empty; publication and TTFT data access will be unavailable")
	}

	// 装配路由
	healthHandler := web.NewHealthHandler()

	// 装配管理员鉴权链: sub2api client → auth service → auth handler
	sub2apiClient := integration.NewSub2APIClient(cfg.Sub2API.BaseURL)
	authService := service.NewAuthService(sub2apiClient, cfg.JWT.Secret, cfg.JWT.ExpireHour, 0)
	authHandler := handler.NewAuthHandler(authService)

	// 装配埋点入库链(U5): ent client → telemetry store → telemetry service → handler
	telemetryStore := service.NewEntTelemetryStore(entClient)
	telemetryService := service.NewTelemetryService(telemetryStore)
	telemetryHandler := handler.NewTelemetryHandler(telemetryService)

	// 装配分析仪表盘链(U6): ent client → analytics store → analytics service → handler
	// analytics store 与 telemetry store 共享同一 ent client(写入与读取互不干扰)
	analyticsStore := service.NewEntAnalyticsStore(entClient)
	analyticsService := service.NewAnalyticsService(analyticsStore)
	analyticsHandler := adminhandler.NewAnalyticsHandler(analyticsService)

	// 旧版首页配置 API 兼容链：复用 system_meta 存储；当前官网内容以 pages.home 为准。
	homepageStore := service.NewEntHomepageConfigStore(entClient)
	homepageService := service.NewHomepageConfigService(homepageStore)
	homepageHandler := adminhandler.NewHomepageConfigHandler(homepageService)

	// 动态页面管理链: ent client → page store → page service → handlers(public + admin)
	pageStore := service.NewEntPageStore(entClient)
	pageService := service.NewPageService(pageStore, sub2apiMenuPublisher)
	pagePublicHandler := handler.NewPagePublicHandler(pageService)
	pageAdminHandler := adminhandler.NewPageHandler(pageService)

	// 图片资源链：文件落在 cfg.Assets.Dir，PostgreSQL 只保存相对路径和索引元数据。
	imageAssetStore := service.NewEntImageAssetStore(entClient)
	imageAssetService := service.NewImageAssetService(imageAssetStore, cfg.Assets.Dir)
	imageAssetHandler := adminhandler.NewImageAssetHandler(imageAssetService)

	// 发票模块只读 Sub2API 的已完成余额充值订单；申请、资料和开票文件
	// 始终保存在扩展自己的数据库/私有文件目录中。
	invoiceOrderStore := integration.NewSub2APIPaymentOrderStore(sub2apiDB)
	invoiceService := service.NewInvoiceService(entClient, invoiceOrderStore, cfg.Assets.Dir)
	if invoiceMenuPublisher != nil {
		syncCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		enabled, readErr := invoiceService.FeatureEnabled(syncCtx)
		if readErr != nil {
			log.Printf("[main] failed to read invoice feature state for menu sync: %v", readErr)
		} else if enabled {
			if syncErr := invoiceMenuPublisher.SetInvoiceMenu(syncCtx, true); syncErr != nil {
				log.Printf("[main] failed to sync enabled invoice menu: %v", syncErr)
			}
		}
		cancel()
	}
	invoiceUserHandler := handler.NewInvoiceUserHandler(invoiceService, sub2apiClient)
	invoiceAdminHandler := adminhandler.NewInvoiceAdminHandler(invoiceService, invoiceMenuPublisher)

	// 运维首字延迟看板直接读取 sub2api PostgreSQL 的 usage_logs/groups/accounts。
	// 未配置数据库时仍注册 handler，由接口返回清晰的 503，而不是让前端遇到无意义的 404。
	ttftStore := integration.NewSub2APITTFTStore(sub2apiDB)
	ttftService := service.NewTTFTService(ttftStore)
	ttftHandler := adminhandler.NewTTFTHandler(ttftService)

	r := server.SetupRouter(cfg, healthHandler, authHandler, authService, telemetryHandler, analyticsHandler, pagePublicHandler, pageAdminHandler, homepageHandler, imageAssetHandler, ttftHandler, invoiceUserHandler, invoiceAdminHandler)

	// 启动 HTTP 服务器
	addr := cfg.Server.Address()
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: time.Duration(cfg.Server.ReadHeaderTimeout) * time.Second,
		ReadTimeout:       time.Duration(cfg.Server.ReadTimeout) * time.Second,
		WriteTimeout:      time.Duration(cfg.Server.WriteTimeout) * time.Second,
		IdleTimeout:       time.Duration(cfg.Server.IdleTimeout) * time.Second,
	}

	go func() {
		log.Printf("Server listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Failed to start server: %v", err)
		}
	}()

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Server forced to shutdown: %v", err)
	}

	log.Println("Server exited")
}

func initSub2APIDatabase(cfg *config.Config) (*sql.DB, error) {
	dsn := cfg.Sub2API.Database.DSN()
	log.Printf("[initSub2APIDatabase] connecting host=%s port=%d db=%s user=%s sslmode=%s public_url_configured=%t", cfg.Sub2API.Database.Host, cfg.Sub2API.Database.Port, cfg.Sub2API.Database.DBName, cfg.Sub2API.Database.User, cfg.Sub2API.Database.SSLMode, strings.TrimSpace(cfg.Sub2API.PublicURL) != "")
	started := time.Now()
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("[initSub2APIDatabase] sql.Open failed elapsed=%s: %v", time.Since(started), err)
		return nil, fmt.Errorf("opening sub2api database/sql: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Printf("[initSub2APIDatabase] ping failed elapsed=%s: %v", time.Since(started), err)
		_ = db.Close()
		return nil, fmt.Errorf("pinging sub2api database: %w", err)
	}
	log.Printf("[initSub2APIDatabase] connected successfully elapsed=%s", time.Since(started))
	return db, nil
}

// initEnt 初始化 Ent 客户端并连接 PostgreSQL，执行一次 ping 确认可达性。
func initEnt(cfg *config.Config) (*ent.Client, error) {
	dsn := cfg.Database.DSN()
	log.Printf("[initEnt] connecting host=%s port=%d db=%s user=%s sslmode=%s", cfg.Database.Host, cfg.Database.Port, cfg.Database.DBName, cfg.Database.User, cfg.Database.SSLMode)
	started := time.Now()

	// 可达性检查: 用同一 DSN 开一个临时连接池 ping, 确认可达后丢弃, 再开 ent client。
	// ent client 的底层 driver 未导出, 无法直接复用其连接池 ping。
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("[initEnt] sql.Open failed elapsed=%s: %v", time.Since(started), err)
		return nil, fmt.Errorf("opening database/sql: %w", err)
	}
	defer func() { _ = db.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		log.Printf("[initEnt] ping failed elapsed=%s: %v", time.Since(started), err)
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	// 开启 ent client
	client, err := ent.Open("postgres", dsn)
	if err != nil {
		log.Printf("[initEnt] ent.Open failed elapsed=%s: %v", time.Since(started), err)
		return nil, fmt.Errorf("opening ent client: %w", err)
	}

	log.Printf("[initEnt] connected successfully elapsed=%s", time.Since(started))
	return client, nil
}

// runMigration 执行 ent 自动迁移(建表), 不启动 HTTP 服务。
//
// 开发环境用 `make migrate` 或 `go run ./cmd/server -migrate` 一次性建表。
// 生产环境用 Docker(镜像启动时已含 schema)或外部迁移流程, 不依赖此入口。
func runMigration(cfg *config.Config) error {
	dsn := cfg.Database.DSN()
	log.Printf("Running migration against %s:%d/%s", cfg.Database.Host, cfg.Database.Port, cfg.Database.DBName)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return fmt.Errorf("opening database/sql: %w", err)
	}
	defer func() { _ = db.Close() }()

	drv := entsql.OpenDB("postgres", db)
	if err := migrate.NewSchema(drv).Create(context.Background()); err != nil {
		return fmt.Errorf("creating schema: %w", err)
	}
	return nil
}
