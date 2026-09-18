import { describe, expect, it } from 'vitest'
import { DEFAULT_SUB2API_SYSTEM_NAME, resolveSystemName } from './system-name'

describe('resolveSystemName', () => {
  it('prefers the configured site name', () => {
    expect(resolveSystemName({ siteName: ' 示例平台 ', heroTitle: '旧名称' })).toBe('示例平台')
  })

  it('keeps legacy hero title compatibility', () => {
    expect(resolveSystemName({ heroTitle: '旧版平台' })).toBe('旧版平台')
  })

  it('falls back to the generic Sub2API name', () => {
    expect(resolveSystemName()).toBe(DEFAULT_SUB2API_SYSTEM_NAME)
  })
})
