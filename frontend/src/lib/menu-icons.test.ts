import { describe, expect, it } from 'vitest'
import { getMenuIcon, MENU_ICON_OPTIONS } from './menu-icons'

describe('menu-icons', () => {
  it('exposes the complete Lucide catalog rather than a small hand-picked list', () => {
    expect(MENU_ICON_OPTIONS.length).toBeGreaterThan(1000)
    expect(MENU_ICON_OPTIONS.some((option) => option.value === 'alarm-clock')).toBe(true)
    expect(MENU_ICON_OPTIONS.some((option) => option.value === 'file-text')).toBe(true)
    expect(MENU_ICON_OPTIONS.some((option) => option.value === 'bar-chart-3')).toBe(true)
  })

  it('keeps unknown metadata values safe and falls back to menu', () => {
    expect(getMenuIcon('file-text')).toBeTruthy()
    expect(getMenuIcon('bar-chart-3')).toBeTruthy()
    expect(getMenuIcon('not-a-real-icon')).toBe(getMenuIcon('menu'))
  })
})
