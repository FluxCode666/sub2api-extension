import { describe, expect, it } from 'vitest'
import { isPathWithinAppBase, normalizeAppBasePath, toCurrentOriginURI, toSameOriginPath, withAppBasePath, withoutAppBasePath } from './app-base-path'

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

  it('normalizes configured URLs to same-origin paths', () => {
    expect(toSameOriginPath('/dashboard')).toBe('/dashboard')
    expect(toSameOriginPath('https://console.example.com/dashboard?tab=home')).toBe('/dashboard?tab=home')
    expect(toSameOriginPath('#section')).toBe('#section')
    expect(toSameOriginPath('javascript:alert(1)', '/admin')).toBe('/admin')
  })

  it('resolves application routes against the current browser origin', () => {
    expect(toCurrentOriginURI('/api-docs', { basePath: '/aux/' })).toBe(`${window.location.origin}/aux/api-docs`)
    expect(toCurrentOriginURI('/dashboard', { includeAppBasePath: false })).toBe(`${window.location.origin}/dashboard`)
  })

  it('removes the mount path before matching application routes', () => {
    expect(withoutAppBasePath('/aux/admin/dashboard', '/aux/')).toBe('/admin/dashboard')
    expect(withoutAppBasePath('/aux', '/aux/')).toBe('/')
    expect(withoutAppBasePath('/admin/dashboard', '/aux/')).toBe('/admin/dashboard')
  })

  it.each([
    ['/login', false],
    ['/dashboard', false],
    ['/admin/users', false],
    ['/aux', true],
    ['/aux/login', true],
    ['/auxiliary/login', false],
  ])('identifies whether %s belongs to the aux mount path', (pathname, expected) => {
    expect(isPathWithinAppBase(pathname, '/aux/')).toBe(expected)
  })
})
