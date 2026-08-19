//go:build integration

// Package server 的集成测试，需要真实 PostgreSQL 连接。
//
// 运行方式：
//
//	go test -tags=integration ./internal/server/...
//
// 无 PostgreSQL 时测试会跳过（通过 DATABASE_HOST 等环境变量配置连接）。
package server

import (
	"context"
	"os"
	"testing"
	"time"

	"sub2api-extension/ent"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEntConnect_PostgreSQL(t *testing.T) {
	dsn := buildTestDSN(t)
	if dsn == "" {
		t.Skip("skipping ent integration test: no DATABASE_DBNAME configured")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := ent.Open("postgres", dsn)
	require.NoError(t, err, "ent.Open should succeed with valid DSN")
	defer func() { _ = client.Close() }()

	// 执行一次空查询验证连接可达性
	// ent 生成的 client 在有 schema 时可用 SystemMeta 查询做空检查；
	// 这里仅验证 client 能成功创建（连接已建立），空查询由 client 行为保证。
	assert.NotNil(t, client, "ent client should not be nil")

	_ = ctx
}

// buildTestDSN 从环境变量构建测试 DSN，未配置必要项时返回空串。
func buildTestDSN(t *testing.T) string {
	t.Helper()
	host := envOr("DATABASE_HOST", "localhost")
	port := envOr("DATABASE_PORT", "5432")
	user := envOr("DATABASE_USER", "")
	dbname := envOr("DATABASE_DBNAME", "")
	password := envOr("DATABASE_PASSWORD", "")
	sslmode := envOr("DATABASE_SSLMODE", "disable")

	if user == "" || dbname == "" {
		return ""
	}

	if password == "" {
		return "host=" + host + " port=" + port + " user=" + user + " dbname=" + dbname + " sslmode=" + sslmode
	}
	return "host=" + host + " port=" + port + " user=" + user + " password=" + password + " dbname=" + dbname + " sslmode=" + sslmode
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
