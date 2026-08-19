package config

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// clearEnv 清除本包关心的环境变量，确保测试隔离。
func clearEnv(t *testing.T) {
	t.Helper()
	keys := []string{
		"SERVER_HOST", "SERVER_PORT", "SERVER_MODE",
		"SERVER_READ_HEADER_TIMEOUT", "SERVER_READ_TIMEOUT",
		"SERVER_WRITE_TIMEOUT", "SERVER_IDLE_TIMEOUT",
		"DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER",
		"DATABASE_PASSWORD", "DATABASE_DBNAME", "DATABASE_SSLMODE",
		"SUB2API_BASE_URL",
		"JWT_SECRET", "JWT_EXPIRE_HOUR",
		"SUB2API_EXTENSION_ASSET_DIR",
	}
	for _, k := range keys {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}
}

func TestLoadFromEnv_Success(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_HOST", "db.example.com")
	t.Setenv("DATABASE_PORT", "6543")
	t.Setenv("DATABASE_USER", "aux")
	t.Setenv("DATABASE_PASSWORD", "secret")
	t.Setenv("DATABASE_DBNAME", "auxdb")
	t.Setenv("JWT_SECRET", "test-secret-key")
	t.Setenv("SERVER_PORT", "9999")
	t.Setenv("SUB2API_BASE_URL", "https://sub2api.example.com")

	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	require.NotNil(t, cfg)

	assert.Equal(t, "db.example.com", cfg.Database.Host)
	assert.Equal(t, 6543, cfg.Database.Port)
	assert.Equal(t, "aux", cfg.Database.User)
	assert.Equal(t, "secret", cfg.Database.Password)
	assert.Equal(t, "auxdb", cfg.Database.DBName)
	assert.Equal(t, "test-secret-key", cfg.JWT.Secret)
	assert.Equal(t, 9999, cfg.Server.Port)
	assert.Equal(t, "https://sub2api.example.com", cfg.Sub2API.BaseURL)
}

func TestLoadFromEnv_MissingDBHost(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_USER", "aux")
	t.Setenv("DATABASE_DBNAME", "auxdb")
	t.Setenv("JWT_SECRET", "test-secret-key")

	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "database.host")
}

func TestLoadFromEnv_MissingDBUser(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_HOST", "localhost")
	t.Setenv("DATABASE_DBNAME", "auxdb")
	t.Setenv("JWT_SECRET", "test-secret-key")

	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "database.user")
}

func TestLoadFromEnv_MissingDBName(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_HOST", "localhost")
	t.Setenv("DATABASE_USER", "aux")
	t.Setenv("JWT_SECRET", "test-secret-key")

	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "database.dbname")
}

func TestLoadFromEnv_MissingJWTSecret(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_HOST", "localhost")
	t.Setenv("DATABASE_USER", "aux")
	t.Setenv("DATABASE_DBNAME", "auxdb")
	t.Setenv("SUB2API_BASE_URL", "http://sub2api:8080")

	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "jwt.secret")
}

func TestLoadFromEnv_MissingSub2APIBaseURL(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_HOST", "localhost")
	t.Setenv("DATABASE_USER", "aux")
	t.Setenv("DATABASE_DBNAME", "auxdb")
	t.Setenv("JWT_SECRET", "test-secret-key")

	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sub2api.base_url")
}

func TestLoadFromEnv_InvalidPort(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_HOST", "localhost")
	t.Setenv("DATABASE_USER", "aux")
	t.Setenv("DATABASE_DBNAME", "auxdb")
	t.Setenv("JWT_SECRET", "test-secret-key")
	t.Setenv("SUB2API_BASE_URL", "http://sub2api:8080")
	t.Setenv("SERVER_PORT", "99999")

	_, err := LoadFromEnv()
	require.Error(t, err)
	assert.Contains(t, err.Error(), "server.port")
}

func TestLoadFromEnv_Defaults(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_HOST", "localhost")
	t.Setenv("DATABASE_USER", "aux")
	t.Setenv("DATABASE_DBNAME", "auxdb")
	t.Setenv("JWT_SECRET", "test-secret-key")
	t.Setenv("SUB2API_BASE_URL", "http://sub2api:8080")

	cfg, err := LoadFromEnv()
	require.NoError(t, err)

	// 验证默认值
	assert.Equal(t, "0.0.0.0", cfg.Server.Host)
	assert.Equal(t, 8787, cfg.Server.Port)
	assert.Equal(t, "debug", cfg.Server.Mode)
	assert.Equal(t, 30, cfg.Server.ReadHeaderTimeout)
	assert.Equal(t, 30, cfg.Server.ReadTimeout)
	assert.Equal(t, 60, cfg.Server.WriteTimeout)
	assert.Equal(t, 120, cfg.Server.IdleTimeout)
	assert.Equal(t, 5432, cfg.Database.Port)
	assert.Equal(t, "disable", cfg.Database.SSLMode)
	assert.Equal(t, 24, cfg.JWT.ExpireHour)
	assert.Equal(t, "data/assets", cfg.Assets.Dir)
}

func TestLoadFromEnv_AssetDirectoryOverride(t *testing.T) {
	clearEnv(t)
	t.Setenv("DATABASE_HOST", "localhost")
	t.Setenv("DATABASE_USER", "aux")
	t.Setenv("DATABASE_DBNAME", "auxdb")
	t.Setenv("JWT_SECRET", "test-secret-key")
	t.Setenv("SUB2API_BASE_URL", "http://sub2api:8080")
	t.Setenv("SUB2API_EXTENSION_ASSET_DIR", "/persist/uploads")

	cfg, err := LoadFromEnv()
	require.NoError(t, err)
	assert.Equal(t, "/persist/uploads", cfg.Assets.Dir)
}

func TestDatabaseDSN_WithPassword(t *testing.T) {
	d := DatabaseConfig{
		Host: "localhost", Port: 5432, User: "aux",
		Password: "secret", DBName: "auxdb", SSLMode: "disable",
	}
	dsn := d.DSN()
	assert.Contains(t, dsn, "host=localhost")
	assert.Contains(t, dsn, "port=5432")
	assert.Contains(t, dsn, "user=aux")
	assert.Contains(t, dsn, "password=secret")
	assert.Contains(t, dsn, "dbname=auxdb")
	assert.Contains(t, dsn, "sslmode=disable")
}

func TestDatabaseDSN_WithoutPassword(t *testing.T) {
	d := DatabaseConfig{
		Host: "localhost", Port: 5432, User: "aux",
		Password: "", DBName: "auxdb", SSLMode: "disable",
	}
	dsn := d.DSN()
	assert.NotContains(t, dsn, "password=")
	assert.Contains(t, dsn, "host=localhost")
	assert.Contains(t, dsn, "user=aux")
}

func TestServerAddress(t *testing.T) {
	s := ServerConfig{Host: "0.0.0.0", Port: 8787}
	assert.Equal(t, "0.0.0.0:8787", s.Address())
}
