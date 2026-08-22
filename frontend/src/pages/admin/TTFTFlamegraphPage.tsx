import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Database,
  Flame,
  RefreshCw,
  Search,
  SlidersHorizontal,
  TimerReset,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TTFTDateTimeRangePicker } from '@/components/TTFTDateTimeRangePicker'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'

gsap.registerPlugin(useGSAP)
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  gsap.registerPlugin(ScrollTrigger)
}

interface TTFTFilterOption {
  id: number
  name: string
  platform?: string
  status?: string
}

interface TTFTSegment {
  band: string
  min_ms: number
  max_ms?: number
  band_order: number
  count: number
}

type TTFTGranularity = 'minute' | 'hour' | 'day'

const granularityOptions: Array<{ value: TTFTGranularity; label: string }> = [
  { value: 'minute', label: '分钟' },
  { value: 'hour', label: '小时' },
  { value: 'day', label: '天' },
]

interface TTFTBucket {
  index: number
  start_time: string
  end_time: string
  sample_count: number
  p50_ms?: number
  p95_ms?: number
  p99_ms?: number
  avg_ms?: number
  max_ms?: number
  segments: TTFTSegment[]
}

interface TTFTResponse {
  start_time: string
  end_time: string
  granularity: TTFTGranularity
  total_samples: number
  p50_ms?: number
  p95_ms?: number
  p99_ms?: number
  avg_ms?: number
  max_ms?: number
  groups: TTFTFilterOption[]
  accounts: TTFTFilterOption[]
  buckets: TTFTBucket[]
}

interface TTFTPercentiles {
  p50: number
  p95: number
  p99: number
}

interface TTFTFilters {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  groupId: string
  accountId: string
  granularity: TTFTGranularity
}

type ViewState =
  | { status: 'loading'; data?: TTFTResponse }
  | { status: 'ready'; data: TTFTResponse }
  | { status: 'error'; message: string; data?: TTFTResponse }

function localDateValue(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toQueryISOString(date: string, clock: string, end = false): string {
  // An end-time input represents the whole selected minute, so include its
  // final second when building the exclusive database boundary.
  const suffix = end ? ':59.999' : ':00.000'
  return new Date(`${date}T${clock}${suffix}`).toISOString()
}

function formatMs(value?: number | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—'
  if (value >= 1000) {
    return `${(value / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} s`
  }
  return `${Math.round(value).toLocaleString('zh-CN')} ms`
}

function segmentRepresentativeMs(segment: TTFTSegment): number {
  if (segment.max_ms !== undefined) return Math.round((segment.min_ms + segment.max_ms) / 2)
  // The open-ended 4 s+ band has no upper boundary. Keep the fallback
  // conservative; real percentile values are used whenever the API returns
  // them.
  return Math.max(segment.min_ms, 4500)
}

function deriveBucketPercentiles(bucket: TTFTBucket): TTFTPercentiles | undefined {
  const segments = (bucket.segments ?? [])
    .filter((segment) => segment.count > 0)
    .sort((left, right) => left.band_order - right.band_order)
  if (segments.length === 0 && bucket.sample_count <= 0) return undefined

  const fallback = bucket.avg_ms ?? bucket.max_ms ?? 0
  if (segments.length === 0) {
    return { p50: fallback, p95: bucket.max_ms ?? fallback, p99: bucket.max_ms ?? fallback }
  }

  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  const percentile = (ratio: number) => {
    const target = Math.max(1, Math.ceil(total * ratio))
    let cumulative = 0
    for (const segment of segments) {
      cumulative += segment.count
      if (cumulative >= target) return segmentRepresentativeMs(segment)
    }
    return segmentRepresentativeMs(segments[segments.length - 1])
  }

  const p50 = bucket.p50_ms ?? percentile(0.5)
  const p95 = bucket.p95_ms ?? percentile(0.95)
  const p99 = bucket.p99_ms ?? percentile(0.99)
  return { p50, p95: Math.max(p50, p95), p99: Math.max(p95, p99) }
}

function bucketSampleCount(bucket: TTFTBucket): number {
  if (bucket.sample_count > 0) return bucket.sample_count
  return (bucket.segments ?? []).reduce((sum, segment) => sum + Math.max(0, segment.count), 0)
}

function isTTFTGranularity(value: unknown): value is TTFTGranularity {
  return value === 'minute' || value === 'hour' || value === 'day'
}

function normalizeTTFTResponse(response: TTFTResponse): TTFTResponse {
  const buckets = (response.buckets ?? []).map((bucket) => ({
    ...bucket,
    sample_count: bucketSampleCount(bucket),
    segments: bucket.segments ?? [],
  }))
  const totalSamples = response.total_samples > 0
    ? response.total_samples
    : buckets.reduce((sum, bucket) => sum + bucket.sample_count, 0)
  return {
    ...response,
    granularity: isTTFTGranularity(response.granularity) ? response.granularity : 'hour',
    total_samples: totalSamples,
    groups: response.groups ?? [],
    accounts: response.accounts ?? [],
    buckets,
  }
}

function formatChartLabel(value: string, granularity: TTFTGranularity, includeDate: boolean): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知时段'
  if (granularity === 'day') {
    return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
  }
  return new Intl.DateTimeFormat('zh-CN', includeDate
    ? { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', hour12: false },
  ).format(date)
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function optionLabel(option: TTFTFilterOption): string {
  const platform = option.platform ? ` · ${option.platform}` : ''
  return `${option.name}${platform}`
}

function searchableOptionText(option: TTFTFilterOption): string {
  return `${optionLabel(option)} ${option.id} ${option.status ?? ''}`.toLocaleLowerCase('zh-CN')
}

function queryParams(filters: TTFTFilters): string {
  const params = new URLSearchParams({
    start: toQueryISOString(filters.startDate, filters.startTime),
    end: toQueryISOString(filters.endDate, filters.endTime, true),
  })
  params.set('granularity', filters.granularity)
  if (filters.groupId) params.set('group_id', filters.groupId)
  if (filters.accountId) params.set('account_id', filters.accountId)
  return params.toString()
}

export default function TTFTFlamegraphPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<TTFTFilters>(() => {
    const today = localDateValue()
    return {
      startDate: today,
      startTime: '00:00',
      endDate: today,
      endTime: '23:59',
      groupId: '',
      accountId: '',
      granularity: 'hour',
    }
  })
  const [activeFilters, setActiveFilters] = useState<TTFTFilters>(draft)
  const [view, setView] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [selectedBucketIndex, setSelectedBucketIndex] = useState<number | null>(null)
  const [noteIndex, setNoteIndex] = useState(0)

  const loadData = useCallback(async (filters: TTFTFilters, isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setView((current) => ({ status: 'loading', data: current.status === 'error' ? current.data : undefined }))
    try {
      const response = await apiClient.get<AuxEnvelope<TTFTResponse>>(`/admin/ops/ttft?${queryParams(filters)}`)
      if (response.code !== 0 || !response.data) {
        throw new Error(response.message || '数据格式异常')
      }
      const data = normalizeTTFTResponse(response.data)
      setView({ status: 'ready', data })
      setSelectedBucketIndex(null)
    } catch (error) {
      const message = error instanceof Error ? error.message : '首字延迟数据加载失败'
      setView((current) => ({ status: 'error', message, data: current.status === 'ready' ? current.data : undefined }))
    } finally {
      if (isRefresh) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadData(activeFilters)
  }, [activeFilters, loadData])

  useGSAP(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function' ||
      /jsdom/i.test(window.navigator.userAgent) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return

    gsap.from('.aux-ttft-hero-copy > *', {
      y: 22,
      stagger: 0.07,
      duration: 0.7,
      ease: 'power3.out',
    })
    gsap.from('.aux-ttft-filter-panel', {
      y: 28,
      duration: 0.8,
      delay: 0.12,
      ease: 'power3.out',
    })
    gsap.from('.aux-ttft-area-layer', {
      opacity: 0,
      duration: 0.7,
      ease: 'power3.out',
      stagger: 0.08,
      scrollTrigger: {
        trigger: '.aux-ttft-flame-panel',
        start: 'top 82%',
        once: true,
      },
    })
    gsap.utils.toArray<HTMLElement>('.aux-ttft-reveal-word').forEach((word, index) => {
      gsap.fromTo(word, { opacity: 0.12 }, {
        opacity: 1,
        duration: 0.7,
        delay: index * 0.06,
        scrollTrigger: {
          trigger: word,
          start: 'top 88%',
          end: 'top 58%',
          scrub: true,
        },
      })
    })
  }, { scope: pageRef, dependencies: [view.status, view.status === 'ready' ? view.data.buckets.length : 0] })

  const data = view.status === 'ready' ? view.data : view.data
  const groups = data?.groups ?? []
  const accounts = data?.accounts ?? []
  const buckets = data?.buckets ?? []
  const isLoading = view.status === 'loading'
  const hasSamples = (data?.total_samples ?? 0) > 0
  // Render the chart from the granularity confirmed by the backend. This
  // keeps labels, summaries and exports aligned with the actual bucket data.
  const chartGranularity = data?.granularity ?? activeFilters.granularity

  const notes = useMemo(() => {
    if (!data || data.total_samples === 0) {
      return ['当前筛选范围还没有首字样本，调整日期或筛选条件后再看。']
    }
    const p95 = data.p95_ms === undefined ? '暂无' : formatMs(data.p95_ms)
    const max = data.max_ms === undefined ? '暂无' : formatMs(data.max_ms)
    return [
      `P95 位于 ${p95}，可优先观察面积图中的尾部峰值。`,
      `当前共有 ${data.total_samples.toLocaleString('zh-CN')} 条首字样本参与分布。`,
      `筛选窗口内最长首字延迟为 ${max}。`,
    ]
  }, [data])

  const applyFilters = () => {
    const start = new Date(`${draft.startDate}T${draft.startTime}`)
    const end = new Date(`${draft.endDate}T${draft.endTime}`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      setView({ status: 'error', message: '开始日期和时间必须早于结束日期和时间' })
      return
    }
    setActiveFilters(draft)
  }

  const resetFilters = () => {
    const today = localDateValue()
    const next: TTFTFilters = {
      startDate: today,
      startTime: '00:00',
      endDate: today,
      endTime: '23:59',
      groupId: '',
      accountId: '',
      granularity: 'hour',
    }
    setDraft(next)
    setActiveFilters(next)
  }

  const changeGranularity = (granularity: TTFTGranularity) => {
    setDraft((current) => ({ ...current, granularity }))
    setActiveFilters((current) => ({ ...current, granularity }))
  }

  const exportCsv = () => {
    if (!data) return
    const lines = [['粒度', '时段开始', '时段结束', '延迟区间', '请求数']]
    for (const bucket of data.buckets) {
      for (const segment of bucket.segments) {
        lines.push([chartGranularity, bucket.start_time, bucket.end_time, segment.band, String(segment.count)])
      }
    }
    const csv = `\uFEFF${lines.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n')}`
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ttft-${activeFilters.startDate}-${activeFilters.endDate}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="aux-ttft-page overflow-x-hidden w-full max-w-full" ref={pageRef}>
      <section className="aux-ttft-hero">
        <div className="aux-ttft-hero-copy">
          <p className="aux-ttft-kicker"><span />运维看板 · 首字响应</p>
          <h1 className="max-w-6xl w-full">让每一枚首字的等待，都有迹可循</h1>
          <p className="aux-ttft-lede">
            从 Sub2API PostgreSQL 的 <code>usage_logs.first_token_ms</code> 读取真实请求，按时间窗口和延迟区间铺开成一张可筛选的火焰图。
          </p>
          <div className="aux-ttft-hero-note">
            <Database aria-hidden="true" />
            <span>只读数据库查询 · 不经过 Sub2API HTTP API</span>
          </div>
        </div>
        <div className="aux-ttft-hero-art aux-dashboard-hero-orbit" aria-hidden="true">
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
          <div className="aux-orbit-core"><Flame /></div>
        </div>
      </section>

      <section className="aux-ttft-filter-panel" aria-label="首字延迟筛选条件">
        <div className="aux-ttft-filter-heading">
          <div>
            <span className="aux-ttft-icon"><SlidersHorizontal aria-hidden="true" /></span>
            <div><p>查看范围</p><h2>把问题缩到一个时间窗口</h2><small>开始与结束日期、时间按本地时间提交，分组和账号支持关键字搜索。</small></div>
          </div>
          <Button type="button" variant="ghost" className="aux-ttft-link-button" onClick={resetFilters}>恢复今天</Button>
        </div>
        <div className="aux-ttft-filter-grid">
          <TTFTDateTimeRangePicker
            value={draft}
            onChange={(value) => setDraft({ ...draft, ...value })}
          />
          <SearchableSelect
            label="Sub2API 分组"
            placeholder="全部分组"
            searchPlaceholder="搜索分组名称、平台或 ID"
            value={draft.groupId}
            options={groups}
            onChange={(value) => setDraft({ ...draft, groupId: value })}
          />
          <SearchableSelect
            label="号池账号"
            placeholder="全部账号"
            searchPlaceholder="搜索账号名称、平台或 ID"
            value={draft.accountId}
            options={accounts}
            onChange={(value) => setDraft({ ...draft, accountId: value })}
          />
          <div className="aux-ttft-filter-actions">
            <Button type="button" variant="ghost" className="aux-ttft-button aux-ttft-button--primary" onClick={applyFilters} disabled={isLoading}>查看火焰图 <Zap aria-hidden="true" /></Button>
            <Button type="button" variant="ghost" className="aux-ttft-button aux-ttft-button--quiet" onClick={() => void loadData(activeFilters, true)} disabled={isLoading || refreshing}><RefreshCw className={refreshing ? 'is-spinning' : ''} aria-hidden="true" />刷新</Button>
          </div>
        </div>
        <div className="aux-ttft-filter-footnote"><TimerReset aria-hidden="true" />当前查询：{formatDateTime(data?.start_time ?? toQueryISOString(activeFilters.startDate, activeFilters.startTime))} — {formatDateTime(data?.end_time ?? toQueryISOString(activeFilters.endDate, activeFilters.endTime, true))}</div>
      </section>

      {view.status === 'error' && <div className="aux-ttft-error" role="alert"><Activity aria-hidden="true" /><span>{view.message || '首字延迟数据暂不可用，请检查 Sub2API 数据库连接。'}</span></div>}

      <section className="aux-ttft-overview grid-flow-dense" aria-label="首字延迟概览">
        <MetricCard label="首字样本" value={data?.total_samples?.toLocaleString('zh-CN') ?? '—'} detail="符合当前时间与筛选条件" icon={<Flame aria-hidden="true" />} />
        <MetricCard label="P50" value={formatMs(data?.p50_ms)} detail="一半请求在此之前首字到达" icon={<Activity aria-hidden="true" />} tone="cool" />
        <MetricCard label="P95" value={formatMs(data?.p95_ms)} detail="尾部体验的主要观察点" icon={<TimerReset aria-hidden="true" />} tone="warm" />
        <MetricCard label="P99" value={formatMs(data?.p99_ms)} detail="极端长尾的边界" icon={<Zap aria-hidden="true" />} tone="hot" />
      </section>

      <section className="aux-ttft-flame-panel">
        <div className="aux-ttft-panel-heading">
          <div><span className="aux-ttft-icon aux-ttft-icon--flame"><Flame aria-hidden="true" /></span><div><p>时间 × 延迟走势</p><h2>首字延迟峰谷面积图</h2></div></div>
          <div className="aux-ttft-panel-heading-actions">
            <div className="aux-ttft-granularity" role="group" aria-label="火焰图时间粒度">
              <span>时间粒度</span>
              <div className="aux-ttft-granularity-segmented">
                {granularityOptions.map((option) => (
                  <button
                    type="button"
                    key={option.value}
                    className={activeFilters.granularity === option.value ? 'is-active' : ''}
                    aria-pressed={activeFilters.granularity === option.value}
                    onClick={() => changeGranularity(option.value)}
                    disabled={isLoading}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <Button type="button" variant="ghost" className="aux-ttft-button aux-ttft-button--quiet" onClick={exportCsv} disabled={!data || !hasSamples}><ArrowDownToLine aria-hidden="true" />导出 CSV</Button>
          </div>
        </div>
        <div className="aux-ttft-chart-intro"><span className="aux-ttft-reveal-word">横轴为请求时间，纵轴为首字耗时。</span><span className="aux-ttft-reveal-word">当前按{granularityOptions.find((option) => option.value === chartGranularity)?.label}聚合，面积的峰谷展示每个时段的 P50、P95 与 P99 延迟走势。</span></div>
        <div className="aux-ttft-chart" aria-label="首字延迟按时段分布">
          {isLoading && !data ? <div className="aux-ttft-chart-empty"><RefreshCw className="is-spinning" aria-hidden="true" /><span>正在读取 Sub2API usage_logs…</span></div> : !hasSamples ? <div className="aux-ttft-chart-empty"><Flame aria-hidden="true" /><span>当前范围没有可展示的首字样本</span></div> : <TTFTAreaChart buckets={buckets} granularity={chartGranularity} selectedBucketIndex={selectedBucketIndex} onSelect={setSelectedBucketIndex} />}
        </div>
        <div className="aux-ttft-legend aux-ttft-area-legend" aria-label="延迟百分位说明">
          <div className="aux-ttft-area-legend-item tone-cool"><span className="aux-ttft-band-swatch" /><span>P50 中位延迟</span></div>
          <div className="aux-ttft-area-legend-item tone-amber"><span className="aux-ttft-band-swatch" /><span>P95 尾部区域</span></div>
          <div className="aux-ttft-area-legend-item tone-hot"><span className="aux-ttft-band-swatch" /><span>P99 极端峰值</span></div>
        </div>
      </section>

      <section className="aux-ttft-bottom-grid grid-flow-dense">
        <div className="aux-ttft-notes-card">
          <div className="aux-ttft-panel-heading aux-ttft-panel-heading--compact"><div><span className="aux-ttft-icon"><Activity aria-hidden="true" /></span><div><p>运营提示</p><h2>下一步看哪里</h2></div></div><div className="aux-ttft-carousel-actions"><button type="button" aria-label="上一条提示" onClick={() => setNoteIndex((noteIndex - 1 + notes.length) % notes.length)}><ChevronLeft /></button><button type="button" aria-label="下一条提示" onClick={() => setNoteIndex((noteIndex + 1) % notes.length)}><ChevronRight /></button></div></div>
          <p className="aux-ttft-note-copy">{notes[noteIndex]}</p>
          <div className="aux-ttft-note-dots">{notes.map((note, index) => <button type="button" key={note} aria-label={`查看第 ${index + 1} 条提示`} className={index === noteIndex ? 'is-active' : ''} onClick={() => setNoteIndex(index)} />)}</div>
        </div>
        <div className="aux-ttft-selected-card">
          <SelectedBucketSummary buckets={buckets} granularity={chartGranularity} selectedBucketIndex={selectedBucketIndex} />
          <span className="aux-ttft-selected-line" />
        </div>
      </section>

      <footer className="aux-ttft-footer"><span>首字延迟看板</span><span>数据源：Sub2API PostgreSQL / usage_logs</span></footer>
    </main>
  )
}

function MetricCard({ label, value, detail, icon, tone = 'violet' }: { label: string; value: string; detail: string; icon: React.ReactNode; tone?: string }) {
  return <div className={`aux-ttft-metric tone-${tone}`}><span className="aux-ttft-metric-icon">{icon}</span><p>{label}</p><strong>{value}</strong><small>{detail}</small></div>
}

function SearchableSelect({
  label,
  placeholder,
  searchPlaceholder,
  value,
  options,
  onChange,
}: {
  label: string
  placeholder: string
  searchPlaceholder: string
  value: string
  options: TTFTFilterOption[]
  onChange: (value: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const selected = options.find((option) => String(option.id) === value)
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('zh-CN')
    if (!query) return options
    return options.filter((option) => searchableOptionText(option).includes(query))
  }, [options, search])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    searchRef.current?.focus()
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(filteredOptions.length - 1, 0)))
  }, [filteredOptions.length])

  const choose = (nextValue: string) => {
    onChange(nextValue)
    setSearch('')
    setOpen(false)
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && filteredOptions[activeIndex]) {
      event.preventDefault()
      choose(String(filteredOptions[activeIndex].id))
    }
  }

  return (
    <div className="aux-ttft-search-select" ref={rootRef}>
      <span className="aux-ttft-search-select-label">{label}</span>
      <button
        type="button"
        className={`aux-ttft-search-select-trigger ${open ? 'is-open' : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className={selected ? '' : 'is-placeholder'}>{selected ? optionLabel(selected) : placeholder}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className="aux-ttft-search-select-popover">
          <div className="aux-ttft-search-select-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              value={search}
              placeholder={searchPlaceholder}
              aria-label={`${label}搜索`}
              onChange={(event) => {
                setSearch(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div className="aux-ttft-search-select-options" role="listbox" aria-label={`${label}选项`}>
            <button type="button" role="option" aria-selected={!value} className={`aux-ttft-search-select-option ${!value ? 'is-selected' : ''}`} onClick={() => choose('')}>
              <span>{placeholder}</span>
              {!value && <Check aria-hidden="true" />}
            </button>
            {filteredOptions.length === 0 ? (
              <p className="aux-ttft-search-select-empty">没有匹配的选项</p>
            ) : filteredOptions.map((option, index) => {
              const optionValue = String(option.id)
              const isSelected = optionValue === value
              return (
                <button
                  type="button"
                  role="option"
                  id={`${label}-${optionValue}`}
                  aria-selected={isSelected}
                  className={`aux-ttft-search-select-option ${isSelected ? 'is-selected' : ''} ${index === activeIndex ? 'is-active' : ''}`}
                  key={optionValue}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(optionValue)}
                >
                  <span><strong>{option.name}</strong><small>{option.platform || '未标注平台'} · ID {option.id}</small></span>
                  {isSelected && <Check aria-hidden="true" />}
                </button>
              )
            })}
          </div>
          <div className="aux-ttft-search-select-count">{filteredOptions.length} / {options.length} 个选项</div>
        </div>
      )}
    </div>
  )
}

function TTFTAreaChart({ buckets, granularity, selectedBucketIndex, onSelect }: { buckets: TTFTBucket[]; granularity: TTFTGranularity; selectedBucketIndex: number | null; onSelect: (index: number | null) => void }) {
  const width = 1080
  const height = 370
  const plot = { left: 76, right: 28, top: 22, bottom: 62 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = height - plot.top - plot.bottom
  const percentileValues = buckets.map(deriveBucketPercentiles)
  const chartValues = percentileValues.map((values) => values ?? { p50: 0, p95: 0, p99: 0 })
  const maxLatency = Math.max(1000, ...chartValues.flatMap((values) => [values.p50, values.p95, values.p99]))
  const maxY = Math.ceil(maxLatency / 500) * 500
  const x = (index: number) => plot.left + (buckets.length <= 1 ? plotWidth / 2 : index / (buckets.length - 1)) * plotWidth
  const y = (value: number) => plot.top + plotHeight - (Math.max(0, value) / maxY) * plotHeight
  const points = (key: keyof TTFTPercentiles) => chartValues.map((values, index) => `${x(index)},${y(values[key])}`).join(' ')
  const area = (upper: keyof TTFTPercentiles, lower?: keyof TTFTPercentiles) => {
    const top = chartValues.map((values, index) => `${x(index)},${y(values[upper])}`).join(' ')
    const bottom = [...chartValues].reverse().map((values, index) => `${x(buckets.length - 1 - index)},${y(lower ? values[lower] : 0)}`).join(' ')
    return `${top} ${bottom}`
  }
  const includeDate = new Set(buckets.map((bucket) => new Date(bucket.start_time).toLocaleDateString('zh-CN'))).size > 1
  const labelStep = Math.max(1, Math.ceil(buckets.length / 12))
  const yTicks = 5
  const selected = selectedBucketIndex === null ? undefined : buckets.find((bucket) => bucket.index === selectedBucketIndex)
  const selectedIndex = selected ? buckets.findIndex((bucket) => bucket.index === selected.index) : -1
  const selectedValues = selectedIndex >= 0 ? chartValues[selectedIndex] : undefined
  const hitLeft = (index: number) => index === 0 ? plot.left : (x(index - 1) + x(index)) / 2
  const hitRight = (index: number) => index === buckets.length - 1 ? width - plot.right : (x(index) + x(index + 1)) / 2
  const tooltipLeft = selectedIndex < 0 ? 50 : Math.min(85, Math.max(15, (x(selectedIndex) / width) * 100))
  const tooltipTop = selectedIndex < 0 ? 20 : (y(selectedValues?.p95 ?? 0) / height) * 100
  const tooltipBelow = selectedIndex >= 0 && y(selectedValues?.p95 ?? 0) < 112

  return (
    <div className="aux-ttft-area-chart-wrap">
      <div className="aux-ttft-area-chart-stage">
        <svg className="aux-ttft-area-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="首字延迟时间序列面积图" onMouseLeave={() => onSelect(null)}>
          {Array.from({ length: yTicks + 1 }, (_, index) => {
            const value = (maxY / yTicks) * index
            const yy = y(value)
            return <g key={value}><line x1={plot.left} x2={width - plot.right} y1={yy} y2={yy} className="aux-ttft-area-gridline" /><text x={plot.left - 12} y={yy + 4} textAnchor="end" className="aux-ttft-area-axis-label">{formatMs(value)}</text></g>
          })}
          <polygon className="aux-ttft-area-layer aux-ttft-area-p50" points={area('p50')} />
          <polygon className="aux-ttft-area-layer aux-ttft-area-p95" points={area('p95', 'p50')} />
          <polygon className="aux-ttft-area-layer aux-ttft-area-p99" points={area('p99', 'p95')} />
          <polyline className="aux-ttft-area-line aux-ttft-area-line-p50" points={points('p50')} />
          <polyline className="aux-ttft-area-line aux-ttft-area-line-p95" points={points('p95')} />
          <polyline className="aux-ttft-area-line aux-ttft-area-line-p99" points={points('p99')} />
          {buckets.map((bucket, index) => {
            const isSelected = bucket.index === selectedBucketIndex
            const values = chartValues[index]
            const label = `${formatChartLabel(bucket.start_time, granularity, includeDate)}，P50 ${formatMs(values.p50)}，P95 ${formatMs(values.p95)}，P99 ${formatMs(values.p99)}，${bucketSampleCount(bucket).toLocaleString('zh-CN')} 条请求`
            return <g key={bucket.index}><line x1={x(index)} x2={x(index)} y1={plot.top} y2={plot.top + plotHeight} className={`aux-ttft-area-focus-line ${isSelected ? 'is-selected' : ''}`} /><rect x={hitLeft(index)} y={plot.top} width={hitRight(index) - hitLeft(index)} height={plotHeight} className="aux-ttft-area-hit" role="img" tabIndex={0} aria-label={label} onMouseEnter={() => onSelect(bucket.index)} onMouseLeave={() => onSelect(null)} onFocus={() => onSelect(bucket.index)} onBlur={() => onSelect(null)} /><text x={x(index)} y={height - 26} textAnchor="middle" className={`aux-ttft-area-x-label ${index % labelStep === 0 || index === buckets.length - 1 ? '' : 'is-hidden'}`}>{formatChartLabel(bucket.start_time, granularity, includeDate)}</text></g>
          })}
          <text x={18} y={plot.top + plotHeight / 2} textAnchor="middle" className="aux-ttft-area-axis-title" transform={`rotate(-90 18 ${plot.top + plotHeight / 2})`}>首字耗时</text>
          <text x={plot.left + plotWidth / 2} y={height - 5} textAnchor="middle" className="aux-ttft-area-axis-title">请求时间</text>
        </svg>
        {selected && selectedValues && (
          <div
            className={`aux-ttft-area-tooltip ${tooltipBelow ? 'is-below' : ''}`}
            style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }}
            role="tooltip"
          >
            <div className="aux-ttft-area-tooltip-heading">
              <span>时间桶</span>
              <strong>{formatChartLabel(selected.start_time, granularity, includeDate)} - {formatChartLabel(selected.end_time, granularity, includeDate)}</strong>
            </div>
            <div className="aux-ttft-area-tooltip-grid">
              <span><small>请求数</small><strong>{bucketSampleCount(selected).toLocaleString('zh-CN')}</strong></span>
              <span className="tone-cool"><small>P50</small><strong>{formatMs(selectedValues.p50)}</strong></span>
              <span className="tone-amber"><small>P95</small><strong>{formatMs(selectedValues.p95)}</strong></span>
              <span className="tone-hot"><small>P99</small><strong>{formatMs(selectedValues.p99)}</strong></span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SelectedBucketSummary({ buckets, granularity, selectedBucketIndex }: { buckets: TTFTBucket[]; granularity: TTFTGranularity; selectedBucketIndex: number | null }) {
  const bucket = selectedBucketIndex === null ? undefined : buckets.find((item) => item.index === selectedBucketIndex)
  const title = bucket ? formatChartLabel(bucket.start_time, granularity, true) : '悬停面积图峰谷'
  const detail = bucket
    ? (() => { const values = deriveBucketPercentiles(bucket); return `${bucketSampleCount(bucket).toLocaleString('zh-CN')} 条请求 · P50 ${formatMs(values?.p50)} · P95 ${formatMs(values?.p95)} · P99 ${formatMs(values?.p99)}` })()
    : '将鼠标移到面积图的时间桶上，查看该时段的 P50、P95、P99 和请求量。'
  return <div className="aux-ttft-panel-heading aux-ttft-panel-heading--compact"><div><span className="aux-ttft-icon aux-ttft-icon--warm"><TimerReset aria-hidden="true" /></span><div><p>当前焦点</p><h2>{title}</h2><p className="aux-ttft-selected-detail">{detail}</p></div></div></div>
}
