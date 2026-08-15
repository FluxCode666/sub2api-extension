import { describe, it, expect } from 'vitest'
import {
  PAGE_REGISTRY,
  getPages,
  getPageById,
  getPageByPath,
  getPublicPages,
  getAdminPages,
} from './page-registry'

describe('page-registry', () => {
  it('declares the expected pages with id/title/path/visibility', () => {
    // R5: 页面清单从代码派生, 非独立注册表。
    expect(PAGE_REGISTRY).toHaveLength(2)

    const home = getPageById('home')
    expect(home).toBeDefined()
    expect(home?.title).toBe('首页')
    expect(home?.path).toBe('/')
    expect(home?.visibility).toBe('public')

    const sample = getPageById('sample-dynamic')
    expect(sample).toBeDefined()
    expect(sample?.title).toBe('示例动态页')
    expect(sample?.path).toBe('/admin/sample-dynamic')
    expect(sample?.visibility).toBe('admin')
  })

  it('every entry has a unique id (KTD7 shared namespace)', () => {
    const ids = PAGE_REGISTRY.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has a unique path', () => {
    const paths = PAGE_REGISTRY.map((p) => p.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('page paths match App.tsx registered routes', () => {
    // 与 App.tsx 路由 path 一致 (KTD7): 清单是路由的真相源。
    // App.tsx 注册: '/' (HomePage), '/admin' index + '/admin/sample-dynamic' (SampleDynamicPage)
    const registeredPaths = ['/', '/admin/sample-dynamic']
    for (const entry of PAGE_REGISTRY) {
      expect(registeredPaths).toContain(entry.path)
    }
  })

  it('getPageById returns undefined for unknown id', () => {
    expect(getPageById('does-not-exist')).toBeUndefined()
  })

  it('getPageByPath finds pages and returns undefined for unknown path', () => {
    expect(getPageByPath('/')?.id).toBe('home')
    expect(getPageByPath('/admin/sample-dynamic')?.id).toBe('sample-dynamic')
    expect(getPageByPath('/nope')).toBeUndefined()
  })

  it('getPublicPages returns only public-visibility pages', () => {
    const publicPages = getPublicPages()
    expect(publicPages.every((p) => p.visibility === 'public')).toBe(true)
    expect(publicPages.map((p) => p.id)).toContain('home')
  })

  it('getAdminPages returns only admin-visibility pages', () => {
    const adminPages = getAdminPages()
    expect(adminPages.every((p) => p.visibility === 'admin')).toBe(true)
    expect(adminPages.map((p) => p.id)).toContain('sample-dynamic')
  })

  it('getPages returns the full registry', () => {
    expect(getPages()).toHaveLength(PAGE_REGISTRY.length)
  })
})
