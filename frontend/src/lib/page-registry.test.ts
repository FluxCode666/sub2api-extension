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
    id: 'client-docs',
    title: '客户端接入',
    path: '/client-docs',
    visibility: 'public',
  },
  {
    id: 'api-docs',
    title: 'API 文档',
    path: '/api-docs',
    aliases: ['/docs'],
    visibility: 'public',
  },
  {
    id: 'dashboard',
    title: '分析仪表盘',
    path: '/admin/dashboard',
    visibility: 'admin',
  },
  {
    id: 'system-config',
    title: '系统配置',
    path: '/admin/system-config',
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
  {
    id: 'ops-consumption',
    title: '消费核算',
    path: '/admin/ops/consumption',
    visibility: 'admin',
  },
  {
    id: 'ops-cost-config',
    title: '成本配置',
    path: '/admin/ops/cost-config',
    visibility: 'admin',
  },
]

describe('page-registry', () => {
  it('declares the current admin pages', () => {
    expect(PAGE_REGISTRY).toEqual(expectedPages)
  })

  it('every entry has a unique id and path', () => {
    const ids = PAGE_REGISTRY.map((page) => page.id)
    const paths = PAGE_REGISTRY.flatMap((page) => [page.path, ...(page.aliases ?? [])])

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('does not register the root redirect as a content page', () => {
    expect(getPageById('home')).toBeUndefined()
    expect(getPageByPath('/')).toBeUndefined()
    expect(getPublicPages()).toEqual(expectedPages.filter(page => page.visibility === 'public'))
  })

  it('finds current pages by id and path', () => {
    expect(getPageByPath('/docs')).toBe(getPageById('api-docs'))
    expect(getPageById('example-content')).toBeUndefined()
    expect(getPageByPath('/admin/examples/interaction')).toBeUndefined()
    expect(getPageByPath('/admin/examples/api')).toBeUndefined()
    expect(getPageByPath('/nope')).toBeUndefined()
  })

  it('separates public and admin pages', () => {
    expect(getAdminPages()).toEqual(expectedPages.filter(page => page.visibility === 'admin'))
    expect(getPages()).toEqual(expectedPages)
  })
})
