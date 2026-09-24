import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api-client'
import UserGuidePage from './UserGuidePage'

const { trackPageView, trackFeatureClick } = vi.hoisted(() => ({ trackPageView: vi.fn(), trackFeatureClick: vi.fn() }))

vi.mock('@/lib/telemetry-sdk', () => ({ trackPageView, trackFeatureClick }))
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }))

describe('UserGuidePage', () => {
  beforeEach(() => {
    trackPageView.mockClear()
    trackFeatureClick.mockClear()
    vi.mocked(apiClient.get).mockRejectedValue(new Error('配置服务不可用'))
  })

  afterEach(() => cleanup())

  function renderPage() {
    return render(<MemoryRouter><UserGuidePage /></MemoryRouter>)
  }

  it('renders the beginner flow and all screenshot placeholders', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: /照着 7 步走，第一次请求就能跑通/ })).toBeInTheDocument()
    expect(screen.getAllByText(/截图待补充/)).toHaveLength(6)
    expect(screen.getByRole('heading', { name: /创建 API Key，并马上保存/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /导入 Provider，先不用手动填模型/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /在 CCSwitch 里点击启用/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /打开 Codex，输入 hi/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /回控制台看用量/ })).toBeInTheDocument()
    expect(screen.getAllByText(window.location.origin)).toHaveLength(2)
    expect(trackPageView).toHaveBeenCalledWith('user-guide')
  })

  it('keeps Codex at the current-origin root while versioning direct API examples', () => {
    renderPage()

    const origin = window.location.origin
    expect(screen.getByLabelText('CC Switch · Codex Provider')).toHaveTextContent(`Base URL ${origin}`)
    expect(screen.getByLabelText('查询模型列表')).toHaveTextContent(`curl ${origin}/v1/models`)
    expect(screen.getByLabelText('发送最小 Responses 请求')).toHaveTextContent(`curl ${origin}/v1/responses`)
    expect(screen.getByLabelText('Python SDK')).toHaveTextContent(`base_url="${origin}/v1"`)
    expect(screen.getByLabelText('CC Switch · Codex Provider')).not.toHaveTextContent(`${origin}/v1`)
  })

  it('continues reading the public system name without replacing the current-origin API address', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      code: 0,
      message: 'success',
      data: {
        siteName: '测试平台',
        systemDomain: 'https://legacy.example.com/v1',
      },
    } as never)
    renderPage()

    await waitFor(() => expect(screen.getByText('测试平台 新手教程 · 示例模型 ID 和 API Key 均为占位值。')).toBeInTheDocument())
    expect(screen.getAllByText(window.location.origin)).toHaveLength(2)
    expect(screen.queryByText('https://legacy.example.com/v1')).not.toBeInTheDocument()
  })

  it('supports chapter navigation and theme switching', () => {
    renderPage()
    fireEvent.click(screen.getAllByRole('link', { name: /配置客户端/ })[0])
    expect(trackFeatureClick).toHaveBeenCalledWith('user-guide', expect.stringMatching(/^section-/))
    fireEvent.click(screen.getByRole('button', { name: /切换深色/ }))
    expect(document.querySelector('.user-guide')).toHaveAttribute('data-theme', 'dark')
    expect(trackFeatureClick).toHaveBeenCalledWith('user-guide', 'theme-dark')
  })
})
