import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import type { Promotion, PromotionOrder } from '@/lib/promotions'
import PromotionPortalPage from '@/pages/PromotionPortalPage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const promotions: Promotion[] = ['固定返利活动', '百分比返利活动', '周末返利活动'].map((title, index) => ({
  id: index + 1,
  title,
  description: `活动 ${index + 1} 的说明`,
  reward_type: index === 1 ? 'PERCENTAGE' : 'FIXED',
  reward_value: (index + 1) * 5,
  enabled: true,
  published: true,
  created_at: '2026-09-12T00:00:00Z',
  updated_at: '2026-09-12T00:00:00Z',
}))

const order: PromotionOrder = {
  payment_order_id: 101,
  out_trade_no: 'PAY-101',
  amount: 100,
  paid_at: '2026-09-12T00:00:00Z',
  claimed: false,
  rebate_amount: 5,
}

function envelope<T>(items: T[]): AuxEnvelope<{ items: T[] }> {
  return { code: 0, message: 'success', data: { items } }
}

function deferredOrders() {
  let resolve!: (value: AuxEnvelope<{ items: PromotionOrder[] }>) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<AuxEnvelope<{ items: PromotionOrder[] }>>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function openPage() {
  render(<PromotionPortalPage />)
  return screen.findByRole('button', { name: /订单 PAY-101/ })
}

function selectActivity(index: number) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(promotions[index].title) }))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(apiClient.get).mockImplementation(async (path) => {
    if (path === '/promotions') return envelope(promotions)
    if (path === '/promotions/claims') return envelope([])
    if (path === '/homepage/config') return { code: 0, message: 'success', data: { siteName: '测试网关', heroTitle: '备用名称' } }
    if (path === '/promotions/1/orders') return envelope([order])
    throw new Error(`Unexpected request: ${path}`)
  })
})
afterEach(cleanup)

describe('促销活动切换', () => {
  it('默认折叠已结束活动，并按结束时间倒序展示', async () => {
    const ended: Promotion[] = [
      { ...promotions[0], id: 4, title: '较早结束活动', ends_at: '2026-09-10T00:00:00Z' },
      { ...promotions[0], id: 5, title: '最近结束活动', ends_at: '2026-09-11T00:00:00Z' },
    ]
    vi.mocked(apiClient.get).mockImplementation(async (path) => {
      if (path === '/promotions') return envelope([...promotions.slice(0, 1), ...ended])
      if (path === '/promotions/claims') return envelope([])
      if (path === '/homepage/config') return { code: 0, message: 'success', data: { siteName: '测试网关' } }
      if (path === '/promotions/1/orders') return envelope([order])
      throw new Error(`Unexpected request: ${path}`)
    })

    await openPage()
    const toggle = screen.getByRole('button', { name: /已结束的活动/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /最近结束活动/ })).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const newest = screen.getByRole('button', { name: /最近结束活动/ })
    const oldest = screen.getByRole('button', { name: /较早结束活动/ })
    expect(newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('使用系统配置中的网站名称展示用户福利标题', async () => {
    await openPage()
    expect(screen.getByText('测试网关 用户福利')).toBeInTheDocument()
    expect(screen.queryByText('Sub2API 用户福利')).not.toBeInTheDocument()
  })

  it('慢请求期间保留当前活动说明和订单节点，禁止领取，完成后一起更新', async () => {
    const row = await openPage()
    fireEvent.click(row)
    const pending = deferredOrders()
    vi.mocked(apiClient.get).mockReturnValueOnce(pending.promise)

    selectActivity(1)
    expect(screen.getByRole('button', { name: /订单 PAY-101/ })).toBe(row)
    expect(row).toBeDisabled()
    expect(row).toHaveTextContent('返 ¥5.00')
    expect(screen.getByText('活动 1 的说明')).toBeInTheDocument()
    expect(screen.queryByText('活动 2 的说明')).not.toBeInTheDocument()
    const claimButton = screen.getByRole('button', { name: /领取选中订单返利/ })
    expect(claimButton).toBeDisabled()
    fireEvent.click(claimButton)
    expect(apiClient.post).not.toHaveBeenCalled()

    await act(async () => pending.resolve(envelope([{ ...order, rebate_amount: 10 }])))
    expect(screen.getByRole('button', { name: /订单 PAY-101/ })).toBe(row)
    expect(row).toBeEnabled()
    expect(row).toHaveTextContent('返 ¥10.00')
    expect(row).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('活动 2 的说明')).toBeInTheDocument()
    expect(screen.queryByText('活动 1 的说明')).not.toBeInTheDocument()
  })

  it('重复点击当前活动不重新请求或清除已选订单', async () => {
    const row = await openPage()
    fireEvent.click(row)
    const requests = vi.mocked(apiClient.get).mock.calls.length
    selectActivity(0)
    expect(apiClient.get).toHaveBeenCalledTimes(requests)
    expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /领取选中订单返利（1）/ })).toBeEnabled()
  })

  it.each(['success', 'error'] as const)('忽略快速切换后旧请求的 %s 结果', async (outcome) => {
    await openPage()
    const stale = deferredOrders()
    const current = deferredOrders()
    vi.mocked(apiClient.get).mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)
    selectActivity(1)
    selectActivity(2)
    await act(async () => current.resolve(envelope([{ ...order, rebate_amount: 15 }])))
    await act(async () => {
      if (outcome === 'success') stale.resolve(envelope([{ ...order, rebate_amount: 10 }]))
      else stale.reject(new Error('旧请求失败'))
    })
    const row = screen.getByRole('button', { name: /订单 PAY-101/ })
    expect(row).toHaveTextContent('返 ¥15.00')
    expect(row).toBeEnabled()
    expect(screen.getByText('活动 3 的说明')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('旧请求先完成时不能解除新活动的加载锁定', async () => {
    const row = await openPage()
    const stale = deferredOrders()
    const current = deferredOrders()
    vi.mocked(apiClient.get).mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise)
    selectActivity(1)
    selectActivity(2)
    await act(async () => stale.resolve(envelope([{ ...order, rebate_amount: 10 }])))
    expect(screen.getByRole('button', { name: /订单 PAY-101/ })).toBe(row)
    expect(row).toBeDisabled()
    expect(row).toHaveTextContent('返 ¥5.00')
    await act(async () => current.resolve(envelope([])))
    expect(screen.getByText('没有可参与的已完成充值订单。')).toBeInTheDocument()
    expect(screen.getByText('活动 3 的说明')).toBeInTheDocument()
  })

  it('失败时保留列表并禁用旧订单，支持重试恢复和按新活动领取', async () => {
    const row = await openPage()
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('网络异常'))
    selectActivity(1)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('百分比返利活动')
    expect(screen.getByRole('button', { name: /订单 PAY-101/ })).toBe(row)
    expect(row).toBeDisabled()
    vi.mocked(apiClient.get).mockResolvedValueOnce(envelope([{ ...order, rebate_amount: 10 }]))
    await act(async () => fireEvent.click(within(alert).getByRole('button', { name: '重试' })))
    expect(row).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    vi.mocked(apiClient.post).mockResolvedValueOnce(envelope([{
      id: 1, promotion_id: 2, payment_order_id: 101, out_trade_no: 'PAY-101',
      order_amount: 100, rebate_amount: 10, status: 'REGISTERED', claimed_at: order.paid_at,
    }]))
    fireEvent.click(row)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /领取选中订单返利（1）/ })))
    expect(apiClient.post).toHaveBeenCalledWith('/promotions/2/claim', { order_ids: [101] })
    expect(row).toHaveTextContent('已领取')
    expect(row).toBeDisabled()
  })
})
