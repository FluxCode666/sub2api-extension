import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api-client'
import PromotionManagementPage from '@/pages/admin/PromotionManagementPage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(apiClient.put).mockResolvedValue({ code: 0, message: 'success', data: {} })
  vi.mocked(apiClient.get).mockImplementation(async (path) => {
    if (path === '/admin/promotions') {
      return {
        code: 0,
        message: 'success',
        data: {
          items: [{
            id: 1,
            title: '春季返利活动',
            description: '## 活动规则\n\n- **充值返利**\n- 支持 `Markdown`',
            reward_type: 'FIXED',
            reward_value: 10,
            enabled: true,
            published: true,
            created_at: '2026-09-12T00:00:00Z',
            updated_at: '2026-09-12T00:00:00Z',
            stats: { participant_count: 2, claim_count: 3, order_amount_total: 100, rebate_total: 30 },
          }, {
            id: 2,
            title: '冬季返利活动',
            description: '冬季活动说明',
            reward_type: 'PERCENTAGE',
            reward_value: 5,
            enabled: true,
            published: false,
            starts_at: '2026-12-01T00:00:00Z',
            ends_at: '2026-12-31T23:59:59Z',
            created_at: '2026-09-11T00:00:00Z',
            updated_at: '2026-09-11T00:00:00Z',
            stats: { participant_count: 0, claim_count: 0, order_amount_total: 0, rebate_total: 0 },
          }],
        },
      }
    }
    if (path === '/admin/promotions/config') return { code: 0, message: 'success', data: { enabled: true } }
    throw new Error(`Unexpected request: ${path}`)
  })
})

afterEach(cleanup)

describe('促销活动管理', () => {
  it('在活动列表中渲染 Markdown 说明', async () => {
    render(<PromotionManagementPage />)

    expect(await screen.findByText('春季返利活动')).toBeInTheDocument()
    const markdown = document.querySelector('.promotion-markdown')
    expect(markdown).toBeInTheDocument()
    expect(markdown?.querySelector('h2')).toHaveTextContent('活动规则')
    expect(markdown?.querySelector('strong')).toHaveTextContent('充值返利')
    expect(markdown?.querySelector('code')).toHaveTextContent('Markdown')
  })

  it('按活动名称筛选列表', async () => {
    render(<PromotionManagementPage />)

    expect(await screen.findByText('冬季返利活动')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('搜索活动名称'), { target: { value: '冬季' } })

    expect(screen.getByText('冬季返利活动')).toBeInTheDocument()
    expect(screen.queryByText('春季返利活动')).not.toBeInTheDocument()
  })

  it('打开活动编辑并提交修改', async () => {
    render(<PromotionManagementPage />)

    await screen.findByText('春季返利活动')
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByDisplayValue('春季返利活动')).toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('春季返利活动'), { target: { value: '春季返利活动（更新）' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/promotions/1', expect.objectContaining({
      title: '春季返利活动（更新）',
      reward_type: 'FIXED',
      reward_value: 10,
    })))
  })
})
