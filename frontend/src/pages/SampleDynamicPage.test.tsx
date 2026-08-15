import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SampleDynamicPage from './SampleDynamicPage'

// mock api-client: 每个测试在 beforeEach 中配置返回值。
vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

import { apiClient } from '@/lib/api-client'

function renderPage() {
  return render(
    <MemoryRouter>
      <SampleDynamicPage />
    </MemoryRouter>,
  )
}

const mockStats = {
  total_users: 100,
  today_new_users: 5,
  active_users: 20,
  total_api_keys: 10,
  active_api_keys: 8,
  total_accounts: 3,
  normal_accounts: 2,
  error_accounts: 1,
  total_requests: 1000,
  total_tokens: 50000,
  total_cost: 12.34,
  today_requests: 100,
  today_tokens: 5000,
  today_cost: 1.23,
  uptime: 3600,
  rpm: 50,
  tpm: 2500,
  stats_updated_at: '2026-08-14T10:00:00Z',
  stats_stale: false,
}

describe('SampleDynamicPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders stat cards when sub2api data loads successfully', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockStats,
    })

    renderPage()

    // 等待数据加载完成, 验证统计值渲染
    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument()
    })
    expect(screen.getByText('总用户数')).toBeInTheDocument()
    expect(screen.getByText('API Key 总数')).toBeInTheDocument()
    expect(screen.getByText('12.34')).toBeInTheDocument() // 总成本 (cost 格式)
  })

  it('shows loading state initially', () => {
    vi.mocked(apiClient.get).mockReturnValueOnce(new Promise(() => {})) // 永不 resolve
    renderPage()
    expect(screen.getByText('加载 sub2api 数据中…')).toBeInTheDocument()
  })

  it('degrades gracefully when proxy fails (network error)', async () => {
    // 降级: 涵盖无会话(401)/proxy 失败(502/503)/网络错误, 不崩。
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('Aux API request failed: 503'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('数据暂不可用')).toBeInTheDocument()
    })
    expect(screen.getByText(/无法读取 sub2api 数据/)).toBeInTheDocument()
  })

  it('degrades gracefully when envelope code is non-zero', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 502,
      message: 'sub2api request failed',
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('数据暂不可用')).toBeInTheDocument()
    })
  })

  it('shows stale warning when stats_stale is true', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: { ...mockStats, stats_stale: true },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/统计数据可能非最新/)).toBeInTheDocument()
    })
  })

  it('calls the proxy endpoint with the correct path', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: mockStats,
    })

    renderPage()

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledWith('/admin/sub2api/dashboard-stats')
    })
  })
})
