import { describe, it, expect } from 'vitest'
import {
  PAGE_REGISTRY,
  getPages,
  getPageById,
  getPageByPath,
  getPublicPages,
  getAdminPages,
} from './page-registry'

const expectedPages = [
  {
    id: 'home',
    title: 'TERALEMO 官网首页',
    path: '/',
    visibility: 'public',
  },
  {
    id: 'dashboard',
    title: '分析仪表盘',
    path: '/admin/dashboard',
    visibility: 'admin',
  },
  {
    id: 'homepage-config',
    title: '官网首页配置',
    path: '/admin/homepage',
    visibility: 'admin',
  },
  {
    id: 'example-content',
    title: '静态内容示例',
    path: '/admin/examples/content',
    visibility: 'admin',
  },
  {
    id: 'example-interaction',
    title: '交互与埋点示例',
    path: '/admin/examples/interaction',
    visibility: 'admin',
  },
  {
    id: 'example-api',
    title: 'API 请求示例',
    path: '/admin/examples/api',
    visibility: 'admin',
  },
]

describe('page-registry', () => {
  it('declares the public homepage and current admin pages', () => {
    expect(PAGE_REGISTRY).toEqual(expectedPages)
  })

  it('every entry has a unique id and path', () => {
    const ids = PAGE_REGISTRY.map((page) => page.id)
    const paths = PAGE_REGISTRY.map((page) => page.path)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('registers the public homepage for analytics', () => {
    expect(getPageById('home')?.path).toBe('/')
    expect(getPageByPath('/')?.id).toBe('home')
    expect(getPublicPages()).toEqual([expectedPages[0]])
  })

  it('finds current pages by id and path', () => {
    expect(getPageById('example-content')?.path).toBe('/admin/examples/content')
    expect(getPageByPath('/admin/examples/interaction')?.id).toBe(
      'example-interaction',
    )
    expect(getPageByPath('/admin/examples/api')?.id).toBe('example-api')
    expect(getPageByPath('/nope')).toBeUndefined()
  })

  it('separates public and admin pages', () => {
    expect(getAdminPages()).toEqual(expectedPages.slice(1))
    expect(getPages()).toEqual(expectedPages)
  })
})
