/**
 * 附属后端 API 客户端。
 *
 * baseURL 指向附属后端 (/api/aux)。
 * 当存在嵌入 token 时自动附加到请求头,供 U3 上报鉴权。
 * 当存在附属管理员会话时自动附加会话 token,供受守卫端点鉴权。
 *
 * 所有请求带默认超时(15s, AbortController): aux 后端慢/挂时管理端页面
 * 不会无限卡在 loading,而是降级为错误提示(#4)。调用方可通过 options.signal
 * 覆盖默认超时行为(传入自定义 signal 时不再附加默认超时)。
 */
import { getEmbeddedContext } from './embedded'
import { clearAdminSession, getAdminSessionToken, ADMIN_SESSION_HEADER } from './admin-auth'
import { AUX_API_BASE_URL } from './api-base'

/** 附属后端标准响应 envelope(镜像后端 response.Response)。 */
export interface AuxEnvelope<T> {
  code: number
  message: string
  data?: T
}

const AUTH_HEADER = 'X-Aux-Token'

/** 请求默认超时(毫秒)。覆盖最慢端点(analytics 聚合 + sub2api 代理往返)。 */
const DEFAULT_REQUEST_TIMEOUT_MS = 15000

export interface ApiRequestOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /** 请求超时(毫秒),默认 15000。传 0 禁用超时。 */
  timeout?: number
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra }
  // 附属管理员会话(受守卫端点需要)
  const sessionToken = getAdminSessionToken()
  if (sessionToken) {
    headers[ADMIN_SESSION_HEADER] = sessionToken
  }
  // sub2api 嵌入 token(U3 session 换取需要)
  const ctx = getEmbeddedContext()
  if (ctx?.token) {
    headers[AUTH_HEADER] = ctx.token
  }
  return headers
}

/**
 * 用带超时的 AbortController 包装 fetch。
 *
 * 调用方已传入 signal 时直接复用(不自建超时);否则创建一个默认超时的
 * AbortController,响应或异常后清理定时器,避免定时器泄漏。
 * 返回 { signal, cleanup } —— signal 传入 fetch init,cleanup 在 finally 调用。
 */
function withTimeout(options: ApiRequestOptions): { signal: AbortSignal | undefined; cleanup: () => void } {
  // 调用方自带 signal 时尊重之, 不叠加默认超时
  if (options.signal) {
    return { signal: options.signal, cleanup: () => {} }
  }
  const timeoutMs = options.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS
  if (timeoutMs <= 0) {
    return { signal: undefined, cleanup: () => {} }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  }
}

/**
 * 向附属后端发起请求。自动附加嵌入 token (若存在)与默认超时。
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const url = `${AUX_API_BASE_URL}${path}`
  const headers = buildHeaders(options.headers)
  const { signal, cleanup } = withTimeout(options)
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    signal,
    // 页面内容和控制台数据来自数据库，禁止浏览器复用旧 GET 响应。
    cache: 'no-store',
  }
  if (options.body !== undefined) {
    if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
      // multipart boundary 必须由浏览器生成，不能手动设置 Content-Type。
      init.body = options.body
    } else {
      init.headers = { 'Content-Type': 'application/json', ...headers }
      init.body = JSON.stringify(options.body)
    }
  }
  try {
    const response = await fetch(url, init)
    if (!response.ok) {
      // 401 未授权：先清除本地会话，再跳转到登录页。
      // 只检查 JWT 格式/过期时间无法确认后端签名仍有效；不清除会话会让
      // LoginPage 再次识别旧会话并跳回控制台，形成 /admin ↔ /login 循环。
      if (response.status === 401 && window.location.pathname.startsWith('/admin')) {
        clearAdminSession()
        window.location.href = '/login'
        throw new Error('Unauthorized: redirecting to login')
      }
      throw new Error(
        `Aux API request failed: ${response.status} ${response.statusText}`,
      )
    }
    return (await response.json()) as T
  } finally {
    cleanup()
  }
}

export const apiClient = {
  get: <T>(path: string, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  upload: <T>(path: string, formData: FormData, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body: formData }),
  put: <T>(path: string, body?: unknown, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  del: <T>(path: string, options?: ApiRequestOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
}
