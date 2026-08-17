import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import HomePage from './HomePage'
import { DEFAULT_HOMEPAGE_CONFIG, loadHomepageConfig } from '@/lib/homepage-config'

vi.mock('@/lib/homepage-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/homepage-config')>()
  return { ...actual, loadHomepageConfig: vi.fn() }
})

vi.mock('@/lib/telemetry-sdk', () => ({
  trackFeatureClick: vi.fn(),
}))

describe('HomePage', () => {
  beforeEach(() => {
    vi.mocked(loadHomepageConfig).mockResolvedValue(DEFAULT_HOMEPAGE_CONFIG)
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    document.documentElement.classList.remove('dark')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('renders the confirmed AI gateway positioning and hides empty partners', async () => {
    render(<HomePage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('TERALEMO')
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()

    await waitFor(() => expect(loadHomepageConfig).toHaveBeenCalledOnce())
    expect(screen.queryByRole('heading', { name: '受信赖的伙伴' })).not.toBeInTheDocument()
  })

  it('shows configured partners and only renders configured logos', async () => {
    vi.mocked(loadHomepageConfig).mockResolvedValue({
      ...DEFAULT_HOMEPAGE_CONFIG,
      trustedPartners: [
        { name: 'Alpha', logoUrl: 'https://example.com/alpha.svg' },
        { name: 'Beta' },
      ],
    })
    const { container } = render(<HomePage />)

    expect(await screen.findByRole('heading', { name: '受信赖的伙伴' })).toBeInTheDocument()
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Beta').length).toBeGreaterThan(1)
    const logos = Array.from(container.querySelectorAll('.teralemo-partner img'))
    expect(logos.length).toBeGreaterThan(0)
    expect(logos.every((logo) => logo.parentElement?.textContent === 'Alpha')).toBe(true)
  })

  it('switches between light and dark themes', () => {
    vi.mocked(loadHomepageConfig).mockReturnValue(new Promise(() => {}))
    render(<HomePage />)

    const themeButton = screen.getByRole('button', { name: '切换到深色主题' })
    expect(themeButton.querySelector('svg')).toBeInTheDocument()
    expect(themeButton).not.toHaveTextContent('暗')

    fireEvent.click(themeButton)
    expect(document.documentElement).toHaveClass('dark')
    expect(screen.getByRole('button', { name: '切换到浅色主题' })).toBeInTheDocument()
  })

  it('uses the configured console link in the navigation', async () => {
    vi.mocked(loadHomepageConfig).mockResolvedValue({
      ...DEFAULT_HOMEPAGE_CONFIG,
      consoleHref: 'https://console.example.com',
    })
    render(<HomePage />)

    expect(await screen.findByRole('link', { name: '控制台' })).toHaveAttribute(
      'href',
      'https://console.example.com',
    )
  })

  it('switches language examples and copies the active code', async () => {
    render(<HomePage />)

    expect(screen.getByRole('tab', { name: 'Chat Completions' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Responses API' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('/v1/responses')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('gpt-5.6-sol')

    fireEvent.click(screen.getByRole('tab', { name: 'Anthropic Messages' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('anthropic-version')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('/v1/messages')

    fireEvent.click(screen.getByRole('tab', { name: 'Chat Completions' }))
    expect(screen.getByRole('tab', { name: 'cURL' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('curl https://api.teralemo.com')

    fireEvent.click(screen.getByRole('tab', { name: 'Python' }))
    expect(screen.getByRole('tab', { name: 'Python' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('requests.post')

    fireEvent.click(screen.getByRole('button', { name: '复制 Python 示例' }))
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('requests.post'))
    })
    expect(screen.getByText('已复制')).toBeInTheDocument()
  })

  it('uses the configured model across protocol examples', async () => {
    vi.mocked(loadHomepageConfig).mockResolvedValue({ ...DEFAULT_HOMEPAGE_CONFIG, model: 'claude-sonnet-4' })
    render(<HomePage />)

    fireEvent.click(screen.getByRole('tab', { name: 'Anthropic Messages' }))
    await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveTextContent('claude-sonnet-4'))
  })
})
