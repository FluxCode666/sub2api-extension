import { describe, expect, it } from 'vitest'
import { isValidClientModel, modelsForClient, preferredClientModel } from './client-models'

const CATALOG = [
  { id: 'claude-opus-5', platforms: ['anthropic'] },
  { id: 'claude-sonnet-5', platforms: ['antigravity'] },
  { id: 'gemini-3-pro', platforms: ['antigravity', 'gemini'] },
  { id: 'gemini-3-flash', platforms: ['antigravity'] },
  { id: 'gpt-6-astra', platforms: ['openai'] },
  { id: 'grok-5', platforms: ['grok'] },
]

describe('client model catalog', () => {
  it.each([
    ['claude-desktop', ['claude-opus-5', 'claude-sonnet-5']],
    ['obsidian', ['claude-opus-5', 'claude-sonnet-5']],
    ['codex', ['gpt-6-astra']],
    ['gemini-cli', ['gemini-3-pro', 'gemini-3-flash']],
    ['grok-build', ['grok-5']],
    ['pi', CATALOG.map(model => model.id)],
  ] as const)('lists the models %s can call', (clientId, expected) => {
    expect(modelsForClient(CATALOG, clientId)).toEqual(expected)
  })

  it('prefers the guide default only when the platform offers it', () => {
    expect(preferredClientModel(['a', 'claude-opus-5'], 'claude-opus-5')).toBe('claude-opus-5')
    expect(preferredClientModel(['a', 'b'], 'claude-opus-5')).toBe('a')
    expect(preferredClientModel([], 'claude-opus-5')).toBe('claude-opus-5')
  })

  it('rejects blank, oversized and control-character model IDs', () => {
    expect(isValidClientModel(' vendor/model-1 ')).toBe(true)
    expect(isValidClientModel('   ')).toBe(false)
    expect(isValidClientModel('a\u0007b')).toBe(false)
    expect(isValidClientModel('m'.repeat(161))).toBe(false)
  })
})
