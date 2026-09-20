import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { DEFAULT_TOB_HOMEPAGE_CONFIG, type TobMapSettings } from '@/lib/tob-homepage'
import TobHomepagePage from './TobHomepagePage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }))
vi.mock('@/components/TobNetworkMap', () => ({ TobNetworkMap: ({ settings }: { settings: TobMapSettings }) => <div data-testid="tob-network-map" data-route-style={settings.routeStyle} /> }))
vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }))
vi.mock('gsap', () => ({ default: { registerPlugin: vi.fn() } }))
vi.mock('gsap/ScrollTrigger', () => ({ ScrollTrigger: {} }))
vi.mock('@/lib/thinkingOrbRuntime', () => ({
  ThinkingOrbRuntime: vi.fn().mockImplementation(() => ({ update: vi.fn(), destroy: vi.fn() })),
}))
vi.mock('./HomepageQuickstart', () => ({
  HomepageQuickstart: ({ variant }: { variant?: string }) => <section id="quickstart" data-testid="homepage-quickstart" data-variant={variant} />,
}))

describe('TobHomepagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: {
      ...DEFAULT_TOB_HOMEPAGE_CONFIG,
      cdnLocations: [{ name: '东京 CDN', latitude: 35.68, longitude: 139.69 }],
      customerLocations: [{ name: '新加坡客户', latitude: 1.35, longitude: 103.82 }],
    } })
  })

  it('renders the enterprise information architecture in navigation and page order', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/tob-home']}><TobHomepagePage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: DEFAULT_TOB_HOMEPAGE_CONFIG.heroTitle })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /关键指标/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /把企业级 AI 调用/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /你的数据/ })).toBeInTheDocument()
    expect(screen.queryByTestId('homepage-quickstart')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /全球节点覆盖/ })).toBeInTheDocument()
    expect(screen.getByText(/让客户就近接入，缩短数据传输路径/)).toBeInTheDocument()
    expect(screen.getByText(/提供国内优化节点，对中国大陆用户同样友好/)).toBeInTheDocument()
    expect(screen.getByTestId('tob-network-map')).toBeInTheDocument()
    expect(screen.getByTestId('tob-network-map')).toHaveAttribute('data-route-style', DEFAULT_TOB_HOMEPAGE_CONFIG.mapSettings.routeStyle)
    expect(screen.queryByRole('link', { name: 'Scroll to explore' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('全球网络节点统计')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /从代码/ })).not.toBeInTheDocument()
    expect(container.querySelector('#developers')).not.toBeInTheDocument()
    expect(container.querySelector('a[href="#developers"]')).not.toBeInTheDocument()

    const navigation = within(await screen.findByRole('navigation', { name: '主导航' }))
    expect(Array.from(container.querySelectorAll('.sub2api-nav-items > a')).map(link => link.textContent?.trim()).slice(0, 5)).toEqual([
      '企业能力',
      '全球网络',
      '数据安全',
      '接入生态',
    ])
    expect(navigation.getByRole('link', { name: '全球网络' })).toHaveAttribute('href', '#network')

    expect(Array.from(container.querySelectorAll('main > section[id]')).map(section => section.id)).toEqual([
      'metrics',
      'capabilities',
      'network',
      'security',
      'ecosystem',
    ])
    expect(screen.getAllByRole('link', { name: DEFAULT_TOB_HOMEPAGE_CONFIG.primaryCta })).toHaveLength(2)
  })

  it('renders the configured ToB navigation labels and destinations', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: {
      ...DEFAULT_TOB_HOMEPAGE_CONFIG,
      navigationItems: [
        { label: '企业方案', href: '#capabilities' },
        { label: '交付路线', href: '#quickstart' },
        { label: '客户案例', href: 'https://example.com/cases' },
      ],
    } })

    render(<MemoryRouter initialEntries={['/tob-home']}><TobHomepagePage /></MemoryRouter>)

    const navigation = within(await screen.findByRole('navigation', { name: '主导航' }))
    expect(await navigation.findByRole('link', { name: '企业方案' })).toHaveAttribute('href', '#capabilities')
    expect(navigation.queryByRole('link', { name: '交付路线' })).not.toBeInTheDocument()
    expect(navigation.getByRole('link', { name: '客户案例' })).toHaveAttribute('href', 'https://example.com/cases')
    expect(navigation.queryByRole('link', { name: '企业能力' })).not.toBeInTheDocument()
  })
})
