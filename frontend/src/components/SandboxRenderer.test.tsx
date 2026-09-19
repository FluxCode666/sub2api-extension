import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import SandboxRenderer, { shouldNavigateTopLevel } from './SandboxRenderer'

vi.mock('@/lib/telemetry-sdk', () => ({
  trackFeatureClick: vi.fn(),
}))

describe('SandboxRenderer navigation bridge', () => {
  it('injects metadata links and routes non-anchor navigation through the host', () => {
    const { container } = render(
      <SandboxRenderer
        content={'<a href="#fallback" data-metadata-href="api_docs_href">API 文档</a>'}
        pageId="page:home"
        metadata={{ api_docs_href: 'https://docs.example.com/api' }}
      />,
    )

    const iframe = container.querySelector('iframe')
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts allow-top-navigation-by-user-activation')
    const srcdoc = iframe?.getAttribute('srcdoc') ?? ''

    expect(srcdoc).toContain('data-metadata-href="api_docs_href"')
    expect(srcdoc).toContain('renderHomepageConfig')
    expect(srcdoc).toContain('data-metadata-text="docs_cta"')
    expect(srcdoc).toContain('type: \'aux-navigation\'')
    expect(srcdoc).toContain('opaque')
    expect(srcdoc).toContain('https?:|mailto:|tel:')
  })

  it.each([
    ['/login', true],
    ['/dashboard', true],
    ['/admin/users', true],
    ['/aux/login', false],
    ['#section', false],
    ['https://docs.example.com/guide', true],
  ])('routes %s through the correct window boundary', (href, expected) => {
    const origin = 'https://code.teralemo.com'
    const target = new URL(href, `${origin}/aux/p/home`)

    expect(shouldNavigateTopLevel(target, '/aux/', origin)).toBe(expected)
  })
})
