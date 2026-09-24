import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import TicketsPortalPage from './TicketsPortalPage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const ticket = {
  id: 41,
  subject: '无法登录',
  status: 'OPEN' as const,
  created_at: '2026-09-23T10:00:00Z',
  updated_at: '2026-09-23T10:00:00Z',
  messages: [{ id: 1, ticket_id: 41, sender_type: 'user' as const, sender_name: '访客', body: '**登录后**页面空白', created_at: '2026-09-23T10:00:00Z' }],
}

describe('TicketsPortalPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { items: [], total: 0, page: 1, page_size: 20, total_pages: 0 } })
    vi.mocked(apiClient.post).mockResolvedValue({ code: 0, data: ticket })
  })

  it('creates a ticket and refreshes the user conversation', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.get).mockImplementation(async (path: string) => {
      if (path.startsWith('/tickets?page=')) return { code: 0, data: { items: [ticket], total: 1, page: 1, page_size: 20, total_pages: 1 } }
      if (path === '/tickets/41') return { code: 0, data: ticket }
      throw new Error(`Unexpected request: ${path}`)
    })

    render(<TicketsPortalPage />)
    await screen.findByRole('heading', { name: '无法登录' })
    await user.click(screen.getByRole('button', { name: /新建工单/ }))
    const dialog = screen.getByRole('dialog', { name: '提交新工单' })
    expect(within(dialog).getByText(/支持 Markdown/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText('问题主题'), '无法登录')
    await user.type(within(dialog).getByLabelText('问题描述'), '**登录后**页面空白')
    await user.click(within(dialog).getByRole('button', { name: '提交工单' }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/tickets', { subject: '无法登录', body: '**登录后**页面空白' }))
    expect(await screen.findByText('登录后')).toHaveProperty('tagName', 'STRONG')
    expect(toast.success).toHaveBeenCalledWith('工单已提交', { description: '客服团队会通过工单中心回复。' })
  })

  it('submits Markdown replies as source text and renders both sides of the conversation', async () => {
    const user = userEvent.setup()
    let currentTicket = {
      ...ticket,
      messages: [
        ...ticket.messages,
        { id: 2, ticket_id: 41, sender_type: 'admin' as const, sender_name: '客服', body: '请运行 `whoami`', created_at: '2026-09-23T11:00:00Z' },
      ],
    }
    vi.mocked(apiClient.get).mockImplementation(async (path: string) => {
      if (path.startsWith('/tickets?page=')) return { code: 0, data: { items: [currentTicket], total: 1, page: 1, page_size: 20, total_pages: 1 } }
      if (path === '/tickets/41') return { code: 0, data: currentTicket }
      throw new Error(`Unexpected request: ${path}`)
    })
    vi.mocked(apiClient.post).mockImplementation(async (path: string, payload) => {
      if (path !== '/tickets/41/messages') throw new Error(`Unexpected request: ${path}`)
      currentTicket = { ...currentTicket, messages: [...currentTicket.messages, { id: 3, ticket_id: 41, sender_type: 'user', sender_name: '访客', body: (payload as { body: string }).body, created_at: '2026-09-23T12:00:00Z' }] }
      return { code: 0, data: currentTicket }
    })

    render(<TicketsPortalPage />)
    expect(await screen.findByText('whoami')).toHaveProperty('tagName', 'CODE')
    await user.type(screen.getByLabelText('追加回复'), '- 已尝试清缓存')
    await user.click(screen.getByRole('button', { name: '发送回复' }))

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/tickets/41/messages', { body: '- 已尝试清缓存' }))
    expect(await screen.findByText('已尝试清缓存')).toHaveProperty('tagName', 'LI')
  })
})
