import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import TicketNotificationSettings from './TicketNotificationSettings'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('TicketNotificationSettings', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { channel_ids: [7], channel_recipients: { '7': ['ops@example.com'] } } })
    vi.mocked(apiClient.put).mockResolvedValue({ code: 0, data: {} })
  })

  it('loads, edits, and saves ticket-specific channels and recipients', async () => {
    render(<TicketNotificationSettings channels={[{ id: 7, name: '运维邮箱', type: 'email', enabled: true }]} />)
    const recipient = await screen.findByLabelText('提醒收件人')
    expect(recipient).toHaveValue('ops@example.com')
    fireEvent.change(recipient, { target: { value: 'ops@example.com, support@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '保存工单提醒' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/notifications/events/ticket.created', {
      channel_ids: [7],
      channel_recipients: { '7': ['ops@example.com', 'support@example.com'] },
    }))
    expect(toast.success).toHaveBeenCalledWith('工单提醒配置已保存')
  })
})
