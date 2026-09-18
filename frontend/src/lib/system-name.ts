export const DEFAULT_SUB2API_SYSTEM_NAME = 'Sub2API'

export interface SystemNameConfig {
  siteName?: string
  heroTitle?: string
}

/** 公开品牌名称统一读取 siteName，并兼容旧版 heroTitle 配置。 */
export function resolveSystemName(config?: SystemNameConfig | null): string {
  return config?.siteName?.trim() || config?.heroTitle?.trim() || DEFAULT_SUB2API_SYSTEM_NAME
}
