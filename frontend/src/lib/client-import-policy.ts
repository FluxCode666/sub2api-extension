import { CLIENT_IMPORT_TARGETS, MULTI_MODEL_CAPABLE_CLIENT_IDS, type ClientImportTargetId } from './client-import'

/** 平台规则：限制该 Sub2API 分组平台可导入的客户端。 */
export interface ClientImportPlatformRule {
  platform: string
  allowedClients: ClientImportTargetId[]
}

/** 分组规则：限制指定分组可导入的客户端，优先于平台规则。 */
export interface ClientImportGroupRule {
  groupId: number
  allowedClients: ClientImportTargetId[]
}

/** 客户端导入白名单；没有规则的平台或分组允许导入全部客户端。 */
export interface ClientImportPolicy {
  platforms: ClientImportPlatformRule[]
  groups: ClientImportGroupRule[]
  /** 允许在导入页配置多个候选模型 ID 的客户端；旧版后端不返回时视为全部可多选客户端开启。 */
  multiModelClients: ClientImportTargetId[]
}

/** 管理端选择分组规则时使用的 Sub2API 分组（只读查询）。 */
export interface ClientImportPolicyGroup {
  id: number
  name: string
  platform: string
  status: string
}

/** Sub2API 已知的分组平台；分组列表或已有规则中的其他平台会追加在后面。 */
export const KNOWN_GROUP_PLATFORMS = ['anthropic', 'openai', 'gemini', 'antigravity', 'grok'] as const

export const ALL_CLIENT_IDS: ClientImportTargetId[] = CLIENT_IMPORT_TARGETS.map((target) => target.id)

export function emptyClientImportPolicy(): ClientImportPolicy {
  return { platforms: [], groups: [], multiModelClients: [...MULTI_MODEL_CAPABLE_CLIENT_IDS] }
}

/** 按 CLIENT_IMPORT_TARGETS 的顺序去重，并丢弃未知客户端。 */
export function sortClientIds(ids: readonly string[]): ClientImportTargetId[] {
  const wanted = new Set(ids)
  return ALL_CLIENT_IDS.filter((id) => wanted.has(id))
}

/** 规范化为与后端一致的顺序，便于比较是否有未保存修改。 */
export function normalizeClientImportPolicy(policy: Partial<ClientImportPolicy> | null | undefined): ClientImportPolicy {
  const multiModel = policy?.multiModelClients
  return {
    platforms: [...(policy?.platforms ?? [])]
      .map((rule) => ({ platform: rule.platform.trim().toLowerCase(), allowedClients: sortClientIds(rule.allowedClients ?? []) }))
      .sort((a, b) => a.platform.localeCompare(b.platform)),
    groups: [...(policy?.groups ?? [])]
      .map((rule) => ({ groupId: rule.groupId, allowedClients: sortClientIds(rule.allowedClients ?? []) }))
      .sort((a, b) => a.groupId - b.groupId),
    multiModelClients: multiModel === undefined || multiModel === null
      ? [...MULTI_MODEL_CAPABLE_CLIENT_IDS]
      : sortClientIds(multiModel).filter((id) => MULTI_MODEL_CAPABLE_CLIENT_IDS.includes(id)),
  }
}

export function samePolicy(a: ClientImportPolicy, b: ClientImportPolicy): boolean {
  return JSON.stringify(normalizeClientImportPolicy(a)) === JSON.stringify(normalizeClientImportPolicy(b))
}

/** 展示用平台列表：已知平台在前，其余按字母排序。 */
export function listPolicyPlatforms(policy: Pick<ClientImportPolicy, 'platforms'>, groups: readonly ClientImportPolicyGroup[]): string[] {
  const extra = new Set<string>()
  for (const group of groups) {
    const platform = group.platform.trim().toLowerCase()
    if (platform) extra.add(platform)
  }
  for (const rule of policy.platforms) extra.add(rule.platform)
  for (const platform of KNOWN_GROUP_PLATFORMS) extra.delete(platform)
  return [...KNOWN_GROUP_PLATFORMS, ...[...extra].sort()]
}

/** 与后端解析规则一致：分组规则优先，其次平台规则，否则允许全部客户端。 */
export function effectiveAllowedClients(policy: Pick<ClientImportPolicy, 'platforms' | 'groups'>, groupId: number, platform: string): ClientImportTargetId[] {
  const groupRule = policy.groups.find((rule) => rule.groupId === groupId)
  if (groupRule) return groupRule.allowedClients
  const platformRule = policy.platforms.find((rule) => rule.platform === platform.trim().toLowerCase())
  if (platformRule) return platformRule.allowedClients
  return ALL_CLIENT_IDS
}

export function toggleClient(ids: readonly ClientImportTargetId[], id: ClientImportTargetId, allowed: boolean): ClientImportTargetId[] {
  return sortClientIds(allowed ? [...ids, id] : ids.filter((current) => current !== id))
}
