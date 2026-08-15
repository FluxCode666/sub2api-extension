/**
 * 管理端路由守卫。
 *
 * 逻辑:
 *   1. 若已有附属管理员会话(getAdminSession) → 放行
 *   2. 若无会话但有 sub2api 嵌入 token → 触发 exchangeSession 换取
 *      - 成功 → 放行
 *      - 失败 → 显示拒绝信息(非管理员/无效/不可达)
 *   3. 无嵌入 token 且无会话 → 显示拒绝信息
 *
 * 换取过程中显示加载状态。
 */
import { useEffect, useState, type ReactNode } from 'react'
import {
  exchangeSession,
  getAdminSession,
  clearAdminSession,
  type SessionError,
} from '@/lib/admin-auth'

type GuardState =
  | { status: 'loading' }
  | { status: 'authenticated' }
  | { status: 'denied'; error: SessionError }

const DENIED_MESSAGES: Record<SessionError, string> = {
  'no-embedded-token': '缺少 sub2api 身份信息,请从 sub2api 管理后台进入。',
  forbidden: '当前账号非管理员,无权访问附属系统管理端。',
  unauthorized: 'sub2api 身份已失效,请重新从 sub2api 管理后台进入。',
  unreachable: '无法连接 sub2api 服务,请稍后重试。',
  'bad-request': '请求格式错误。',
  unknown: '未知错误,请稍后重试。',
}

export default function AdminGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GuardState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function check() {
      // 已有有效会话 → 放行
      const existing = getAdminSession()
      if (existing) {
        if (!cancelled) setState({ status: 'authenticated' })
        return
      }

      // 无会话 → 尝试用嵌入 token 换取
      const result = await exchangeSession()
      if (cancelled) return

      if (result.ok && result.session) {
        setState({ status: 'authenticated' })
      } else {
        setState({ status: 'denied', error: result.error ?? 'unknown' })
      }
    }

    check()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          正在验证管理员身份...
        </p>
      </div>
    )
  }

  if (state.status === 'denied') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-4 dark:bg-gray-900">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          访问被拒绝
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {DENIED_MESSAGES[state.error]}
        </p>
        <button
          type="button"
          onClick={() => {
            clearAdminSession()
            window.location.reload()
          }}
          className="mt-2 rounded bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
        >
          重试
        </button>
      </div>
    )
  }

  return <>{children}</>
}
