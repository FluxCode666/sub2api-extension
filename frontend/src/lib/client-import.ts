import { isValidClientModel } from '@/lib/client-models'

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
  | 'pi'

export type ClientConfigTargetId = 'cherry-studio' | 'chatbox' | 'zcode' | 'workbuddy' | 'pi'
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
  /** 后端按管理端导入限制解析出的可导入客户端；旧版后端不返回时视为不限制。 */
  allowed_clients?: string[]
}

export interface ClientImportKeysResponse {
  items: ClientImportKey[]
  /** 管理端允许配置多个候选模型 ID 的客户端；旧版后端不返回时视为不允许多选。 */
  multi_model_clients?: string[]
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
  // CC Switch 的 provider 深度链接不接受 app=pi，只能在其 Pi 面板手动添加，因此 Pi 以原生 models.json 提供。
  { id: 'pi', name: 'Pi', description: '下载 Pi 的 models.json，放入 ~/.pi/agent/ 后在 /model 中选择。', kind: 'config-file', icon: 'PI' },
] as const

/**
 * 导入配置本身能写入多个模型 ID 的客户端，与后端 ClientImportMultiModelCapableIDs 保持一致：
 * Chatbox 的 settings.models、ZCode 的 models、WorkBuddy 的 models/availableModels、Pi 的 providers.gateway.models。
 * CC Switch 深度链接只有单个 model 参数，Cherry Studio 的导入数据不含模型，因此不在其中。
 */
export const MULTI_MODEL_CAPABLE_CLIENT_IDS: readonly ClientImportTargetId[] = ['chatbox', 'zcode', 'workbuddy', 'pi']

/** 该客户端是否能配置候选模型：导入格式支持，且在管理端「多模型候选」中开启。 */
export function supportsMultiModel(targetId: ClientImportTargetId, enabledClients: readonly string[] | undefined): boolean {
  return MULTI_MODEL_CAPABLE_CLIENT_IDS.includes(targetId) && !!enabledClients?.includes(targetId)
}

/** 合并默认模型与候选模型：默认模型在首位，去掉空值与重复项。 */
export function mergeClientModels(model: string, candidates: readonly string[] = []): string[] {
  const models: string[] = []
  for (const item of [model, ...candidates]) {
    const value = item.trim()
    if (value && !models.includes(value)) models.push(value)
  }
  return models
}

export function getClientImportTarget(id: ClientImportTargetId): ClientImportTarget {
  return CLIENT_IMPORT_TARGETS.find((target) => target.id === id) ?? CLIENT_IMPORT_TARGETS[0]
}

const GROUP_PLATFORM_LABELS: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  grok: 'Grok',
}

/** API Key 是否已绑定 Sub2API 分组；未绑定分组的密钥不允许导入任何客户端。 */
export function hasKeyGroup(key: ClientImportKey): boolean {
  return key.group_id !== null || !!key.group
}

/** 将 Sub2API 分组平台标识转为展示名称，未知平台原样返回。 */
export function formatGroupPlatform(platform: string | undefined): string {
  const value = platform?.trim()
  if (!value) return '未知平台'
  return GROUP_PLATFORM_LABELS[value.toLowerCase()] ?? value
}

/** 返回「分组名称 · 平台」，未绑定分组时返回「未选择分组」。 */
export function describeKeyGroup(key: ClientImportKey): string {
  if (!hasKeyGroup(key)) return '未选择分组'
  const name = key.group?.name?.trim() || (key.group_id !== null ? `分组 #${key.group_id}` : '未命名分组')
  return `${name} · ${formatGroupPlatform(key.group?.platform)}`
}

/** 该密钥是否允许导入指定客户端：必须已分组，且未被管理端的平台/分组规则限制。 */
export function isClientAllowedForKey(key: ClientImportKey, targetId: ClientImportTargetId): boolean {
  if (!hasKeyGroup(key)) return false
  return key.allowed_clients === undefined || key.allowed_clients.includes(targetId)
}

/** 返回该密钥可导入的客户端，保持 CLIENT_IMPORT_TARGETS 的展示顺序。 */
export function allowedClientTargets(key: ClientImportKey): ClientImportTarget[] {
  return CLIENT_IMPORT_TARGETS.filter((target) => isClientAllowedForKey(key, target.id))
}

/** 规范化密钥模型列表响应：只保留合法的模型 ID 字符串，按首次出现去重并保持网关顺序。 */
export function normalizeKeyModels(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  const models: string[] = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    const model = item.trim()
    if (isValidClientModel(model) && !models.includes(model)) models.push(model)
  }
  return models
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

/**
 * 生成客户端配置。candidates 为额外的候选模型，只有支持多模型的客户端会写入；
 * 默认模型始终排在模型列表首位，客户端通常以首个模型作为默认选择。
 */
export function buildConfigFile(
  targetId: ClientConfigTargetId,
  key: ClientImportKey,
  baseURL: string,
  model: string,
  providerName: string,
  candidates: readonly string[] = [],
): Record<string, unknown> {
  const providerId = `aux-${new URL(baseURL).host.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${key.id}`
  const endpoint = withV1Endpoint(baseURL)
  const models = mergeClientModels(model, MULTI_MODEL_CAPABLE_CLIENT_IDS.includes(targetId) ? candidates : [])
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
        models: models.map((modelId) => ({ modelId, type: 'chat' })),
      },
    }
  }
  if (targetId === 'zcode') {
    return {
      name: providerName,
      baseUrl: baseURL,
      apiFormat: 'anthropic-messages',
      apiKey: key.key,
      models: models.map((id) => ({ id, name: id })),
    }
  }
  if (targetId === 'pi') {
    return {
      providers: {
        gateway: {
          baseUrl: endpoint,
          api: 'openai-completions',
          apiKey: key.key,
          models: models.map((id) => ({ id, name: id })),
        },
      },
    }
  }
  return {
    models: models.map((id) => ({ id, name: id, vendor: providerName, apiKey: key.key, url: `${endpoint}/chat/completions`, supportsToolCall: true })),
    availableModels: models,
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
    case 'pi': return 'models.json'
  }
}
