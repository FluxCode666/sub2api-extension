/**
 * LoginPage 单元测试。
 *
 * 覆盖:
 *   1. 渲染表单 (email + password 输入 + 登录按钮)
 *   2. 提交调用 loginWithCredentials(email, password)
 *   3. 成功 → 跳转 /admin (通过捕获路由断言)
 *   4. 失败 → 显示错误信息, 不跳转
 *   5. 已登录用户访问 → 直接跳转 /admin
 *   6. 提交中按钮禁用
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LoginPage from './LoginPage'

// mock admin-auth: 控制 loginWithCredentials / getAdminSession 行为
const loginMock = vi.fn()
const getAdminSessionMock = vi.fn()
vi.mock('@/lib/admin-auth', () => ({
  loginWithCredentials: (...args: unknown[]) => loginMock(...args),
  getAdminSession: () => getAdminSessionMock(),
}))

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* 捕获 /admin 跳转目标 */}
        <Route path="/admin" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    loginMock.mockReset()
    getAdminSessionMock.mockReset()
    // 默认无已有会话
    getAdminSessionMock.mockReturnValue(null)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders login form with email and password inputs', () => {
    renderLogin()

    expect(screen.getByText('管理员登录')).toBeInTheDocument()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
  })

  it('redirects to /admin when already logged in', async () => {
    getAdminSessionMock.mockReturnValue({ token: 'existing', user: { role: 'admin' } })
    renderLogin()

    await waitFor(() => {
      expect(screen.getByText('dashboard')).toBeInTheDocument()
    })
  })

  it('submits email+password and navigates to /admin on success', async () => {
    loginMock.mockResolvedValue({
      ok: true,
      session: { token: 'new-jwt', user: { role: 'admin' } },
    })
    renderLogin()

    await userEvent.type(screen.getByLabelText('邮箱'), 'admin@sub2api.local')
    await userEvent.type(screen.getByLabelText('密码'), '123456')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(loginMock).toHaveBeenCalledWith('admin@sub2api.local', '123456')
    // 成功后跳转 /admin
    await waitFor(() => {
      expect(screen.getByText('dashboard')).toBeInTheDocument()
    })
  })

  it('shows error message and stays on login page when credentials invalid', async () => {
    loginMock.mockResolvedValue({ ok: false, error: 'invalid-credentials' })
    renderLogin()

    await userEvent.type(screen.getByLabelText('邮箱'), 'a@b.com')
    await userEvent.type(screen.getByLabelText('密码'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByText('邮箱或密码错误。')).toBeInTheDocument()
    })
    // 仍在登录页
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
  })

  it('shows two-factor message on two-factor error', async () => {
    loginMock.mockResolvedValue({ ok: false, error: 'two-factor' })
    renderLogin()

    await userEvent.type(screen.getByLabelText('邮箱'), '2fa@e.com')
    await userEvent.type(screen.getByLabelText('密码'), 'pass')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByText('该账号已开启两步验证,暂不支持。')).toBeInTheDocument()
    })
  })

  it('disables submit button while submitting', async () => {
    // 永不 resolve, 保持 submitting 状态
    loginMock.mockReturnValue(new Promise(() => {}))
    renderLogin()

    await userEvent.type(screen.getByLabelText('邮箱'), 'a@b.com')
    await userEvent.type(screen.getByLabelText('密码'), 'pass')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '登录中...' })).toBeDisabled()
    })
  })
})
