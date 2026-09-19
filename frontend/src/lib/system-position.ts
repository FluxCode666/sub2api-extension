export type SystemPosition = 'toc' | 'tob'

export const DEFAULT_SYSTEM_POSITION: SystemPosition = 'toc'
export const TOC_HOMEPAGE_PATH = '/sub2api-home'
export const TOB_HOMEPAGE_PATH = '/tob-home'

export function normalizeSystemPosition(value: unknown): SystemPosition {
  return value === 'tob' ? 'tob' : DEFAULT_SYSTEM_POSITION
}

export function homepagePathForPosition(value: unknown): string {
  return normalizeSystemPosition(value) === 'tob' ? TOB_HOMEPAGE_PATH : TOC_HOMEPAGE_PATH
}
