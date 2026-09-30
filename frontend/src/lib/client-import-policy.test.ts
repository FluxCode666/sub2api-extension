import { describe, expect, it } from 'vitest'
import {
  ALL_CLIENT_IDS,
  effectiveAllowedClients,
  listPolicyPlatforms,
  normalizeClientImportPolicy,
  samePolicy,
  toggleClient,
} from './client-import-policy'

describe('client import policy helpers', () => {
  it('normalizes rule order, platform case and client order like the backend', () => {
    expect(normalizeClientImportPolicy({
      platforms: [{ platform: ' OpenAI ', allowedClients: ['pi', 'codex', 'pi'] }, { platform: 'anthropic', allowedClients: [] }],
      groups: [{ groupId: 9, allowedClients: ['chatbox'] }, { groupId: 2, allowedClients: ['workbuddy', 'claude-code'] }],
    })).toEqual({
      platforms: [{ platform: 'anthropic', allowedClients: [] }, { platform: 'openai', allowedClients: ['codex', 'pi'] }],
      groups: [{ groupId: 2, allowedClients: ['claude-code', 'workbuddy'] }, { groupId: 9, allowedClients: ['chatbox'] }],
      multiModelClients: ['chatbox', 'zcode', 'workbuddy', 'pi'],
    })
    expect(normalizeClientImportPolicy(null)).toEqual({ platforms: [], groups: [], multiModelClients: ['chatbox', 'zcode', 'workbuddy', 'pi'] })
  })

  it('defaults missing multi-model clients to every capable client and keeps explicit choices', () => {
    expect(normalizeClientImportPolicy({ platforms: [], groups: [] }).multiModelClients).toEqual(['chatbox', 'zcode', 'workbuddy', 'pi'])
    expect(normalizeClientImportPolicy({ platforms: [], groups: [], multiModelClients: [] }).multiModelClients).toEqual([])
    expect(normalizeClientImportPolicy({
      platforms: [],
      groups: [],
      multiModelClients: ['pi', 'codex', 'zcode', 'pi'],
    }).multiModelClients).toEqual(['zcode', 'pi'])
  })

  it('compares policies independent of rule order', () => {
    expect(samePolicy(
      { platforms: [{ platform: 'openai', allowedClients: ['pi', 'codex'] }], groups: [], multiModelClients: ['pi', 'zcode'] },
      { platforms: [{ platform: 'openai', allowedClients: ['codex', 'pi'] }], groups: [], multiModelClients: ['zcode', 'pi'] },
    )).toBe(true)
    expect(samePolicy(
      { platforms: [], groups: [], multiModelClients: [] },
      { platforms: [], groups: [{ groupId: 1, allowedClients: [] }], multiModelClients: [] },
    )).toBe(false)
    expect(samePolicy(
      { platforms: [], groups: [], multiModelClients: ['pi'] },
      { platforms: [], groups: [], multiModelClients: [] },
    )).toBe(false)
  })

  it('resolves group rules before platform rules', () => {
    const policy = {
      platforms: [{ platform: 'anthropic', allowedClients: ['claude-code' as const] }],
      groups: [{ groupId: 7, allowedClients: [] }],
    }
    expect(effectiveAllowedClients(policy, 7, 'anthropic')).toEqual([])
    expect(effectiveAllowedClients(policy, 5, 'Anthropic')).toEqual(['claude-code'])
    expect(effectiveAllowedClients(policy, 5, 'openai')).toEqual(ALL_CLIENT_IDS)
  })

  it('lists known platforms first and appends platforms from groups and rules', () => {
    expect(listPolicyPlatforms(
      { platforms: [{ platform: 'zhipu', allowedClients: [] }] },
      [{ id: 1, name: 'A', platform: 'OpenAI', status: 'active' }, { id: 2, name: 'B', platform: 'deepseek', status: 'active' }],
    )).toEqual(['anthropic', 'openai', 'gemini', 'antigravity', 'grok', 'deepseek', 'zhipu'])
  })

  it('toggles clients in canonical order', () => {
    expect(toggleClient(['pi'], 'codex', true)).toEqual(['codex', 'pi'])
    expect(toggleClient(['codex', 'pi'], 'codex', false)).toEqual(['pi'])
  })
})
