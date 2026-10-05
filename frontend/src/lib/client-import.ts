import { isValidClientModel } from '@/lib/client-models'
import { renderSetupCommand, type ClientSetupPlan, type SetupPlatform } from '@/lib/client-setup-command'

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

/** 导入方式，对应导入页的三个页签。 */
export type ClientImportKind = 'cc-switch' | 'direct-import' | 'config-file'

export interface ClientImportTarget {
  id: ClientImportTargetId
  name: string
  description: string
  /** 主要导入方式；可下载原生配置的 CC Switch 客户端同时出现在「配置文件」页签。 */
  kind: ClientImportKind
  /** 在「配置文件」页签展示的说明，仅主要导入方式不是配置文件的客户端需要。 */
  configDescription?: string
  app?: 'claude' | 'codex' | 'gemini' | 'grokbuild' | 'opencode' | 'openclaw' | 'hermes'
  icon: string
}

export const CLIENT_IMPORT_TARGETS: readonly ClientImportTarget[] = [
  { id: 'claude-code', name: 'Claude Code', description: '终端编程，导入后在 CC Switch 中启用 Claude 供应商。', configDescription: '一键命令合并 settings.json 的 env，也可下载文件。', kind: 'cc-switch', app: 'claude', icon: 'CC' },
  { id: 'claude-desktop', name: 'Claude Desktop', description: '桌面应用，支持在 CC Switch 中选择直连或模型映射。', kind: 'cc-switch', app: 'claude', icon: 'CD' },
  { id: 'codex', name: 'Codex', description: '导入 OpenAI Responses 供应商配置。', configDescription: '一键命令写入 config.toml 与 auth.json，也可下载文件。', kind: 'cc-switch', app: 'codex', icon: 'CX' },
  { id: 'gemini', name: 'Gemini CLI', description: '导入 Gemini 供应商配置。', configDescription: '一键命令写入 ~/.gemini/.env 并选择 API Key 认证。', kind: 'cc-switch', app: 'gemini', icon: 'GM' },
  { id: 'grok-build', name: 'Grok Build', description: '导入 Grok Build 的兼容接口配置。', configDescription: '一键命令登记 config.toml 自定义模型，也可下载文件。', kind: 'cc-switch', app: 'grokbuild', icon: 'GB' },
  { id: 'opencode', name: 'OpenCode', description: '导入 OpenCode 供应商配置。', configDescription: '一键命令合并 opencode.json 的 gateway 供应商。', kind: 'cc-switch', app: 'opencode', icon: 'OC' },
  { id: 'openclaw', name: 'OpenClaw', description: '导入 OpenClaw 模型提供方。', configDescription: '一键命令写入 gateway 提供方与默认模型。', kind: 'cc-switch', app: 'openclaw', icon: 'OW' },
  { id: 'hermes', name: 'Hermes Agent', description: '导入 Hermes Agent 自定义提供方。', kind: 'cc-switch', app: 'hermes', icon: 'HA' },
  { id: 'cherry-studio', name: 'Cherry Studio', description: '一键唤起 Cherry Studio，确认后导入 OpenAI 兼容供应商。', kind: 'direct-import', icon: 'CS' },
  { id: 'chatbox', name: 'Chatbox', description: '一键唤起 Chatbox，确认后导入自定义模型提供方。', kind: 'direct-import', icon: 'CB' },
  { id: 'zcode', name: 'ZCode', description: '下载供应商配置参考，包含地址、API Key 和模型 ID。', kind: 'config-file', icon: 'ZC' },
  { id: 'workbuddy', name: 'WorkBuddy', description: '下载官方 models.json，自定义模型可读取该配置。', kind: 'config-file', icon: 'WB' },
  // CC Switch 的 provider 深度链接不接受 app=pi，只能在其 Pi 面板手动添加，因此 Pi 以原生 models.json 提供。
  { id: 'pi', name: 'Pi', description: '一键命令合并 ~/.pi/agent/models.json，在 /model 中选择。', kind: 'config-file', icon: 'PI' },
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

/**
 * 「配置文件」页签提供原生配置文件的客户端。Claude Desktop 只能在应用内配置、Hermes 由向导写入，
 * 所以仍只走 CC Switch；Cherry Studio 和 Chatbox 在一键导入页签内提供下载。
 */
export const CONFIG_FILE_TARGET_IDS = ['claude-code', 'codex', 'gemini', 'grok-build', 'opencode', 'openclaw', 'zcode', 'workbuddy', 'pi'] as const
export type ConfigFileTargetId = typeof CONFIG_FILE_TARGET_IDS[number]

export function supportsConfigFile(id: ClientImportTargetId): id is ConfigFileTargetId {
  return (CONFIG_FILE_TARGET_IDS as readonly string[]).includes(id)
}

/** 某个页签下展示的客户端，保持 CLIENT_IMPORT_TARGETS 的顺序。 */
export function targetsForKind(kind: ClientImportKind): ClientImportTarget[] {
  return CLIENT_IMPORT_TARGETS.filter((target) => target.kind === kind || (kind === 'config-file' && supportsConfigFile(target.id)))
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

export interface ClientConfigFile {
  /** 下载时使用的文件名。 */
  fileName: string
  /** 客户端读取该文件的位置，仅用于提示；为空表示需在客户端界面中导入或参照填写。 */
  path: string
  format: 'JSON' | 'TOML' | 'ENV'
  content: string
}

const CONFIG_FILE_PATHS: Record<ClientConfigTargetId, string> = {
  'cherry-studio': '',
  chatbox: '',
  zcode: '',
  workbuddy: '~/.codebuddy/models.json',
  pi: '~/.pi/agent/models.json',
}

/** 各客户端配置文件的放置与合并说明，显示在下载按钮下方。 */
export const CONFIG_FILE_NOTES: Record<ConfigFileTargetId, string> = {
  'claude-code': '放到 ~/.claude/settings.json（Windows 为 %USERPROFILE%\\.claude\\settings.json）；已有该文件时只把 env 中的变量合并进去，保留其他设置。终端里仍设置了 ANTHROPIC_API_KEY 等旧变量时请先清理，再在新终端运行 claude。',
  codex: 'Codex 需要 config.toml 和 auth.json 两个文件，请切换文件分别下载，放到 ~/.codex/（Windows 为 %USERPROFILE%\\.codex\\）。已有 config.toml 时，把顶层字段放在所有表定义之前并合并 [model_providers.gateway]；替换 auth.json 前先备份。保存后完全退出并重新打开 Codex。',
  gemini: '下载的 gemini.env 需重命名为 .env，放到 ~/.gemini/.env（Windows 为 %USERPROFILE%\\.gemini\\.env）；项目目录下的 .gemini/.env 会优先读取。远程网关地址必须使用 HTTPS。首次启动在认证方式中选择 Gemini API Key。',
  'grok-build': '放到 ~/.grok/config.toml（Windows 为 %USERPROFILE%\\.grok\\config.toml）；已有该文件时合并 [models] 与对应的 [model."…"] 表，同名模型请先备份。保存后退出 Grok Build，再从项目目录重新运行 grok。',
  opencode: '放到 ~/.config/opencode/opencode.json，或放在项目根目录作为项目配置；已有该文件时只合并 provider.gateway 与 model 字段。重新启动 opencode 后在 /models 中选择 gateway 下的模型。',
  openclaw: '合并到 ~/.openclaw/openclaw.json（Windows 位于 %USERPROFILE%\\.openclaw），保留 channels、gateway 等已有设置。运行 openclaw models list 确认模型，已安装 Gateway 服务时运行 openclaw gateway restart 使配置生效。',
  zcode: 'ZCode 官方当前未提供 JSON 导入协议。下载文件用于快速复制到「设置 → 模型设置 → 添加供应商」，请在 ZCode 中确认 API 格式并添加模型。',
  workbuddy: 'WorkBuddy 使用官方 models.json 格式。下载后按 WorkBuddy 文档放入用户级或项目级 .codebuddy/models.json，再重新打开或刷新模型设置。',
  pi: 'CC Switch 暂不支持通过深度链接导入 Pi。下载后放到 ~/.pi/agent/models.json（Windows 为 %USERPROFILE%\\.pi\\agent\\models.json）；已有该文件时，只把 providers.gateway 合并进去，保留其他供应商。重新打开 /model 即可读取。',
}

/** 不指定默认模型时，CC Switch 导入和原生配置共同使用的兜底模型；没有兜底时由客户端自行决定。 */
export function fallbackClientModel(targetId: ClientImportTargetId, platform: string | undefined): string | undefined {
  return resolveCCSwitchEndpoint(targetId, platform, '').model
}

// TOML 基本字符串与 JSON 字符串的转义规则兼容；.env 的双引号值同理。
const quoted = (value: string) => JSON.stringify(value)

/** 原生配置的端点和模型：与 CC Switch 深度链接一致，未指定模型时使用相同的兜底模型。 */
function nativeTarget(targetId: ClientImportTargetId, key: ClientImportKey, baseURL: string, model: string): { endpoint: string; modelID: string } {
  const resolved = resolveCCSwitchEndpoint(targetId, key.group?.platform, baseURL)
  return { endpoint: resolved.endpoint, modelID: model.trim() || resolved.model || '' }
}

const claudeCodeEnv = (endpoint: string, apiKey: string, modelID: string) => ({
  ANTHROPIC_BASE_URL: endpoint,
  ANTHROPIC_AUTH_TOKEN: apiKey,
  ...(modelID ? { ANTHROPIC_MODEL: modelID } : {}),
})

const codexRootLines = (modelID: string) => [...(modelID ? [`model = ${quoted(modelID)}`] : []), 'model_provider = "gateway"', 'cli_auth_credentials_store = "file"']
const codexProviderLines = (providerName: string, endpoint: string) => ['[model_providers.gateway]', `name = ${quoted(providerName)}`, `base_url = ${quoted(endpoint)}`, 'wire_api = "responses"', 'requires_openai_auth = true']

const geminiEnvLines = (endpoint: string, apiKey: string, modelID: string) => Object.entries({ GOOGLE_GEMINI_BASE_URL: endpoint, GEMINI_API_KEY: apiKey, ...(modelID ? { GEMINI_MODEL: modelID } : {}) })
  .map(([name, value]) => `${name}=${quoted(value)}`)

const grokModelHeader = (modelID: string) => `model.${quoted(modelID)}`
const grokModelLines = (modelID: string, endpoint: string, providerName: string, apiKey: string) => [
  `[${grokModelHeader(modelID)}]`,
  `model = ${quoted(modelID)}`,
  `base_url = ${quoted(endpoint)}`,
  `name = ${quoted(providerName)}`,
  `api_key = ${quoted(apiKey)}`,
  'api_backend = "chat_completions"',
]

const opencodeProvider = (providerName: string, endpoint: string, apiKey: string, modelID: string) => ({
  npm: '@ai-sdk/openai-compatible',
  name: providerName,
  options: { baseURL: endpoint, apiKey },
  models: modelID ? { [modelID]: { name: modelID } } : {},
})

const openclawProvider = (endpoint: string, apiKey: string, modelID: string) => ({
  baseUrl: endpoint,
  apiKey,
  api: 'openai-completions',
  models: modelID ? [{ id: modelID, name: modelID }] : [],
})

/**
 * 生成客户端可直接读取的配置文件。CC Switch 客户端与深度链接使用同一端点和兜底模型，
 * 下载文件与一键导入写入的结果一致；Codex 需要 config.toml 和 auth.json 两个文件。
 */
export function buildClientConfigFiles(
  targetId: ConfigFileTargetId | DirectImportTargetId,
  key: ClientImportKey,
  baseURL: string,
  model: string,
  providerName: string,
  candidates: readonly string[] = [],
): ClientConfigFile[] {
  const json = (fileName: string, path: string, data: unknown): ClientConfigFile => ({ fileName, path, format: 'JSON', content: `${JSON.stringify(data, null, 2)}\n` })
  const text = (lines: readonly string[]) => `${lines.join('\n')}\n`
  switch (targetId) {
    case 'cherry-studio':
    case 'chatbox':
    case 'zcode':
    case 'workbuddy':
    case 'pi':
      return [json(configFileName(targetId), CONFIG_FILE_PATHS[targetId], buildConfigFile(targetId, key, baseURL, model, providerName, candidates))]
  }
  const { endpoint, modelID } = nativeTarget(targetId, key, baseURL, model)
  switch (targetId) {
    case 'claude-code':
      return [json('settings.json', '~/.claude/settings.json', { env: claudeCodeEnv(endpoint, key.key, modelID) })]
    case 'codex':
      return [
        { fileName: 'config.toml', path: '~/.codex/config.toml', format: 'TOML', content: text([...codexRootLines(modelID), '', ...codexProviderLines(providerName, endpoint)]) },
        json('auth.json', '~/.codex/auth.json', { OPENAI_API_KEY: key.key }),
      ]
    case 'gemini':
      // 浏览器会改写以点开头的下载文件名，因此下载为 gemini.env，由用户重命名为 .env。
      return [{ fileName: 'gemini.env', path: '~/.gemini/.env', format: 'ENV', content: text(geminiEnvLines(endpoint, key.key, modelID)) }]
    case 'grok-build':
      return [{ fileName: 'config.toml', path: '~/.grok/config.toml', format: 'TOML', content: text(['[models]', `default = ${quoted(modelID)}`, '', ...grokModelLines(modelID, endpoint, providerName, key.key)]) }]
    case 'opencode':
      return [json('opencode.json', '~/.config/opencode/opencode.json', {
        $schema: 'https://opencode.ai/config.json',
        ...(modelID ? { model: `gateway/${modelID}` } : {}),
        provider: { gateway: opencodeProvider(providerName, endpoint, key.key, modelID) },
      })]
    case 'openclaw':
      return [json('openclaw.json', '~/.openclaw/openclaw.json', {
        models: { mode: 'merge', providers: { gateway: openclawProvider(endpoint, key.key, modelID) } },
        ...(modelID ? { agents: { defaults: { model: { primary: `gateway/${modelID}` }, models: { [`gateway/${modelID}`]: {} } } } } : {}),
      })]
  }
}

/** 提供一键配置命令的客户端；ZCode 只能在界面中填写，WorkBuddy 仍以下载 models.json 为准。 */
export const SETUP_COMMAND_TARGET_IDS = ['claude-code', 'codex', 'gemini', 'grok-build', 'opencode', 'openclaw', 'pi'] as const
export type SetupCommandTargetId = typeof SETUP_COMMAND_TARGET_IDS[number]

export function supportsSetupCommand(id: ClientImportTargetId): id is SetupCommandTargetId {
  return (SETUP_COMMAND_TARGET_IDS as readonly string[]).includes(id)
}

/** 一键命令会做什么，显示在复制按钮下方。 */
export const SETUP_COMMAND_NOTES: Record<SetupCommandTargetId, string> = {
  'claude-code': '命令会合并 ~/.claude/settings.json 的 env：写入网关地址、API Key 和模型，移除旧供应商的 ANTHROPIC_API_KEY 与模型映射变量，保留其他设置；设置了 CLAUDE_CONFIG_DIR 时写入该目录。',
  codex: '命令会更新 ~/.codex/config.toml：替换 model、model_provider 和 [model_providers.gateway]，保留其他设置；auth.json 会被替换为当前 API Key，原文件已备份，切回 ChatGPT 登录时需重新登录。设置了 CODEX_HOME 时写入该目录。',
  gemini: '命令会更新 ~/.gemini/.env 的网关地址、API Key 和模型，并在 ~/.gemini/settings.json 中选择 Gemini API Key 认证。终端已导出同名环境变量时会优先使用它们，命令会给出提示；远程网关必须使用 HTTPS。',
  'grok-build': '命令会更新 ~/.grok/config.toml：设置 [models] 的默认模型，替换同名的 [model."模型 ID"] 表，保留其他模型。',
  opencode: '命令会合并 ~/.config/opencode/opencode.json：替换 provider.gateway 的地址、密钥和模型列表，并设为默认模型，保留其他供应商。',
  openclaw: '命令通过 openclaw config set 写入 gateway 提供方与默认模型，由 OpenClaw 校验后保存；校验失败时不会修改配置。需要已安装 openclaw 命令。',
  pi: '命令会合并 ~/.pi/agent/models.json 的 providers.gateway，保留其他供应商。',
}

const CLAUDE_PROVIDER_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL']

/**
 * 生成一键配置命令的写入计划。写入内容与下载的配置文件一致，但改为合并已有配置：
 * 只替换本平台的供应商条目，保留用户的其他设置；渲染见 client-setup-command.ts。
 */
export function buildClientSetupPlan(
  targetId: SetupCommandTargetId,
  key: ClientImportKey,
  baseURL: string,
  model: string,
  providerName: string,
  candidates: readonly string[] = [],
): ClientSetupPlan {
  const name = getClientImportTarget(targetId).name
  if (targetId === 'pi') {
    return {
      name,
      steps: [{ kind: 'merge-json', path: { display: '~/.pi/agent/models.json', home: ['.pi', 'agent', 'models.json'] }, value: buildConfigFile('pi', key, baseURL, model, providerName, candidates) }],
      nextStep: '重新打开 Pi，输入 /model 选择 gateway 下的模型，发送「当前时间」验证。',
    }
  }
  const { endpoint, modelID } = nativeTarget(targetId, key, baseURL, model)
  switch (targetId) {
    case 'claude-code':
      return {
        name,
        // 切换供应商时，旧供应商的密钥和模型映射会与新网关冲突，未指定模型时同时移除旧的 ANTHROPIC_MODEL。
        steps: [{
          kind: 'merge-json',
          path: { display: '~/.claude/settings.json', home: ['.claude', 'settings.json'], env: { name: 'CLAUDE_CONFIG_DIR', type: 'dir' } },
          value: { env: claudeCodeEnv(endpoint, key.key, modelID) },
          deletes: [...CLAUDE_PROVIDER_ENV, ...(modelID ? [] : ['ANTHROPIC_MODEL'])].map((variable) => ['env', variable]),
        }],
        warnEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL'],
        nextStep: '打开新终端运行 claude，发送「当前时间」验证。',
      }
    case 'codex': {
      const codexPath = (file: string) => ({ display: `~/.codex/${file}`, home: ['.codex', file], env: { name: 'CODEX_HOME', type: 'dir' as const } })
      return {
        name,
        steps: [
          {
            kind: 'edit-text',
            path: codexPath('config.toml'),
            prepend: codexRootLines(modelID),
            append: ['', ...codexProviderLines(providerName, endpoint)],
            dropTables: ['model_providers.gateway'],
            dropKeys: ['model', 'model_provider', 'cli_auth_credentials_store'].map((item) => ({ table: '', key: item })),
          },
          { kind: 'write', path: codexPath('auth.json'), content: `${JSON.stringify({ OPENAI_API_KEY: key.key }, null, 2)}\n` },
        ],
        nextStep: '完全退出并重新打开 Codex（IDE 扩展请重载编辑器窗口），发送「当前时间」验证。',
      }
    }
    case 'gemini':
      return {
        name,
        steps: [
          {
            kind: 'edit-text',
            path: { display: '~/.gemini/.env', home: ['.gemini', '.env'] },
            append: geminiEnvLines(endpoint, key.key, modelID),
            dropKeys: ['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_MODEL'].map((item) => ({ table: '', key: item })),
          },
          { kind: 'merge-json', path: { display: '~/.gemini/settings.json', home: ['.gemini', 'settings.json'] }, value: { security: { auth: { selectedType: 'gemini-api-key' } } } },
        ],
        warnEnv: ['GEMINI_API_KEY', 'GOOGLE_GEMINI_BASE_URL', 'GEMINI_MODEL'],
        nextStep: '打开新终端运行 gemini，发送「当前时间」验证。',
      }
    case 'grok-build':
      return {
        name,
        steps: [{
          kind: 'edit-text',
          path: { display: '~/.grok/config.toml', home: ['.grok', 'config.toml'] },
          append: ['', ...grokModelLines(modelID, endpoint, providerName, key.key)],
          dropTables: [grokModelHeader(modelID)],
          dropKeys: [{ table: 'models', key: 'default' }],
          setTable: { name: 'models', lines: [`default = ${quoted(modelID)}`] },
        }],
        nextStep: '退出正在运行的 grok，再从项目目录重新运行 grok 验证。',
      }
    case 'opencode':
      return {
        name,
        steps: [{
          kind: 'merge-json',
          path: { display: '~/.config/opencode/opencode.json', home: ['.config', 'opencode', 'opencode.json'] },
          value: {
            $schema: 'https://opencode.ai/config.json',
            ...(modelID ? { model: `gateway/${modelID}` } : {}),
            provider: { gateway: opencodeProvider(providerName, endpoint, key.key, modelID) },
          },
          // 模型表是对象，深度合并会保留上次选择的模型，先删除再写入。
          deletes: [['provider', 'gateway', 'models']],
        }],
        nextStep: '重新启动 opencode，在 /models 中确认 gateway 下的模型后发送「当前时间」验证。',
      }
    case 'openclaw':
      return {
        name,
        steps: [{
          kind: 'openclaw-config',
          path: { display: '~/.openclaw/openclaw.json', home: ['.openclaw', 'openclaw.json'], env: { name: 'OPENCLAW_CONFIG_PATH', type: 'file' } },
          entries: [
            { path: 'models.mode', value: 'merge' },
            { path: 'models.providers.gateway', value: openclawProvider(endpoint, key.key, modelID) },
            ...(modelID ? [
              { path: 'agents.defaults.model.primary', value: `gateway/${modelID}` },
              { path: 'agents.defaults.models', value: { [`gateway/${modelID}`]: {} }, merge: true },
            ] : []),
          ],
        }],
        nextStep: '运行 openclaw models list 确认 gateway 下的模型；如提示重启，运行 openclaw gateway restart。',
      }
  }
}

/** 生成可直接粘贴运行的一键配置命令。 */
export function buildClientSetupCommand(
  targetId: SetupCommandTargetId,
  key: ClientImportKey,
  baseURL: string,
  model: string,
  providerName: string,
  candidates: readonly string[],
  platform: SetupPlatform,
): string {
  return renderSetupCommand(buildClientSetupPlan(targetId, key, baseURL, model, providerName, candidates), platform)
}
