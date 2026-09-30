import { describe, expect, it } from 'vitest'
import { AuxApiError } from '@/lib/api-client'
import {
  asyncTaskKey,
  batchProgress,
  buildAsyncTaskPageItems,
  buildAsyncTaskPath,
  describeAsyncTaskError,
  describeAsyncTaskRefreshError,
  formatElapsed,
  formatRelativeTime,
  formatTaskCost,
  isActiveAsyncTask,
  localDayBoundary,
  shortTaskID,
  type AsyncTask,
} from './async-tasks'

const task = (overrides: Partial<AsyncTask>): AsyncTask => ({ id: 'imgtask_1', kind: 'image', status: 'completed', raw_status: 'completed', created_at: '2026-09-27T00:00:00Z', ...overrides })

describe('async task helpers', () => {
  it('builds the query without sending all filters or a user id', () => {
    expect(buildAsyncTaskPath({ kind: 'all', status: 'all', page: 1, pageSize: 20 })).toBe('/async-tasks?page=1&page_size=20')
    expect(buildAsyncTaskPath({ kind: 'video', status: 'pending', page: 2, pageSize: 10 })).toBe('/async-tasks?page=2&page_size=10&kind=video&status=pending')
  })

  it('sends model, key, keyword and a local-day range with an exclusive end', () => {
    const path = buildAsyncTaskPath({ kind: 'all', status: 'all', model: 'gpt-image-2', apiKeyID: 7, keyword: '  poster ', createdFrom: '2026-08-31', createdTo: '2026-09-01', page: 1, pageSize: 20 })
    const params = new URLSearchParams(path.split('?')[1])
    expect(params.get('model')).toBe('gpt-image-2')
    expect(params.get('api_key_id')).toBe('7')
    expect(params.get('keyword')).toBe('poster')
    expect(new Date(params.get('created_from') ?? '').getTime()).toBe(new Date(2026, 7, 31).getTime())
    expect(new Date(params.get('created_to') ?? '').getTime()).toBe(new Date(2026, 8, 2).getTime())
    expect(params.has('user_id')).toBe(false)

    const sameDay = new URLSearchParams(buildAsyncTaskPath({ kind: 'all', status: 'all', createdFrom: '2026-09-27', page: 1, pageSize: 20 }).split('?')[1])
    expect(new Date(sameDay.get('created_to') ?? '').getTime()).toBe(new Date(2026, 8, 28).getTime())
    expect(localDayBoundary('2026-09-27')).toMatch(/^2026-09-27T00:00:00(Z|[+-]\d{2}:\d{2})$/)
    expect(localDayBoundary('bad')).toBe('')
  })

  it('collapses long page ranges around the current page', () => {
    expect(buildAsyncTaskPageItems(1, 5)).toEqual([1, 2, 3, 4, 5])
    expect(buildAsyncTaskPageItems(1, 10)).toEqual([1, 2, 'ellipsis', 10])
    expect(buildAsyncTaskPageItems(5, 10)).toEqual([1, 'ellipsis', 4, 5, 6, 'ellipsis', 10])
    expect(buildAsyncTaskPageItems(10, 10)).toEqual([1, 'ellipsis', 9, 10])
  })

  it('maps API errors to actionable messages without backend details', () => {
    expect(describeAsyncTaskError(new AuxApiError(401, 'invalid token'))).toContain('重新打开')
    expect(describeAsyncTaskError(new AuxApiError(503, 'redis down'))).toContain('暂时不可用')
    expect(describeAsyncTaskError(new Error('dial tcp 10.0.0.1'))).not.toContain('10.0.0.1')
  })

  it('formats ids, times, elapsed durations and costs', () => {
    expect(shortTaskID('imgtask_short')).toBe('imgtask_short')
    expect(shortTaskID('imgtask_0123456789abcdefghijklmn')).toBe('imgtask_0123…ijklmn')
    const now = new Date('2026-09-27T02:00:00Z').getTime()
    expect(formatRelativeTime('2026-09-27T01:59:30Z', now)).toBe('刚刚')
    expect(formatRelativeTime('2026-09-27T01:15:00Z', now)).toBe('45 分钟前')
    expect(formatRelativeTime('2026-09-26T20:00:00Z', now)).toBe('6 小时前')
    expect(formatRelativeTime('0001-01-01T00:00:00Z', now)).toBe('时间未知')
    expect(formatElapsed('2026-09-27T00:00:00Z', '2026-09-27T00:00:42Z')).toBe('42 秒')
    expect(formatElapsed('2026-09-27T00:00:00Z', '2026-09-27T00:03:05Z')).toBe('3 分 5 秒')
    expect(formatElapsed('2026-09-27T00:00:00Z')).toBe('')
    expect(formatTaskCost(0.5)).toBe('$0.50')
    expect(formatTaskCost(0.00125)).toBe('$0.00125')
    expect(formatTaskCost(12, 'cny')).toBe('12.00 CNY')
    expect(formatTaskCost(undefined)).toBe('')
  })

  it('computes batch progress and active state', () => {
    expect(batchProgress(task({ kind: 'batch', item_count: 10, success_count: 6, fail_count: 1, cancelled_count: 1 }))).toEqual({ done: 8, total: 10, percent: 80 })
    expect(batchProgress(task({ kind: 'batch' }))).toEqual({ done: 0, total: 0, percent: 0 })
    expect(isActiveAsyncTask(task({ status: 'processing' }))).toBe(true)
    expect(isActiveAsyncTask(task({ status: 'pending' }))).toBe(true)
    expect(isActiveAsyncTask(task({ status: 'failed' }))).toBe(false)
  })

  it('keys video tasks by provider because Grok and Seedance ids can collide', () => {
    expect(asyncTaskKey(task({ kind: 'video', provider: 'seedance', id: 'x' }))).not.toBe(asyncTaskKey(task({ kind: 'video', provider: 'grok', id: 'x' })))
    expect(asyncTaskKey(task({ kind: 'video', id: 'x' }))).toBe(asyncTaskKey(task({ kind: 'video', provider: 'grok', id: 'x' })))
    expect(asyncTaskKey(task({ kind: 'image', provider: 'grok', id: 'x' }))).toBe('image::x')
  })

  it('describes refresh errors by status and stable reason', () => {
    expect(describeAsyncTaskRefreshError(new AuxApiError(404, 'x', 'VIDEO_TASK_NOT_FOUND'))).toContain('网关找不到')
    expect(describeAsyncTaskRefreshError(new AuxApiError(404, 'x', 'ASYNC_TASK_NOT_FOUND'))).toContain('不存在或已过期')
    expect(describeAsyncTaskRefreshError(new AuxApiError(409, 'x', 'API_KEY_UNAVAILABLE'))).toContain('API Key 已删除或停用')
    expect(describeAsyncTaskRefreshError(new AuxApiError(422, 'x', 'VIDEO_STATUS_REJECTED'))).toContain('余额')
    expect(describeAsyncTaskRefreshError(new AuxApiError(429, 'x'))).toContain('过于频繁')
    expect(describeAsyncTaskRefreshError(new AuxApiError(500, 'internal detail'))).toBe('任务进度查询失败，请稍后重试。')
  })
})
