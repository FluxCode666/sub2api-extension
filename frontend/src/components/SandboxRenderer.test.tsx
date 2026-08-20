import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import SandboxRenderer from './SandboxRenderer'

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
    const srcdoc = iframe?.getAttribute('srcdoc') ?? ''

    expect(srcdoc).toContain('data-metadata-href="api_docs_href"')
    expect(srcdoc).toContain('type: \'aux-navigation\'')
    expect(srcdoc).toContain('opaque')
    expect(srcdoc).toContain('https?:|mailto:|tel:')
  })
})
