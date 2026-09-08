import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HomepageConfigPage from './HomepageConfigPage'
import { apiClient } from '@/lib/api-client'
import { DEFAULT_HOMEPAGE_CONFIG, type HomepageConfig } from '@/lib/homepage'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('HomepageConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({
      code: 0,
      message: 'success',
      data: DEFAULT_HOMEPAGE_CONFIG,
    })
  })

  it('keeps partner inputs focused while typing', async () => {
    const user = userEvent.setup()

    render(<HomepageConfigPage />)

    await user.click(await screen.findByRole('button', { name: '添加伙伴' }))
    const nameInput = screen.getByRole('textbox', { name: '伙伴 1 名称' })
    await user.type(nameInput, 'Alpha')

    expect(nameInput).toHaveValue('Alpha')
    expect(nameInput).toHaveFocus()
  })

  it('allows configuring an integration logo and documentation link', async () => {
    const user = userEvent.setup()

    render(<HomepageConfigPage />)

    await user.click(await screen.findByRole('button', { name: '添加应用' }))
    const nameInput = screen.getByRole('textbox', { name: '应用 1 名称' })
    const logoInput = screen.getByRole('textbox', { name: '应用 1 Logo' })
    const documentationInput = screen.getByRole('textbox', { name: '应用 1 文档' })

    await user.type(nameInput, 'OpenAI')
    await user.type(logoInput, 'https://example.com/openai.svg')
    await user.type(documentationInput, 'https://docs.example.com/openai')

    expect(nameInput).toHaveValue('OpenAI')
    expect(logoInput).toHaveValue('https://example.com/openai.svg')
    expect(documentationInput).toHaveValue('https://docs.example.com/openai')
  })

  it('allows configuring the website logo URL', async () => {
    const user = userEvent.setup()

    render(<HomepageConfigPage />)

    const logoInput = await screen.findByRole('textbox', { name: '官网 Logo URL' })
    await user.type(logoInput, 'https://example.com/logo.svg')

    expect(logoInput).toHaveValue('https://example.com/logo.svg')
  })

  it('allows configuring service metrics and descriptions', async () => {
    const user = userEvent.setup()

    render(<HomepageConfigPage />)

    const availabilityInput = await screen.findByRole('textbox', { name: '服务可用性' })
    await user.clear(availabilityInput)
    await user.type(availabilityInput, '99.95%')

    const descriptionInput = screen.getByRole('textbox', { name: '可用性描述' })
    await user.clear(descriptionInput)
    await user.type(descriptionInput, '核心服务持续稳定运行')

    expect(availabilityInput).toHaveValue('99.95%')
    expect(descriptionInput).toHaveValue('核心服务持续稳定运行')
    expect(descriptionInput).toHaveFocus()
  })

  it('allows toggling the developers section', async () => {
    const user = userEvent.setup()

    render(<HomepageConfigPage />)

    const toggle = await screen.findByRole('switch', { name: '展示开发者板块' })
    expect(toggle).toHaveAttribute('data-state', 'checked')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('data-state', 'unchecked')
  })

  it('allows toggling the quickstart section', async () => {
    const user = userEvent.setup()

    render(<HomepageConfigPage />)

    const toggle = await screen.findByRole('switch', { name: '展示快速接入板块' })
    expect(toggle).toHaveAttribute('data-state', 'checked')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('data-state', 'unchecked')
  })

  it('saves the builders documentation URL independently of general documentation', async () => {
    const user = userEvent.setup()
    const config = { ...DEFAULT_HOMEPAGE_CONFIG, documentationUrl: 'https://docs.example.com' }
    const developersDocsUrl = 'https://docs.example.com/quickstart'
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: config })
    vi.mocked(apiClient.put).mockResolvedValue({ code: 0, data: { ...config, developersDocsUrl } })
    render(<HomepageConfigPage />)

    const input = await screen.findByRole('textbox', { name: '接入文档 URL' })
    await user.type(input, developersDocsUrl)
    expect(input).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(apiClient.put).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({
      developersDocsUrl,
      documentationUrl: config.documentationUrl,
    }))
    expect(screen.getByRole('textbox', { name: '接入文档 URL' })).toHaveValue(developersDocsUrl)
  })

  it('edits, reorders and saves navigation without losing input focus', async () => {
    const user = userEvent.setup()
    const config = { ...DEFAULT_HOMEPAGE_CONFIG, navigationItems: [{ label: '文档', href: '/guide' }] }
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: config })
    const navigationItems = [{ label: '价格', href: 'https://example.com/pricing' }]
    vi.mocked(apiClient.put).mockResolvedValue({ code: 0, data: { ...config, navigationItems } })
    render(<HomepageConfigPage />)

    const firstName = await screen.findByRole('textbox', { name: '菜单 1 名称' })
    await user.type(firstName, '中心')
    expect(firstName).toHaveValue('文档中心')
    expect(firstName).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '添加菜单' }))
    await user.type(screen.getByRole('textbox', { name: '菜单 2 名称' }), '价格')
    await user.type(screen.getByRole('textbox', { name: '菜单 2 链接' }), 'https://example.com/pricing')
    await user.click(screen.getByRole('button', { name: '上移菜单 2' }))
    expect(screen.getByRole('textbox', { name: '菜单 1 名称' })).toHaveValue('价格')
    await user.click(screen.getByRole('button', { name: '下移菜单 1' }))
    expect(screen.getByRole('textbox', { name: '菜单 1 名称' })).toHaveValue('文档中心')
    await user.click(screen.getByRole('button', { name: '删除菜单 1' }))
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(apiClient.put).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ navigationItems }))
    expect(screen.getByRole('textbox', { name: '菜单 1 名称' })).toHaveValue('价格')
  })

  it('saves an explicitly empty navigation list', async () => {
    const user = userEvent.setup()
    const config = { ...DEFAULT_HOMEPAGE_CONFIG, navigationItems: [{ label: '文档', href: '/guide' }] }
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: config })
    vi.mocked(apiClient.put).mockResolvedValue({ code: 0, data: { ...config, navigationItems: [] } })
    render(<HomepageConfigPage />)

    await user.click(await screen.findByRole('button', { name: '删除菜单 1' }))
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(apiClient.put).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ navigationItems: [] }))
    expect(screen.queryByRole('textbox', { name: '菜单 1 名称' })).not.toBeInTheDocument()
  })

  it('defaults legacy menus and rejects unsafe navigation links before saving', async () => {
    const user = userEvent.setup()
    const config: Partial<HomepageConfig> = { ...DEFAULT_HOMEPAGE_CONFIG }
    delete config.navigationItems
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: config })
    render(<HomepageConfigPage />)

    expect(await screen.findByRole('textbox', { name: '菜单 1 名称' })).toHaveValue('安全')
    const href = screen.getByRole('textbox', { name: '菜单 1 链接' })
    await user.clear(href)
    await user.type(href, 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(screen.getByRole('alert')).toHaveTextContent('菜单 1')
    expect(apiClient.put).not.toHaveBeenCalled()
  })
})
