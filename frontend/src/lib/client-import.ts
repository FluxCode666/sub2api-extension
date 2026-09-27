export type ClientImportTargetId =
  | 'claude-code'
  | 'claude-desktop'
  | 'codex'
  | 'gemini'
  | 'grok-build'
  | 'opencode'
  | 'openclaw'
  | 'hermes'
  | 'cherry-studio'
  | 'chatbox'
  | 'zcode'
  | 'workbuddy'

export type ClientConfigTargetId = 'cherry-studio' | 'chatbox' | 'zcode' | 'workbuddy'
export type DirectImportTargetId = 'cherry-studio' | 'chatbox'

export interface ClientImportGroup {
  name: string
  platform: string
}

export interface ClientImportKey {
  id: number
  key: string
  name: string
  group_id: number | null
  status: string
  expires_at: string | null
  created_at: string
  group?: ClientImportGroup
}

export interface ClientImportKeysResponse {
  items: ClientImportKey[]
}

export interface ClientImportTarget {
  id: ClientImportTargetId
  name: string
  description: string
  kind: 'cc-switch' | 'direct-import' | 'config-file'
  app?: 'claude' | 'codex' | 'gemini' | 'grokbuild' | 'opencode' | 'openclaw' | 'hermes'
  icon: string
}

export const CLIENT_IMPORT_TARGETS: readonly ClientImportTarget[] = [
  { id: 'claude-code', name: 'Claude Code', description: '终端编程，导入后在 CC Switch 中启用 Claude 供应商。', kind: 'cc-switch', app: 'claude', icon: 'CC' },
  { id: 'claude-desktop', name: 'Claude Desktop', description: '桌面应用，支持在 CC Switch 中选择直连或模型映射。', kind: 'cc-switch', app: 'claude', icon: 'CD' },
  { id: 'codex', name: 'Codex', description: '导入 OpenAI Responses 供应商配置。', kind: 'cc-switch', app: 'codex', icon: 'CX' },
  { id: 'gemini', name: 'Gemini CLI', description: '导入 Gemini 供应商配置。', kind: 'cc-switch', app: 'gemini', icon: 'GM' },
  { id: 'grok-build', name: 'Grok Build', description: '导入 Grok Build 的兼容接口配置。', kind: 'cc-switch', app: 'grokbuild', icon: 'GB' },
  { id: 'opencode', name: 'OpenCode', description: '导入 OpenCode 供应商配置。', kind: 'cc-switch', app: 'opencode', icon: 'OC' },
  { id: 'openclaw', name: 'OpenClaw', description: '导入 OpenClaw 模型提供方。', kind: 'cc-switch', app: 'openclaw', icon: 'OW' },
  { id: 'hermes', name: 'Hermes Agent', description: '导入 Hermes Agent 自定义提供方。', kind: 'cc-switch', app: 'hermes', icon: 'HA' },
  { id: 'cherry-studio', name: 'Cherry Studio', description: '一键唤起 Cherry Studio，确认后导入 OpenAI 兼容供应商。', kind: 'direct-import', icon: 'CS' },
  { id: 'chatbox', name: 'Chatbox', description: '一键唤起 Chatbox，确认后导入自定义模型提供方。', kind: 'direct-import', icon: 'CB' },
  { id: 'zcode', name: 'ZCode', description: '下载供应商配置参考，包含地址、API Key 和模型 ID。', kind: 'config-file', icon: 'ZC' },
  { id: 'workbuddy', name: 'WorkBuddy', description: '下载官方 models.json，自定义模型可读取该配置。', kind: 'config-file', icon: 'WB' },
] as const

export function getClientImportTarget(id: ClientImportTargetId): ClientImportTarget {
  return CLIENT_IMPORT_TARGETS.find((target) => target.id === id) ?? CLIENT_IMPORT_TARGETS[0]
}

export function maskAPIKey(value: string): string {
  const key = value.trim()
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}${'•'.repeat(Math.min(12, Math.max(4, key.length - 8)))}${key.slice(-4)}`
}

export function normalizeImportBaseURL(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function defaultImportBaseURL(search: string, currentOrigin: string): string {
  const params = new URLSearchParams(search)
  const explicit = params.get('api_base')?.trim()
  if (explicit) return explicit
  return currentOrigin
}

function withV1Endpoint(baseURL: string): string {
  return `${baseURL}/v1`
}

function resolveCCSwitchEndpoint(targetId: ClientImportTargetId, platform: string | undefined, baseURL: string): { endpoint: string; model?: string } {
  if (targetId === 'claude-code' || targetId === 'claude-desktop') return { endpoint: baseURL }
  if (targetId === 'gemini' || platform === 'gemini') return { endpoint: baseURL }
  if (targetId === 'grok-build' || platform === 'grok') return { endpoint: withV1Endpoint(baseURL), model: 'grok-4.5' }
  if (platform === 'antigravity') return { endpoint: `${baseURL}/antigravity` }
  return { endpoint: withV1Endpoint(baseURL), model: targetId === 'codex' ? 'gpt-5.5' : undefined }
}

export function buildCCSwitchImportURL({
  key,
  target,
  baseURL,
  providerName,
  model,
}: {
  key: ClientImportKey
  target: ClientImportTarget
  baseURL: string
  providerName: string
  model: string
}): string {
  if (!target.app) throw new Error('CC Switch target is missing an app identifier')
  const resolved = resolveCCSwitchEndpoint(target.id, key.group?.platform, baseURL)
  const params = new URLSearchParams({
    resource: 'provider',
    app: target.app,
    name: providerName,
    homepage: baseURL,
    endpoint: resolved.endpoint,
    apiKey: key.key,
    configFormat: 'json',
    enabled: 'false',
  })
  const resolvedModel = model.trim() || resolved.model
  if (resolvedModel) params.set('model', resolvedModel)
  return `ccswitch://v1/import?${params.toString()}`
}

export function buildConfigFile(targetId: ClientConfigTargetId, key: ClientImportKey, baseURL: string, model: string, providerName: string): Record<string, unknown> {
  const providerId = `aux-${new URL(baseURL).host.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${key.id}`
  const endpoint = withV1Endpoint(baseURL)
  if (targetId === 'cherry-studio') {
    return {
      id: providerId,
      name: providerName,
      type: 'openai',
      apiKey: key.key,
      baseUrl: endpoint,
    }
  }
  if (targetId === 'chatbox') {
    return {
      id: providerId,
      name: providerName,
      type: 'openai',
      isCustom: true,
      urls: { website: baseURL },
      settings: {
        apiHost: baseURL,
        apiPath: '/v1/chat/completions',
        apiKey: key.key,
        models: model.trim() ? [{ modelId: model.trim(), type: 'chat' }] : [],
      },
    }
  }
  if (targetId === 'zcode') {
    return {
      name: providerName,
      baseUrl: baseURL,
      apiFormat: 'anthropic-messages',
      apiKey: key.key,
      models: model.trim() ? [{ id: model.trim(), name: model.trim() }] : [],
    }
  }
  const modelID = model.trim()
  return {
    models: modelID ? [{ id: modelID, name: modelID, vendor: providerName, apiKey: key.key, url: `${endpoint}/chat/completions`, supportsToolCall: true }] : [],
    availableModels: modelID ? [modelID] : [],
  }
}

export function buildDirectImportURL(targetId: DirectImportTargetId, config: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(config))
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
  if (targetId === 'cherry-studio') {
    return `cherrystudio://providers/api-keys?v=1&data=${encodeURIComponent(encoded.replace(/\+/g, '_').replace(/\//g, '-'))}`
  }
  return `chatbox://provider/import?config=${encodeURIComponent(encoded)}`
}

export function configFileName(targetId: ClientConfigTargetId): string {
  switch (targetId) {
    case 'cherry-studio': return 'cherry-studio-provider.json'
    case 'chatbox': return 'chatbox-provider.json'
    case 'zcode': return 'zcode-provider.json'
    case 'workbuddy': return 'models.json'
  }
}
