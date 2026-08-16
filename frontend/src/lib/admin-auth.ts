/**
 * 管理员认证: 用 sub2api iframe token 换取附属系统管理员会话。
 *
 * 流程:
 *   1. 从 embedded context 取 sub2api token (iframe 传入)
 *   2. POST /api/aux/admin/session { token } → 后端转发 sub2api 验证
 *   3. 成功 → 存附属会话 JWT (localStorage + 内存)
 *   4. 后续受守卫请求用附属会话 JWT (X-Aux-Session: <aux-jwt>)
 *
 * 两套 token 严格区分:
 *   - sub2api token: iframe 传入, 仅用于换取附属会话, 不持久化
 *   - 附属会话 token: 后端签发, 存 localStorage, 调受守卫端点时带
 */
import { getEmbeddedContext } from './embedded'
import { AUX_API_BASE_URL } from './api-base'

const SESSION_STORAGE_KEY = 'aux_admin_session'

/** 附属会话 JWT 的请求头名(供 api-client 附加)。与后端 admin_guard.go 的 sessionHeaderKey 一致。 */
export const ADMIN_SESSION_HEADER = 'X-Aux-Session'

/** exchangeSession / loginWithCredentials 的超时(毫秒)。aux 后端慢/挂时降级为 unreachable 而非永久 loading。 */
const SESSION_EXCHANGE_TIMEOUT_MS = 10000

/** 后端 /admin/session 成功响应的 envelope。 */
interface SessionEnvelope {
  code: number
  message: string
  data?: {
    session_token: string
    user: {
      id: number
      email: string
      username: string
      role: string
    }
  }
}

/** 管理员会话信息。 */
export interface AdminSession {
  token: string
  user: {
    id: number
    email: string
    username: string
    role: string
  }
}

/** 会话换取失败原因。 */
export type SessionError =
  | 'no-embedded-token'
  | 'forbidden'
  | 'unauthorized'
  | 'unreachable'
  | 'bad-request'
  | 'unknown'

/** 会话换取结果。 */
export interface SessionResult {
  ok: boolean
  session?: AdminSession
  error?: SessionError
}

/**
 * 用 sub2api iframe token 换取附属管理员会话。
 *
 * 若 embedded context 无 token, 返回 'no-embedded-token'。
 * 后端根据 sub2api 验证结果返回:
 *   - 200 → 成功, 存会话
 *   - 403 → 非 admin → 'forbidden'
 *   - 401 → sub2api token 无效/过期 → 'unauthorized'
 *   - 503 → sub2api 不可达 → 'unreachable'
 *   - 400 → 请求格式错误 → 'bad-request'
 */
export async function exchangeSession(): Promise<SessionResult> {
  const ctx = getEmbeddedContext()
  const sub2apiToken = ctx?.token
  if (!sub2apiToken) {
    return { ok: false, error: 'no-embedded-token' }
  }

  let resp: Response
  // 带超时的 AbortController: aux 后端慢(转发 sub2api /auth/me)或挂起时,
  // 10s 后 abort,降级为 'unreachable',AdminGuard 显示重试提示(#3)。
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SESSION_EXCHANGE_TIMEOUT_MS)
  try {
    resp = await fetch(`${AUX_API_BASE_URL}/admin/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sub2apiToken }),
      signal: controller.signal,
    })
  } catch {
    // 网络错误与超时(abort)均降级为 unreachable
    return { ok: false, error: 'unreachable' }
  } finally {
    clearTimeout(timeoutId)
  }

  if (resp.ok) {
    const env: SessionEnvelope = await resp.json()
    if (env.code === 0 && env.data?.session_token) {
      const session: AdminSession = {
        token: env.data.session_token,
        user: env.data.user,
      }
      saveSession(session)
      return { ok: true, session }
    }
    return { ok: false, error: 'unknown' }
  }

  // 错误响应: 按 HTTP 状态码映射错误类型
  try {
    await resp.json()
  } catch {
    // 非 JSON 错误体, 忽略(按状态码判定即可)
  }

  switch (resp.status) {
    case 403:
      return { ok: false, error: 'forbidden' }
    case 401:
      return { ok: false, error: 'unauthorized' }
    case 503:
      return { ok: false, error: 'unreachable' }
    case 400:
      return { ok: false, error: 'bad-request' }
    default:
      return { ok: false, error: 'unknown' }
  }
}

/** 账号密码登录失败原因。 */
export type LoginError =
  | 'invalid-credentials' // 邮箱或密码错误(401)
  | 'forbidden'           // 非管理员(403 NOT_ADMIN)
  | 'two-factor'          // 已开启两步验证(403 TWO_FACTOR_REQUIRED)
  | 'unreachable'         // sub2api/aux 不可达(503 或网络错误)
  | 'bad-request'         // 请求格式错误(400)
  | 'unknown'

/** 账号密码登录结果。 */
export interface LoginResult {
  ok: boolean
  session?: AdminSession
  error?: LoginError
}

/**
 * 用账号密码登录(独立登录入口,不经 sub2api iframe)。
 *
 * 与 exchangeSession 互补: exchangeSession 用 iframe token, 本函数用账号密码。
 * 成功后同样调 saveSession 存附属会话。响应结构与 /admin/session 一致。
 *
 * 后端返回:
 *   - 200 → 成功, 存会话
 *   - 401 → 邮箱或密码错误 → 'invalid-credentials'
 *   - 403 + reason NOT_ADMIN → 非管理员 → 'forbidden'
 *   - 403 + reason TWO_FACTOR_REQUIRED → 已开启两步验证 → 'two-factor'
 *   - 503 → sub2api 不可达 → 'unreachable'
 *   - 400 → 请求格式错误 → 'bad-request'
 */
export async function loginWithCredentials(
  email: string,
  password: string,
): Promise<LoginResult> {
  let resp: Response
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SESSION_EXCHANGE_TIMEOUT_MS)
  try {
    resp = await fetch(`${AUX_API_BASE_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    })
  } catch {
    // 网络错误与超时(abort)均降级为 unreachable
    return { ok: false, error: 'unreachable' }
  } finally {
    clearTimeout(timeoutId)
  }

  if (resp.ok) {
    try {
      const env: SessionEnvelope = await resp.json()
      if (env.code === 0 && env.data?.session_token) {
        const session: AdminSession = {
          token: env.data.session_token,
          user: env.data.user,
        }
        saveSession(session)
        return { ok: true, session }
      }
    } catch {
      // 成功状态码但响应体不合法时,降级为可恢复的未知错误。
    }
    return { ok: false, error: 'unknown' }
  }

  // 错误响应: 解析 body 中的 reason(403 用 reason 区分非管理员/两步验证)
  let reason = ''
  try {
    const errEnv = await resp.json()
    reason = typeof errEnv.reason === 'string' ? errEnv.reason : ''
  } catch {
    // 非 JSON 错误体, 忽略(按状态码判定即可)
  }

  switch (resp.status) {
    case 401:
      return { ok: false, error: 'invalid-credentials' }
    case 403:
      return { ok: false, error: reason === 'TWO_FACTOR_REQUIRED' ? 'two-factor' : 'forbidden' }
    case 503:
      return { ok: false, error: 'unreachable' }
    case 400:
      return { ok: false, error: 'bad-request' }
    default:
      return { ok: false, error: 'unknown' }
  }
}

/**
 * 持久化管理员会话到 localStorage + 内存。
 */
let cachedSession: AdminSession | null = null

function saveSession(session: AdminSession): void {
  cachedSession = session
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session))
  } catch {
    // localStorage 不可用时仅存内存
  }
}

/**
 * 获取当前管理员会话(优先内存, 其次 localStorage)。
 * 无会话时返回 null。
 */
export function getAdminSession(): AdminSession | null {
  if (cachedSession) {
    return cachedSession
  }
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (raw) {
      cachedSession = JSON.parse(raw) as AdminSession
      return cachedSession
    }
  } catch {
    // localStorage 不可用或解析失败
  }
  return null
}

/**
 * 清除管理员会话(登出)。
 */
export function clearAdminSession(): void {
  cachedSession = null
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // localStorage 不可用
  }
}

/**
 * 获取附属会话 token(用于受守卫请求的 X-Aux-Session 头)。
 * 无会话时返回 null。
 */
export function getAdminSessionToken(): string | null {
  return getAdminSession()?.token ?? null
}
