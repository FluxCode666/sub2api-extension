/**
 * 解析 sub2api iframe 传入的查询参数。
 *
 * 查询参数键名与 sub2api frontend/src/utils/embedded-url.ts 保持一致:
 *   user_id, token, theme, lang, ui_mode (值 "embedded"), src_host, src_url
 *
 * token 仅在内存中持有,供 U3 上报鉴权使用,不上报到 sub2api。
 */

export type Theme = 'light' | 'dark'

export interface EmbeddedContext {
  token: string | null
  userId: string | null
  theme: Theme
  lang: string | null
  embedded: boolean
  srcHost: string | null
  srcUrl: string | null
}

const KEY_USER_ID = 'user_id'
const KEY_TOKEN = 'token'
const KEY_THEME = 'theme'
const KEY_LANG = 'lang'
const KEY_UI_MODE = 'ui_mode'
const UI_MODE_EMBEDDED = 'embedded'
const KEY_SRC_HOST = 'src_host'
const KEY_SRC_URL = 'src_url'

function normalizeTheme(value: string | null): Theme {
  return value === 'dark' ? 'dark' : 'light'
}

/**
 * 从查询字符串解析嵌入上下文。纯函数,无副作用。
 */
export function parseEmbeddedParams(search: string): EmbeddedContext {
  // 兼容传入带或不带前导 "?" 的字符串
  const query = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(query)

  const uiMode = params.get(KEY_UI_MODE)
  return {
    token: params.get(KEY_TOKEN),
    userId: params.get(KEY_USER_ID),
    theme: normalizeTheme(params.get(KEY_THEME)),
    lang: params.get(KEY_LANG),
    embedded: uiMode === UI_MODE_EMBEDDED,
    srcHost: params.get(KEY_SRC_HOST),
    srcUrl: params.get(KEY_SRC_URL),
  }
}

// 内存中的嵌入上下文,供 U3 上报使用 (不上报到 sub2api,仅本地持有)
let currentContext: EmbeddedContext | null = null

/**
 * 启动时调用:解析 window.location.search 并将上下文存入内存。
 * 返回解析结果以便调用方立即应用主题/语言。
 */
export function initEmbeddedContext(search: string): EmbeddedContext {
  currentContext = parseEmbeddedParams(search)
  return currentContext
}

/**
 * 获取当前内存中的嵌入上下文 (U3 上报时使用)。
 */
export function getEmbeddedContext(): EmbeddedContext | null {
  return currentContext
}
