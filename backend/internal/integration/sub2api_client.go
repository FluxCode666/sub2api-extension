// Package integration 提供与 sub2api 对接的客户端。
//
// 本包不导入 sub2api 的任何包,仅通过 HTTP 调用 sub2api 的公开 API。
// sub2api_client 负责管理员身份验证：转发管理员持有的 sub2api JWT 到
// sub2api GET /api/v1/auth/me，解析响应判定角色是否为 admin。
package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
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

// sub2APIEnvelope 镜像 sub2api 的认证响应 envelope: {code, message, reason, data}。
type sub2APIEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Reason  string          `json:"reason,omitempty"`
	Data    json.RawMessage `json:"data,omitempty"`
}

// Sub2APIClient 调用 sub2api 的 HTTP 客户端。
type Sub2APIClient struct {
	baseURL    string
	httpClient *http.Client
}

// NewSub2APIClient 创建 sub2api 客户端。
// baseURL 为 sub2api 后端地址(如 http://localhost:8090),尾部斜杠会被去除。
func NewSub2APIClient(baseURL string) *Sub2APIClient {
	return &Sub2APIClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
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
	info, err := c.verifyJWT(ctx, token)
	if err != nil {
		return false, nil, err
	}
	return info.Role == "admin", info, nil
}

// VerifyUserJWT verifies a Sub2API access token for a customer-facing
// embedded page.  Unlike VerifyAdminJWT it deliberately accepts every valid
// account role; authorization of a request is always based on the verified
// returned user ID, never on the iframe's user_id query parameter.
func (c *Sub2APIClient) VerifyUserJWT(ctx context.Context, token string) (*Sub2APIUserInfo, error) {
	return c.verifyJWT(ctx, token)
}

func (c *Sub2APIClient) verifyJWT(ctx context.Context, token string) (*Sub2APIUserInfo, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, ErrInvalidToken
	}
	url := c.baseURL + "/api/v1/auth/me"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("building request to sub2api: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrSub2APIUnreachable, err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("[Sub2APIClient.verifyJWT] failed to close response body: %v", closeErr)
		}
	}()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading sub2api response: %w", err)
	}

	// 先按状态码判定 token 有效性: sub2api 在 token 无效/过期时返回 401。
	// 必须在 JSON 解码之前判定 —— 生产环境中 401 响应体可能不是 JSON
	// (如反向代理/网关返回纯文本或 HTML 错误页), 若先解码会落入"不可达"桶,
	// 误导前端展示"服务不可达"而非"身份已失效"(R4 错误分级语义)。
	if resp.StatusCode == http.StatusUnauthorized {
		return nil, ErrInvalidToken
	}

	var envelope sub2APIEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("decoding sub2api response: %w", err)
	}

	// 其他非 200 视为错误(含合规拦截 403、5xx 等)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sub2api returned status %d: %s", resp.StatusCode, envelope.Message)
	}

	// 解析 data 中的用户信息
	var info Sub2APIUserInfo
	if len(envelope.Data) == 0 {
		return nil, fmt.Errorf("sub2api response missing data field")
	}
	if err := json.Unmarshal(envelope.Data, &info); err != nil {
		return nil, fmt.Errorf("decoding sub2api user data: %w", err)
	}
	return &info, nil
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
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			log.Printf("[Sub2APIClient.Login] failed to close response body: %v", closeErr)
		}
	}()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading sub2api login response: %w", err)
	}

	// 登录响应可能包含 access_token/refresh_token；绝不记录完整响应体或凭据。

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

// BaseURL 返回 sub2api 后端基础 URL。
func (c *Sub2APIClient) BaseURL() string {
	return c.baseURL
}
