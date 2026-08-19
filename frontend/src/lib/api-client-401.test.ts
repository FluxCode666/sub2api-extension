/**
 * 测试 API 客户端的 401 跳转逻辑。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { apiRequest } from './api-client'
import { clearAdminSession, getAdminSession } from './admin-auth'

function makeSessionToken(expiresInSeconds = 3600): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  })}.test-signature`
}

describe('apiRequest 401 handling', () => {
  const originalLocation = window.location
  let mockAssign: ReturnType<typeof vi.fn>

  beforeEach(() => {
    clearAdminSession()
    // Mock window.location
    mockAssign = vi.fn()
    delete (window as any).location
    window.location = { ...originalLocation, href: '', assign: mockAssign, pathname: '' } as any
  })

  afterEach(() => {
    clearAdminSession()
    window.location = originalLocation
    vi.restoreAllMocks()
  })

  it('should redirect to /login when 401 occurs on /admin path', async () => {
    // 设置当前路径为 /admin/dashboard
    window.location.pathname = '/admin/dashboard'

    // Mock fetch 返回 401
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response)

    // 调用 API 应该触发跳转
    await expect(apiRequest('/test')).rejects.toThrow('Unauthorized: redirecting to login')

    // 验证跳转到登录页
    expect(window.location.href).toBe('/login')
  })

  it('should clear the stale admin session before redirecting after 401', async () => {
    window.location.pathname = '/admin/dashboard'
    localStorage.setItem('aux_admin_session', JSON.stringify({
      token: makeSessionToken(),
      user: { id: 1, email: 'admin@example.com', username: 'admin', role: 'admin' },
    }))
    expect(getAdminSession()).not.toBeNull()

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response)

    await expect(apiRequest('/test')).rejects.toThrow('Unauthorized: redirecting to login')

    expect(getAdminSession()).toBeNull()
    expect(window.location.href).toBe('/login')
  })

  it('should not redirect when 401 occurs on non-admin path', async () => {
    // 设置当前路径为公开页面
    window.location.pathname = '/p/home'

    // Mock fetch 返回 401
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    } as Response)

    // 调用 API 应该抛出错误但不跳转
    await expect(apiRequest('/test')).rejects.toThrow('Aux API request failed: 401 Unauthorized')

    // 验证没有跳转
    expect(window.location.href).toBe('')
  })

  it('should handle other error codes normally', async () => {
    window.location.pathname = '/admin/dashboard'

    // Mock fetch 返回 500
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response)

    // 调用 API 应该抛出错误但不跳转
    await expect(apiRequest('/test')).rejects.toThrow('Aux API request failed: 500 Internal Server Error')

    // 验证没有跳转
    expect(window.location.href).toBe('')
  })
})
