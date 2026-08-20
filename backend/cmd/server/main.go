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
	pageService := service.NewPageService(pageStore)
	pagePublicHandler := handler.NewPagePublicHandler(pageService)
	pageAdminHandler := adminhandler.NewPageHandler(pageService)

	// 图片资源链：文件落在 cfg.Assets.Dir，PostgreSQL 只保存相对路径和索引元数据。
	imageAssetStore := service.NewEntImageAssetStore(entClient)
	imageAssetService := service.NewImageAssetService(imageAssetStore, cfg.Assets.Dir)
	imageAssetHandler := adminhandler.NewImageAssetHandler(imageAssetService)

	r := server.SetupRouter(cfg, healthHandler, authHandler, authService, telemetryHandler, analyticsHandler, pagePublicHandler, pageAdminHandler, homepageHandler, imageAssetHandler)

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

// initEnt 初始化 Ent 客户端并连接 PostgreSQL，执行一次 ping 确认可达性。
func initEnt(cfg *config.Config) (*ent.Client, error) {
	dsn := cfg.Database.DSN()
	log.Printf("Connecting to PostgreSQL at %s:%d/%s", cfg.Database.Host, cfg.Database.Port, cfg.Database.DBName)

	// 可达性检查: 用同一 DSN 开一个临时连接池 ping, 确认可达后丢弃, 再开 ent client。
	// ent client 的底层 driver 未导出, 无法直接复用其连接池 ping。
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database/sql: %w", err)
	}
	defer func() { _ = db.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	// 开启 ent client
	client, err := ent.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening ent client: %w", err)
	}

	log.Println("Ent client connected to PostgreSQL successfully")
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
