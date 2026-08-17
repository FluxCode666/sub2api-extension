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

vi.mock('@/pages/HomePage', () => ({
  default: () => <h1>homepage</h1>,
}))

vi.mock('@/pages/admin/HomepageConfigPage', () => ({
  default: () => <h1>homepage-config-page</h1>,
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
  return <output data-testid="location">{location.pathname}</output>
}

describe('App routing', () => {
  it('renders the public homepage at the root path', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
        <LocationProbe />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('location')).toHaveTextContent('/')
    expect(screen.getByRole('heading', { name: 'homepage' })).toBeInTheDocument()
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

  it.each([
    ['/admin/homepage', 'homepage-config-page'],
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
