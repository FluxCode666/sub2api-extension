import { describe, it, expect, beforeEach } from 'vitest'
import { applyTheme, detectTheme } from './theme'

describe('applyTheme / detectTheme', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('dark')
  })

  it('applies dark class when theme=dark', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(detectTheme()).toBe('dark')
  })

  it('removes dark class when theme=light', () => {
    document.documentElement.classList.add('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(detectTheme()).toBe('light')
  })

  it('detects light by default', () => {
    expect(detectTheme()).toBe('light')
  })
})
