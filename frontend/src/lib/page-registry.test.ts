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
    id: 'file-management',
    title: '文件管理',
    path: '/admin/files',
    visibility: 'admin',
  },
  {
    id: 'ops-ttft',
    title: '首字延迟',
    path: '/admin/ops/ttft',
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
    expect(getPageById('example-content')).toBeUndefined()
    expect(getPageByPath('/admin/examples/interaction')).toBeUndefined()
    expect(getPageByPath('/admin/examples/api')).toBeUndefined()
    expect(getPageByPath('/nope')).toBeUndefined()
  })

  it('separates public and admin pages', () => {
    expect(getAdminPages()).toEqual(expectedPages)
    expect(getPages()).toEqual(expectedPages)
  })
})
