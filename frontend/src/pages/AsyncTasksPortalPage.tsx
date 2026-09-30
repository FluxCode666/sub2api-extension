import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { format, startOfDay, subDays } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { AlertTriangle, CalendarDays, Check, ChevronsUpDown, Clapperboard, Copy, ExternalLink, ImageIcon, Inbox, Info, Layers, Link2, ListChecks, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { toast } from 'sonner'
import ErrorState from '@/components/ErrorState'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Card } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  ASYNC_TASK_KIND_LABELS,
  ASYNC_TASK_KIND_OPTIONS,
  ASYNC_TASK_PAGE_SIZES,
  ASYNC_TASK_STATUS_LABELS,
  ASYNC_TASK_STATUS_OPTIONS,
  ASYNC_TASK_VIDEO_PROVIDER_LABELS,
  asyncTaskKey,
  batchProgress,
  buildAsyncTaskPageItems,
  describeAsyncTaskError,
  describeAsyncTaskRefreshError,
  fetchAsyncTasks,
  formatElapsed,
  formatRelativeTime,
  formatTaskCost,
  formatTaskTime,
  isActiveAsyncTask,
  refreshAsyncTask,
  shortTaskID,
  type AsyncTask,
  type AsyncTaskKind,
  type AsyncTaskKindFilter,
  type AsyncTaskPage,
  type AsyncTaskRefreshResult,
  type AsyncTaskStatus,
  type AsyncTaskStatusFilter,
} from '@/lib/async-tasks'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import { cn } from '@/lib/utils'

const PAGE_ID = 'async-tasks'
const DEFAULT_PAGE_SIZE = 20
const KEYWORD_DEBOUNCE_MS = 400
const MAX_THUMBNAILS = 3
/** 与后端数据库回看窗口一致；更早的视频/批量记录不会返回。 */
const ASYNC_TASK_LOOKBACK_DAYS = 30
/** 有生成中/等待结果的任务时静默轮询；只读 Sub2API 已有数据，不代用户查询上游（视频上游查询只由用户逐条手动触发）。 */
export const ASYNC_TASK_POLL_INTERVAL_MS = 15000

const kindIcons: Record<AsyncTaskKind, typeof ImageIcon> = { image: ImageIcon, video: Clapperboard, batch: Layers }

/** 进行中使用靛蓝主色，等待结果使用暖橙提示，终态收敛到绿/红/中性。 */
const statusTone: Record<AsyncTaskStatus, string> = {
  processing: 'border-primary/30 bg-primary/10 text-primary dark:border-primary/40',
  pending: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  completed: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-muted text-muted-foreground',
}

function AsyncTaskStatusBadge({ status }: { status: AsyncTaskStatus }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 whitespace-nowrap font-medium', statusTone[status])}>
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full bg-current', status === 'processing' && 'animate-pulse motion-reduce:animate-none', status === 'cancelled' && 'opacity-50')} />
      {ASYNC_TASK_STATUS_LABELS[status]}
    </Badge>
  )
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard is unavailable')
}

/** 手动查询的视频结果：签名地址直接打开，网关相对路径需携带创建任务的 API Key 下载，只提供复制。 */
function VideoResultLink({ refresh }: { refresh: AsyncTaskRefreshResult }) {
  if (refresh.video_url) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
            <a href={refresh.video_url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" onClick={() => trackFeatureClick(PAGE_ID, 'open-video')}>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              打开视频
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs break-words">上游视频地址可能有时效，过期后可重新查询</TooltipContent>
      </Tooltip>
    )
  }
  const path = refresh.video_content_path
  if (!path) return null
  const copyPath = async () => {
    trackFeatureClick(PAGE_ID, 'copy-video-path')
    try {
      await copyText(path)
      toast.success('下载路径已复制', { description: '请在 Sub2API API 地址后拼接该路径，并携带创建任务的 API Key 下载。' })
    } catch {
      toast.error('复制失败', { description: path })
    }
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void copyPath()}>
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          复制下载路径
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs break-words">视频由 Sub2API 网关代理，下载时需携带创建该任务的 API Key</TooltipContent>
    </Tooltip>
  )
}

function TaskResult({ task, refresh }: { task: AsyncTask; refresh?: AsyncTaskRefreshResult }) {
  if (task.kind === 'image') {
    const urls = task.image_urls ?? []
    const hidden = Math.max(0, (task.image_count ?? urls.length) - Math.min(urls.length, MAX_THUMBNAILS))
    if (urls.length === 0) return <span className="text-xs text-[var(--aux-page-muted)]">{task.status === 'failed' ? '无结果' : '—'}</span>
    return (
      <div className="flex items-center gap-1.5">
        {urls.slice(0, MAX_THUMBNAILS).map((url, index) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            aria-label={`打开第 ${index + 1} 张结果图`}
            onClick={() => trackFeatureClick(PAGE_ID, 'open-image')}
            className="group relative block h-9 w-9 shrink-0 overflow-hidden rounded-md border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover transition-transform group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100" />
          </a>
        ))}
        {hidden > 0 && <span className="text-xs tabular-nums text-[var(--aux-page-muted)]" title={`另有 ${hidden} 张未展示`}>+{hidden}</span>}
      </div>
    )
  }
  if (task.kind === 'batch') {
    const progress = batchProgress(task)
    if (progress.total === 0) return <span className="text-xs text-[var(--aux-page-muted)]">—</span>
    return (
      <div className="w-44 space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-[var(--aux-page-muted)]">
          <span>{progress.done} / {progress.total}</span>
          <span title={task.cancelled_count ? `另有 ${task.cancelled_count} 项已取消` : undefined}>
            <span className="text-emerald-700 dark:text-emerald-300">{task.success_count ?? 0} 成功</span>
            {' · '}
            <span className={cn((task.fail_count ?? 0) > 0 && 'text-destructive')}>{task.fail_count ?? 0} 失败</span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="批量任务进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${progress.percent}%` }} />
        </div>
      </div>
    )
  }
  const spec = [task.resolution, task.duration_seconds ? `${task.duration_seconds} 秒` : ''].filter(Boolean).join(' · ')
  const active = isActiveAsyncTask(task)
  const link = task.status === 'completed' && refresh ? <VideoResultLink refresh={refresh} /> : null
  return (
    <div className="space-y-1 text-xs text-[var(--aux-page-muted)]">
      {spec && <p className="tabular-nums">{spec}</p>}
      {active && <p>可点击状态旁按钮查询进度</p>}
      {link}
      {!spec && !active && !link && '—'}
    </div>
  )
}

interface TaskRowProps {
  task: AsyncTask
  refresh?: AsyncTaskRefreshResult
  refreshing: boolean
  onRefresh: (task: AsyncTask) => void
}

function TaskRow({ task, refresh, refreshing, onRefresh }: TaskRowProps) {
  const Icon = kindIcons[task.kind]
  const cost = formatTaskCost(task.cost, task.currency)
  const elapsed = formatElapsed(task.created_at, task.completed_at)
  const title = task.kind === 'batch' && task.task_name ? task.task_name : ASYNC_TASK_KIND_LABELS[task.kind]
  const provider = task.kind === 'video' ? ASYNC_TASK_VIDEO_PROVIDER_LABELS[task.provider ?? 'grok'] : ''
  const refreshHint = task.kind === 'video'
    ? '向 Sub2API 查询最新进度；若视频已生成，将按该任务计费一次（与调用端查询相同）'
    : '重新读取该任务最新状态'
  const errorText = task.status === 'failed' && task.error_message ? `${task.http_status ? `HTTP ${task.http_status}：` : ''}${task.error_message}` : ''

  const copyID = async () => {
    trackFeatureClick(PAGE_ID, 'copy-task-id')
    try {
      await copyText(task.id)
      toast.success('任务 ID 已复制')
    } catch {
      toast.error('复制失败', { description: '请手动选择任务 ID 复制。' })
    }
  }

  return (
    <TableRow data-task-id={task.id}>
      <TableCell className="py-2.5 pl-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-[var(--aux-page-accent)]">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="max-w-[220px] truncate font-medium" title={title}>{title}</p>
            <div className="flex items-center gap-0.5 text-xs text-[var(--aux-page-muted)]">
              <code className="truncate font-mono" title={task.id}>{shortTaskID(task.id)}</code>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="复制任务 ID" onClick={() => void copyID()}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>复制任务 ID</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-[var(--aux-page-muted)]">
        {ASYNC_TASK_KIND_LABELS[task.kind]}
        {provider && <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px] font-medium">{provider}</Badge>}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <AsyncTaskStatusBadge status={task.status} />
          {isActiveAsyncTask(task) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="查询任务进度" disabled={refreshing} onClick={() => onRefresh(task)}>
                  <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs break-words">{refreshing ? '正在查询…' : refreshHint}</TooltipContent>
            </Tooltip>
          )}
          {errorText && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" aria-label={`失败原因：${errorText}`}>
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs break-words">{errorText}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>
      <TableCell><span className="block max-w-[180px] truncate font-mono text-xs" title={task.model || undefined}>{task.model || '—'}</span></TableCell>
      <TableCell><span className="block max-w-[140px] truncate" title={task.api_key_name || undefined}>{task.api_key_name || (task.api_key_id ? `#${task.api_key_id}` : '—')}</span></TableCell>
      <TableCell className="whitespace-nowrap">
        <time dateTime={task.created_at} className="block tabular-nums">{formatTaskTime(task.created_at)}</time>
        <span className="text-xs text-[var(--aux-page-muted)]">{formatRelativeTime(task.created_at)}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap tabular-nums text-[var(--aux-page-muted)]">{elapsed || '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {cost ? (
          <span title={task.cost_estimated ? '预估费用，以实际扣费为准' : undefined}>
            {cost}
            {task.cost_estimated && <span className="ml-1 text-xs text-[var(--aux-page-muted)]">预估</span>}
          </span>
        ) : '—'}
      </TableCell>
      <TableCell className="pr-4"><TaskResult task={task} refresh={refresh} /></TableCell>
    </TableRow>
  )
}

/** 创建日期范围：单按钮 + 同一日历区间选择，桌面双月、窄屏单月，可清除。 */
function CreatedDateRangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const today = startOfDay(new Date())
  const earliest = subDays(today, ASYNC_TASK_LOOKBACK_DAYS)
  const selected = from ? { from: new Date(`${from}T00:00:00`), to: to ? new Date(`${to}T00:00:00`) : undefined } : undefined
  const label = from ? (to && to !== from ? `${from} — ${to}` : from) : '全部日期'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id="async-task-created-range" type="button" variant="outline" className={cn('h-9 w-full justify-start gap-2 px-3 text-left font-normal', !from && 'text-muted-foreground')}>
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="w-auto max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-24px)] overflow-y-auto p-0" aria-label="任务创建日期范围">
        <Calendar
          mode="range"
          selected={selected}
          defaultMonth={selected?.from ?? today}
          onSelect={range => onChange(range?.from ? format(range.from, 'yyyy-MM-dd') : '', range?.to ? format(range.to, 'yyyy-MM-dd') : '')}
          resetOnSelect
          numberOfMonths={isMobile ? 1 : 2}
          startMonth={earliest}
          endMonth={today}
          disabled={[{ before: earliest }, { after: today }]}
          locale={zhCN}
          labels={{ labelDayButton: date => format(date, 'yyyy-MM-dd') }}
          autoFocus
        />
        <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
          <span className="text-xs text-muted-foreground">可查询近 {ASYNC_TASK_LOOKBACK_DAYS} 天</span>
          <Button type="button" variant="ghost" size="sm" disabled={!from && !to} onClick={() => { onChange('', ''); setOpen(false) }}>清除日期范围</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** 模型下拉支持搜索；选项来自用户全部近期任务，当前值不在选项中时仍保留显示。 */
function ModelCombobox({ value, models, onChange }: { value: string; models: string[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const options = value && !models.includes(value) ? [value, ...models] : models
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id="async-task-model" type="button" variant="outline" role="combobox" aria-expanded={open} aria-label="模型" className="h-9 w-full justify-between gap-2 px-3 font-normal">
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || '全部模型'}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-60 p-0">
        <Command label="模型">
          <CommandInput placeholder="搜索模型…" aria-label="搜索模型" />
          <CommandList>
            <CommandEmpty>没有匹配的模型</CommandEmpty>
            <CommandGroup>
              {['', ...options].map(option => (
                <CommandItem
                  key={option || 'all'}
                  value={option || '全部模型'}
                  onSelect={() => { onChange(option); setOpen(false) }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === option ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                  <span className={cn('truncate', option && 'font-mono text-xs')}>{option || '全部模型'}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function FilterField({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor} className="text-xs font-normal text-[var(--aux-page-muted)]">{label}</Label>
      {children}
    </div>
  )
}

interface AsyncTaskFilters {
  kind: AsyncTaskKindFilter
  status: AsyncTaskStatusFilter
  model: string
  apiKeyID: string
  keyword: string
  createdFrom: string
  createdTo: string
}

const DEFAULT_FILTERS: AsyncTaskFilters = { kind: 'all', status: 'all', model: '', apiKeyID: 'all', keyword: '', createdFrom: '', createdTo: '' }

export default function AsyncTasksPortalPage() {
  const [filters, setFilters] = useState<AsyncTaskFilters>(DEFAULT_FILTERS)
  const [keywordDraft, setKeywordDraft] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [data, setData] = useState<AsyncTaskPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  /** 本次会话内的单条查询结果；网关失败/过期不会回写 Sub2API 列表，只能靠这里保留。 */
  const [refreshed, setRefreshed] = useState<Record<string, AsyncTaskRefreshResult>>({})
  const [refreshingKeys, setRefreshingKeys] = useState<Record<string, true>>({})
  const requestRef = useRef(0)
  const hasDataRef = useRef(false)

  /** mode=initial 用于首屏/筛选切换，manual 为手动刷新（通知结果），silent 为后台轮询（失败不打扰）。 */
  const load = useCallback(async (mode: 'initial' | 'manual' | 'silent') => {
    const requestID = ++requestRef.current
    if (mode !== 'silent') setLoading(true)
    try {
      const next = await fetchAsyncTasks({
        kind: filters.kind,
        status: filters.status,
        model: filters.model,
        apiKeyID: filters.apiKeyID === 'all' ? undefined : Number(filters.apiKeyID),
        keyword: filters.keyword,
        createdFrom: filters.createdFrom,
        createdTo: filters.createdTo,
        page,
        pageSize,
      })
      if (requestID !== requestRef.current) return
      setData(next)
      hasDataRef.current = true
      setLoadError('')
      if (mode === 'manual') toast.success('任务列表已刷新')
    } catch (caught) {
      if (requestID !== requestRef.current) return
      console.error('[AsyncTasksPortalPage] failed to load async tasks', caught)
      const message = describeAsyncTaskError(caught)
      // 已有列表时保留旧数据并以通知反馈；首屏失败才进入整页错误态。
      if (mode === 'initial' && !hasDataRef.current) setLoadError(message)
      else if (mode !== 'silent') toast.error(mode === 'manual' ? '刷新失败' : '任务读取失败', { description: message })
    } finally {
      if (requestID === requestRef.current) setLoading(false)
    }
  }, [filters, page, pageSize])

  useEffect(() => { void load('initial') }, [load])

  // 关键词输入防抖后再查询，避免每次按键都扫描任务来源。
  useEffect(() => {
    const keyword = keywordDraft.trim()
    if (keyword === filters.keyword) return undefined
    const timer = window.setTimeout(() => {
      setFilters(current => ({ ...current, keyword }))
      setPage(1)
      trackFeatureClick(PAGE_ID, 'search')
    }, KEYWORD_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [keywordDraft, filters.keyword])

  // 列表仍显示未结束时才用会话内查询结果覆盖；列表已进入终态则以 Sub2API 记录为准。
  const items = (data?.items ?? []).map(task => {
    const result = refreshed[asyncTaskKey(task)]
    return result && isActiveAsyncTask(task) ? { ...task, ...result.task } : task
  })
  const hasActive = items.some(isActiveAsyncTask)
  useEffect(() => {
    if (!hasActive) return undefined
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load('silent')
    }, ASYNC_TASK_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [hasActive, load])

  // 轮询后总数减少时把越界页码收回到最后一页。
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1
  useEffect(() => {
    if (data && data.total > 0 && page > totalPages) setPage(totalPages)
  }, [data, page, totalPages])

  const updateFilters = (patch: Partial<AsyncTaskFilters>, featureID: string) => {
    setFilters(current => ({ ...current, ...patch }))
    setPage(1)
    trackFeatureClick(PAGE_ID, featureID)
  }
  const filtersActive = filters.kind !== 'all' || filters.status !== 'all' || filters.model !== '' || filters.apiKeyID !== 'all' || filters.keyword !== '' || filters.createdFrom !== '' || keywordDraft.trim() !== ''
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS)
    setKeywordDraft('')
    setPage(1)
    trackFeatureClick(PAGE_ID, 'reset-filters')
  }
  const refresh = () => {
    trackFeatureClick(PAGE_ID, 'refresh')
    void load('manual')
  }
  const refreshTask = async (task: AsyncTask) => {
    const key = asyncTaskKey(task)
    if (refreshingKeys[key]) return
    trackFeatureClick(PAGE_ID, `refresh-task-${task.kind}`)
    setRefreshingKeys(current => ({ ...current, [key]: true }))
    try {
      const result = await refreshAsyncTask(task)
      setRefreshed(current => ({ ...current, [key]: result }))
      const next = result.task
      if (next.status === 'completed') {
        const hint = next.kind === 'video' ? (result.video_url ? '可在结果列打开视频。' : result.video_content_path ? '可在结果列复制下载路径。' : undefined) : undefined
        toast.success('任务已完成', hint ? { description: hint } : undefined)
      } else if (next.status === 'failed') {
        toast.warning('任务已失败', next.error_message ? { description: next.error_message } : undefined)
      } else if (next.status === 'cancelled') {
        toast.warning('任务已取消')
      } else {
        toast.info('任务仍在生成中', { description: result.upstream_checked ? '已向 Sub2API 查询，请稍后再试。' : '已读取最新状态，请稍后再试。' })
      }
      void load('silent')
    } catch (caught) {
      console.error('[AsyncTasksPortalPage] failed to refresh async task', task.kind, task.id, caught)
      toast.error('查询失败', { description: describeAsyncTaskRefreshError(caught) })
    } finally {
      setRefreshingKeys(current => {
        const { [key]: _done, ...rest } = current
        return rest
      })
    }
  }
  const changePage = (next: number) => {
    if (next < 1 || next > totalPages || next === page || loading) return
    setPage(next)
    trackFeatureClick(PAGE_ID, 'paginate')
  }

  if (loadError && !data) {
    return (
      <main className="min-h-screen bg-[var(--aux-page-bg)] px-4 py-8 text-[var(--aux-page-ink)] sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-3xl flex-col items-start gap-4">
          <ErrorState title="无法读取异步任务" description={loadError} />
          <Button type="button" onClick={() => void load('initial')} disabled={loading}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            重新读取
          </Button>
        </div>
        <Toaster position="top-right" />
      </main>
    )
  }

  const summary = data?.summary
  const total = data?.total ?? 0
  const currentPage = Math.min(page, totalPages)
  const firstItem = total === 0 ? 0 : (currentPage - 1) * (data?.page_size ?? pageSize) + 1
  const lastItem = Math.min(firstItem + items.length - 1, total)
  const degradedSources = (data?.sources ?? []).filter(source => !source.available)
  const truncated = (data?.sources ?? []).some(source => source.available && source.truncated)
  const initialLoading = loading && !data
  const models = data?.filter_options?.models ?? []
  const apiKeys = data?.filter_options?.api_keys ?? []
  const kindCount = (option: AsyncTaskKindFilter) => (option === 'all' ? summary?.total : summary?.[option])
  const statusCount = (option: AsyncTaskStatusFilter) => (option === 'all' ? undefined : summary?.[option])

  return (
    <TooltipProvider>
      <main className="flex min-h-screen flex-col bg-[var(--aux-page-bg)] px-4 py-8 text-[var(--aux-page-ink)] sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6">
          <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--aux-page-line)] pb-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--aux-page-accent)]">生成记录</p>
              <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight">
                <ListChecks className="h-7 w-7 text-[var(--aux-page-accent)]" aria-hidden="true" />
                异步任务
              </h1>
              <p className="mt-2 text-sm text-[var(--aux-page-muted)]">查看近期异步生图、视频生成和批量生图任务的进度与结果，进行中的任务会自动刷新；未结束的任务可逐条手动查询进度。</p>
            </div>
            {summary && (
              <dl className="flex gap-5 text-sm" aria-label="当前筛选统计">
                <div><dt className="text-xs text-[var(--aux-page-muted)]">进行中</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums">{summary.processing + summary.pending}</dd></div>
                <div><dt className="text-xs text-[var(--aux-page-muted)]">已完成</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums">{summary.completed}</dd></div>
                <div><dt className="text-xs text-[var(--aux-page-muted)]">失败</dt><dd className="mt-0.5 text-xl font-semibold tabular-nums">{summary.failed}</dd></div>
              </dl>
            )}
          </header>

          {degradedSources.length > 0 && (
            <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100 [&>svg]:text-amber-700 dark:[&>svg]:text-amber-300">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                部分任务来源暂不可用，列表可能不完整：
                {degradedSources.map(source => `${ASYNC_TASK_KIND_LABELS[source.kind]}${source.message ? `（${source.message}）` : ''}`).join('；')}
              </AlertDescription>
            </Alert>
          )}
          {truncated && (
            <Alert>
              <AlertDescription>任务较多，本次只读取到部分近期记录；如未找到目标任务，请缩小日期范围或稍后刷新。</AlertDescription>
            </Alert>
          )}

          <Card className="flex min-w-0 flex-col overflow-hidden">
            <form
              role="search"
              aria-label="筛选异步任务"
              className="grid grid-cols-1 gap-3 border-b bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_repeat(4,minmax(0,1fr))]"
              onSubmit={event => {
                event.preventDefault()
                const keyword = keywordDraft.trim()
                if (keyword !== filters.keyword) updateFilters({ keyword }, 'search')
              }}
            >
              <FilterField label="任务 ID / 名称" htmlFor="async-task-keyword">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input id="async-task-keyword" type="search" value={keywordDraft} maxLength={128} placeholder="输入任务 ID 或批量任务名" className="pl-8" onChange={event => setKeywordDraft(event.target.value)} />
                </div>
              </FilterField>
              <FilterField label="创建日期" htmlFor="async-task-created-range">
                <CreatedDateRangePicker from={filters.createdFrom} to={filters.createdTo} onChange={(createdFrom, createdTo) => updateFilters({ createdFrom, createdTo }, 'filter-date')} />
              </FilterField>
              <FilterField label="任务类型">
                <Select value={filters.kind} onValueChange={value => updateFilters({ kind: value as AsyncTaskKindFilter }, `filter-kind-${value}`)}>
                  <SelectTrigger className="h-9" aria-label="任务类型"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASYNC_TASK_KIND_OPTIONS.map(option => (
                      <SelectItem key={option} value={option}>
                        {option === 'all' ? '全部类型' : ASYNC_TASK_KIND_LABELS[option]}
                        {kindCount(option) !== undefined && <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{kindCount(option)}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="任务状态">
                <Select value={filters.status} onValueChange={value => updateFilters({ status: value as AsyncTaskStatusFilter }, `filter-status-${value}`)}>
                  <SelectTrigger className="h-9" aria-label="任务状态"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASYNC_TASK_STATUS_OPTIONS.map(option => (
                      <SelectItem key={option} value={option}>
                        {option === 'all' ? '全部状态' : ASYNC_TASK_STATUS_LABELS[option]}
                        {statusCount(option) !== undefined && <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{statusCount(option)}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="模型" htmlFor="async-task-model">
                <ModelCombobox value={filters.model} models={models} onChange={model => updateFilters({ model }, 'filter-model')} />
              </FilterField>
              <FilterField label="API Key">
                <Select value={filters.apiKeyID} onValueChange={apiKeyID => updateFilters({ apiKeyID }, 'filter-api-key')}>
                  <SelectTrigger className="h-9" aria-label="API Key"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部 Key</SelectItem>
                    {filters.apiKeyID !== 'all' && !apiKeys.some(key => String(key.id) === filters.apiKeyID) && <SelectItem value={filters.apiKeyID}>#{filters.apiKeyID}</SelectItem>}
                    {apiKeys.map(key => <SelectItem key={key.id} value={String(key.id)}>{key.name || `#${key.id}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </FilterField>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <p className="text-xs text-[var(--aux-page-muted)]" role="status">
                {data ? `共 ${total} 条任务${filtersActive ? '（已筛选）' : ''}` : '正在读取任务…'}
              </p>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-8" disabled={!filtersActive} onClick={resetFilters}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  重置筛选
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="刷新任务" onClick={refresh} disabled={loading} className="h-8 w-8">
                      <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>刷新任务列表</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {initialLoading ? (
              <div role="status" aria-label="正在加载异步任务" className="space-y-3 p-4">
                {[0, 1, 2, 3, 4].map(index => (
                  <div key={index} className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                <p className="text-sm font-medium">{filtersActive ? '没有符合筛选条件的任务' : '近期没有异步任务'}</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {filtersActive ? '可以放宽日期范围或清除部分条件后再查看。' : '通过 API 提交异步生图、视频生成或批量生图后，任务会显示在这里。异步生图记录保留 24 小时。'}
                </p>
                {filtersActive && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={resetFilters}>重置筛选</Button>}
              </div>
            ) : (
              <Table aria-label="异步任务列表" aria-busy={loading} className={cn('min-w-[1040px] transition-opacity motion-reduce:transition-none', loading && 'opacity-60')}>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">任务</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>模型</TableHead>
                    <TableHead>API Key</TableHead>
                    <TableHead>创建时间</TableHead>
                    <TableHead>耗时</TableHead>
                    <TableHead className="text-right">费用</TableHead>
                    <TableHead className="pr-4">结果 / 进度</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map(task => {
                    const key = asyncTaskKey(task)
                    return <TaskRow key={key} task={task} refresh={refreshed[key]} refreshing={Boolean(refreshingKeys[key])} onRefresh={task => void refreshTask(task)} />
                  })}
                </TableBody>
              </Table>
            )}

            {data && total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-2.5 text-xs text-[var(--aux-page-muted)]">
                <span className="tabular-nums">显示 {firstItem}–{lastItem} 条，共 {total} 条</span>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span>每页</span>
                    <Select value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1); trackFeatureClick(PAGE_ID, 'page-size') }}>
                      <SelectTrigger className="h-8 w-[88px]" aria-label="每页条数"><SelectValue /></SelectTrigger>
                      <SelectContent>{ASYNC_TASK_PAGE_SIZES.map(size => <SelectItem key={size} value={String(size)}>{size} 条</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Pagination aria-label="异步任务分页" className="mx-0 w-auto">
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          href="#"
                          aria-disabled={currentPage <= 1 || loading}
                          className={cn('h-8', (currentPage <= 1 || loading) && 'pointer-events-none opacity-50')}
                          onClick={event => { event.preventDefault(); changePage(currentPage - 1) }}
                        />
                      </PaginationItem>
                      {buildAsyncTaskPageItems(currentPage, totalPages).map((item, index) => item === 'ellipsis' ? (
                        <PaginationItem key={`ellipsis-${index}`} className="hidden sm:block"><PaginationEllipsis className="h-8 w-8" /></PaginationItem>
                      ) : (
                        <PaginationItem key={item} className={cn(item !== currentPage && 'hidden sm:block')}>
                          <PaginationLink
                            href="#"
                            isActive={item === currentPage}
                            aria-label={`第 ${item} 页`}
                            className="h-8 w-8 tabular-nums"
                            onClick={event => { event.preventDefault(); changePage(item) }}
                          >
                            {item}
                          </PaginationLink>
                        </PaginationItem>
                      ))}
                      <PaginationItem>
                        <PaginationNext
                          href="#"
                          aria-disabled={currentPage >= totalPages || loading}
                          className={cn('h-8', (currentPage >= totalPages || loading) && 'pointer-events-none opacity-50')}
                          onClick={event => { event.preventDefault(); changePage(currentPage + 1) }}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                </div>
              </div>
            )}
          </Card>

          {data?.generated_at && (
            <p className="flex items-center gap-1.5 text-xs text-[var(--aux-page-muted)]">
              <Info className="h-3 w-3" aria-hidden="true" />
              数据更新于 {formatTaskTime(data.generated_at)}；异步生图记录保留 24 小时。视频任务不会自动推进，可点击状态旁的查询按钮向 Sub2API 获取进度，视频地址仅在本次查询中展示、不会保存。
            </p>
          )}
        </div>
      </main>
      <Toaster position="top-right" />
    </TooltipProvider>
  )
}
