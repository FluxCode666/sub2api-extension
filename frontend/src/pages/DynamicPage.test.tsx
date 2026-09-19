import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DynamicPage from './DynamicPage'

const { get, renderer } = vi.hoisted(() => ({ get: vi.fn(), renderer: vi.fn() }))

vi.mock('@/lib/api-client', () => ({ apiClient: { get } }))
vi.mock('@/lib/telemetry-sdk', () => ({ trackPageView: vi.fn() }))
vi.mock('@/components/SandboxRenderer', () => ({
  default: (props: unknown) => {
    renderer(props)
    return <div data-testid="sandbox" />
  },
}))

describe('DynamicPage', () => {
  beforeEach(() => {
    get.mockReset()
    renderer.mockClear()
  })

  it('overrides legacy homepage metadata with the configured system name', async () => {
    get.mockImplementation(async (path: string) => {
      if (path === '/pages/home') return { code: 0, data: {
        id: 1,
        slug: 'home',
        title: '官网',
        visibility: 'public',
        content_type: 'html',
        content_html: '<main>home</main>',
        metadata: { site_name: '旧硬编码名称', full_bleed: 'true' },
        enabled: true,
        page_id: 'page:home',
      } }
      if (path === '/homepage/config') return { code: 0, data: {
        siteName: '示例平台',
        systemDomain: 'https://api.example.com',
        siteLogoUrl: 'https://cdn.example.com/logo.svg',
        docsCta: '查看 API 参考',
        docsHref: '/api-docs',
        consoleHref: '/dashboard',
        navigationItems: [{ label: '价格', href: '#pricing' }],
      } }
      throw new Error(`Unexpected request: ${path}`)
    })

    render(<MemoryRouter initialEntries={['/p/home']}><Routes><Route path="/p/:slug" element={<DynamicPage />} /></Routes></MemoryRouter>)

    expect(await screen.findByTestId('sandbox')).toBeInTheDocument()
    await waitFor(() => expect(renderer).toHaveBeenLastCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        site_name: '示例平台',
        system_domain: 'https://api.example.com',
        logo: 'https://cdn.example.com/logo.svg',
        docs_cta: '查看 API 参考',
        docs_href: '/api-docs',
        console_href: '/dashboard',
        navigation_items: [{ label: '价格', href: '#pricing' }],
      }),
    })))
  })
})
