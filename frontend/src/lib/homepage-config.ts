import { apiClient, type AuxEnvelope } from './api-client'

export interface TrustedPartner {
  name: string
  logoUrl?: string
  linkUrl?: string
}

export interface HomepageConfig {
  heroLabel: string
  heroTitle: string
  heroDescription: string
  model: string
  primaryCta: string
  primaryHref: string
  docsCta: string
  docsHref: string
  consoleHref: string
  trustedPartners: TrustedPartner[]
}

const LEGACY_HERO_TITLE = 'AI 网关，让接入、治理与运行统一'
const LEGACY_HERO_DESCRIPTION = 'TERALEMO 将安全准入、智能路由、稳定保障、用量管理与运行观测统一到同一网关层。'

export const DEFAULT_HOMEPAGE_CONFIG: HomepageConfig = {
  heroLabel: '面向生产环境的 AI 网关',
  heroTitle: 'TERALEMO',
  heroDescription:
    '将安全准入、智能路由、稳定保障、用量管理与运行观测统一到同一网关层。',
  model: 'gpt-5.6-sol',
  primaryCta: '获取接入方案',
  primaryHref: '#contact',
  docsCta: '查看开发者文档',
  docsHref: '#developers',
  consoleHref: '/admin',
  trustedPartners: [],
}

export function normalizeHomepageConfigForDisplay(config: HomepageConfig): HomepageConfig {
  return {
    ...DEFAULT_HOMEPAGE_CONFIG,
    ...config,
    heroTitle: config.heroTitle === LEGACY_HERO_TITLE ? DEFAULT_HOMEPAGE_CONFIG.heroTitle : config.heroTitle,
    heroDescription: config.heroDescription === LEGACY_HERO_DESCRIPTION ? DEFAULT_HOMEPAGE_CONFIG.heroDescription : config.heroDescription,
    model: config.model?.trim() || DEFAULT_HOMEPAGE_CONFIG.model,
  }
}

function isHomepageConfig(value: unknown): value is HomepageConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Partial<HomepageConfig>
  return (
    typeof config.heroLabel === 'string' &&
    typeof config.heroTitle === 'string' &&
    typeof config.heroDescription === 'string' &&
    (config.model === undefined || typeof config.model === 'string') &&
    typeof config.primaryCta === 'string' &&
    typeof config.primaryHref === 'string' &&
    typeof config.docsCta === 'string' &&
    typeof config.docsHref === 'string' &&
    (config.consoleHref === undefined || typeof config.consoleHref === 'string') &&
    Array.isArray(config.trustedPartners)
  )
}

export async function loadHomepageConfig(): Promise<HomepageConfig> {
  try {
    const envelope = await apiClient.get<AuxEnvelope<HomepageConfig>>('/homepage/config')
    if (envelope.code === 0 && isHomepageConfig(envelope.data)) {
      const configured = normalizeHomepageConfigForDisplay(envelope.data)
      return {
        ...configured,
        trustedPartners: configured.trustedPartners.filter(
          (partner) => Boolean(partner && typeof partner.name === 'string' && partner.name.trim()),
        ),
      }
    }
  } catch {
    // 官网读取失败不应阻塞首屏，使用内置默认文案。
  }
  return DEFAULT_HOMEPAGE_CONFIG
}
