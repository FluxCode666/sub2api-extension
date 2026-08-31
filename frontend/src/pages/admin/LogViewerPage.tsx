import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Activity, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Search, Terminal, UserRound } from 'lucide-react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'

export type LogViewerKind = 'system' | 'operation'

interface SystemLogItem {
  id: number
  level: string
  source: string
  message: string
  details?: string
  request_id?: string
  created_at: string
}

interface OperationLogItem {
  id: number
  user_id?: number
  username?: string
  action: string
  resource?: string
  resource_id?: string
  status: string
  details?: string
  ip_address?: string
  created_at: string
}

interface LogPageResponse<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

interface LogQuery {
  search: string
  level: string
  status: string
}

type Item = SystemLogItem | OperationLogItem

const PAGE_SIZE = 30

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function isSystem(item: Item): item is SystemLogItem { return 'level' in item }

export default function LogViewerPage({ kind }: { kind: LogViewerKind }) {
  const isSystemPage = kind === 'system'
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState('')
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState<LogQuery>({ search: '', level: '', status: '' })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const requestSequence = useRef(0)

  const load = useCallback(async (nextPage: number, refresh = false) => {
    const sequence = ++requestSequence.current
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(nextPage), page_size: String(PAGE_SIZE) })
      if (query.search) params.set('search', query.search)
      if (isSystemPage && query.level) params.set('level', query.level)
      if (!isSystemPage && query.status) params.set('status', query.status)
      const envelope = await apiClient.get<AuxEnvelope<LogPageResponse<Item>>>(`/admin/logs/${isSystemPage ? 'system' : 'operations'}?${params.toString()}`)
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '日志数据格式异常')
      if (sequence !== requestSequence.current) return
      setItems(envelope.data.items ?? [])
      setTotal(envelope.data.total ?? 0)
      setPage(envelope.data.page || nextPage)
    } catch (caught) {
      if (sequence !== requestSequence.current) return
      const message = caught instanceof Error ? caught.message : '日志加载失败'
      console.error('[LogViewerPage] load failed', { kind, page: nextPage, message })
      setError(message)
      setItems([])
      setTotal(0)
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [isSystemPage, kind, query])

  useEffect(() => { void load(1) }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const title = isSystemPage ? '系统日志' : '操作日志'
  const subtitle = isSystemPage ? '查看服务请求、运行状态和错误事件。' : '追踪管理员对页面、资源和配置执行的每一次变更。'
  const Icon = isSystemPage ? Terminal : UserRound

  const summary = useMemo(() => {
    if (isSystemPage) {
      const errors = items.filter((item) => isSystem(item) && item.level === 'ERROR').length
      return `${total.toLocaleString('zh-CN')} 条记录 · 当前页 ${errors} 条错误`
    }
    const failures = items.filter((item) => !isSystem(item) && item.status === 'failure').length
    return `${total.toLocaleString('zh-CN')} 条记录 · 当前页 ${failures} 条失败`
  }, [isSystemPage, items, total])

  const submitFilters = (event: FormEvent) => {
    event.preventDefault()
    const nextQuery = { search: search.trim(), level, status }
    if (nextQuery.search === query.search && nextQuery.level === query.level && nextQuery.status === query.status) {
      void load(1)
      return
    }
    setQuery(nextQuery)
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"><Icon className="h-4 w-4" />运维审计</p>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <button type="button" onClick={() => void load(page, true)} disabled={loading || refreshing} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50">
          <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />刷新
        </button>
      </header>

      <section className="rounded-2xl border bg-card shadow-sm">
        <form onSubmit={submitFilters} className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><input aria-label={isSystemPage ? '搜索系统日志' : '搜索操作日志'} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isSystemPage ? '搜索消息、详情…' : '搜索管理员、动作、资源…'} className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring" /></div>
          {isSystemPage ? <select aria-label="按日志级别筛选" value={level} onChange={(event) => setLevel(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">全部级别</option><option value="ERROR">错误</option><option value="WARN">警告</option><option value="INFO">信息</option><option value="DEBUG">调试</option></select> : <select aria-label="按操作结果筛选" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">全部结果</option><option value="success">成功</option><option value="failure">失败</option></select>}
          <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">筛选</button>
        </form>

        {error && <div className="m-4 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-medium">无法加载{title}</p><p className="mt-1 opacity-80">{error}</p></div></div>}
        {loading ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-muted-foreground"><Activity className="h-4 w-4 animate-pulse" />正在加载日志…</div> : items.length === 0 ? <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">当前筛选条件下没有日志记录。</div> : isSystemPage ? <SystemTable items={items.filter(isSystem)} /> : <OperationTable items={items.filter((item): item is OperationLogItem => !isSystem(item))} />}

        <footer className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground"><span>{summary}</span><div className="flex items-center gap-2"><button type="button" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => void load(page - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent disabled:pointer-events-none disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span>第 {page} / {pageCount} 页</span><button type="button" aria-label="下一页" disabled={page >= pageCount || loading} onClick={() => void load(page + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-accent disabled:pointer-events-none disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></footer>
      </section>
    </div>
  )
}

function SystemTable({ items }: { items: SystemLogItem[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><caption className="sr-only">系统日志列表</caption><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-3">时间</th><th className="px-4 py-3">级别</th><th className="px-4 py-3">来源</th><th className="px-4 py-3">消息</th><th className="px-4 py-3">请求 ID</th></tr></thead><tbody className="divide-y">{items.map((item) => <tr key={item.id} className="align-top hover:bg-muted/30"><td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDate(item.created_at)}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${item.level === 'ERROR' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : item.level === 'WARN' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}`}>{item.level}</span></td><td className="px-4 py-3 font-mono text-xs">{item.source}</td><td className="max-w-[520px] px-4 py-3"><p className="font-medium">{item.message}</p>{item.details && <p className="mt-1 truncate text-xs text-muted-foreground">{item.details}</p>}</td><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.request_id || '—'}</td></tr>)}</tbody></table></div>
}

function OperationTable({ items }: { items: OperationLogItem[] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm"><caption className="sr-only">操作日志列表</caption><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-3">时间</th><th className="px-4 py-3">管理员</th><th className="px-4 py-3">操作</th><th className="px-4 py-3">资源</th><th className="px-4 py-3">结果</th><th className="px-4 py-3">客户端 IP</th></tr></thead><tbody className="divide-y">{items.map((item) => <tr key={item.id} className="align-top hover:bg-muted/30"><td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDate(item.created_at)}</td><td className="px-4 py-3"><p className="font-medium">{item.username || '未知管理员'}</p>{item.user_id && <p className="mt-1 text-xs text-muted-foreground">#{item.user_id}</p>}</td><td className="px-4 py-3"><span className="font-medium">{item.action}</span>{item.details && <p className="mt-1 text-xs text-muted-foreground">{item.details}</p>}</td><td className="px-4 py-3 font-mono text-xs">{item.resource || '—'}{item.resource_id && <span className="text-muted-foreground"> / {item.resource_id}</span>}</td><td className="px-4 py-3">{item.status === 'success' ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" aria-hidden="true" />成功</span> : <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"><AlertCircle className="h-3 w-3" aria-hidden="true" />失败</span>}</td><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{item.ip_address || '—'}</td></tr>)}</tbody></table></div>
}
