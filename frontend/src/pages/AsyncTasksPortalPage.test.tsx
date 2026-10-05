import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, AuxApiError } from '@/lib/api-client'
import { toast } from 'sonner'
import AsyncTasksPortalPage, { ASYNC_TASK_POLL_INTERVAL_MS } from './AsyncTasksPortalPage'
import { format, subDays } from 'date-fns'
import { localDayBoundary, type AsyncTask, type AsyncTaskPage } from '@/lib/async-tasks'

vi.mock('@/lib/api-client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: { get: vi.fn(), post: vi.fn() },
}))
vi.mock('@/lib/telemetry-sdk', () => ({ trackFeatureClick: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => <div data-testid="async-task-toaster" /> }))

const summary = { total: 3, image: 1, video: 1, batch: 1, processing: 1, pending: 1, completed: 1, failed: 0, cancelled: 0 }

function page(items: AsyncTask[], overrides: Partial<AsyncTaskPage> = {}): AsyncTaskPage {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 20,
    summary,
    filter_options: { models: ['gpt-image-2', 'grok-imagine-video'], api_keys: [{ id: 7, name: '生产 Key' }, { id: 9 }] },
    sources: [{ kind: 'image', available: true }, { kind: 'video', available: true }, { kind: 'batch', available: true }],
    generated_at: '2026-09-27T02:00:00Z',
    ...overrides,
  }
}

const imageTask: AsyncTask = {
  id: 'imgtask_completed_0001',
  kind: 'image',
  status: 'completed',
  raw_status: 'completed',
  api_key_id: 7,
  api_key_name: '生产 Key',
  created_at: '2026-09-27T01:00:00Z',
  completed_at: '2026-09-27T01:00:30Z',
  image_urls: ['https://cdn.example.com/a.png'],
  image_count: 3,
}
const videoTask: AsyncTask = { id: 'req-video', kind: 'video', provider: 'grok', status: 'pending', raw_status: 'pending', model: 'grok-imagine-video', created_at: '2026-09-27T01:10:00Z', resolution: '720p', duration_seconds: 8 }
const seedanceTask: AsyncTask = { id: 'cgt-1', kind: 'video', provider: 'seedance', status: 'pending', raw_status: 'pending', model: 'doubao-seedance', api_key_id: 7, created_at: '2026-09-27T01:30:00Z' }
const batchTask: AsyncTask = { id: 'batch_1', kind: 'batch', status: 'processing', raw_status: 'running', task_name: '海报批量', created_at: '2026-09-27T01:20:00Z', item_count: 4, success_count: 1, fail_count: 1, cost: 0.4, cost_estimated: true }

describe('AsyncTasksPortalPage', () => {
  beforeAll(() => {
    // Radix Select 在 jsdom 中需要的指针与滚动 API。
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, message: 'success', data: page([batchTask, videoTask, imageTask]) })
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })
  const lastParams = () => new URLSearchParams(String(vi.mocked(apiClient.get).mock.lastCall?.[0]).split('?')[1])
  afterEach(() => vi.useRealTimers())

  it('renders all task kinds as table rows with safe result links and status details', async () => {
    render(<AsyncTasksPortalPage />)

    expect(await screen.findByText('海报批量')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/async-tasks?page=1&page_size=20')
    const table = screen.getByRole('table', { name: '异步任务列表' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByRole('columnheader', { name: '模型' })).toBeInTheDocument()
    expect(screen.getByText('预估')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '批量任务进度' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getAllByText('可点击状态旁按钮查询进度')).toHaveLength(1)
    expect(within(table).getAllByRole('button', { name: '查询任务进度' })).toHaveLength(2)
    const videoRow = within(table).getByText('req-video').closest('tr') as HTMLElement
    expect(within(videoRow).getAllByText('视频生成')).toHaveLength(2)
    expect(within(videoRow).getByText('Grok')).toBeInTheDocument()
    const imageRow = within(table).getByText('imgtask_completed_0001').closest('tr') as HTMLElement
    expect(within(imageRow).queryByRole('button', { name: '查询任务进度' })).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: '打开第 1 张结果图' })
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/a.png')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText('+2')).toBeInTheDocument()
    expect(within(table).getByText('生产 Key')).toBeInTheDocument()
    expect(screen.getByText('显示 1–3 条，共 3 条')).toBeInTheDocument()
    expect(screen.getByTestId('async-task-toaster')).toBeInTheDocument()
  })

  it('sends kind, status, model and API key filters and resets to the first page', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, message: 'success', data: page([batchTask, videoTask, imageTask], { total: 45 }) })
    render(<AsyncTasksPortalPage />)
    await screen.findByText('海报批量')

    await user.click(screen.getByRole('link', { name: '第 2 页' }))
    await waitFor(() => expect(lastParams().get('page')).toBe('2'))

    await user.click(screen.getByRole('combobox', { name: '任务类型' }))
    await user.click(await screen.findByRole('option', { name: /视频生成/ }))
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith('/async-tasks?page=1&page_size=20&kind=video'))

    await user.click(screen.getByRole('combobox', { name: '任务状态' }))
    await user.click(await screen.findByRole('option', { name: /等待结果/ }))
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith('/async-tasks?page=1&page_size=20&kind=video&status=pending'))

    await user.click(screen.getByRole('combobox', { name: '模型' }))
    await user.type(await screen.findByPlaceholderText('搜索模型…'), 'grok')
    expect(screen.queryByRole('option', { name: 'gpt-image-2' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'grok-imagine-video' }))
    await waitFor(() => expect(lastParams().get('model')).toBe('grok-imagine-video'))
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveTextContent('grok-imagine-video')

    await user.click(screen.getByRole('combobox', { name: 'API Key' }))
    await user.click(await screen.findByRole('option', { name: '#9' }))
    await waitFor(() => expect(lastParams().get('api_key_id')).toBe('9'))
    expect(lastParams().get('page')).toBe('1')

    await user.click(screen.getByRole('button', { name: /重置筛选/ }))
    await waitFor(() => expect(apiClient.get).toHaveBeenLastCalledWith('/async-tasks?page=1&page_size=20'))
  })

  it('debounces the keyword search and changes the page size', async () => {
    const user = userEvent.setup()
    render(<AsyncTasksPortalPage />)
    await screen.findByText('海报批量')

    await user.type(screen.getByRole('searchbox', { name: '任务 ID / 名称' }), ' batch_1 ')
    await waitFor(() => expect(lastParams().get('keyword')).toBe('batch_1'))
    expect(vi.mocked(apiClient.get).mock.calls.filter(([path]) => String(path).includes('keyword=')).length).toBe(1)

    await user.click(screen.getByRole('combobox', { name: '每页条数' }))
    await user.click(await screen.findByRole('option', { name: '50 条' }))
    await waitFor(() => expect(lastParams().get('page_size')).toBe('50'))
  })

  it('filters by a created date range with one calendar and can clear it', async () => {
    // 固定在月中：双月日历会显示相邻月份的日期，月初或月末时同一天会出现两次。
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 17, 12))
    const user = userEvent.setup()
    const today = new Date()
    const yesterday = subDays(today, 1)
    render(<AsyncTasksPortalPage />)
    await screen.findByText('海报批量')

    await user.click(screen.getByRole('button', { name: '创建日期' }))
    const dialog = await screen.findByRole('dialog', { name: '任务创建日期范围' })
    expect(within(dialog).getAllByRole('grid')).toHaveLength(2)
    await user.click(within(dialog).getByRole('button', { name: format(yesterday, 'yyyy-MM-dd') }))
    await user.click(within(dialog).getByRole('button', { name: format(today, 'yyyy-MM-dd') }))
    await waitFor(() => expect(lastParams().get('created_to')).toBe(localDayBoundary(format(today, 'yyyy-MM-dd'), 1)))
    expect(lastParams().get('created_from')).toBe(localDayBoundary(format(yesterday, 'yyyy-MM-dd')))
    expect(screen.getByRole('button', { name: '创建日期' })).toHaveTextContent(`${format(yesterday, 'yyyy-MM-dd')} — ${format(today, 'yyyy-MM-dd')}`)

    await user.click(within(dialog).getByRole('button', { name: '清除日期范围' }))
    await waitFor(() => expect(lastParams().has('created_from')).toBe(false))
    expect(screen.getByRole('button', { name: '创建日期' })).toHaveTextContent('全部日期')
  })

  it('warns about unavailable sources and shows an empty state', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      code: 0,
      message: 'success',
      data: page([], { sources: [{ kind: 'image', available: false, message: 'Redis 未配置' }, { kind: 'video', available: true }, { kind: 'batch', available: true, truncated: true }] }),
    })
    render(<AsyncTasksPortalPage />)

    expect(await screen.findByText('近期没有异步任务')).toBeInTheDocument()
    expect(screen.getByText(/部分任务来源暂不可用/)).toHaveTextContent('异步生图（Redis 未配置）')
    expect(screen.getByText(/只读取到部分近期记录/)).toBeInTheDocument()
  })

  it('shows a full error state on first load failure and retries', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.get).mockRejectedValueOnce(new AuxApiError(503, 'redis down'))
    render(<AsyncTasksPortalPage />)

    expect(await screen.findByRole('heading', { name: '无法读取异步任务' })).toBeInTheDocument()
    expect(screen.queryByText(/redis down/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /重新读取/ }))
    expect(await screen.findByText('海报批量')).toBeInTheDocument()
  })

  it('notifies manual refresh results and keeps existing tasks on failure', async () => {
    const user = userEvent.setup()
    render(<AsyncTasksPortalPage />)
    await screen.findByText('海报批量')

    await user.click(screen.getByRole('button', { name: '刷新任务' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('任务列表已刷新'))

    vi.mocked(apiClient.get).mockRejectedValueOnce(new AuxApiError(401, 'invalid token'))
    await user.click(screen.getByRole('button', { name: '刷新任务' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('刷新失败', expect.objectContaining({ description: expect.stringContaining('重新打开') })))
    expect(screen.getByText('海报批量')).toBeInTheDocument()
  })

  it('copies the full task id with a toast', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<AsyncTasksPortalPage />)
    const item = (await screen.findByText('海报批量')).closest('tr') as HTMLElement

    await user.click(within(item).getByRole('button', { name: '复制任务 ID' }))
    expect(writeText).toHaveBeenCalledWith('batch_1')
    expect(toast.success).toHaveBeenCalledWith('任务 ID 已复制')
  })

  it('silently polls only while visible tasks are still running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<AsyncTasksPortalPage />)
    await screen.findByText('海报批量')
    expect(apiClient.get).toHaveBeenCalledTimes(1)

    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, message: 'success', data: page([imageTask]) })
    await act(async () => { await vi.advanceTimersByTimeAsync(ASYNC_TASK_POLL_INTERVAL_MS) })
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2))
    expect(toast.success).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(ASYNC_TASK_POLL_INTERVAL_MS * 2) })
    expect(apiClient.get).toHaveBeenCalledTimes(2)
  })

  describe('single task refresh', () => {
    const rowOf = async (id: string) => (await screen.findByText(id)).closest('tr') as HTMLElement

    it('queries a Seedance video upstream, shows the signed link and keeps it after a silent reload', async () => {
      const user = userEvent.setup()
      vi.mocked(apiClient.get).mockResolvedValue({ code: 0, message: 'success', data: page([seedanceTask, imageTask]) })
      vi.mocked(apiClient.post).mockResolvedValue({
        code: 0,
        message: 'success',
        data: { task: { ...seedanceTask, status: 'completed', raw_status: 'succeeded' }, upstream_checked: true, video_url: 'https://ark.example.com/v.mp4?sig=1', checked_at: '2026-09-27T02:00:00Z' },
      })
      render(<AsyncTasksPortalPage />)
      const row = await rowOf('cgt-1')
      expect(within(row).getByText('Seedance')).toBeInTheDocument()

      await user.click(within(row).getByRole('button', { name: '查询任务进度' }))

      expect(apiClient.post).toHaveBeenCalledWith('/async-tasks/refresh', { kind: 'video', id: 'cgt-1', provider: 'seedance' }, { timeout: 25000 })
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('任务已完成', { description: '可在结果列打开视频。' }))
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2))
      const refreshedRow = await rowOf('cgt-1')
      expect(within(refreshedRow).getByText('已完成')).toBeInTheDocument()
      expect(within(refreshedRow).queryByRole('button', { name: '查询任务进度' })).not.toBeInTheDocument()
      const link = within(refreshedRow).getByRole('link', { name: '打开视频' })
      expect(link).toHaveAttribute('href', 'https://ark.example.com/v.mp4?sig=1')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('offers to copy the gateway content path for Grok videos', async () => {
      const user = userEvent.setup()
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      vi.mocked(apiClient.post).mockResolvedValue({
        code: 0,
        message: 'success',
        data: { task: { ...videoTask, status: 'completed', raw_status: 'done' }, upstream_checked: true, video_content_path: '/v1/videos/req-video/content', checked_at: '2026-09-27T02:00:00Z' },
      })
      render(<AsyncTasksPortalPage />)

      await user.click(within(await rowOf('req-video')).getByRole('button', { name: '查询任务进度' }))
      expect(apiClient.post).toHaveBeenCalledWith('/async-tasks/refresh', { kind: 'video', id: 'req-video', provider: 'grok' }, { timeout: 25000 })
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('任务已完成', { description: '可在结果列复制下载路径。' }))

      await user.click(within(await rowOf('req-video')).getByRole('button', { name: '复制下载路径' }))
      expect(writeText).toHaveBeenCalledWith('/v1/videos/req-video/content')
      expect(within(await rowOf('req-video')).queryByRole('link', { name: '打开视频' })).not.toBeInTheDocument()
    })

    it('rereads batch tasks without an upstream query and reports that they are still running', async () => {
      const user = userEvent.setup()
      vi.mocked(apiClient.post).mockResolvedValue({ code: 0, message: 'success', data: { task: { ...batchTask, success_count: 3 }, upstream_checked: false, checked_at: '2026-09-27T02:00:00Z' } })
      render(<AsyncTasksPortalPage />)

      await user.click(within(await rowOf('batch_1')).getByRole('button', { name: '查询任务进度' }))
      expect(apiClient.post).toHaveBeenCalledWith('/async-tasks/refresh', { kind: 'batch', id: 'batch_1' }, { timeout: 25000 })
      await waitFor(() => expect(toast.info).toHaveBeenCalledWith('任务仍在生成中', { description: '已读取最新状态，请稍后再试。' }))
      expect(within(await rowOf('batch_1')).getByText('3 成功')).toBeInTheDocument()
    })

    it('keeps an upstream failure for the session even though the list still shows pending', async () => {
      const user = userEvent.setup()
      vi.mocked(apiClient.post).mockResolvedValue({
        code: 0,
        message: 'success',
        data: { task: { ...videoTask, status: 'failed', raw_status: 'expired', error_message: '上游任务已过期' }, upstream_checked: true, checked_at: '2026-09-27T02:00:00Z' },
      })
      render(<AsyncTasksPortalPage />)

      await user.click(within(await rowOf('req-video')).getByRole('button', { name: '查询任务进度' }))
      await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('任务已失败', { description: '上游任务已过期' }))
      await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2))
      const row = await rowOf('req-video')
      expect(within(row).getByText('失败')).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: '失败原因：上游任务已过期' })).toBeInTheDocument()
    })

    it('notifies actionable errors and re-enables the button', async () => {
      const user = userEvent.setup()
      vi.mocked(apiClient.post).mockRejectedValue(new AuxApiError(409, 'api key unavailable', 'API_KEY_UNAVAILABLE'))
      render(<AsyncTasksPortalPage />)

      const button = within(await rowOf('req-video')).getByRole('button', { name: '查询任务进度' })
      await user.click(button)
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('查询失败', { description: expect.stringContaining('API Key 已删除或停用') }))
      expect(within(await rowOf('req-video')).getByRole('button', { name: '查询任务进度' })).toBeEnabled()
      expect(within(await rowOf('req-video')).getByText('等待结果')).toBeInTheDocument()
      expect(apiClient.get).toHaveBeenCalledTimes(1)
    })
  })
})
