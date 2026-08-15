/**
 * SampleDynamicPage —— 示例动态页。
 *
 * 经附属后端 proxy (Admin API Key 模式) 读 sub2api dashboard stats,
 * 展示统计卡片。对应 sub2api custom_menu_items 路径, 需管理员会话 (U3)。
 *
 * Covers KTD5: 双数据源最小调用面 —— 验证能读到 sub2api 数据。
 * Covers KTD6: 此页走 custom_menu_items (传 token), 非 home_content 裸 iframe。
 *
 * 降级策略: 非管理员/无会话/proxy 失败 → 优雅降级显示提示, 不崩。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import ErrorState from '@/components/ErrorState'

/** sub2api dashboard stats (镜像后端 DashboardStatsResponse)。 */
interface DashboardStats {
  total_users: number
  today_new_users: number
  active_users: number
  total_api_keys: number
  active_api_keys: number
  total_accounts: number
  normal_accounts: number
  error_accounts: number
  total_requests: number
  total_tokens: number
  total_cost: number
  today_requests: number
  today_tokens: number
  today_cost: number
  uptime: number
  rpm: number
  tpm: number
  stats_updated_at: string
  stats_stale: boolean
}

/** 仪表盘统计快照(经附属后端 proxy 读取 sub2api)。 */
type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; stats: DashboardStats }
  | { status: 'error'; message: string }

export default function SampleDynamicPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  // 请求序号: 每次发起新请求递增, .then 回调中校验序号是否仍为最新,
  // 丢弃过期响应(旧请求晚返回时不覆盖新数据,解决刷新竞态 #16)。
  const reqIdRef = useRef(0)

  const loadStats = useCallback(() => {
    const myReqId = ++reqIdRef.current
    setState({ status: 'loading' })

    apiClient
      .get<AuxEnvelope<DashboardStats>>('/admin/sub2api/dashboard-stats')
      .then((envelope) => {
        // 仅当此请求仍为最新时才 setState; 旧请求(被刷新取代)的响应丢弃
        if (myReqId !== reqIdRef.current) return
        if (envelope.code !== 0 || !envelope.data) {
          setState({ status: 'error', message: envelope.message || '数据格式异常' })
          return
        }
        setState({ status: 'ok', stats: envelope.data })
      })
      .catch((err: unknown) => {
        if (myReqId !== reqIdRef.current) return
        // 降级: 不崩, 显示提示。涵盖无会话(401)/proxy 失败(502/503)/网络错误。
        const msg = err instanceof Error ? err.message : '未知错误'
        setState({ status: 'error', message: msg })
      })
  }, [])

  useEffect(() => {
    loadStats()
    // 组件卸载时使所有在途请求过期(下次 setState 前校验 reqId 失效)
    return () => {
      reqIdRef.current++
    }
  }, [loadStats])

  /**
   * 刷新按钮: 重新加载 sub2api 数据 + 手动埋点功能点击(R9)。
   * trackFeatureClick 上报失败不阻塞(SDK 内部 fire-and-forget)。
   */
  const handleRefresh = () => {
    trackFeatureClick('sample-dynamic', 'refresh-btn')
    loadStats()
  }

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          示例动态页
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">加载 sub2api 数据中…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    // 优雅降级: 非管理员/无会话/proxy 失败均走此分支, 不崩。
    return (
      <ErrorState
        title="示例动态页"
        description="无法读取 sub2api 数据。可能原因: 未登录或非管理员、sub2api 暂时不可达。"
        detail={state.message}
      />
    )
  }

  const s = state.stats
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            示例动态页
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            来自 sub2api 的实时系统统计 (经 Admin API Key 读取)。
          </p>
        </div>
        {/* 刷新按钮: 点击触发 trackFeatureClick('sample-dynamic', 'refresh-btn') 验证 R9 手动埋点链路 */}
        <button
          type="button"
          onClick={handleRefresh}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          刷新数据
        </button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="总用户数" value={s.total_users} hint={`今日新增 ${s.today_new_users}`} />
        <StatCard label="活跃用户" value={s.active_users} />
        <StatCard label="API Key 总数" value={s.total_api_keys} hint={`活跃 ${s.active_api_keys}`} />
        <StatCard label="账号总数" value={s.total_accounts} hint={`异常 ${s.error_accounts}`} />
        <StatCard label="总请求数" value={s.total_requests} hint={`今日 ${s.today_requests}`} />
        <StatCard label="总 Token" value={s.total_tokens} hint={`今日 ${s.today_tokens}`} />
        <StatCard label="总成本" value={s.total_cost} hint={`今日 ${s.today_cost}`} format="cost" />
        <StatCard label="RPM" value={s.rpm} hint={`TPM ${s.tpm}`} />
      </section>

      {s.stats_stale && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          注: 统计数据可能非最新 (stats_stale)。更新于 {s.stats_updated_at || '未知'}。
        </p>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  format,
}: {
  label: string
  value: number
  hint?: string
  format?: 'cost'
}) {
  const display = format === 'cost' ? value.toFixed(2) : value.toLocaleString()
  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">{display}</p>
      {hint && <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">{hint}</p>}
    </div>
  )
}
