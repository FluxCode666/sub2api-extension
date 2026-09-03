import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import InvoicePortalPage from './InvoicePortalPage'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(() => new Promise(() => {})),
  },
}))

describe('InvoicePortalPage', () => {
  it('renders a themed and accessible initial loading state', () => {
    render(<InvoicePortalPage />)

    const loadingState = screen.getByRole('status')
    expect(loadingState).toHaveClass('invoice-portal', 'invoice-state', 'invoice-state--loading')
    expect(loadingState).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('heading', { name: '正在载入企业发票中心' })).toBeInTheDocument()
    expect(screen.getByText('正在同步充值记录、默认开票资料和申请进度')).toBeInTheDocument()
  })
})
