import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { DEFAULT_HOMEPAGE_CONFIG } from '@/lib/homepage'
import HomepagePage from './HomepagePage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }))
vi.mock('gsap', () => ({ default: { registerPlugin: vi.fn() } }))
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }))
vi.mock('@/lib/thinkingOrbRuntime', () => ({
  ThinkingOrbRuntime: vi.fn().mockImplementation(() => ({ update: vi.fn(), destroy: vi.fn() })),
}))
vi.mock('./HomepageQuickstart', () => ({ HomepageQuickstart: () => null }))

describe('HomepagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('renders configured links in order in embedded mode and closes the mobile menu', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: {
      ...DEFAULT_HOMEPAGE_CONFIG,
      navigationItems: [{ label: '文档中心', href: 'https://docs.example.com' }, { label: '状态', href: '#metrics' }],
    } })
    render(<MemoryRouter initialEntries={['/embed']}><HomepagePage /></MemoryRouter>)
    const nav = within(screen.getByRole('navigation', { name: '主导航' }))
    const docs = await nav.findByRole('link', { name: '文档中心' })
    expect(nav.getAllByRole('link').map(link => link.textContent?.trim())).toEqual(['S2Sub2API', '文档中心', '状态', '进入控制台'])
    expect(docs).toHaveAttribute('href', 'https://docs.example.com')
    expect(docs).toHaveAttribute('target', '_blank')
    expect(docs).toHaveAttribute('rel', 'noreferrer')
    await user.click(nav.getByRole('button', { name: '打开菜单' }))
    await user.click(nav.getByRole('link', { name: '状态' }))
    expect(nav.getByRole('button', { name: '打开菜单' })).toBeInTheDocument()
  })

  it('hides disabled section anchors and unsafe URLs while preserving external links', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: {
      ...DEFAULT_HOMEPAGE_CONFIG,
      showDevelopersSection: false,
      showQuickstartSection: false,
      navigationItems: [
        { label: '教程', href: '#quickstart' },
        { label: '开发', href: '#developers' },
        { label: '伙伴', href: '#partners' },
        { label: '脚本', href: 'javascript:alert(1)' },
        { label: '文档中心', href: 'https://docs.example.com' },
      ],
    } })
    render(<MemoryRouter><HomepagePage /></MemoryRouter>)
    const nav = within(screen.getByRole('navigation', { name: '主导航' }))
    await nav.findByRole('link', { name: '文档中心' })
    expect(nav.getAllByRole('link')).toHaveLength(3)
  })

  it.each([
    { name: 'legacy defaults', data: {}, count: 6 },
    { name: 'explicitly empty menus', data: { navigationItems: [] }, count: 2 },
  ])('supports $name', async ({ data, count }) => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data })
    const { container } = render(<MemoryRouter><HomepagePage /></MemoryRouter>)
    await waitFor(() => expect(container.querySelector('.sub2api-home')).toHaveAttribute('data-loading', 'false'))
    const nav = within(screen.getByRole('navigation', { name: '主导航' }))
    expect(nav.getAllByRole('link')).toHaveLength(count)
    expect(nav.getByRole('link', { name: '进入控制台' })).toHaveAttribute('href', '/admin')
  })

  it.each([
    { name: 'dedicated external URL', data: { developersDocsUrl: 'https://docs.example.com/quickstart', documentationUrl: 'https://docs.example.com' }, href: 'https://docs.example.com/quickstart', external: true },
    { name: 'internal URL', data: { developersDocsUrl: '/guide' }, href: '/guide', external: false },
    { name: 'legacy documentation fallback', data: { documentationUrl: 'https://docs.example.com' }, href: 'https://docs.example.com', external: true },
  ])('links the builders button to $name in embedded mode', async ({ data, href, external }) => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { ...DEFAULT_HOMEPAGE_CONFIG, ...data } })
    render(<MemoryRouter initialEntries={['/embed']}><HomepagePage /></MemoryRouter>)

    const button = await screen.findByRole('link', { name: '接入文档' })
    expect(button.closest('section')).toHaveAttribute('id', 'developers')
    expect(button).toHaveAttribute('href', href)
    if (external) {
      expect(button).toHaveAttribute('target', '_blank')
      expect(button).toHaveAttribute('rel', 'noreferrer')
    } else {
      expect(button).not.toHaveAttribute('target')
    }
  })

  it.each([
    { name: 'unconfigured documentation', data: {} },
    { name: 'unsafe documentation', data: { developersDocsUrl: 'javascript:alert(1)' } },
    { name: 'disabled builders section', data: { showDevelopersSection: false, developersDocsUrl: '/guide' } },
  ])('hides the builders button for $name', async ({ data }) => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { ...DEFAULT_HOMEPAGE_CONFIG, ...data } })
    const { container } = render(<MemoryRouter><HomepagePage /></MemoryRouter>)

    await waitFor(() => expect(container.querySelector('.sub2api-home')).toHaveAttribute('data-loading', 'false'))
    expect(screen.queryByRole('link', { name: '接入文档' })).not.toBeInTheDocument()
  })
})
