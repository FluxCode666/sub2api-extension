import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getVisitorId, isCurrentUserAdmin, resetVisitorId, clearVisitorIdMemoryCache } from './visitor-id'

describe('visitor-id', () => {
  beforeEach(() => {
    resetVisitorId()
    localStorage.clear()
    // 重置 admin-auth 的内存缓存
    vi.resetModules()
  })

  describe('getVisitorId', () => {
    it('generates a non-empty visitor id on first call', () => {
      const id = getVisitorId()
      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('persists the same id across multiple calls (localStorage)', () => {
      const id1 = getVisitorId()
      const id2 = getVisitorId()
      expect(id1).toBe(id2)
    })

    it('persists id in localStorage across "page reload" (re-read)', () => {
      const id1 = getVisitorId()
      // 模拟重新加载: 清除内存缓存但保留 localStorage
      clearVisitorIdMemoryCache()
      const id2 = getVisitorId()
      expect(id2).toBe(id1)
    })

    it('stores id in localStorage under aux_visitor_id key', () => {
      const id = getVisitorId()
      expect(localStorage.getItem('aux_visitor_id')).toBe(id)
    })
  })

  describe('isCurrentUserAdmin', () => {
    it('returns false when no admin session exists', () => {
      expect(isCurrentUserAdmin()).toBe(false)
    })
  })

  describe('resetVisitorId', () => {
    it('clears the in-memory and localStorage visitor id', () => {
      const id1 = getVisitorId()
      resetVisitorId()
      const id2 = getVisitorId()
      // 重置后应生成新 id(除非 localStorage 还有旧的——但 reset 也清了 localStorage)
      expect(id2).not.toBe(id1)
    })
  })
})
