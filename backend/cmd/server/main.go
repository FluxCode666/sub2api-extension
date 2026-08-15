// Package main 是附属内容系统后端的入口。
//
// 镜像 sub2api backend/cmd/server/main.go 的入口结构。
// 独立 module（aux-system），不导入 sub2api 的包。
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

	"aux-system/ent"
	"aux-system/internal/config"
	"aux-system/internal/handler"
	adminhandler "aux-system/internal/handler/admin"
	"aux-system/internal/integration"
	"aux-system/internal/server"
	"aux-system/internal/service"
	"aux-system/internal/web"

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
	flag.Parse()

	if *showVersion {
		log.Printf("aux-system %s (commit: %s, built: %s)\n", Version, Commit, Date)
		return
	}

	// 加载配置
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	log.Printf("aux-system %s starting in %s mode", Version, cfg.Server.Mode)

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
	sub2apiClient := integration.NewSub2APIClient(cfg.Sub2API.BaseURL, cfg.Sub2API.AdminAPIKey)
	authService := service.NewAuthService(sub2apiClient, cfg.JWT.Secret, cfg.JWT.ExpireHour, 0)
	authHandler := handler.NewAuthHandler(authService)

	// 装配 sub2api 数据代理 handler(U4): 用 Admin API Key 读 sub2api 数据
	proxyHandler := handler.NewProxyHandler(sub2apiClient)

	// 装配埋点入库链(U5): ent client → telemetry store → telemetry service → handler
	telemetryStore := service.NewEntTelemetryStore(entClient)
	telemetryService := service.NewTelemetryService(telemetryStore)
	telemetryHandler := handler.NewTelemetryHandler(telemetryService)

	// 装配分析仪表盘链(U6): ent client → analytics store → analytics service → handler
	// analytics store 与 telemetry store 共享同一 ent client(写入与读取互不干扰)
	analyticsStore := service.NewEntAnalyticsStore(entClient)
	analyticsService := service.NewAnalyticsService(analyticsStore)
	analyticsHandler := adminhandler.NewAnalyticsHandler(analyticsService)

	r := server.SetupRouter(cfg, healthHandler, authHandler, authService, proxyHandler, telemetryHandler, analyticsHandler)

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
	defer db.Close()

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
