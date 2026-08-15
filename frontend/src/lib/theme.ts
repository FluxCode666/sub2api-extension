/**
 * 主题随动:读取 theme 参数并在 document 根元素上切换 light/dark class。
 * 使用 Tailwind class 策略 (tailwind.config.js darkMode: 'class')。
 */
import type { Theme } from './embedded'

export type { Theme }

const DARK_CLASS = 'dark'

/**
 * 应用主题到 document 根元素。
 * dark -> 添加 "dark" class; light -> 移除 "dark" class。
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const classList = document.documentElement.classList
  if (theme === 'dark') {
    classList.add(DARK_CLASS)
  } else {
    classList.remove(DARK_CLASS)
  }
}

/**
 * 读取当前已应用的主题。
 */
export function detectTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light'
}
