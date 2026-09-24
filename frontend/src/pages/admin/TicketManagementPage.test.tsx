import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import TicketManagementPage from './TicketManagementPage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(apiClient.get).mockImplementation(async (path) => {
    if (path === '/admin/tickets/config') {
      return { code: 0, message: 'success', data: { enabled: false, publish_available: true } }
    }
    if (path === '/admin/tickets?page=1&page_size=20') {
      return { code: 0, message: 'success', data: { items: [], page: 1, total_pages: 1 } }
    }
    throw new Error(`Unexpected request: ${path}`)
  })
  vi.mocked(apiClient.put).mockResolvedValue({
    code: 0,
    message: 'success',
    data: { enabled: true, published: true },
  })
})

afterEach(cleanup)

describe('TicketManagementPage 用户端上架开关', () => {
  it('开启开关后保存配置并同步菜单', async () => {
    render(<TicketManagementPage />)

    const toggle = await screen.findByRole('switch', { name: '上架工单用户端' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/tickets/config', { enabled: true }))
    expect(toast.success).toHaveBeenCalledWith('工单用户端已上架')
  })

  it('菜单同步失败时保留设置并显示警告', async () => {
    vi.mocked(apiClient.put).mockResolvedValue({
      code: 0,
      message: 'ticket setting saved with warning',
      reason: '设置已保存，但 Sub2API 菜单同步失败，请检查数据库连接和公开域名',
      data: { enabled: true, published: false },
    })

    render(<TicketManagementPage />)
    fireEvent.click(await screen.findByRole('switch', { name: '上架工单用户端' }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('设置已保存，但 Sub2API 菜单同步失败，请检查数据库连接和公开域名'))
    expect(toast.success).not.toHaveBeenCalledWith('工单用户端已上架')
  })
})

describe('TicketManagementPage 工单对话', () => {
  it('renders Markdown and submits administrator replies without converting to HTML', async () => {
    const ticket = {
      id: 41,
      subject: '无法登录',
      user_id: 7,
      user_name: '访客',
      user_email: 'user@example.com',
      status: 'OPEN',
      created_at: '2026-09-23T10:00:00Z',
      updated_at: '2026-09-23T10:00:00Z',
      messages: [
        { id: 1, ticket_id: 41, sender_type: 'user', body: '请看 **日志**', created_at: '2026-09-23T10:00:00Z' },
        { id: 2, ticket_id: 41, sender_type: 'admin', body: '运行 `whoami`', created_at: '2026-09-23T11:00:00Z' },
      ],
    }
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path === '/admin/tickets/config') return { code: 0, data: { enabled: false, publish_available: true } }
      if (path === '/admin/tickets?page=1&page_size=20') return { code: 0, data: { items: [ticket], page: 1, total_pages: 1 } }
      if (path === '/admin/tickets/41') return { code: 0, data: ticket }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.mocked(apiClient.post).mockResolvedValue({ code: 0, data: ticket })

    render(<TicketManagementPage />)
    expect(await screen.findByText('日志')).toHaveProperty('tagName', 'STRONG')
    expect(screen.getByText('whoami')).toHaveProperty('tagName', 'CODE')
    fireEvent.change(screen.getByLabelText('回复用户'), { target: { value: '## 请重试' } })
    fireEvent.click(screen.getByRole('button', { name: '发送回复' }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/admin/tickets/41/messages', { body: '## 请重试' }))
    expect(toast.success).toHaveBeenCalledWith('工单回复已发送')
  })
})
