import { apiClient, type AuxEnvelope } from './api-client'

export interface TrustedPartner {
  name: string
  logoUrl?: string
  linkUrl?: string
}

export interface IntegrationApp {
  name: string
  logoUrl?: string
  documentationUrl?: string
}

export interface HomepageNavigationItem {
  label: string
  href: string
}

export interface HomepageConfig {
  siteName: string
  systemDomain: string
  siteLogoUrl: string
  heroLabel: string
  heroTitle: string
  heroDescription: string
  model: string
  availability: string
  availabilityDescription: string
  firstTokenResponseTime: string
  firstTokenResponseTimeDescription: string
  promptCacheRate: string
  promptCacheRateDescription: string
  primaryCta: string
  primaryHref: string
  docsCta: string
  docsHref: string
  consoleHref: string
  documentationUrl: string
  developersDocsUrl: string
  termsUrl: string
  userTermsUrl: string
  privacyUrl: string
  sub2apiPublished: boolean
  showDevelopersSection: boolean
  showQuickstartSection: boolean
  navigationItems: HomepageNavigationItem[]
  trustedPartners: TrustedPartner[]
  integrations: IntegrationApp[]
}

export const DEFAULT_HOMEPAGE_CONFIG: HomepageConfig = {
  siteName: 'Sub2API',
  systemDomain: '',
  siteLogoUrl: '',
  heroLabel: '面向生产环境的 AI 网关',
  heroTitle: 'AI API 网关，面向下一次调用',
  heroDescription: '用一个清晰、稳定、可观测的入口，连接模型、团队与真实业务。',
  model: 'gpt-6-astra',
  availability: '99.99%',
  availabilityDescription: '核心 API 入口持续在线，异常请求自动隔离，保障业务稳定运行。',
  firstTokenResponseTime: '≤ 200ms',
  firstTokenResponseTimeDescription: '从请求发出到首个 Token 返回，减少等待，保持交互流畅。',
  promptCacheRate: '≥ 85%',
  promptCacheRateDescription: '重复提示词优先命中缓存，降低延迟与调用成本。',
  primaryCta: '开始使用',
  primaryHref: '/login',
  docsCta: '查看开发文档',
  docsHref: '#developers',
  consoleHref: '/admin',
  documentationUrl: '',
  developersDocsUrl: '',
  termsUrl: '',
  userTermsUrl: '',
  privacyUrl: '',
  sub2apiPublished: false,
  showDevelopersSection: true,
  showQuickstartSection: true,
  navigationItems: [
    { label: '安全', href: '#security' },
    { label: '指标', href: '#metrics' },
    { label: '开发者', href: '#developers' },
    { label: '生态', href: '#ecosystem' },
    { label: '合作伙伴', href: '#partners' },
  ],
  trustedPartners: [],
  integrations: [],
}

export function isHomepageNavigationHref(value: string): boolean {
  const href = value.trim()
  if (!href || /[\\\r\n\t]/.test(href) || href.startsWith('//')) return false
  if (href.startsWith('#') || href.startsWith('/')) return true
  if (!/^https?:\/\//.test(href)) return false
  try {
    const url = new URL(href)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function fetchHomepageConfig(): Promise<HomepageConfig> {
  const envelope = await apiClient.get<AuxEnvelope<HomepageConfig>>('/homepage/config')
  if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '无法读取官网配置')
  return {
    ...DEFAULT_HOMEPAGE_CONFIG,
    ...envelope.data,
    navigationItems: envelope.data.navigationItems ?? DEFAULT_HOMEPAGE_CONFIG.navigationItems,
    trustedPartners: envelope.data.trustedPartners ?? [],
    integrations: envelope.data.integrations ?? [],
  }
}
