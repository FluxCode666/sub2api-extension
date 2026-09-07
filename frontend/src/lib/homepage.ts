import { apiClient, type AuxEnvelope } from './api-client'

export interface TrustedPartner {
  name: string
  logoUrl?: string
  linkUrl?: string
}

export interface HomepageConfig {
  siteName: string
  heroLabel: string
  heroTitle: string
  heroDescription: string
  model: string
  primaryCta: string
  primaryHref: string
  docsCta: string
  docsHref: string
  consoleHref: string
  documentationUrl: string
  termsUrl: string
  userTermsUrl: string
  privacyUrl: string
  trustedPartners: TrustedPartner[]
}

export const DEFAULT_HOMEPAGE_CONFIG: HomepageConfig = {
  siteName: 'Sub2API',
  heroLabel: '面向生产环境的 AI 网关',
  heroTitle: 'AI API 网关，面向下一次调用',
  heroDescription: '用一个清晰、稳定、可观测的入口，连接模型、团队与真实业务。',
  model: 'gpt-5.6-sol',
  primaryCta: '开始使用',
  primaryHref: '/login',
  docsCta: '查看开发文档',
  docsHref: '#developers',
  consoleHref: '/admin',
  documentationUrl: '',
  termsUrl: '',
  userTermsUrl: '',
  privacyUrl: '',
  trustedPartners: [],
}

export async function fetchHomepageConfig(): Promise<HomepageConfig> {
  const envelope = await apiClient.get<AuxEnvelope<HomepageConfig>>('/homepage/config')
  if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '无法读取官网配置')
  return { ...DEFAULT_HOMEPAGE_CONFIG, ...envelope.data }
}
