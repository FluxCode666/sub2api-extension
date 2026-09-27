import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { fetchHomepageConfig } from '@/lib/homepage'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import ClientImportPage from './ClientImportPage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@/lib/homepage', () => ({ fetchHomepageConfig: vi.fn() }))
vi.mock('@/lib/telemetry-sdk', () => ({ trackFeatureClick: vi.fn(), trackPageView: vi.fn() }))

const key = {
  id: 3,
  key: 'sk-secret-client-import-test',
  name: '测试密钥',
  group_id: null,
  status: 'active',
  expires_at: null,
  created_at: '2026-09-24T00:00:00Z',
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })))
  vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { items: [key] } })
  vi.mocked(fetchHomepageConfig).mockResolvedValue({ siteName: '测试站点' } as Awaited<ReturnType<typeof fetchHomepageConfig>>)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ClientImportPage', () => {
  it.each(['/client-import?embed=1', '/client-import?ui_mode=embedded'])('hides the top menu for embedded entry %s', async (entry) => {
    render(<MemoryRouter initialEntries={[entry]}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    expect(document.querySelector('.client-import-page')).toHaveClass('client-import-page--embedded')
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看接入文档' })).not.toBeInTheDocument()
  })

  it('provides confirmed deep links for both clients and masks the nested Chatbox API key', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    const ccSwitchLink = screen.getByRole('link', { name: '打开 CC Switch 导入确认' })
    expect(ccSwitchLink).toHaveAttribute('target', '_blank')
    expect(ccSwitchLink).toHaveAttribute('rel', 'noopener noreferrer')
    await user.click(screen.getByRole('tab', { name: /Cherry \/ Chatbox/ }))

    const cherryLink = screen.getByRole('link', { name: '一键导入 Cherry Studio' })
    expect(cherryLink).toHaveAttribute('href', expect.stringMatching(/^cherrystudio:\/\/providers\/api-keys\?v=1&data=/))
    expect(cherryLink).toHaveAttribute('target', '_blank')
    expect(cherryLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(screen.getByLabelText('Cherry Studio 配置预览')).getByText(/••••/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Chatbox/ }))
    const chatboxLink = screen.getByRole('link', { name: '一键导入 Chatbox' })
    expect(chatboxLink).toHaveAttribute('href', expect.stringMatching(/^chatbox:\/\/provider\/import\?config=/))
    expect(chatboxLink).toHaveAttribute('target', '_blank')
    expect(chatboxLink).toHaveAttribute('rel', 'noopener noreferrer')
    const preview = screen.getByLabelText('Chatbox 配置预览')
    expect(preview).toHaveTextContent('apiKey')
    expect(preview).not.toHaveTextContent(key.key)
    expect(trackFeatureClick).toHaveBeenCalledWith('client-import', 'select-chatbox')

    await user.clear(screen.getByLabelText('API 基础地址'))
    expect(screen.queryByRole('link', { name: '一键导入 Chatbox' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '填写完整参数后继续' })).toBeDisabled()
  })

  it('offers ZCode and WorkBuddy configuration downloads with masked previews', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    await user.click(screen.getByRole('tab', { name: '配置文件' }))
    expect(screen.getByRole('radio', { name: /ZCode/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /WorkBuddy/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载 ZCode 配置' })).toBeInTheDocument()
    expect(screen.getByLabelText('ZCode 配置预览')).not.toHaveTextContent(key.key)
    expect(screen.getByLabelText('ZCode 配置预览')).toHaveTextContent('anthropic-messages')

    await user.click(screen.getByRole('radio', { name: /WorkBuddy/ }))
    expect(screen.getByRole('button', { name: '下载 WorkBuddy 配置' })).toBeInTheDocument()
    expect(screen.getByLabelText('WorkBuddy 配置预览')).toHaveTextContent('availableModels')
    expect(screen.getByLabelText('WorkBuddy 配置预览')).not.toHaveTextContent(key.key)
  })
})
