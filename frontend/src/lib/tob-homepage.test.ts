import { beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from './api-client'
import { DEFAULT_TOB_MAP_SETTINGS, fetchTobHomepageConfig } from './tob-homepage'

vi.mock('./api-client', () => ({ apiClient: { get: vi.fn() } }))

describe('fetchTobHomepageConfig', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds map appearance defaults to legacy configurations', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { siteName: '旧版企业站' } })

    const config = await fetchTobHomepageConfig()

    expect(config.mapSettings).toEqual(DEFAULT_TOB_MAP_SETTINGS)
  })

  it('merges partial map appearance settings with defaults', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { mapSettings: { routeStyle: 'solid', showNodeLabels: false } } })

    const config = await fetchTobHomepageConfig()

    expect(config.mapSettings).toEqual({ ...DEFAULT_TOB_MAP_SETTINGS, routeStyle: 'solid', showNodeLabels: false })
  })
})
