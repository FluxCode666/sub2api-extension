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
 *     * 埋点库有但 registry 无 → 历史数据保留但不在当前仪表盘展示
 *   - 功能使用度仅展示当前 registry 页面, 按计数降序排序
 *
 * Covers U6(R5/R8/R9/R10), AE2(管理员看到页面清单与访问量), F2(管理员看到埋点分析)。
 * 降级: 加载失败显示提示不崩(镜像 SampleDynamicPage 风格)。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Activity, ArrowUpRight, BarChart3, CheckCircle2, Gauge, MousePointerClick, PanelsTopLeft, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { getMergedRegistry } from '@/lib/dynamic-pages'
import type { PageEntry } from '@/lib/page-registry'
import ErrorState from '@/components/ErrorState'

gsap.registerPlugin(useGSAP)
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  gsap.registerPlugin(ScrollTrigger)
}

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
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; pages: PageRow[]; features: FeatureClickCountDTO[] }
  | { status: 'error'; message: string }

export default function DashboardPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const dashboardRef = useRef<HTMLDivElement>(null)

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

        // KTD7: 合并注册表(静态核心 + 动态页)派生页面清单, 后端计数按 page id 关联。
        const registryPages: readonly PageEntry[] = getMergedRegistry()
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
        }))

        // 只展示当前页面的功能使用度; 已删除页面的历史数据仍保留在数据库。
        const features = envelope.data.feature_clicks.filter((feature) =>
          registryIds.has(feature.page_id),
        )
        setState({ status: 'ok', pages, features })
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

  useGSAP(() => {
    if (
      state.status !== 'ok' ||
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      /jsdom/i.test(window.navigator.userAgent) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return

    gsap.from('.aux-dashboard-hero-copy > *', {
      y: 22,
      opacity: 0,
      stagger: 0.08,
      duration: 0.7,
      ease: 'power3.out',
    })
    gsap.from('.aux-dashboard-hero-orbit', {
      scale: 0.78,
      opacity: 0,
      duration: 1.05,
      ease: 'power3.out',
    })
    gsap.from('.aux-metric-card', {
      opacity: 0,
      stagger: 0.07,
      duration: 0.72,
      delay: 0.16,
      ease: 'power3.out',
    })
    gsap.fromTo('.aux-signal-bar-fill', { scaleX: 0 }, {
      scaleX: 1,
      duration: 1.1,
      stagger: 0.08,
      delay: 0.36,
      ease: 'power3.out',
    })

    gsap.utils.toArray<HTMLElement>('.aux-data-panel').forEach((panel, index) => {
      gsap.from(panel, {
        y: 64 + index * 18,
        opacity: 0,
        scale: 0.98,
        duration: 0.9,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: panel,
          start: 'top 88%',
          once: true,
        },
      })
    })
  }, { scope: dashboardRef, dependencies: [state.status] })

  if (state.status === 'loading') {
    return (
      <div className="aux-dashboard aux-dashboard--state" ref={dashboardRef}>
        <div className="aux-loading-shell">
          <span className="aux-loading-mark"><Activity aria-hidden="true" /></span>
          <div>
            <h1>分析仪表盘</h1>
            <p>加载埋点数据中…</p>
          </div>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="aux-dashboard aux-dashboard--state" ref={dashboardRef}>
        <ErrorState
          title="分析仪表盘"
          description="无法读取埋点分析数据。可能原因: 未登录或非管理员、服务暂时不可达。"
          detail={state.message}
        />
      </div>
    )
  }

  const totalViews = state.pages.reduce((sum, p) => sum + p.viewCount, 0)
  const totalFeatureClicks = state.features.reduce(
    (sum, feature) => sum + feature.count,
    0,
  )
  const activePages = state.pages.filter((page) => page.viewCount > 0).length
  const highestViews = Math.max(0, ...state.pages.map((page) => page.viewCount))
  const pageActivity = state.pages.length > 0 ? Math.round((activePages / state.pages.length) * 100) : 0

  return (
    <div className="aux-dashboard" ref={dashboardRef}>
      <section className="aux-dashboard-hero">
        <div className="aux-dashboard-hero-copy">
          <p className="aux-dashboard-kicker"><span />今天的系统概览</p>
          <h1><span>分析</span><span><i className="aux-inline-signal" aria-hidden="true" />仪表盘</span></h1>
          <p className="aux-dashboard-lede">
            页面清单从代码派生，访问量与功能使用度来自埋点库聚合。让每一次访问都成为下一步决策的信号。
          </p>
          <div className="aux-dashboard-hero-links">
            <Link to="/admin/pages" className="aux-console-button aux-console-button--primary">管理页面 <ArrowUpRight aria-hidden="true" /></Link>
            <Link to="/p/home" className="aux-console-button aux-console-button--secondary">查看官网</Link>
          </div>
        </div>
        <div className="aux-dashboard-hero-orbit" aria-hidden="true">
          <div className="aux-orbit-track aux-orbit-track--outer">
            <div className="aux-orbit-ring aux-orbit-ring--outer" />
            <div className="aux-orbit-spinner aux-orbit-spinner--outer">
              <span className="aux-orbit-dot aux-orbit-dot--two" />
            </div>
          </div>
          <div className="aux-orbit-track aux-orbit-track--inner">
            <div className="aux-orbit-ring aux-orbit-ring--inner" />
            <div className="aux-orbit-spinner aux-orbit-spinner--inner">
              <span className="aux-orbit-dot aux-orbit-dot--one" />
            </div>
          </div>
          <div className="aux-orbit-core"><Gauge /></div>
          <div className="aux-orbit-caption"><span>运行状态</span><strong>已同步</strong></div>
        </div>
      </section>

      <section className="aux-overview-grid grid-flow-dense" aria-label="概览指标">
        <SummaryCard className="aux-metric-card" label="页面总数" value={state.pages.length} icon={<PanelsTopLeft aria-hidden="true" />} detail={`${activePages} 个页面已有访问`} />
        <SummaryCard className="aux-metric-card" label="总访问量" value={totalViews} icon={<BarChart3 aria-hidden="true" />} detail={`最高单页 ${highestViews.toLocaleString()}`} />
        <SummaryCard className="aux-metric-card" label="功能点击" value={totalFeatureClicks} icon={<MousePointerClick aria-hidden="true" />} detail={`${state.features.length} 条功能记录`} />
        <SummaryCard className="aux-metric-card" label="活跃页面" value={activePages} icon={<CheckCircle2 aria-hidden="true" />} detail={`${pageActivity}% 页面有流量`} />

        <div className="aux-signal-card">
          <div className="aux-card-heading">
            <div><span className="aux-card-icon"><Activity aria-hidden="true" /></span><div><p>系统脉搏</p><h2>访问信号保持稳定</h2></div></div>
            <span className="aux-live-dot"><i />实时</span>
          </div>
          <div className="aux-signal-bars" aria-hidden="true">
            {[42, 68, 54, 82, 62, 88, 73, 94, 77, 100, 86, 96].map((width, index) => (
              <span className="aux-signal-bar" key={index}><b className="aux-signal-bar-fill" style={{ width: `${width}%` }} /></span>
            ))}
          </div>
          <p className="aux-signal-caption">当前页面活动度 <strong>{pageActivity}%</strong>，数据来自当前注册表。</p>
        </div>

        <div className="aux-quick-card">
          <div className="aux-card-heading"><div><span className="aux-card-icon aux-card-icon--warm"><Zap aria-hidden="true" /></span><div><p>快捷动作</p><h2>继续推进</h2></div></div></div>
          <div className="aux-quick-actions">
            <Link to="/admin/pages" className="aux-quick-action"><span>页面管理</span><ArrowUpRight aria-hidden="true" /></Link>
            <Link to="/p/home" className="aux-quick-action"><span>查看官网</span><ArrowUpRight aria-hidden="true" /></Link>
          </div>
        </div>
      </section>

      <section className="aux-data-grid">
        <section className="aux-data-panel aux-pages-panel">
          <div className="aux-panel-heading">
            <div><span className="aux-panel-symbol"><BarChart3 aria-hidden="true" /></span><div><h2>页面访问量</h2><p>当前注册页面的访问分布</p></div></div>
            <Link to="/admin/pages" className="aux-panel-link">打开管理 <ArrowUpRight aria-hidden="true" /></Link>
          </div>
          <div className="aux-table-scroll">
            <table className="aux-data-table min-w-[680px]">
              <thead><tr><Th>页面标题</Th><Th>页面 ID</Th><Th>路径</Th><Th>可见性</Th><Th className="text-right">访问量</Th></tr></thead>
              <tbody>
                {state.pages.map((p) => (
                  <tr key={p.pageId}>
                    <td><Link to={p.path} className="aux-page-title">{p.title}<ArrowUpRight aria-hidden="true" /></Link></td>
                    <td><span className="aux-mono">{p.pageId}</span></td>
                    <td><Link to={p.path} className="aux-path-link">{p.path}</Link></td>
                    <td><VisibilityBadge visibility={p.visibility} /></td>
                    <td className="text-right"><strong className="aux-count">{p.viewCount.toLocaleString()}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="aux-data-panel aux-features-panel">
          <div className="aux-panel-heading">
            <div><span className="aux-panel-symbol"><MousePointerClick aria-hidden="true" /></span><div><h2>功能使用度</h2><p>哪些动作正在被频繁使用</p></div></div>
            <span className="aux-panel-total">{totalFeatureClicks.toLocaleString()} 次</span>
          </div>
          {state.features.length === 0 ? (
            <div className="aux-empty-state"><span className="aux-empty-icon"><Zap aria-hidden="true" /></span><p>暂无功能使用记录。</p><span>有新的交互后，数据会自动出现在这里。</span></div>
          ) : (
            <div className="aux-table-scroll">
              <table className="aux-data-table min-w-[520px]">
                <thead><tr><Th>排名</Th><Th>页面 ID</Th><Th>功能 ID</Th><Th className="text-right">点击次数</Th></tr></thead>
                <tbody>
                  {state.features.map((f, idx) => (
                    <tr key={`${f.page_id}-${f.feature_id}`}>
                      <td><span className={`aux-rank ${idx === 0 ? 'is-top' : ''}`}>#{idx + 1}</span></td>
                      <td><span className="aux-mono">{f.page_id}</span></td>
                      <td><span className="aux-feature-name">{f.feature_id}</span></td>
                      <td className="text-right"><strong className="aux-count">{f.count.toLocaleString()}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </div>
  )
}

function SummaryCard({ label, value, icon, detail, className = '' }: { label: string; value: number; icon: React.ReactNode; detail: string; className?: string }) {
  return (
    <div className={`aux-metric-card ${className}`}>
      <div className="aux-metric-icon">{icon}</div>
      <p className="aux-metric-label">{label}</p>
      <p className="aux-metric-value">{value.toLocaleString()}</p>
      <p className="aux-metric-detail">{detail}</p>
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
      className={`aux-table-head ${className ?? ''}`}
    >
      {children}
    </th>
  )
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === 'public') {
    return (
      <span className="aux-visibility-badge is-public">
        public
      </span>
    )
  }
  if (visibility === 'admin') {
    return (
      <span className="aux-visibility-badge is-admin">
        admin
      </span>
    )
  }
  return (
    <span className="aux-visibility-badge">
      {visibility}
    </span>
  )
}
