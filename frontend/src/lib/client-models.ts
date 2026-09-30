import type { ClientId } from '@/lib/client-guides'

/** 后端 /client-docs/models 返回的模型选项，来源为 Sub2API 模型广场。 */
export interface ClientModelOption {
  id: string
  platforms: string[]
}

export interface ClientModelListResponse {
  items: ClientModelOption[]
}

export const MAX_CLIENT_MODEL_LENGTH = 160

type ModelMatcher = (model: ClientModelOption) => boolean

const onPlatform = (platform: string, prefix?: string): ModelMatcher => model =>
  model.platforms.includes(platform) || (!!prefix && model.platforms.includes('antigravity') && model.id.toLowerCase().startsWith(prefix))

const anthropicModels: ModelMatcher = onPlatform('anthropic', 'claude')
const openAIModels: ModelMatcher = onPlatform('openai')

// 单协议客户端只列出对应平台的模型；Antigravity 分组同时承载 Claude 与 Gemini，按模型前缀归类。
// 未登记的客户端支持 Chat Completions 等多种协议，展示全部模型。
const CLIENT_MODEL_MATCHERS: Partial<Record<ClientId, ModelMatcher>> = {
  'claude-code': anthropicModels,
  'claude-desktop': anthropicModels,
  'vscode-claude': anthropicModels,
  obsidian: anthropicModels,
  codex: openAIModels,
  'vscode-codex': openAIModels,
  'gemini-cli': onPlatform('gemini', 'gemini'),
  'grok-build': onPlatform('grok'),
}

/** 返回指定客户端可用的模型 ID，保持后端排序。 */
export function modelsForClient(models: readonly ClientModelOption[], clientId: ClientId): string[] {
  const matches = CLIENT_MODEL_MATCHERS[clientId]
  return models.filter(model => !matches || matches(model)).map(model => model.id)
}

/** 未手动选择时优先使用指南默认模型；平台未开放该模型时改用列表首项。 */
export function preferredClientModel(options: readonly string[], fallback: string): string {
  return options.includes(fallback) ? fallback : options[0] ?? fallback
}

/** 模型 ID 会写入配置示例，禁止空值和控制字符。 */
export function isValidClientModel(value: string): boolean {
  const model = value.trim()
  return !!model && model.length <= MAX_CLIENT_MODEL_LENGTH && !/[\x00-\x1f\x7f]/.test(model)
}
