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

export function promotionIsEnded(promotion: Pick<Promotion, 'ends_at'>, now = Date.now()): boolean {
  if (!promotion.ends_at) return false
  const end = Date.parse(promotion.ends_at)
  return Number.isFinite(end) && end <= now
}

export function formatPromotionMoney(value: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value || 0)
}

export function promotionRewardLabel(promotion: Pick<Promotion, 'reward_type' | 'reward_value'>): string {
  return promotion.reward_type === 'PERCENTAGE' ? `支付金额的 ${promotion.reward_value}%` : `每笔 ${formatPromotionMoney(promotion.reward_value)}`
}
