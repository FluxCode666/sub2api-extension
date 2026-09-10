import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminVersionControl, { AdminVersionButton } from './AdminVersionControl'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: { get, post } }))

const release = {
  release: { version: 'v0.6.0', name: 'v0.6.0 · 版本更新', notes: '## 新增发布流程\n\n- 支持 **管理员更新**\n- [查看详情](https://github.com/FluxCode666/sub2api-extension/releases/tag/v0.6.0)\n\n```sh\ndocker compose pull\n```\n\n<script>不应执行</script>', url: 'https://github.com/FluxCode666/sub2api-extension/releases/tag/v0.6.0', publishedAt: '2026-09-09T00:00:00Z' },
  canUpdate: true, updateAvailable: true,
}
let status: { enabled: boolean; reason?: string; job?: { id: string; version: string; phase: string; message: string } }

async function openDialog() {
  render(<AdminVersionControl><AdminVersionButton /></AdminVersionControl>)
  fireEvent.click(await screen.findByRole('button', { name: '查看版本与更新，当前 v0.5.0' }))
  return screen.findByRole('dialog')
}

describe('administrator version control', () => {
  beforeEach(() => {
    get.mockReset(); post.mockReset()
    status = { enabled: true }
    get.mockImplementation(async (path: string) => ({ code: 0, data: path.endsWith('/version') ? { version: 'v0.5.0', commit: 'abc123', buildTime: '' } : path.endsWith('/release') ? release : status }))
  })

  it('renders Markdown release notes and safely displays raw HTML as text', async () => {
    const dialog = await openDialog()
    expect(await within(dialog).findByText('v0.6.0 · 版本更新')).toBeInTheDocument()
    expect(within(dialog).getByText(/<script>不应执行/)).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: '新增发布流程' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: '查看详情' })).toHaveAttribute('href', 'https://github.com/FluxCode666/sub2api-extension/releases/tag/v0.6.0')
    expect(within(dialog).getByText('docker compose pull')).toBeInTheDocument()
    expect(dialog.querySelector('script')).toBeNull()
    expect(within(dialog).getByRole('link', { name: 'GitHub Release' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(dialog).getByRole('button', { name: '更新到最新版本' })).toBeEnabled()
  })

  it('explains disabled updates when the helper is not installed', async () => {
    status = { enabled: false, reason: '当前运行环境不支持原地更新' }
    await openDialog()
    expect(await screen.findByText('当前运行环境不支持原地更新')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更新到最新版本' })).toBeDisabled()
  })

  it('confirms the version, starts once, and recovers job status when reopened', async () => {
    const job = { id: '1', version: 'v0.6.0', phase: 'queued', message: '更新任务已创建' }
    post.mockImplementation(async () => { status = { enabled: true, job }; return { code: 0, data: { ...job, need_restart: true } } })
    await openDialog()
    await waitFor(() => expect(screen.getByRole('button', { name: '更新到最新版本' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '更新到最新版本' }))
    expect(post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }))
    expect(await screen.findByText('更新任务已创建')).toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith('/admin/system/update', undefined, { timeout: 15 * 60 * 1000 })
    expect(screen.getByRole('button', { name: '更新进行中' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    status = { enabled: true, job: { ...job, phase: 'succeeded', message: '更新完成，新版本已通过健康检查' } }
    fireEvent.click(screen.getByRole('button', { name: '查看版本与更新，当前 v0.5.0' }))
    expect(await screen.findByRole('button', { name: '我已重启，重新检查' })).toBeInTheDocument()
  })

  it('polls after a lost POST response without sending a second update', async () => {
    post.mockImplementation(async () => {
      status = { enabled: true, job: { id: '2', version: 'v0.6.0', phase: 'succeeded', message: '更新已完成' } }
      throw new Error('连接中断')
    })
    await openDialog()
    await waitFor(() => expect(screen.getByRole('button', { name: '更新到最新版本' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '更新到最新版本' }))
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }))
    expect(await screen.findByText(/连接暂时中断/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '我已重启，重新检查' })).toBeInTheDocument(), { timeout: 4500 })
    expect(post).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent('🎉 更新已完成')
  })

  it('restarts automatically and reloads once the service is healthy again', async () => {
    const job = { id: '3', version: 'v0.6.0', phase: 'succeeded', message: '更新完成，服务即将自动重启' }
    post.mockImplementation(async () => { status = { enabled: true, job }; return { code: 0, data: { ...job, restarting: true } } })
    const reload = vi.fn()
    Object.defineProperty(window, 'location', { writable: true, value: { ...window.location, reload } })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true }))
    await openDialog()
    await waitFor(() => expect(screen.getByRole('button', { name: '更新到最新版本' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '更新到最新版本' }))
    fireEvent.click(screen.getByRole('button', { name: '确认更新' }))
    expect(await screen.findByText(/服务正在自动重启/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /服务重启中/ })).toBeDisabled()
    await waitFor(() => expect(reload).toHaveBeenCalled(), { timeout: 5000 })
    vi.unstubAllGlobals()
  })

  it('keeps the current version and offers retry when GitHub is unavailable', async () => {
    get.mockImplementation(async (path: string) => {
      if (path.endsWith('/release')) throw new Error('GitHub 访问受限')
      return { code: 0, data: path.endsWith('/version') ? { version: 'v0.5.0' } : status }
    })
    await openDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub 访问受限')
    expect(screen.getByRole('button', { name: '重新检查' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '更新到最新版本' })).toBeDisabled()
  })
})
