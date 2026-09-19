/** 将 Vite 部署基础路径规范为单个开头和结尾斜杠。 */
export function normalizeAppBasePath(value: string): string {
  const path = value.trim().replace(/^\/+|\/+$/g, '')
  return path ? `/${path}/` : '/'
}

/** 前端公开挂载路径，例如 `/aux/`。 */
export const APP_BASE_PATH = normalizeAppBasePath(import.meta.env.BASE_URL)

/** React Router 使用不带结尾斜杠的 basename。 */
export const ROUTER_BASE_PATH = APP_BASE_PATH === '/'
  ? '/'
  : APP_BASE_PATH.slice(0, -1)

/** 为应用内绝对路径添加当前挂载路径，外部地址和锚点保持不变。 */
export function withAppBasePath(path: string, basePath = APP_BASE_PATH): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path

  const normalizedBase = normalizeAppBasePath(basePath)
  if (normalizedBase === '/') return path

  const baseWithoutSlash = normalizedBase.slice(0, -1)
  if (path === baseWithoutSlash || path.startsWith(`${baseWithoutSlash}/`)) return path
  if (path === '/') return normalizedBase
  return `${baseWithoutSlash}${path}`
}

/** 将配置中的 URL 转为当前浏览器 origin 下的路径，避免跨域打开同一系统的按钮。 */
export function toSameOriginPath(value: string, fallback = ''): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.startsWith('#')) return trimmed

  try {
    const parsed = new URL(trimmed, 'https://aux-current-origin.invalid')
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

/** 将应用内路径解析为当前浏览器 origin 下的绝对 URI。 */
export function toCurrentOriginURI(
  path: string,
  options: { basePath?: string; includeAppBasePath?: boolean } = {},
): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path

  const targetPath = options.includeAppBasePath === false
    ? path
    : withAppBasePath(path, options.basePath)
  if (typeof window === 'undefined' || !window.location.origin) return targetPath
  return new URL(targetPath, window.location.origin).toString()
}

/** 判断 URL pathname 是否属于当前应用挂载路径。 */
export function isPathWithinAppBase(pathname: string, basePath = APP_BASE_PATH): boolean {
  if (!pathname.startsWith('/')) return false

  const normalizedBase = normalizeAppBasePath(basePath)
  if (normalizedBase === '/') return true

  const baseWithoutSlash = normalizedBase.slice(0, -1)
  return pathname === baseWithoutSlash || pathname.startsWith(`${baseWithoutSlash}/`)
}

/** 匹配应用路由元数据前移除前端挂载路径。 */
export function withoutAppBasePath(path: string, basePath = APP_BASE_PATH): string {
  const normalizedBase = normalizeAppBasePath(basePath)
  if (normalizedBase === '/') return path

  const baseWithoutSlash = normalizedBase.slice(0, -1)
  if (path === baseWithoutSlash) return '/'
  if (path.startsWith(`${baseWithoutSlash}/`)) return path.slice(baseWithoutSlash.length) || '/'
  return path
}
