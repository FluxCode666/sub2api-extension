import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

const currentPages = [
  { id: 'dashboard', title: '分析仪表盘', path: '/admin/dashboard', visibility: 'admin' },
  { id: 'example-content', title: '静态内容示例', path: '/admin/examples/content', visibility: 'admin' },
  { id: 'example-interaction', title: '交互与埋点示例', path: '/admin/examples/interaction', visibility: 'admin' },
  { id: 'example-api', title: 'API 请求示例', path: '/admin/examples/api', visibility: 'admin' },
]

vi.mock('@/lib/page-registry', () => ({
  getPages: () => currentPages,
}))

import { apiClient } from '@/lib/api-client'

const mockOverview = {
  page_views: [
    { page_id: 'dashboard', count: 8 },
    { page_id: 'example-content', count: 3 },
    { page_id: 'home', count: 2 },
    { page_id: 'sample-dynamic', count: 2 },
  ],
  feature_clicks: [
    { page_id: 'sample-dynamic', feature_id: 'removed-refresh', count: 11 },
    { page_id: 'example-interaction', feature_id: 'increment-counter', count: 5 },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

function summaryCard(label: string): HTMLElement {
  const card = screen.getByText(label).parentElement
  if (!card) throw new Error(`missing summary card: ${label}`)
  return card
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists current registry pages with linked titles and paths', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockOverview,
    })

    renderPage()

    await screen.findByRole('link', { name: '静态内容示例' })

    for (const page of currentPages) {
      expect(screen.getByRole('link', { name: page.title })).toHaveAttribute(
        'href',
        page.path,
      )
      expect(screen.getByRole('link', { name: page.path })).toHaveAttribute(
        'href',
        page.path,
      )
    }
  })

  it('hides telemetry from removed pages and excludes it from summaries', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockOverview,
    })

    renderPage()

    await screen.findByRole('link', { name: '分析仪表盘' })

    expect(screen.queryByText('home')).not.toBeInTheDocument()
    expect(screen.queryByText('sample-dynamic')).not.toBeInTheDocument()
    expect(screen.queryByText('removed-refresh')).not.toBeInTheDocument()
    expect(screen.queryByText('未知页面')).not.toBeInTheDocument()
    expect(screen.queryByText('孤儿')).not.toBeInTheDocument()
    expect(screen.queryByText('(孤儿)')).not.toBeInTheDocument()

    expect(summaryCard('页面总数')).toHaveTextContent('4')
    expect(summaryCard('总访问量')).toHaveTextContent('11')
    expect(summaryCard('功能点击')).toHaveTextContent('5')
  })

  it('shows zero visits for current pages without telemetry', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockOverview,
    })

    renderPage()

    const apiLink = await screen.findByRole('link', { name: 'API 请求示例' })
    const row = apiLink.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLTableRowElement).getByText('0')).toBeInTheDocument()
  })

  it('renders current feature usage in backend order', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockOverview,
    })

    renderPage()

    expect(await screen.findByText('increment-counter')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getAllByText('example-interaction').length).toBeGreaterThan(0)
  })

  it('shows loading state initially', () => {
    vi.mocked(apiClient.get).mockReturnValueOnce(new Promise(() => {}))
    renderPage()
    expect(screen.getByText('加载埋点数据中…')).toBeInTheDocument()
  })

  it('shows an error state when the request fails', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(
      new Error('Aux API request failed: 503'),
    )

    renderPage()

    expect(await screen.findByText('数据暂不可用')).toBeInTheDocument()
    expect(screen.getByText(/无法读取埋点分析数据/)).toBeInTheDocument()
  })

  it('shows an error state for a non-zero envelope', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 500,
      message: 'internal error',
    })

    renderPage()

    expect(await screen.findByText('数据暂不可用')).toBeInTheDocument()
  })

  it('shows an empty feature message when current pages have no clicks', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: {
        page_views: [{ page_id: 'dashboard', count: 1 }],
        feature_clicks: [
          { page_id: 'sample-dynamic', feature_id: 'removed-refresh', count: 7 },
        ],
      },
    })

    renderPage()

    expect(await screen.findByText('暂无功能使用记录。')).toBeInTheDocument()
    expect(summaryCard('功能点击')).toHaveTextContent('0')
  })

  it('calls the analytics overview endpoint', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: { page_views: [], feature_clicks: [] },
    })

    renderPage()

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/admin/analytics/overview')
    })
  })
})
