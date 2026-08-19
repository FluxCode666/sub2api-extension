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
    id: 'dashboard',
    title: '分析仪表盘',
    path: '/admin/dashboard',
    visibility: 'admin',
  },
  {
    id: 'image-assets',
    title: '图片资源',
    path: '/admin/assets',
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
  it('declares the current admin pages', () => {
    expect(PAGE_REGISTRY).toEqual(expectedPages)
  })

  it('every entry has a unique id and path', () => {
    const ids = PAGE_REGISTRY.map((page) => page.id)
    const paths = PAGE_REGISTRY.map((page) => page.path)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('does not register the root redirect as a content page', () => {
    expect(getPageById('home')).toBeUndefined()
    expect(getPageByPath('/')).toBeUndefined()
    expect(getPublicPages()).toEqual([])
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
    expect(getAdminPages()).toEqual(expectedPages)
    expect(getPages()).toEqual(expectedPages)
  })
})
