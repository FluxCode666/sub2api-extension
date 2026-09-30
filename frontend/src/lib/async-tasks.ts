import { apiClient, AuxApiError, type AuxEnvelope } from '@/lib/api-client'

export type AsyncTaskKind = 'image' | 'video' | 'batch'
export type AsyncTaskStatus = 'processing' | 'pending' | 'completed' | 'failed' | 'cancelled'
export type AsyncTaskKindFilter = 'all' | AsyncTaskKind
export type AsyncTaskStatusFilter = 'all' | AsyncTaskStatus
export type AsyncTaskVideoProvider = 'grok' | 'seedance'

export interface AsyncTask {
  id: string
  kind: AsyncTaskKind
  /** 仅视频任务：Grok 或 Seedance。 */
  provider?: AsyncTaskVideoProvider
  status: AsyncTaskStatus
  raw_status: string
  model?: string
  api_key_id?: number
  api_key_name?: string
  created_at: string
  completed_at?: string
  expires_at?: string
  image_urls?: string[]
  image_count?: number
  error_message?: string
  http_status?: number
  resolution?: string
  duration_seconds?: number
  task_name?: string
  item_count?: number
  success_count?: number
  fail_count?: number
  cancelled_count?: number
  cost?: number
  cost_estimated?: boolean
  currency?: string
}

export interface AsyncTaskSummary {
  total: number
  image: number
  video: number
  batch: number
  processing: number
  pending: number
  completed: number
  failed: number
  cancelled: number
}

export interface AsyncTaskSource {
  kind: AsyncTaskKind
  available: boolean
  truncated?: boolean
  message?: string
}

export interface AsyncTaskFilterOptions {
  models: string[]
  api_keys: Array<{ id: number; name?: string }>
}

/** 单条任务手动查询结果；视频地址只在本次上游确认完成时返回，不会出现在列表接口中。 */
export interface AsyncTaskRefreshResult {
  task: AsyncTask
  upstream_checked: boolean
  video_url?: string
  /** 网关代理的相对下载路径，下载时需携带创建任务的同一 API Key。 */
  video_content_path?: string
  checked_at: string
}

export interface AsyncTaskPage {
  items: AsyncTask[]
  total: number
  page: number
  page_size: number
  summary: AsyncTaskSummary
  filter_options?: AsyncTaskFilterOptions
  sources: AsyncTaskSource[]
  generated_at: string
}

/** 日期使用本地 yyyy-MM-dd；只选开始日期时视为单日。 */
export interface AsyncTaskQuery {
  kind: AsyncTaskKindFilter
  status: AsyncTaskStatusFilter
  model?: string
  apiKeyID?: number
  keyword?: string
  createdFrom?: string
  createdTo?: string
  page: number
  pageSize: number
}

export const ASYNC_TASK_KIND_LABELS: Record<AsyncTaskKind, string> = {
  image: '异步生图',
  video: '视频生成',
  batch: '批量生图',
}

export const ASYNC_TASK_VIDEO_PROVIDER_LABELS: Record<AsyncTaskVideoProvider, string> = {
  grok: 'Grok',
  seedance: 'Seedance',
}

export const ASYNC_TASK_STATUS_LABELS: Record<AsyncTaskStatus, string> = {
  processing: '生成中',
  pending: '等待结果',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export const ASYNC_TASK_STATUS_OPTIONS: AsyncTaskStatusFilter[] = ['all', 'processing', 'pending', 'completed', 'failed', 'cancelled']
export const ASYNC_TASK_KIND_OPTIONS: AsyncTaskKindFilter[] = ['all', 'image', 'video', 'batch']
export const ASYNC_TASK_PAGE_SIZES = [10, 20, 50, 100] as const

/** 本地日期 yyyy-MM-dd 转为该日零点的 RFC3339（带本地时区偏移）；offsetDays 用于生成不包含的结束边界。 */
export function localDayBoundary(day: string, offsetDays = 0): string {
  const [year, month, date] = day.split('-').map(Number)
  const value = new Date(year, month - 1, date + offsetDays)
  if (!year || !month || !date || Number.isNaN(value.getTime())) return ''
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0')
  const offset = -value.getTimezoneOffset()
  const zone = offset === 0 ? 'Z' : `${offset > 0 ? '+' : '-'}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T00:00:00${zone}`
}

export function buildAsyncTaskPath(query: AsyncTaskQuery): string {
  const params = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize) })
  if (query.kind !== 'all') params.set('kind', query.kind)
  if (query.status !== 'all') params.set('status', query.status)
  if (query.model) params.set('model', query.model)
  if (query.apiKeyID) params.set('api_key_id', String(query.apiKeyID))
  const keyword = query.keyword?.trim()
  if (keyword) params.set('keyword', keyword)
  if (query.createdFrom) {
    params.set('created_from', localDayBoundary(query.createdFrom))
    params.set('created_to', localDayBoundary(query.createdTo || query.createdFrom, 1))
  }
  return `/async-tasks?${params.toString()}`
}

/** 页码窗口：始终保留首尾页，当前页前后各一页，其余折叠为省略号。 */
export function buildAsyncTaskPageItems(page: number, totalPages: number): Array<number | 'ellipsis'> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  const pages = new Set([1, totalPages, page - 1, page, page + 1].filter(value => value >= 1 && value <= totalPages))
  const sorted = [...pages].sort((a, b) => a - b)
  const items: Array<number | 'ellipsis'> = []
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) items.push('ellipsis')
    items.push(value)
  })
  return items
}

export async function fetchAsyncTasks(query: AsyncTaskQuery): Promise<AsyncTaskPage> {
  const envelope = await apiClient.get<AuxEnvelope<AsyncTaskPage>>(buildAsyncTaskPath(query))
  if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '异步任务读取失败')
  return envelope.data
}

/** 视频上游查询最长 20 秒，前端超时需略长于后端。 */
const ASYNC_TASK_REFRESH_TIMEOUT_MS = 25000

/** 查询单条任务的最新进度：视频任务由后端用创建任务的 API Key 代查网关，生图与批量只重新读取记录。 */
export async function refreshAsyncTask(task: Pick<AsyncTask, 'kind' | 'provider' | 'id'>): Promise<AsyncTaskRefreshResult> {
  const body = { kind: task.kind, id: task.id, ...(task.kind === 'video' ? { provider: task.provider ?? 'grok' } : {}) }
  const envelope = await apiClient.post<AuxEnvelope<AsyncTaskRefreshResult>>('/async-tasks/refresh', body, { timeout: ASYNC_TASK_REFRESH_TIMEOUT_MS })
  if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '任务进度查询失败')
  return envelope.data
}

/** 任务在列表中的稳定身份；Grok 与 Seedance 的任务 ID 可能重复。 */
export function asyncTaskKey(task: Pick<AsyncTask, 'kind' | 'provider' | 'id'>): string {
  return `${task.kind}:${task.kind === 'video' ? task.provider ?? 'grok' : ''}:${task.id}`
}

/** 手动查询失败时的可执行提示；reason 由后端稳定返回，不依赖错误文案。 */
export function describeAsyncTaskRefreshError(error: unknown): string {
  if (error instanceof AuxApiError) {
    if (error.status === 401) return '登录状态已失效，请从 Sub2API 用户菜单重新打开此页面。'
    if (error.status === 404 && error.reason === 'VIDEO_TASK_NOT_FOUND') return 'Sub2API 网关找不到该视频任务，可能已超过保留期，或创建任务的 API Key 分组已变更。'
    if (error.status === 404) return '任务不存在或已过期，请刷新列表。'
    if (error.status === 409) return '创建该任务的 API Key 已删除或停用，无法代为查询，请使用调用端查询。'
    if (error.status === 422) return 'Sub2API 拒绝查询：请检查该 API Key 的状态、余额或分组权限。'
    if (error.status === 429) return '查询过于频繁，请稍后再试。'
    if (error.status === 503) return 'Sub2API 暂时不可用，请稍后重试。'
    if (error.status === 400) return '任务参数无效，请刷新列表后重试。'
  }
  return '任务进度查询失败，请稍后重试。'
}

/** 将接口错误转成用户可执行的提示，不展示后端内部错误。 */
export function describeAsyncTaskError(error: unknown): string {
  if (error instanceof AuxApiError) {
    if (error.status === 401) return '登录状态已失效，请从 Sub2API 用户菜单重新打开此页面。'
    if (error.status === 503) return 'Sub2API 任务数据暂时不可用，请稍后重试或联系管理员。'
  }
  return '异步任务读取失败，请稍后重试。'
}

export function isActiveAsyncTask(task: AsyncTask): boolean {
  return task.status === 'processing' || task.status === 'pending'
}

/** 长任务 ID 保留首尾，完整值通过复制按钮获取。 */
export function shortTaskID(id: string): string {
  return id.length > 22 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id
}

export function formatTaskTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return '—'
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatRelativeTime(value: string | undefined, now: number = Date.now()): string {
  if (!value) return '时间未知'
  const time = new Date(value).getTime()
  if (Number.isNaN(time) || time <= 0) return '时间未知'
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return formatTaskTime(value)
}

export function formatElapsed(start?: string, end?: string): string {
  if (!start || !end) return ''
  const seconds = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  if (!Number.isFinite(seconds) || seconds < 0) return ''
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

export function formatTaskCost(cost?: number, currency?: string): string {
  if (cost === undefined || cost === null || !Number.isFinite(cost)) return ''
  const amount = cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: cost > 0 && cost < 0.01 ? 6 : 4 })
  const code = (currency || 'USD').toUpperCase()
  return code === 'USD' ? `$${amount}` : `${amount} ${code}`
}

/** 批量任务进度：成功、失败、取消均视为已结束的条目。 */
export function batchProgress(task: AsyncTask): { done: number; total: number; percent: number } {
  const total = Math.max(0, task.item_count ?? 0)
  const done = Math.min(total, (task.success_count ?? 0) + (task.fail_count ?? 0) + (task.cancelled_count ?? 0))
  return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 }
}
