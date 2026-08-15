import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseEmbeddedParams,
  initEmbeddedContext,
  getEmbeddedContext,
} from './embedded'

describe('parseEmbeddedParams', () => {
  it('parses theme=dark, lang=zh, ui_mode=embedded as embedded mode', () => {
    const ctx = parseEmbeddedParams('?theme=dark&lang=zh&ui_mode=embedded')
    expect(ctx.theme).toBe('dark')
    expect(ctx.lang).toBe('zh')
    expect(ctx.embedded).toBe(true)
  })

  it('defaults to light theme and non-embedded when no params present', () => {
    const ctx = parseEmbeddedParams('')
    expect(ctx.theme).toBe('light')
    expect(ctx.lang).toBeNull()
    expect(ctx.embedded).toBe(false)
    expect(ctx.token).toBeNull()
    expect(ctx.userId).toBeNull()
  })

  it('parses token and user_id into memory only (no network side effects)', () => {
    const ctx = parseEmbeddedParams('?token=abc123&user_id=42')
    expect(ctx.token).toBe('abc123')
    expect(ctx.userId).toBe('42')
  })

  it('parses src_host and src_url', () => {
    const ctx = parseEmbeddedParams(
      '?src_host=https://app.example.com&src_url=https://app.example.com/page',
    )
    expect(ctx.srcHost).toBe('https://app.example.com')
    expect(ctx.srcUrl).toBe('https://app.example.com/page')
  })

  it('treats non-embedded ui_mode values as non-embedded', () => {
    expect(parseEmbeddedParams('?ui_mode=standalone').embedded).toBe(false)
    expect(parseEmbeddedParams('?ui_mode=').embedded).toBe(false)
  })

  it('treats unknown theme values as light', () => {
    expect(parseEmbeddedParams('?theme=purple').theme).toBe('light')
    expect(parseEmbeddedParams('?theme=light').theme).toBe('light')
  })

  it('accepts search string without leading question mark', () => {
    const ctx = parseEmbeddedParams('theme=dark&ui_mode=embedded')
    expect(ctx.theme).toBe('dark')
    expect(ctx.embedded).toBe(true)
  })
})

describe('initEmbeddedContext / getEmbeddedContext', () => {
  beforeEach(() => {
    initEmbeddedContext('')
  })

  it('stores parsed context in memory and retrieves it', () => {
    const ctx = initEmbeddedContext('?token=sekret&user_id=7&theme=dark')
    expect(ctx.token).toBe('sekret')
    expect(getEmbeddedContext()?.token).toBe('sekret')
    expect(getEmbeddedContext()?.userId).toBe('7')
    expect(getEmbeddedContext()?.theme).toBe('dark')
  })
})
