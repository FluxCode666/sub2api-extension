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

/** 列表行使用的相对时间，便于快速判断工单新鲜度；完整时间仍由 formatTicketDate 提供。 */
export function formatTicketRelative(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const elapsed = Date.now() - date.getTime()
  if (elapsed < 0) return formatTicketDate(value)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN')
}
