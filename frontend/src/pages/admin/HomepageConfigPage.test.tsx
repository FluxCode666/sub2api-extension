import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomepageConfigPage from './HomepageConfigPage'
import { apiClient } from '@/lib/api-client'
import { DEFAULT_HOMEPAGE_CONFIG } from '@/lib/homepage-config'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), put: vi.fn() },
}))

vi.mock('@/lib/telemetry-sdk', () => ({
  trackFeatureClick: vi.fn(),
}))

describe('HomepageConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, message: 'success', data: DEFAULT_HOMEPAGE_CONFIG })
  })

  it('explains that the partner section stays hidden when empty', async () => {
    render(<MemoryRouter><HomepageConfigPage /></MemoryRouter>)
    expect(await screen.findByText('当前不展示伙伴板块')).toBeInTheDocument()
  })

  it('adds a partner and saves the homepage configuration', async () => {
    vi.mocked(apiClient.put).mockResolvedValue({
      code: 0,
      message: 'success',
      data: { ...DEFAULT_HOMEPAGE_CONFIG, trustedPartners: [{ name: 'Alpha', logoUrl: '', linkUrl: '' }] },
    })
    render(<MemoryRouter><HomepageConfigPage /></MemoryRouter>)

    fireEvent.click(await screen.findByRole('button', { name: '添加伙伴' }))
    fireEvent.change(screen.getByLabelText('品牌名称'), { target: { value: 'Alpha' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/admin/homepage/config',
        expect.objectContaining({ trustedPartners: [expect.objectContaining({ name: 'Alpha' })] }),
      )
    })
    expect(await screen.findByText('官网首页配置已保存。')).toBeInTheDocument()
  })

  it('configures the navigation console link', async () => {
    vi.mocked(apiClient.put).mockResolvedValue({
      code: 0,
      message: 'success',
      data: { ...DEFAULT_HOMEPAGE_CONFIG, consoleHref: 'https://console.example.com' },
    })
    render(<MemoryRouter><HomepageConfigPage /></MemoryRouter>)

    fireEvent.change(await screen.findByLabelText('顶部导航控制台链接'), {
      target: { value: 'https://console.example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => {
      expect(apiClient.put).toHaveBeenCalledWith(
        '/admin/homepage/config',
        expect.objectContaining({ consoleHref: 'https://console.example.com' }),
      )
    })
  })
})
