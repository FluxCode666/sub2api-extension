import { describe, expect, it } from 'vitest'
import { normalizeAppBasePath, withAppBasePath, withoutAppBasePath } from './app-base-path'

describe('app base path', () => {
  it.each([
    ['', '/'],
    ['/', '/'],
    ['aux', '/aux/'],
    ['/aux', '/aux/'],
    ['/aux/', '/aux/'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeAppBasePath(input)).toBe(expected)
  })

  it('prefixes only application-local absolute paths', () => {
    expect(withAppBasePath('/admin/dashboard', '/aux/')).toBe('/aux/admin/dashboard')
    expect(withAppBasePath('/aux/admin/dashboard', '/aux/')).toBe('/aux/admin/dashboard')
    expect(withAppBasePath('#section', '/aux/')).toBe('#section')
    expect(withAppBasePath('https://example.com', '/aux/')).toBe('https://example.com')
    expect(withAppBasePath('//cdn.example.com/app.js', '/aux/')).toBe('//cdn.example.com/app.js')
  })

  it('removes the mount path before matching application routes', () => {
    expect(withoutAppBasePath('/aux/admin/dashboard', '/aux/')).toBe('/admin/dashboard')
    expect(withoutAppBasePath('/aux', '/aux/')).toBe('/')
    expect(withoutAppBasePath('/admin/dashboard', '/aux/')).toBe('/admin/dashboard')
  })
})
