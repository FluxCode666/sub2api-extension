import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InvoicePortalPage from './InvoicePortalPage'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get,
  },
}))

describe('InvoicePortalPage', () => {
  beforeEach(() => {
    get.mockReset()
    get.mockImplementation(() => new Promise(() => {}))
  })

  it('renders a themed and accessible initial loading state', () => {
    render(<InvoicePortalPage />)

    const loadingState = screen.getByRole('status')
    expect(loadingState).toHaveClass('invoice-portal', 'invoice-state', 'invoice-state--loading')
    expect(loadingState).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { name: '正在载入企业发票中心' })).toBeInTheDocument()
    expect(screen.getByText('正在同步充值记录、默认开票资料和申请进度')).toBeInTheDocument()
  })

  it('uses the configured Sub2API system name in the footer', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/homepage/config') return { code: 0, data: { siteName: '示例平台' } }
      if (path === '/invoices/config') return { code: 0, data: { enabled: true } }
      if (path === '/invoices/eligible-orders') return { code: 0, data: { items: [] } }
      if (path === '/invoices/requests?page=1&page_size=5') return { code: 0, data: { items: [], total: 0, page: 1, page_size: 5, total_pages: 0 } }
      if (path === '/invoices/profile') return { code: 0, data: { profile: null } }
      throw new Error(`Unexpected request: ${path}`)
    })

    render(<InvoicePortalPage />)

    expect(await screen.findByText('示例平台 企业客户服务')).toBeInTheDocument()
  })
})
