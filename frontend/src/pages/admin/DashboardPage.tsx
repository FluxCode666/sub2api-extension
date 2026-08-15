/**
 * DashboardPage —— U6 管理端分析仪表盘首页。
 *
 * 从埋点库聚合呈现: 当前有哪些页面、各页面访问量、各功能使用度。
 *
 * 关键设计(KTD7: page-registry 与埋点按 page id 关联):
 *   - 页面清单从 page-registry 派生(R5: 非独立注册表)
 *   - 访问量/功能使用度计数来自后端埋点聚合(R8/R9)
 *   - 两者按 page id 关联:
 *     * registry 有但埋点库无 → 零访问, 显示 0
 *     * 埋点库有但 registry 无 → 孤儿, 标注"未知页面"
 *   - 功能使用度按计数降序排序(R9/R10: 哪些功能用得更多)
 *
 * Covers U6(R5/R8/R9/R10), AE2(管理员看到页面清单与访问量), F2(管理员看到埋点分析)。
 * 降级: 加载失败显示提示不崩(镜像 SampleDynamicPage 风格)。
 */
import { useCallback, useEffect, useState } from 'react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { getPages, type PageEntry } from '@/lib/page-registry'
import ErrorState from '@/components/ErrorState'

/** 后端 analytics overview 响应(镜像后端 OverviewResponse)。 */
interface PageViewCountDTO {
  page_id: string
  count: number
}

interface FeatureClickCountDTO {
  page_id: string
  feature_id: string
  count: number
}

interface OverviewResponse {
  page_views: PageViewCountDTO[]
  feature_clicks: FeatureClickCountDTO[]
}

/** 仪表盘行(页面清单 + 访问量, 从 registry 派生并关联后端计数)。 */
interface PageRow {
  pageId: string
  title: string
  path: string
  visibility: string
  viewCount: number
  isOrphan: boolean
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; pages: PageRow[]; features: FeatureClickCountDTO[] }
  | { status: 'error'; message: string }

export default function DashboardPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const loadOverview = useCallback(() => {
    let cancelled = false
    setState({ status: 'loading' })

    apiClient
      .get<AuxEnvelope<OverviewResponse>>('/admin/analytics/overview')
      .then((envelope) => {
        if (cancelled) return
        if (envelope.code !== 0 || !envelope.data) {
          setState({ status: 'error', message: envelope.message || '数据格式异常' })
          return
        }

        // KTD7: registry 派生页面清单, 后端计数按 page id 关联。
        const registryPages: readonly PageEntry[] = getPages()
        const viewCounts = new Map<string, number>()
        for (const pv of envelope.data.page_views) {
          viewCounts.set(pv.page_id, pv.count)
        }

        // 从 registry 派生行: 零访问页显示 0。
        const registryIds = new Set(registryPages.map((p) => p.id))
        const pages: PageRow[] = registryPages.map((p) => ({
          pageId: p.id,
          title: p.title,
          path: p.path,
          visibility: p.visibility,
          viewCount: viewCounts.get(p.id) ?? 0,
          isOrphan: false,
        }))

        // 孤儿页: 后端返回但 registry 无的 page id, 标注"未知页面"。
        for (const pv of envelope.data.page_views) {
          if (!registryIds.has(pv.page_id)) {
            pages.push({
              pageId: pv.page_id,
              title: '未知页面',
              path: '(孤儿)',
              visibility: 'unknown',
              viewCount: pv.count,
              isOrphan: true,
            })
          }
        }

        // 功能使用度已由后端按计数降序排序, 直接使用。
        setState({ status: 'ok', pages, features: envelope.data.feature_clicks })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : '未知错误'
        setState({ status: 'error', message: msg })
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const cleanup = loadOverview()
    return cleanup
  }, [loadOverview])

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          分析仪表盘
        </h1>
        <p className="text-sm text-gray-600 dark:text-gray-400">加载埋点数据中…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <ErrorState
        title="分析仪表盘"
        description="无法读取埋点分析数据。可能原因: 未登录或非管理员、服务暂时不可达。"
        detail={state.message}
      />
    )
  }

  const totalViews = state.pages.reduce((sum, p) => sum + p.viewCount, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          分析仪表盘
        </h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          页面清单从代码派生, 访问量与功能使用度来自埋点库聚合。
        </p>
      </div>

      {/* 概览统计 */}
      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="页面总数" value={state.pages.length} />
        <SummaryCard label="总访问量" value={totalViews} />
        <SummaryCard
          label="孤儿页面"
          value={state.pages.filter((p) => p.isOrphan).length}
        />
      </section>

      {/* 页面清单 + 访问量 (R5/R8/R10) */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
          页面访问量
        </h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <Th>页面标题</Th>
                <Th>页面 ID</Th>
                <Th>路径</Th>
                <Th>可见性</Th>
                <Th className="text-right">访问量</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {state.pages.map((p) => (
                <tr
                  key={p.pageId}
                  className={p.isOrphan ? 'bg-amber-50 dark:bg-amber-900/20' : ''}
                >
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                    {p.title}
                    {p.isOrphan && (
                      <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200">
                        孤儿
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                    {p.pageId}
                  </td>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                    {p.path}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    <VisibilityBadge visibility={p.visibility} />
                  </td>
                  <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {p.viewCount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {state.pages.some((p) => p.isOrphan) && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
            注: 标注"孤儿"的页面有埋点记录但不在当前 page-registry 中(可能已删除)。
          </p>
        )}
      </section>

      {/* 功能使用度 (R9/R10: 哪些功能用得更多, 按计数降序) */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-gray-100">
          功能使用度
        </h2>
        {state.features.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            暂无功能使用记录。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <Th>排名</Th>
                  <Th>页面 ID</Th>
                  <Th>功能 ID</Th>
                  <Th className="text-right">点击次数</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                {state.features.map((f, idx) => (
                  <tr key={`${f.page_id}-${f.feature_id}`}>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      #{idx + 1}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                      {f.page_id}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                      {f.feature_id}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {f.count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
        {value.toLocaleString()}
      </p>
    </div>
  )
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <th
      className={`px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400 ${className ?? ''}`}
    >
      {children}
    </th>
  )
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === 'public') {
    return (
      <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
        public
      </span>
    )
  }
  if (visibility === 'admin') {
    return (
      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
        admin
      </span>
    )
  }
  return (
    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-800 dark:bg-gray-700 dark:text-gray-200">
      {visibility}
    </span>
  )
}
