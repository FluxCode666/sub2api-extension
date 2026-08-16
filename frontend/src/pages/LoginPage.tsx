/**
 * LoginPage —— 独立账号密码登录入口。
 *
 * 与 AdminGuard 的 iframe token 换取流程互补: 此页面供用户用 sub2api 管理员
 * 账号密码直接登录, 不依赖 sub2api iframe 注入 token。
 *
 * 流程:
 *   1. 已有有效附属会话 → 直接跳转 /admin/dashboard (避免重复登录)
 *   2. 提交 email+password → loginWithCredentials → aux 后端代理 sub2api 登录
 *   3. 成功 → saveSession(已在 loginWithCredentials 内完成) + 跳转 /admin/dashboard
 *   4. 失败 → 显示对应错误信息(凭据错误/非管理员/两步验证/不可达)
 *
 * 此路由在 AdminGuard 之外 (App.tsx PublicLayout 下), 不登记到 page-registry
 * (功能路由, 非内容页, 不污染埋点仪表盘)。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loginWithCredentials, getAdminSession, type LoginError } from '@/lib/admin-auth'

const ERROR_MESSAGES: Record<LoginError, string> = {
  'invalid-credentials': '邮箱或密码错误。',
  forbidden: '仅管理员可登录。',
  'two-factor': '该账号已开启两步验证,暂不支持。',
  unreachable: '无法连接服务,请稍后重试。',
  'bad-request': '请求格式错误。',
  unknown: '未知错误,请稍后重试。',
}

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<LoginError | null>(null)

  // 已登录用户访问 /login 直接跳转管理端
  useEffect(() => {
    if (getAdminSession()) {
      navigate('/admin/dashboard', { replace: true })
    }
  }, [navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    const result = await loginWithCredentials(email, password)

    if (result.ok && result.session) {
      navigate('/admin/dashboard', { replace: true })
      return
    }

    setError(result.error ?? 'unknown')
    setSubmitting(false)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          管理员登录
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          使用 sub2api 管理员账号登录附属系统管理端。
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              邮箱
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-600"
              placeholder="admin@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              密码
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:disabled:bg-gray-600"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              {ERROR_MESSAGES[error]}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            {submitting ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}
