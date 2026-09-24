import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api-client'
import NotificationManagementPage from './NotificationManagementPage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

describe('NotificationManagementPage', () => {
  it('places new-ticket reminder with event settings before delivery logs', async () => {
    vi.mocked(apiClient.get).mockImplementation(async path => {
      if (path === '/admin/notifications/channels') return { code: 0, data: { items: [] } }
      if (path === '/admin/notifications/events/invoice.application.created' || path === '/admin/notifications/events/ticket.created') {
        return { code: 0, data: { channel_ids: [], channel_recipients: {} } }
      }
      if (path.startsWith('/admin/notifications/logs?')) return { code: 0, data: { items: [], total: 0, page: 1, total_pages: 0 } }
      throw new Error(`Unexpected request: ${path}`)
    })

    render(<NotificationManagementPage />)
    const invoice = screen.getByRole('heading', { name: '发票申请通知' })
    const ticket = screen.getByRole('heading', { name: '新工单提醒' })
    const logs = screen.getByRole('heading', { name: '系统消息通知日志' })

    await screen.findByText('请先配置通知渠道，再开启工单提醒。')
    expect(invoice.compareDocumentPosition(ticket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(ticket.compareDocumentPosition(logs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/admin/notifications/events/ticket.created'))
  })
})
