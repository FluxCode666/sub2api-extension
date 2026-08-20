// Package config 提供附属内容系统的配置加载、默认值与校验。
//
// 镜像 sub2api backend/internal/config 的风格，但仅保留附属系统所需的最小配置集。
// 配置来源：环境变量（优先）+ 可选 config.yaml。
package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/viper"
)

// Config 是附属内容系统的根配置。
type Config struct {
	Server   ServerConfig   `mapstructure:"server"`
	Database DatabaseConfig `mapstructure:"database"`
	Sub2API  Sub2APIConfig  `mapstructure:"sub2api"`
	JWT      JWTConfig      `mapstructure:"jwt"`
	Assets   AssetConfig    `mapstructure:"assets"`
}

// ServerConfig HTTP 服务配置。
type ServerConfig struct {
	Host              string `mapstructure:"host"`
	Port              int    `mapstructure:"port"`
	Mode              string `mapstructure:"mode"`                // debug/release
	ReadHeaderTimeout int    `mapstructure:"read_header_timeout"` // 秒
	ReadTimeout       int    `mapstructure:"read_timeout"`        // 秒
	WriteTimeout      int    `mapstructure:"write_timeout"`       // 秒
	IdleTimeout       int    `mapstructure:"idle_timeout"`        // 秒
}

// Address 返回 HTTP 监听地址 host:port。
func (s *ServerConfig) Address() string {
	return net.JoinHostPort(s.Host, strconv.Itoa(s.Port))
}

// DatabaseConfig PostgreSQL 连接配置。
type DatabaseConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	User     string `mapstructure:"user"`
	Password string `mapstructure:"password"`
	DBName   string `mapstructure:"dbname"`
	SSLMode  string `mapstructure:"sslmode"`
}

// DSN 返回 lib/pq 兼容的连接字符串。
// 当密码为空时不包含 password 参数，避免 libpq 解析错误（镜像 sub2api 风格）。
func (d *DatabaseConfig) DSN() string {
	if d.Password == "" {
		return fmt.Sprintf(
			"host=%s port=%d user=%s dbname=%s sslmode=%s",
			d.Host, d.Port, d.User, d.DBName, d.SSLMode,
		)
	}
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode,
	)
}

// Sub2APIConfig sub2api 对接配置（供管理员身份验证使用）。
type Sub2APIConfig struct {
	BaseURL string `mapstructure:"base_url"` // sub2api 后端基础 URL
}

// JWTConfig JWT 签名配置（供 U3 管理员鉴权）。
type JWTConfig struct {
	Secret     string `mapstructure:"secret"`      // 签名密钥
	ExpireHour int    `mapstructure:"expire_hour"` // Token 有效期（小时）
}

// AssetConfig 是图片等上传资源的文件存储配置。
// 数据库只记录相对此目录的路径，文件本身不写入数据库。
type AssetConfig struct {
	Dir string `mapstructure:"dir"`
}

// Load 读取并校验完整配置。缺少必需项时返回清晰错误。
func Load() (*Config, error) {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath(".")
	viper.AddConfigPath("./config")

	// 环境变量支持
	viper.AutomaticEnv()
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	// AutomaticEnv 只会读取已绑定/默认的键；显式绑定确保 SUB2API_EXTENSION_ASSET_DIR
	// 能覆盖 assets.dir（尤其是生产容器的 /app/data/assets）。
	_ = viper.BindEnv("assets.dir", "SUB2API_EXTENSION_ASSET_DIR")

	setDefaults()

	if err := viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("read config error: %w", err)
		}
		// 配置文件不存在时使用默认值 + 环境变量
	}

	var cfg Config
	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config error: %w", err)
	}

	normalize(&cfg)

	if err := validate(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// setDefaults 设置配置默认值。
//
// 必需项(database.user/password/dbname、jwt.secret、sub2api.base_url)
// 这里也设空串默认值——不是为了提供默认值,而是为了给 viper 注册这些 key,
// 使 AutomaticEnv 能从环境变量(DATABASE_USER 等)读取它们。
// 否则 viper 只对已注册的 key 生效,未注册的必需项即使环境变量存在也读不到。
// 真正的"是否提供"校验由 validate() 负责。
func setDefaults() {
	viper.SetDefault("server.host", "0.0.0.0")
	viper.SetDefault("server.port", 8787)
	viper.SetDefault("server.mode", "debug")
	viper.SetDefault("server.read_header_timeout", 30)
	viper.SetDefault("server.read_timeout", 30)
	viper.SetDefault("server.write_timeout", 60)
	viper.SetDefault("server.idle_timeout", 120)

	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", 5432)
	viper.SetDefault("database.user", "")
	viper.SetDefault("database.password", "")
	viper.SetDefault("database.dbname", "")
	viper.SetDefault("database.sslmode", "disable")

	viper.SetDefault("sub2api.base_url", "")

	viper.SetDefault("jwt.secret", "")
	viper.SetDefault("jwt.expire_hour", 24)

	// 本地开发默认落在 backend/data/assets；Docker Compose 会覆写为
	// /app/data/assets，并将 /app/data 挂进持久卷。
	viper.SetDefault("assets.dir", "data/assets")
}

// normalize 规范化配置字段。
func normalize(cfg *Config) {
	cfg.Server.Mode = strings.ToLower(strings.TrimSpace(cfg.Server.Mode))
	if cfg.Server.Mode == "" {
		cfg.Server.Mode = "debug"
	}
	cfg.Database.Host = strings.TrimSpace(cfg.Database.Host)
	cfg.Database.User = strings.TrimSpace(cfg.Database.User)
	cfg.Database.DBName = strings.TrimSpace(cfg.Database.DBName)
	cfg.Database.SSLMode = strings.TrimSpace(cfg.Database.SSLMode)
	cfg.Database.Password = strings.TrimSpace(cfg.Database.Password)
	cfg.Sub2API.BaseURL = strings.TrimSpace(cfg.Sub2API.BaseURL)
	cfg.JWT.Secret = strings.TrimSpace(cfg.JWT.Secret)
	cfg.Assets.Dir = strings.TrimSpace(cfg.Assets.Dir)
	if cfg.Assets.Dir == "" {
		cfg.Assets.Dir = "data/assets"
	}
}

// validate 校验必需配置项，缺少时返回清晰错误。
func validate(cfg *Config) error {
	if cfg.Database.Host == "" {
		return fmt.Errorf("config validation: database.host is required")
	}
	if cfg.Database.User == "" {
		return fmt.Errorf("config validation: database.user is required")
	}
	if cfg.Database.DBName == "" {
		return fmt.Errorf("config validation: database.dbname is required")
	}
	if cfg.Database.Port <= 0 || cfg.Database.Port > 65535 {
		return fmt.Errorf("config validation: database.port must be between 1 and 65535, got %d", cfg.Database.Port)
	}
	if cfg.Server.Port <= 0 || cfg.Server.Port > 65535 {
		return fmt.Errorf("config validation: server.port must be between 1 and 65535, got %d", cfg.Server.Port)
	}
	if cfg.JWT.Secret == "" {
		return fmt.Errorf("config validation: jwt.secret is required")
	}
	if cfg.Sub2API.BaseURL == "" {
		return fmt.Errorf("config validation: sub2api.base_url is required")
	}
	return nil
}

// LoadFromEnv 直接从环境变量加载配置（不依赖 config.yaml），用于测试与容器化部署。
func LoadFromEnv() (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{
			Host:              getEnv("SERVER_HOST", "0.0.0.0"),
			Port:              getEnvInt("SERVER_PORT", 8787),
			Mode:              getEnv("SERVER_MODE", "debug"),
			ReadHeaderTimeout: getEnvInt("SERVER_READ_HEADER_TIMEOUT", 30),
			ReadTimeout:       getEnvInt("SERVER_READ_TIMEOUT", 30),
			WriteTimeout:      getEnvInt("SERVER_WRITE_TIMEOUT", 60),
			IdleTimeout:       getEnvInt("SERVER_IDLE_TIMEOUT", 120),
		},
		Database: DatabaseConfig{
			Host:     getEnv("DATABASE_HOST", ""),
			Port:     getEnvInt("DATABASE_PORT", 5432),
			User:     getEnv("DATABASE_USER", ""),
			Password: getEnv("DATABASE_PASSWORD", ""),
			DBName:   getEnv("DATABASE_DBNAME", ""),
			SSLMode:  getEnv("DATABASE_SSLMODE", "disable"),
		},
		Sub2API: Sub2APIConfig{
			BaseURL: getEnv("SUB2API_BASE_URL", ""),
		},
		JWT: JWTConfig{
			Secret:     getEnv("JWT_SECRET", ""),
			ExpireHour: getEnvInt("JWT_EXPIRE_HOUR", 24),
		},
		Assets: AssetConfig{
			Dir: getEnv("SUB2API_EXTENSION_ASSET_DIR", "data/assets"),
		},
	}

	normalize(cfg)

	if err := validate(cfg); err != nil {
		return nil, err
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
