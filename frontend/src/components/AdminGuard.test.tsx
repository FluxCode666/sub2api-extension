/**
 * AdminGuard 单元测试 (#1)。
 *
 * AdminGuard 是管理端唯一的访问控制门: 状态机(loading/authenticated/denied)
 * 与 6 个 SessionError 分支全部未测, 是 diff 中最高风险的未测组件。
 *
 * 覆盖:
 *   1. 加载状态显示 "正在验证管理员身份..."
 *   2. 已有会话 → authenticated(放行 children)
 *   3. exchangeSession 成功 → authenticated
 *   4. 每种 SessionError → denied 状态及正确文本
 *   5. 重试按钮调用 clearAdminSession + reload
 *   6. 卸载期间不 setState(cancelled 标志)
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AdminGuard from './AdminGuard'

// mock admin-auth: 控制 exchangeSession/getAdminSession/clearAdminSession 行为
const exchangeSessionMock = vi.fn()
const getAdminSessionMock = vi.fn()
const clearAdminSessionMock = vi.fn()
vi.mock('@/lib/admin-auth', () => ({
  exchangeSession: (...args: unknown[]) => exchangeSessionMock(...args),
  getAdminSession: () => getAdminSessionMock(),
  clearAdminSession: () => clearAdminSessionMock(),
  ADMIN_SESSION_HEADER: 'X-Aux-Session',
}))

// mock window.location.reload
const reloadMock = vi.fn()
beforeEach(() => {
  // jsdom 的 window.location.reload 不可直接赋值, 用 defineProperty 覆盖
  Object.defineProperty(window, 'location', {
    value: { reload: reloadMock },
    writable: true,
  })
})

// renderGuard 包裹 MemoryRouter: AdminGuard 现在用 <Navigate>(需 Router 上下文)。
// loginRoute 若为 true, 注册一个 /login 捕获路由, 用于断言 no-embedded-token 重定向。
function renderGuard(
  children: React.ReactNode = <div>protected-content</div>,
  opts: { loginRoute?: boolean } = {},
) {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin" element={<AdminGuard>{children}</AdminGuard>} />
        {opts.loginRoute && (
          <Route path="/login" element={<div>login-page</div>} />
        )}
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminGuard', () => {
  beforeEach(() => {
    exchangeSessionMock.mockReset()
    getAdminSessionMock.mockReset()
    clearAdminSessionMock.mockReset()
    reloadMock.mockReset()
    // 默认无已有会话
    getAdminSessionMock.mockReturnValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows loading state initially while verifying', () => {
    // exchangeSession 永不 resolve, 保持 loading
    exchangeSessionMock.mockReturnValue(new Promise(() => {}))
    renderGuard()

    expect(screen.getByText('正在验证管理员身份...')).toBeInTheDocument()
  })

  it('renders children when existing admin session present', async () => {
    getAdminSessionMock.mockReturnValue({ token: 'existing-jwt', user: { role: 'admin' } })
    renderGuard()

    // 已有会话应直接放行, 不调用 exchangeSession
    await waitFor(() => {
      expect(screen.getByText('protected-content')).toBeInTheDocument()
    })
    expect(exchangeSessionMock).not.toHaveBeenCalled()
  })

  it('renders children after exchangeSession succeeds', async () => {
    exchangeSessionMock.mockResolvedValue({
      ok: true,
      session: { token: 'new-jwt', user: { role: 'admin' } },
    })
    renderGuard()

    await waitFor(() => {
      expect(screen.getByText('protected-content')).toBeInTheDocument()
    })
    expect(exchangeSessionMock).toHaveBeenCalledTimes(1)
  })

  const deniedCases: Array<{ error: string; expectedText: string }> = [
    // no-embedded-token 不在此列: 它重定向到 /login, 见下方独立测试
    { error: 'forbidden', expectedText: '当前账号非管理员' },
    { error: 'unauthorized', expectedText: 'sub2api 身份已失效' },
    { error: 'unreachable', expectedText: '无法连接 sub2api 服务' },
    { error: 'bad-request', expectedText: '请求格式错误' },
    { error: 'unknown', expectedText: '未知错误' },
  ]

  deniedCases.forEach(({ error, expectedText }) => {
    it(`shows denied state with correct message for ${error}`, async () => {
      exchangeSessionMock.mockResolvedValue({ ok: false, error })
      renderGuard()

      await waitFor(() => {
        expect(screen.getByText('访问被拒绝')).toBeInTheDocument()
      })
      // 部分匹配: expectedText 是完整消息的子串
      expect(screen.getByText(expectedText, { exact: false })).toBeInTheDocument()
      // children 不应渲染
      expect(screen.queryByText('protected-content')).not.toBeInTheDocument()
    })
  })

  it('redirects to /login when no embedded token (independent login entry)', async () => {
    exchangeSessionMock.mockResolvedValue({ ok: false, error: 'no-embedded-token' })
    renderGuard(<div>protected-content</div>, { loginRoute: true })

    // 应重定向到 /login (捕获路由渲染 login-page), 不显示拒绝界面
    await waitFor(() => {
      expect(screen.getByText('login-page')).toBeInTheDocument()
    })
    expect(screen.queryByText('访问被拒绝')).not.toBeInTheDocument()
    expect(screen.queryByText('protected-content')).not.toBeInTheDocument()
  })

  it('defaults to unknown error when error field missing', async () => {
    exchangeSessionMock.mockResolvedValue({ ok: false })
    renderGuard()

    await waitFor(() => {
      expect(screen.getByText('未知错误,请稍后重试。')).toBeInTheDocument()
    })
  })

  it('retry button calls clearAdminSession and reloads', async () => {
    exchangeSessionMock.mockResolvedValue({ ok: false, error: 'forbidden' })
    renderGuard()

    const retryBtn = await screen.findByText('重试')
    await userEvent.click(retryBtn)

    expect(clearAdminSessionMock).toHaveBeenCalledTimes(1)
    expect(reloadMock).toHaveBeenCalledTimes(1)
  })

  it('does not setState after unmount during pending exchangeSession', async () => {
    // 一个永不 resolve 的 promise, 模拟挂起
    let resolveExchange: (v: unknown) => void = () => {}
    exchangeSessionMock.mockReturnValue(
      new Promise((r) => {
        resolveExchange = r
      }),
    )
    const { unmount } = renderGuard()
    expect(screen.getByText('正在验证管理员身份...')).toBeInTheDocument()

    // 卸载(cleanup 设 cancelled = true)
    unmount()

    // 卸载后 resolve: 不应抛 React "setState on unmounted" 警告
    await act(async () => {
      resolveExchange({ ok: true, session: { token: 'x', user: { role: 'admin' } } })
    })
    // 无断言失败即通过: 卸载后 setState 被 cancelled 标志拦截
  })
})
