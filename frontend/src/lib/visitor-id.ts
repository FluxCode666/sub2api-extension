/**
 * 匿名访客 id 生成与读取。
 *
 * 策略:
 *   - 用 localStorage 生成并持久化一个随机访客 id(UUID v4 风格)。
 *   - 首次访问时生成,后续读取持久化值。
 *   - localStorage 不可用时退化为内存 id(同会话内一致)。
 *
 * 管理员标识: 通过 getAdminSession() 判断是否有附属管理员会话,
 * 有会话则 is_admin=true(用于 U6 归因)。
 *
 * Covers KTD4(访客 id 区分匿名/管理员), R11(自有采集)。
 */
import { getAdminSession } from './admin-auth'

const VISITOR_ID_KEY = 'aux_visitor_id'

/** 内存 fallback 访客 id(localStorage 不可用时使用)。 */
let memoryVisitorId: string | null = null

/**
 * 生成一个随机访客 id(UUID v4 风格, 不依赖 crypto.randomUUID 以兼容旧环境)。
 */
function generateVisitorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: 基于 Math.random + Date.now 的伪 UUID
  const timestamp = Date.now().toString(16)
  const random = Math.random().toString(16).slice(2)
  return `${timestamp}-${random}`
}

/**
 * 获取或创建匿名访客 id。
 *
 * 首次调用时从 localStorage 读取; 不存在则生成并持久化。
 * localStorage 不可用时退化为内存 id(同会话内一致)。
 */
export function getVisitorId(): string {
  // 优先用内存缓存
  if (memoryVisitorId) {
    return memoryVisitorId
  }

  try {
    const stored = localStorage.getItem(VISITOR_ID_KEY)
    if (stored) {
      memoryVisitorId = stored
      return stored
    }
    // 生成新 id 并持久化
    const newId = generateVisitorId()
    localStorage.setItem(VISITOR_ID_KEY, newId)
    memoryVisitorId = newId
    return newId
  } catch (error) {
    // localStorage 不可用: 退化为内存 id，但保留诊断日志。
    console.error('[visitor-id] failed to read/write localStorage', error)
    if (!memoryVisitorId) {
      memoryVisitorId = generateVisitorId()
    }
    return memoryVisitorId
  }
}

/**
 * 判断当前访问者是否为管理员(有附属管理员会话)。
 *
 * 用于埋点 is_admin 字段(U6 归因)。
 */
export function isCurrentUserAdmin(): boolean {
  return getAdminSession() !== null
}

/**
 * 重置访客 id(测试用)。清除 localStorage 与内存缓存。
 */
export function resetVisitorId(): void {
  memoryVisitorId = null
  try {
    localStorage.removeItem(VISITOR_ID_KEY)
  } catch (error) {
    // localStorage 不可用，但不能静默吞掉清理失败。
    console.error('[visitor-id] failed to clear localStorage', error)
  }
}

/**
 * 仅清除内存缓存,保留 localStorage(测试用)。
 * 用于模拟页面重新加载: 内存状态丢失但 localStorage 持久化值保留。
 */
export function clearVisitorIdMemoryCache(): void {
  memoryVisitorId = null
}
