import { describe, expect, it } from 'vitest'
import { allowedClientTargets, buildCCSwitchImportURL, buildConfigFile, buildDirectImportURL, defaultImportBaseURL, describeKeyGroup, formatGroupPlatform, hasKeyGroup, isClientAllowedForKey, maskAPIKey, mergeClientModels, normalizeImportBaseURL, normalizeKeyModels, supportsMultiModel } from './client-import'

const key = {
  id: 1,
  key: 'sk-test-1234567890',
  name: '测试密钥',
  group_id: 2,
  status: 'active',
  expires_at: null,
  created_at: '2026-09-24T00:00:00Z',
  group: { name: 'Anthropic', platform: 'anthropic' },
}

describe('client-import helpers', () => {
  it('describes the key group with its platform and detects ungrouped keys', () => {
    expect(describeKeyGroup(key)).toBe('Anthropic · Anthropic')
    expect(describeKeyGroup({ ...key, group: { name: '图像组', platform: 'antigravity' } })).toBe('图像组 · Antigravity')
    expect(describeKeyGroup({ ...key, group: undefined })).toBe('分组 #2 · 未知平台')
    expect(formatGroupPlatform('custom-platform')).toBe('custom-platform')
    expect(hasKeyGroup({ ...key, group_id: null, group: undefined })).toBe(false)
    expect(describeKeyGroup({ ...key, group_id: null, group: undefined })).toBe('未选择分组')
  })

  it('applies the admin import restrictions returned for each key', () => {
    expect(isClientAllowedForKey(key, 'pi')).toBe(true)
    expect(allowedClientTargets(key)).toHaveLength(13)
    const restricted = { ...key, allowed_clients: ['codex', 'pi'] }
    expect(isClientAllowedForKey(restricted, 'claude-code')).toBe(false)
    expect(allowedClientTargets(restricted).map((target) => target.id)).toEqual(['codex', 'pi'])
    expect(allowedClientTargets({ ...key, allowed_clients: [] })).toEqual([])
    expect(isClientAllowedForKey({ ...key, group_id: null, group: undefined }, 'codex')).toBe(false)
  })

  it('normalizes only safe HTTP(S) gateway roots', () => {
    expect(normalizeImportBaseURL('https://api.example.com/v1/')).toBe('https://api.example.com')
    expect(normalizeImportBaseURL('https://user:pass@api.example.com')).toBeNull()
    expect(normalizeImportBaseURL('javascript:alert(1)')).toBeNull()
  })

  it('defaults to the current page origin, including when embedded in Sub2API', () => {
    expect(defaultImportBaseURL('?ui_mode=embedded&src_host=https%3A%2F%2Fgateway.example.com', 'https://aux.example.com')).toBe('https://aux.example.com')
    expect(defaultImportBaseURL('?src_host=https%3A%2F%2Fgateway.example.com', 'https://aux.example.com')).toBe('https://aux.example.com')
    expect(defaultImportBaseURL('?api_base=https%3A%2F%2Fmanual.example.com&ui_mode=embedded&src_host=https%3A%2F%2Fgateway.example.com', 'https://aux.example.com')).toBe('https://manual.example.com')
  })

  it('builds a CC Switch deep link without exposing the key in the UI helper output', () => {
    const url = buildCCSwitchImportURL({
      key,
      target: { id: 'claude-code', name: 'Claude Code', description: '', kind: 'cc-switch', app: 'claude', icon: 'CC' },
      baseURL: 'https://api.example.com',
      providerName: 'Gateway',
      model: 'claude-opus-5',
    })
    const parsed = new URL(url)
    expect(parsed.protocol).toBe('ccswitch:')
    expect(parsed.hostname).toBe('v1')
    expect(parsed.pathname).toBe('/import')
    expect(parsed.searchParams.get('app')).toBe('claude')
    expect(parsed.searchParams.get('apiKey')).toBe(key.key)
    expect(maskAPIKey(key.key)).not.toBe(key.key)
  })

  it('builds provider payloads accepted by Cherry Studio and Chatbox', () => {
    expect(buildConfigFile('cherry-studio', key, 'https://api.example.com', 'gpt-5.5', 'Gateway')).toEqual({
      id: 'aux-api-example-com-1',
      name: 'Gateway',
      type: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: key.key,
    })
    expect(buildConfigFile('chatbox', key, 'https://api.example.com', 'gpt-5.5', 'Gateway')).toEqual({
      id: 'aux-api-example-com-1',
      name: 'Gateway',
      type: 'openai',
      isCustom: true,
      urls: { website: 'https://api.example.com' },
      settings: { apiHost: 'https://api.example.com', apiPath: '/v1/chat/completions', apiKey: key.key, models: [{ modelId: 'gpt-5.5', type: 'chat' }] },
    })
  })

  it('builds downloadable ZCode provider reference files', () => {
    expect(buildConfigFile('zcode', key, 'https://api.example.com', 'claude-opus-5', 'Gateway')).toEqual({
      name: 'Gateway',
      baseUrl: 'https://api.example.com',
      apiFormat: 'anthropic-messages',
      apiKey: key.key,
      models: [{ id: 'claude-opus-5', name: 'claude-opus-5' }],
    })
  })

  it('builds WorkBuddy models.json with the selected model', () => {
    expect(buildConfigFile('workbuddy', key, 'https://api.example.com', 'claude-opus-5', 'Gateway')).toEqual({
      models: [{
        id: 'claude-opus-5',
        name: 'claude-opus-5',
        vendor: 'Gateway',
        apiKey: key.key,
        url: 'https://api.example.com/v1/chat/completions',
        supportsToolCall: true,
      }],
      availableModels: ['claude-opus-5'],
    })
  })

  it('builds Pi models.json with the gateway provider on the Chat Completions endpoint', () => {
    expect(buildConfigFile('pi', key, 'https://api.example.com', 'gpt-5.5', 'Gateway')).toEqual({
      providers: {
        gateway: {
          baseUrl: 'https://api.example.com/v1',
          api: 'openai-completions',
          apiKey: key.key,
          models: [{ id: 'gpt-5.5', name: 'gpt-5.5' }],
        },
      },
    })
  })

  it('merges candidate models after the default model without duplicates', () => {
    expect(mergeClientModels(' gpt-5.5 ', ['gpt-5.5-mini', 'gpt-5.5', ' ', 'gpt-5.5-mini', 'o5'])).toEqual(['gpt-5.5', 'gpt-5.5-mini', 'o5'])
    expect(mergeClientModels('', ['o5', 'gpt-5.5'])).toEqual(['o5', 'gpt-5.5'])
    expect(mergeClientModels('')).toEqual([])
  })

  it('only allows multiple models for capable clients enabled by the admin', () => {
    expect(supportsMultiModel('pi', ['pi', 'zcode'])).toBe(true)
    expect(supportsMultiModel('workbuddy', ['pi', 'zcode'])).toBe(false)
    expect(supportsMultiModel('claude-code', ['claude-code'])).toBe(false)
    expect(supportsMultiModel('pi', undefined)).toBe(false)
  })

  it('writes candidate models after the default model for multi-model clients', () => {
    const candidates = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-5']
    expect(buildConfigFile('pi', key, 'https://api.example.com', 'claude-opus-5', 'Gateway', candidates)).toMatchObject({
      providers: { gateway: { models: [
        { id: 'claude-opus-5', name: 'claude-opus-5' },
        { id: 'claude-sonnet-5', name: 'claude-sonnet-5' },
        { id: 'claude-haiku-5', name: 'claude-haiku-5' },
      ] } },
    })
    expect(buildConfigFile('zcode', key, 'https://api.example.com', 'claude-opus-5', 'Gateway', candidates)).toMatchObject({
      models: [{ id: 'claude-opus-5' }, { id: 'claude-sonnet-5' }, { id: 'claude-haiku-5' }],
    })
    expect(buildConfigFile('chatbox', key, 'https://api.example.com', '', 'Gateway', candidates)).toMatchObject({
      settings: { models: candidates.map((modelId) => ({ modelId, type: 'chat' })) },
    })
    const workbuddy = buildConfigFile('workbuddy', key, 'https://api.example.com', 'claude-opus-5', 'Gateway', ['claude-sonnet-5'])
    expect(workbuddy.availableModels).toEqual(['claude-opus-5', 'claude-sonnet-5'])
    expect((workbuddy.models as { id: string, vendor: string }[]).map((model) => [model.id, model.vendor])).toEqual([['claude-opus-5', 'Gateway'], ['claude-sonnet-5', 'Gateway']])
    expect(buildConfigFile('cherry-studio', key, 'https://api.example.com', 'claude-opus-5', 'Gateway', candidates)).not.toHaveProperty('models')
  })

  it('does not offer Pi as a CC Switch deep link target', async () => {
    const { getClientImportTarget } = await import('./client-import')
    expect(getClientImportTarget('pi')).toMatchObject({ kind: 'config-file' })
    expect(getClientImportTarget('pi').app).toBeUndefined()
  })

  it('uses the expected filenames for downloadable configurations', async () => {
    const { configFileName } = await import('./client-import')
    expect(configFileName('zcode')).toBe('zcode-provider.json')
    expect(configFileName('workbuddy')).toBe('models.json')
    expect(configFileName('pi')).toBe('models.json')
  })

  it.each(['cherry-studio', 'chatbox'] as const)('encodes Unicode and the key in the %s deep link', (targetId) => {
    const config = buildConfigFile(targetId, key, 'https://api.example.com', 'gpt-5.5', '中文供应商')
    const link = new URL(buildDirectImportURL(targetId, config))
    expect(link.protocol).toBe(targetId === 'cherry-studio' ? 'cherrystudio:' : 'chatbox:')
    expect(link.hostname).toBe(targetId === 'cherry-studio' ? 'providers' : 'provider')
    expect(link.pathname).toBe(targetId === 'cherry-studio' ? '/api-keys' : '/import')
    expect(link.searchParams.get('v')).toBe(targetId === 'cherry-studio' ? '1' : null)
    const encoded = link.searchParams.get(targetId === 'cherry-studio' ? 'data' : 'config')!
      .replace(/_/g, '+').replace(/-/g, '/')
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)))
    expect(JSON.parse(decoded)).toEqual(config)
    expect(link.href).not.toContain(key.key)
  })
})

describe('normalizeKeyModels', () => {
  it('keeps valid model ID strings once in gateway order', () => {
    expect(normalizeKeyModels([' claude-opus-5 ', 'claude-sonnet-5', 'claude-opus-5', '', 42, null, 'bad\nmodel', 'x'.repeat(161)])).toEqual(['claude-opus-5', 'claude-sonnet-5'])
  })

  it('returns an empty list for malformed responses', () => {
    expect(normalizeKeyModels(undefined)).toEqual([])
    expect(normalizeKeyModels({ items: ['claude-opus-5'] })).toEqual([])
  })
})
