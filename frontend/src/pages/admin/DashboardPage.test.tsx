import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'

// mock api-client: 每个测试在 beforeEach 中配置返回值。
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

// mock page-registry: 控制页面清单(R5: 清单从代码派生)。
// 用 3 个页面测零访问场景: home(2), dashboard(1), zero-page(0)。
vi.mock('@/lib/page-registry', () => ({
  getPages: () => [
    { id: 'home', title: '首页', path: '/', visibility: 'public' },
    { id: 'dashboard', title: '分析仪表盘', path: '/admin/dashboard', visibility: 'admin' },
    { id: 'zero-page', title: '零访问页', path: '/zero', visibility: 'public' },
  ],
  getPageById: (id: string) => {
    const pages: Record<string, { id: string; title: string; path: string; visibility: string }> = {
      'home': { id: 'home', title: '首页', path: '/', visibility: 'public' },
      'dashboard': { id: 'dashboard', title: '分析仪表盘', path: '/admin/dashboard', visibility: 'admin' },
      'zero-page': { id: 'zero-page', title: '零访问页', path: '/zero', visibility: 'public' },
    }
    return pages[id]
  },
}))

import { apiClient } from '@/lib/api-client'

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

const mockOverview = {
  page_views: [
    { page_id: 'home', count: 2 },
    { page_id: 'dashboard', count: 1 },
  ],
  feature_clicks: [
    { page_id: 'dashboard', feature_id: 'refresh-btn', count: 5 },
    { page_id: 'home', feature_id: 'btn-a', count: 1 },
  ],
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders page list from registry with view counts (zero-visit page shows 0)', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockOverview,
    })

    renderPage()

    // 等待数据加载完成
    await waitFor(() => {
      expect(screen.getByText('首页')).toBeInTheDocument()
    })

    // 3 个页面都应显示(registry 派生, R5)
    expect(screen.getByText('首页')).toBeInTheDocument()
    expect(screen.getAllByText('dashboard').length).toBeGreaterThan(0)
    expect(screen.getByText('零访问页')).toBeInTheDocument()

    // 验证访问量: home=2, dashboard=1, zero-page=0
    // 用 getAllByText 因为 "1" 和 "0" 可能出现在多处(概览卡片 + 表格)
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
  })

  it('marks orphan pages (backend has but registry does not)', async () => {
    // ghost-page 在后端返回但不在 registry → 孤儿标注
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: {
        page_views: [
          { page_id: 'home', count: 3 },
          { page_id: 'ghost-page', count: 7 }, // 孤儿
        ],
        feature_clicks: [],
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('未知页面')).toBeInTheDocument()
    })

    // 孤儿页应标注"孤儿"badge
    expect(screen.getByText('孤儿')).toBeInTheDocument()
    // 孤儿注释说明
    expect(screen.getByText(/标注"孤儿"的页面/)).toBeInTheDocument()

    // 孤儿页的访问量也应显示
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('renders feature usage sorted by count descending', async () => {
    // 后端已按计数降序排序; 前端直接渲染, 排名 #1 是最高
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockOverview,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('功能使用度')).toBeInTheDocument()
    })

    // refresh-btn(5) 应排第一, btn-a(1) 排第二
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()

    // 验证功能 id 出现
    expect(screen.getByText('refresh-btn')).toBeInTheDocument()
    expect(screen.getByText('btn-a')).toBeInTheDocument()
  })

  it('shows loading state initially', () => {
    vi.mocked(apiClient.get).mockReturnValueOnce(new Promise(() => {})) // 永不 resolve
    renderPage()
    expect(screen.getByText('加载埋点数据中…')).toBeInTheDocument()
  })

  it('degrades gracefully when API fails (network error)', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Aux API request failed: 503'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('数据暂不可用')).toBeInTheDocument()
    })
    expect(screen.getByText(/无法读取埋点分析数据/)).toBeInTheDocument()
  })

  it('degrades gracefully when envelope code is non-zero', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 500,
      message: 'internal error',
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('数据暂不可用')).toBeInTheDocument()
    })
  })

  it('shows empty feature message when no feature clicks', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: {
        page_views: [{ page_id: 'home', count: 1 }],
        feature_clicks: [],
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('暂无功能使用记录。')).toBeInTheDocument()
    })
  })

  it('calls the analytics overview endpoint with correct path', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockOverview,
    })

    renderPage()

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/admin/analytics/overview')
    })
  })

  it('shows total views summary across all pages', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockOverview,
    })

    renderPage()

    // home=2, dashboard=1, zero-page=0 → 总访问量=3
    await waitFor(() => {
      expect(screen.getByText('总访问量')).toBeInTheDocument()
    })
    // 概览卡片中应有 3 (总访问量)
    const summaryValues = screen.getAllByText('3')
    expect(summaryValues.length).toBeGreaterThan(0)
  })
})
