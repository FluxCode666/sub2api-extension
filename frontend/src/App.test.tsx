import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from './App'

vi.mock('@/components/AdminGuard', () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/layouts/AdminLayout', () => ({
  default: () => <Outlet />,
}))

vi.mock('@/pages/admin/DashboardPage', () => ({
  default: () => <h1>dashboard-page</h1>,
}))

vi.mock('@/pages/admin/ImageAssetsPage', () => ({
  default: () => <h1>image-assets-page</h1>,
}))

vi.mock('@/pages/admin/ConsumptionPage', () => ({
  default: () => <h1>consumption-page</h1>,
}))

vi.mock('@/pages/admin/CostConfigPage', () => ({
  default: () => <h1>cost-config-page</h1>,
}))

vi.mock('@/pages/admin/FileManagementPage', () => ({
  default: () => <h1>file-management-page</h1>,
}))

vi.mock('@/pages/HomepagePage', () => ({
  default: () => <h1>homepage-page</h1>,
}))

vi.mock('@/pages/admin/HomepageConfigPage', () => ({
  default: () => <h1>homepage-config-page</h1>,
}))

vi.mock('@/pages/admin/SystemConfigPage', () => ({
  default: () => <h1>system-config-page</h1>,
}))

vi.mock('@/pages/DynamicPage', () => ({
  default: () => <h1>dynamic-page</h1>,
}))

vi.mock('@/pages/examples/ContentExamplePage', () => ({
  default: () => <h1>content-example-page</h1>,
}))

vi.mock('@/pages/examples/InteractionExamplePage', () => ({
  default: () => <h1>interaction-example-page</h1>,
}))

vi.mock('@/pages/examples/APIExamplePage', () => ({
  default: () => <h1>api-example-page</h1>,
}))

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname}{location.search}</output>
}

describe('App routing', () => {
  it('opens client documentation as a public standalone page', async () => {
    render(<MemoryRouter initialEntries={['/client-docs?client=codex']}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Codex 接入指南' })).toBeInTheDocument()
  })
  it('redirects the root path to the admin dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/dashboard'))
    expect(screen.getByRole('heading', { name: 'dashboard-page' })).toBeInTheDocument()
  })

  it('preserves sub2api embedded query parameters when redirecting the root path', async () => {
    render(
      <MemoryRouter initialEntries={['/?token=sub2api-jwt&user_id=7&ui_mode=embedded']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/admin/dashboard?token=sub2api-jwt&user_id=7&ui_mode=embedded'))
  })

  it('exposes the independent Sub2API homepage route', () => {
    render(
      <MemoryRouter initialEntries={['/sub2api-home']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'homepage-page' })).toBeInTheDocument()
  })

  it('preserves sub2api embedded query parameters when redirecting /admin', async () => {
    render(
      <MemoryRouter initialEntries={['/admin?token=sub2api-jwt&ui_mode=embedded']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/admin/dashboard?token=sub2api-jwt&ui_mode=embedded',
      )
    })
  })

  it('redirects the admin index to the canonical dashboard route', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/admin/dashboard')
    })
    expect(screen.getByRole('heading', { name: 'dashboard-page' })).toBeInTheDocument()
  })

  it('exposes the homepage configuration route inside admin', () => {
    render(
      <MemoryRouter initialEntries={['/admin/homepage']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'homepage-config-page' })).toBeInTheDocument()
  })

  it('keeps /p/home on the generic dynamic page route', () => {
    render(
      <MemoryRouter initialEntries={['/p/home']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'dynamic-page' })).toBeInTheDocument()
  })

  it('keeps unknown routes on the 404 page instead of sending them to the public home page', () => {
    render(
      <MemoryRouter initialEntries={['/some-removed-route']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '页面不存在' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回管理控制台' })).toHaveAttribute('href', '/admin/dashboard')
    expect(screen.getByTestId('location')).toHaveTextContent('/some-removed-route')
    expect(screen.getByTestId('location')).not.toHaveTextContent('/p/home')
  })

  it.each([
    ['/admin/files', 'file-management-page'],
    ['/admin/assets', 'image-assets-page'],
    ['/admin/ops/consumption', 'consumption-page'],
    ['/admin/ops/cost-config', 'cost-config-page'],
    ['/admin/system-config', 'system-config-page'],
    ['/admin/examples/content', 'content-example-page'],
    ['/admin/examples/interaction', 'interaction-example-page'],
    ['/admin/examples/api', 'api-example-page'],
  ])('registers %s inside the guarded admin routes', (path, heading) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
  })
})
