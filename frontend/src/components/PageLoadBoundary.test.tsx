import { lazy, Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PageLoadBoundary from './PageLoadBoundary'

describe('PageLoadBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows a recovery action when a route chunk fails and recovers on navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const FailedPage = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')))
    const { rerender } = render(<PageLoadBoundary routeKey="/tob-home">
      <Suspense fallback={<p>正在加载页面…</p>}><FailedPage /></Suspense>
    </PageLoadBoundary>)

    expect(await screen.findByRole('alert')).toHaveTextContent('页面加载失败')
    expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled()
    expect(screen.queryByText('Failed to fetch dynamically imported module')).not.toBeInTheDocument()

    rerender(<PageLoadBoundary routeKey="/api-docs"><h1>API 文档</h1></PageLoadBoundary>)
    expect(await screen.findByRole('heading', { name: 'API 文档' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
