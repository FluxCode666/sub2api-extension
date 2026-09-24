export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'CLOSED'

export interface TicketMessage {
  id: number
  ticket_id: number
  sender_type: 'user' | 'admin'
  sender_name: string
  body: string
  created_at: string
}

export interface Ticket {
  id: number
  user_id?: number
  user_email?: string
  user_name?: string
  subject: string
  status: TicketStatus
  messages?: TicketMessage[]
  created_at: string
  updated_at: string
}

export interface TicketPage {
  items: Ticket[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export function ticketStatusLabel(status: TicketStatus): string {
  return {
    OPEN: '待处理',
    IN_PROGRESS: '处理中',
    CLOSED: '已关闭',
  }[status]
}

export function formatTicketDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
