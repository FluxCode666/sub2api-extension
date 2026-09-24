export type PromotionRewardType = 'FIXED' | 'PERCENTAGE'

export interface PromotionStats {
  participant_count: number
  claim_count: number
  order_amount_total: number
  rebate_total: number
  last_claim_at?: string
}

export interface Promotion {
  id: number
  title: string
  description: string
  reward_type: PromotionRewardType
  reward_value: number
  max_rebate_amount?: number
  starts_at?: string
  ends_at?: string
  enabled: boolean
  published: boolean
  created_at: string
  updated_at: string
  stats?: PromotionStats
}

export interface PromotionOrder {
  payment_order_id: number
  out_trade_no: string
  amount: number
  paid_at: string
  claimed: boolean
  rebate_amount: number
}

export interface PromotionClaim {
  id: number
  promotion_id: number
  payment_order_id: number
  out_trade_no: string
  order_amount: number
  rebate_amount: number
  status: string
  claimed_at: string
}

const promotionAdvanceNoticeWindow = 3 * 24 * 60 * 60 * 1000

export function promotionIsEnded(promotion: Pick<Promotion, 'ends_at'>, now = Date.now()): boolean {
  if (!promotion.ends_at) return false
  const end = Date.parse(promotion.ends_at)
  return Number.isFinite(end) && end <= now
}

export function promotionIsUpcoming(promotion: Pick<Promotion, 'starts_at'>, now = Date.now()): boolean {
  if (!promotion.starts_at) return false
  const start = Date.parse(promotion.starts_at)
  return Number.isFinite(start) && start > now && start <= now + promotionAdvanceNoticeWindow
}

export function formatPromotionStart(value?: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  return date.toLocaleString('zh-CN', { ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function formatPromotionTimeRange(promotion: Pick<Promotion, 'starts_at' | 'ends_at'>): string {
  const startDate = promotion.starts_at ? new Date(promotion.starts_at) : undefined
  const endDate = promotion.ends_at ? new Date(promotion.ends_at) : undefined
  const sameYear = startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime()) && startDate.getFullYear() === endDate.getFullYear()
  const formatDate = (date?: Date): string => {
    if (!date || Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('zh-CN', { ...(sameYear || date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }), month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  }
  const start = formatDate(startDate)
  const end = formatDate(endDate)
  if (start && end) return `${start} 至 ${end}`
  if (start) return `${start} 起`
  if (end) return `截至 ${end}`
  return '时间不限'
}

export function formatPromotionMoney(value: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value || 0)
}

export function promotionRewardLabel(promotion: Pick<Promotion, 'reward_type' | 'reward_value'>): string {
  return promotion.reward_type === 'PERCENTAGE' ? `支付金额的 ${promotion.reward_value}%` : `每笔 ${formatPromotionMoney(promotion.reward_value)}`
}

export function promotionRebateLimitLabel(promotion: Pick<Promotion, 'max_rebate_amount'>): string {
  return promotion.max_rebate_amount && promotion.max_rebate_amount > 0
    ? formatPromotionMoney(promotion.max_rebate_amount)
    : '不限'
}
