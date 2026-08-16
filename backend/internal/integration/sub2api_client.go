// Package integration 提供与 sub2api 对接的客户端。
//
// 本包不导入 sub2api 的任何包,仅通过 HTTP 调用 sub2api 的公开 API。
// sub2api_client 负责两种对接模式:
//   - 转发 JWT 验证: 转发管理员持有的 sub2api JWT 到 sub2api GET /api/v1/auth/me,
//     解析响应判定角色是否为 admin。本单元(U3)核心。
//   - Admin API Key 模式: 用 sub2api Admin API Key 直接调用 sub2api 管理端读取数据。
//     本单元先建骨架,供 U4 使用。
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Sub2APIUserInfo 是从 sub2api /auth/me 解析出的用户信息(仅保留附属系统所需字段)。
type Sub2APIUserInfo struct {
	ID       int64  `json:"id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

// sub2APIEnvelope 镜像 sub2api 的通用响应 envelope: {code, message, reason, data}。
// 它是 sub2api 所有 API(auth/me 与 admin/dashboard/stats)共用的响应结构, 非 auth 特有。
type sub2APIEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Reason  string          `json:"reason,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// Sub2APIClient 调用 sub2api 的 HTTP 客户端。
type Sub2APIClient struct {
	baseURL    string
	adminKey   string // sub2api Admin API Key(供 U4 用)
	httpClient *http.Client
}

// NewSub2APIClient 创建 sub2api 客户端。
// baseURL 为 sub2api 后端地址(如 http://localhost:8090),尾部斜杠会被去除。
func NewSub2APIClient(baseURL, adminAPIKey string) *Sub2APIClient {
	return &Sub2APIClient{
		baseURL:  strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		adminKey: strings.TrimSpace(adminAPIKey),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// VerifyAdminJWT 转发 sub2api JWT 到 sub2api GET /api/v1/auth/me 验证有效性,
// 并判定角色是否为管理员。
//
// 返回值:
//   - isAdmin: data.role == "admin" 时 true
//   - user: 解析出的用户信息(role 为非 admin 时也返回,供调用方决定如何拒绝)
//   - err: 网络/sub2api 不可达错误(失败关闭由调用方据此返回 503)
//
// 当 sub2api 返回 401(token 无效/过期)时, err 为 ErrInvalidToken, user 为 nil。
// 当 sub2api 返回其他非 200 时, err 描述状态码。
func (c *Sub2APIClient) VerifyAdminJWT(ctx context.Context, token string) (isAdmin bool, user *Sub2APIUserInfo, err error) {
	url := c.baseURL + "/api/v1/auth/me"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, nil, fmt.Errorf("building request to sub2api: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, nil, fmt.Errorf("%w: %w", ErrSub2APIUnreachable, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, nil, fmt.Errorf("reading sub2api response: %w", err)
	}

	// 先按状态码判定 token 有效性: sub2api 在 token 无效/过期时返回 401。
	// 必须在 JSON 解码之前判定 —— 生产环境中 401 响应体可能不是 JSON
	// (如反向代理/网关返回纯文本或 HTML 错误页), 若先解码会落入"不可达"桶,
	// 误导前端展示"服务不可达"而非"身份已失效"(R4 错误分级语义)。
	if resp.StatusCode == http.StatusUnauthorized {
		return false, nil, ErrInvalidToken
	}

	var envelope sub2APIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return false, nil, fmt.Errorf("decoding sub2api response: %w", err)
	}

	// 其他非 200 视为错误(含合规拦截 403、5xx 等)
	if resp.StatusCode != http.StatusOK {
		return false, nil, fmt.Errorf("sub2api returned status %d: %s", resp.StatusCode, envelope.Message)
	}

	// 解析 data 中的用户信息
	var info Sub2APIUserInfo
	if len(envelope.Data) == 0 {
		return false, nil, fmt.Errorf("sub2api response missing data field")
	}
	if err := json.Unmarshal(envelope.Data, &info); err != nil {
		return false, nil, fmt.Errorf("decoding sub2api user data: %w", err)
	}

	isAdmin = info.Role == "admin"
	return isAdmin, &info, nil
}

// Sub2APILoginRequest sub2api 登录请求体。
// captcha 字段省略: sub2api 未配置验证码提供者时 VerifyCaptcha 直接放行,
// 传空字段与省略等价(已通过本地联调验证)。
type Sub2APILoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// Sub2APILoginResponse sub2api 登录响应的 data 部分。
//
// 正常登录: AccessToken/RefreshToken/User 填充, Requires2FA 为 false。
// 2FA 分支: Requires2FA 为 true, AccessToken 为空, 填充 TempToken/UserEmailMasked。
// User 复用 Sub2APIUserInfo(sub2api 返回的额外字段如 balance/status 被忽略)。
type Sub2APILoginResponse struct {
	AccessToken  string          `json:"access_token"`
	RefreshToken string          `json:"refresh_token"`
	ExpiresIn    int             `json:"expires_in"`
	TokenType    string          `json:"token_type"`
	User         Sub2APIUserInfo `json:"user"`

	// 2FA 分支字段(requires_2fa=true 时填充)
	Requires2FA     bool   `json:"requires_2fa,omitempty"`
	TempToken       string `json:"temp_token,omitempty"`
	UserEmailMasked string `json:"user_email_masked,omitempty"`
}

// Login 用账号密码调 sub2api POST /api/v1/auth/login。
//
// 返回值:
//   - resp: 登录响应(含 access_token 与 user;2FA 分支 Requires2FA=true)
//   - err: ErrInvalidCredentials(账号密码错误 401) / 包装 ErrSub2APIUnreachable(网络) / 其他状态码错误
//
// captcha 字段不传: sub2api 未配置验证码提供者时放行(已联调验证)。
func (c *Sub2APIClient) Login(ctx context.Context, req Sub2APILoginRequest) (*Sub2APILoginResponse, error) {
	url := c.baseURL + "/api/v1/auth/login"

	bodyBytes, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("encoding login request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("building login request to sub2api: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrSub2APIUnreachable, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading sub2api login response: %w", err)
	}

	// 账号密码错误: sub2api 返回 401。先判状态码再解 JSON(401 响应体可能非 JSON)。
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrInvalidCredentials
	}

	var envelope sub2APIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("decoding sub2api login response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sub2api login returned status %d: %s", resp.StatusCode, envelope.Message)
	}
	if envelope.Code != 0 {
		return nil, fmt.Errorf("sub2api login returned error code %d: %s", envelope.Code, envelope.Message)
	}

	if len(envelope.Data) == 0 {
		return nil, fmt.Errorf("sub2api login response missing data field")
	}

	var loginResp Sub2APILoginResponse
	if err := json.Unmarshal(envelope.Data, &loginResp); err != nil {
		return nil, fmt.Errorf("decoding sub2api login data: %w", err)
	}

	return &loginResp, nil
}

// ErrInvalidToken 表示 sub2api 判定 token 无效或过期(401)。
var ErrInvalidToken = errors.New("invalid or expired sub2api token")

// ErrInvalidCredentials 表示 sub2api 判定账号密码错误(登录 401)。
var ErrInvalidCredentials = errors.New("invalid email or password")

// ErrSub2APIUnreachable 表示 sub2api 网络不可达/超时(供调用方用 errors.Is 判定返回 503)。
var ErrSub2APIUnreachable = errors.New("sub2api unreachable")

// DashboardStats 是 sub2api GET /api/v1/admin/dashboard/stats 返回的统计快照。
//
// 仅保留附属系统示例动态页展示所需的核心字段;sub2api 返回的其他字段被忽略。
// 字段映射基于 sub2api backend/internal/handler/admin/dashboard_handler.go GetStats 的 gin.H 键名。
type DashboardStats struct {
	// 用户统计
	TotalUsers    int64 `json:"total_users"`
	TodayNewUsers int64 `json:"today_new_users"`
	ActiveUsers   int64 `json:"active_users"`

	// API Key 统计
	TotalAPIKeys  int64 `json:"total_api_keys"`
	ActiveAPIKeys int64 `json:"active_api_keys"`

	// 账户统计
	TotalAccounts  int64 `json:"total_accounts"`
	NormalAccounts int64 `json:"normal_accounts"`
	ErrorAccounts  int64 `json:"error_accounts"`

	// 累计使用统计
	TotalRequests int64   `json:"total_requests"`
	TotalTokens   int64   `json:"total_tokens"`
	TotalCost     float64 `json:"total_cost"`

	// 今日使用统计
	TodayRequests int64   `json:"today_requests"`
	TodayTokens   int64   `json:"today_tokens"`
	TodayCost     float64 `json:"today_cost"`

	// 系统运行统计
	Uptime int64 `json:"uptime"`

	// 性能指标
	Rpm int64 `json:"rpm"`
	Tpm int64 `json:"tpm"`

	// 预聚合新鲜度
	StatsUpdatedAt string `json:"stats_updated_at"`
	StatsStale     bool   `json:"stats_stale"`
}

// ErrAdminAPIKeyMissing 表示未配置 Admin API Key。
var ErrAdminAPIKeyMissing = errors.New("sub2api admin api key not configured")

// GetDashboardStats 用 Admin API Key 调 sub2api GET /api/v1/admin/dashboard/stats,
// 解析 envelope 的 data 为 DashboardStats。
//
// 鉴权方式: x-api-key header(镜像 sub2api adminAuth 中间件的 API Key 分支)。
// 调用面: 仅此一个端点,不透传整个 /admin/*(KTD5 最小调用面)。
//
// 错误:
//   - 未配置 Admin API Key → ErrAdminAPIKeyMissing
//   - sub2api 不可达/超时 → 包装错误(调用方据此返回 503)
//   - sub2api 返回非 200(含合规拦截) → 描述状态码的错误(调用方据此返回 502)
func (c *Sub2APIClient) GetDashboardStats(ctx context.Context) (*DashboardStats, error) {
	if c.adminKey == "" {
		return nil, ErrAdminAPIKeyMissing
	}

	url := c.baseURL + "/api/v1/admin/dashboard/stats"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("building dashboard stats request: %w", err)
	}
	req.Header.Set("x-api-key", c.adminKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrSub2APIUnreachable, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading sub2api response: %w", err)
	}

	var envelope sub2APIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("decoding sub2api response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sub2api returned status %d: %s", resp.StatusCode, envelope.Message)
	}

	if len(envelope.Data) == 0 {
		return nil, fmt.Errorf("sub2api response missing data field")
	}

	var stats DashboardStats
	if err := json.Unmarshal(envelope.Data, &stats); err != nil {
		return nil, fmt.Errorf("decoding dashboard stats: %w", err)
	}

	return &stats, nil
}

// AdminKey 返回配置的 sub2api Admin API Key(供 U4 使用)。
func (c *Sub2APIClient) AdminKey() string {
	return c.adminKey
}

// BaseURL 返回 sub2api 后端基础 URL。
func (c *Sub2APIClient) BaseURL() string {
	return c.baseURL
}
