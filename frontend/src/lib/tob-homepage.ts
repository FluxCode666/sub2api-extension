import { apiClient, type AuxEnvelope } from './api-client'
import { DEFAULT_HOMEPAGE_CONFIG, type HomepageConfig } from './homepage'

export interface TobMapNode {
  name: string
  latitude: number
  longitude: number
  description?: string
}

export type TobMapRouteStyle = 'dashed' | 'solid'

export interface TobMapSettings {
  showNodeLabels: boolean
  routeCurvature: number
  nodeSize: number
  primaryServerColor: string
  cdnColor: string
  customerColor: string
  routeStyle: TobMapRouteStyle
  flowAnimation: boolean
}

export interface TobHomepageConfig extends HomepageConfig {
  primaryServers: TobMapNode[]
  cdnLocations: TobMapNode[]
  customerLocations: TobMapNode[]
  mapSettings: TobMapSettings
}

export const DEFAULT_TOB_MAP_SETTINGS: TobMapSettings = {
  showNodeLabels: true,
  routeCurvature: 24,
  nodeSize: 100,
  primaryServerColor: '#d97706',
  cdnColor: '#497d96',
  customerColor: '#15803d',
  routeStyle: 'dashed',
  flowAnimation: true,
}

export const DEFAULT_TOB_HOMEPAGE_CONFIG: TobHomepageConfig = {
  ...DEFAULT_HOMEPAGE_CONFIG,
  navigationItems: [...DEFAULT_HOMEPAGE_CONFIG.navigationItems, { label: '全球网络', href: '#network' }],
  primaryServers: [{ name: '华东主站', latitude: 31.23, longitude: 121.47, description: '核心 API 与控制面' }],
  cdnLocations: [],
  customerLocations: [],
  mapSettings: { ...DEFAULT_TOB_MAP_SETTINGS },
}

export async function fetchTobHomepageConfig(): Promise<TobHomepageConfig> {
  const envelope = await apiClient.get<AuxEnvelope<TobHomepageConfig>>('/tob-homepage/config')
  if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '无法读取企业官网配置')
  return {
    ...DEFAULT_TOB_HOMEPAGE_CONFIG,
    ...envelope.data,
    navigationItems: envelope.data.navigationItems ?? DEFAULT_TOB_HOMEPAGE_CONFIG.navigationItems,
    trustedPartners: envelope.data.trustedPartners ?? [],
    integrations: envelope.data.integrations ?? [],
    primaryServers: envelope.data.primaryServers ?? DEFAULT_TOB_HOMEPAGE_CONFIG.primaryServers,
    cdnLocations: envelope.data.cdnLocations ?? [],
    customerLocations: envelope.data.customerLocations ?? [],
    mapSettings: { ...DEFAULT_TOB_MAP_SETTINGS, ...(envelope.data.mapSettings ?? {}) },
  }
}
