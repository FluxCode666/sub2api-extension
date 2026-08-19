import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

import { apiClient } from './api-client'
import {
  fetchDynamicPages,
  getMergedRegistry,
  resetDynamicPagesCacheForTest,
} from './dynamic-pages'

const mockedGet = vi.mocked(apiClient.get)

describe('dynamic-pages', () => {
  beforeEach(() => {
    resetDynamicPagesCacheForTest()
    mockedGet.mockReset()
  })

  it('loads public pages from the public endpoint', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        items: [{
          id: 1,
          slug: 'public-page',
          title: '公开页面',
          visibility: 'public',
          content_type: 'html',
          enabled: true,
          route: '/p/public-page',
          page_id: 'page:public-page',
          updated_at: '2026-01-01T00:00:00Z',
        }],
      },
    })

    await fetchDynamicPages()

    expect(mockedGet).toHaveBeenCalledWith('/pages')
    expect(getMergedRegistry().some((page) => page.id === 'page:public-page')).toBe(true)
  })

  it('loads admin pages only through the guarded endpoint', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        items: [{
          id: 2,
          slug: 'admin-page',
          title: '管理页面',
          visibility: 'admin',
          content_type: 'html',
          enabled: true,
          route: '/admin/p/admin-page',
          page_id: 'page:admin-page',
          updated_at: '2026-01-01T00:00:00Z',
        }],
      },
    })

    await fetchDynamicPages({ includeAdmin: true })

    expect(mockedGet).toHaveBeenCalledWith('/admin/pages')
    expect(getMergedRegistry().some((page) => page.id === 'page:admin-page')).toBe(true)
  })

  it('upgrades a public cache to the guarded admin list when requested', async () => {
    mockedGet
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({ data: { items: [] } })

    await fetchDynamicPages()
    await fetchDynamicPages({ includeAdmin: true })

    expect(mockedGet.mock.calls.map(([path]) => path)).toEqual(['/pages', '/admin/pages'])
  })
})
