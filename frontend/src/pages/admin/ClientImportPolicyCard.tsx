import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Layers, Loader2, Plus, RotateCcw, Save, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, AuxApiError, type AuxEnvelope } from '@/lib/api-client'
import { CLIENT_IMPORT_TARGETS, MULTI_MODEL_CAPABLE_CLIENT_IDS, formatGroupPlatform, type ClientImportTargetId } from '@/lib/client-import'
import {
  ALL_CLIENT_IDS,
  effectiveAllowedClients,
  emptyClientImportPolicy,
  listPolicyPlatforms,
  normalizeClientImportPolicy,
  samePolicy,
  toggleClient,
  type ClientImportPolicy,
  type ClientImportPolicyGroup,
} from '@/lib/client-import-policy'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SystemConfigSectionHeading } from './SystemConfigNav'

type GroupsState =
  | { status: 'loading' }
  | { status: 'ready'; items: ClientImportPolicyGroup[] }
  | { status: 'unavailable'; message: string }

function describeAllowed(ids: readonly ClientImportTargetId[]): string {
  if (ids.length === 0) return '不允许导入任何客户端'
  if (ids.length === ALL_CLIENT_IDS.length) return '允许全部客户端'
  return `已允许 ${ids.length}/${ALL_CLIENT_IDS.length}`
}

const MULTI_MODEL_TARGETS = CLIENT_IMPORT_TARGETS.filter((target) => MULTI_MODEL_CAPABLE_CLIENT_IDS.includes(target.id))

function describeMultiModel(ids: readonly ClientImportTargetId[]): string {
  if (ids.length === 0) return '全部客户端只能配置单个模型 ID'
  if (ids.length === MULTI_MODEL_TARGETS.length) return '支持多模型的客户端均已开启'
  return `已开启 ${ids.length}/${MULTI_MODEL_TARGETS.length}`
}

function groupLabel(group: ClientImportPolicyGroup | undefined, groupId: number): string {
  if (!group) return `分组 #${groupId}`
  const name = group.name.trim() || `分组 #${group.id}`
  const inactive = group.status && group.status !== 'active' ? '（已停用）' : ''
  return `${name}${inactive} · ${formatGroupPlatform(group.platform)}`
}

interface ClientSwitchGridProps {
  idPrefix: string
  ruleLabel: string
  allowed: ClientImportTargetId[]
  disabled: boolean
  onChange: (next: ClientImportTargetId[]) => void
}

function ClientSwitchGrid({ idPrefix, ruleLabel, allowed, disabled, onChange }: ClientSwitchGridProps) {
  return (
    <div className="aux-import-policy-clients">
      <div className="aux-import-policy-bulk">
        <Button type="button" variant="ghost" size="sm" disabled={disabled || allowed.length === ALL_CLIENT_IDS.length} onClick={() => onChange([...ALL_CLIENT_IDS])} aria-label={`${ruleLabel}：全选客户端`}>全选</Button>
        <Button type="button" variant="ghost" size="sm" disabled={disabled || allowed.length === 0} onClick={() => onChange([])} aria-label={`${ruleLabel}：全不选客户端`}>全不选</Button>
      </div>
      <div className="aux-import-policy-client-grid" role="group" aria-label={`${ruleLabel}允许导入的客户端`}>
        {CLIENT_IMPORT_TARGETS.map((target) => {
          const id = `${idPrefix}-${target.id}`
          const checked = allowed.includes(target.id)
          return (
            <div key={target.id} className={`aux-import-policy-client${checked ? ' is-allowed' : ''}`}>
              <Label htmlFor={id}>{target.name}</Label>
              <Switch
                id={id}
                checked={checked}
                disabled={disabled}
                aria-label={`${ruleLabel}允许导入 ${target.name}`}
                onCheckedChange={(next) => onChange(toggleClient(allowed, target.id, next))}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface ClientImportPolicyCardProps {
  /** 板块锚点 id，供系统配置目录跳转。 */
  id?: string
  /** 草稿与已保存规则是否不同，供目录标记未保存状态。 */
  onDirtyChange?: (dirty: boolean) => void
}

/** 系统配置页中的客户端导入限制：按分组平台或具体分组设置可导入的客户端白名单，并控制哪些客户端可配置多个候选模型 ID。 */
export function ClientImportPolicyCard({ id = 'client-import-policy', onDirtyChange }: ClientImportPolicyCardProps) {
  const [saved, setSaved] = useState<ClientImportPolicy | null>(null)
  const [draft, setDraft] = useState<ClientImportPolicy>(emptyClientImportPolicy)
  const [loadError, setLoadError] = useState('')
  const [groups, setGroups] = useState<GroupsState>({ status: 'loading' })
  const [pendingGroupId, setPendingGroupId] = useState('')
  const [saving, setSaving] = useState(false)

  const loadPolicy = useCallback(async () => {
    setLoadError('')
    setSaved(null)
    try {
      const response = await apiClient.get<AuxEnvelope<ClientImportPolicy>>('/admin/client-import/policy')
      const policy = normalizeClientImportPolicy(response.data)
      setSaved(policy)
      setDraft(policy)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '客户端导入限制加载失败')
    }
  }, [])

  const loadGroups = useCallback(async () => {
    setGroups({ status: 'loading' })
    try {
      const response = await apiClient.get<AuxEnvelope<{ items: ClientImportPolicyGroup[] }>>('/admin/client-import/groups')
      setGroups({ status: 'ready', items: response.data?.items ?? [] })
    } catch (err) {
      const message = err instanceof AuxApiError && err.status === 503
        ? '未配置 Sub2API 数据库，无法读取分组列表；仍可配置平台规则，已有分组规则按分组 ID 显示。'
        : err instanceof Error ? err.message : '分组列表加载失败'
      setGroups({ status: 'unavailable', message })
    }
  }, [])

  useEffect(() => {
    void loadPolicy()
    void loadGroups()
  }, [loadPolicy, loadGroups])

  const groupItems = groups.status === 'ready' ? groups.items : []
  const groupsById = useMemo(() => new Map(groupItems.map((group) => [group.id, group])), [groupItems])
  const platforms = useMemo(() => listPolicyPlatforms(draft, groupItems), [draft, groupItems])
  const addableGroups = useMemo(() => groupItems.filter((group) => !draft.groups.some((rule) => rule.groupId === group.id)), [draft.groups, groupItems])
  const dirty = saved !== null && !samePolicy(draft, saved)
  const ruleCount = draft.platforms.length + draft.groups.length
  const controlsDisabled = saved === null || saving

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const setPlatformRule = (platform: string, allowedClients: ClientImportTargetId[] | null) => {
    setDraft((current) => {
      const others = current.platforms.filter((rule) => rule.platform !== platform)
      return { ...current, platforms: allowedClients === null ? others : [...others, { platform, allowedClients }] }
    })
  }

  const setGroupRule = (groupId: number, allowedClients: ClientImportTargetId[] | null) => {
    setDraft((current) => {
      const index = current.groups.findIndex((rule) => rule.groupId === groupId)
      if (allowedClients === null) return { ...current, groups: current.groups.filter((rule) => rule.groupId !== groupId) }
      if (index < 0) return { ...current, groups: [...current.groups, { groupId, allowedClients }] }
      const next = [...current.groups]
      next[index] = { groupId, allowedClients }
      return { ...current, groups: next }
    })
  }

  const addGroupRule = () => {
    const groupId = Number(pendingGroupId)
    const group = groupsById.get(groupId)
    if (!group) return
    // 新分组规则以当前实际生效的客户端为起点，避免添加后立刻改变该分组的可导入范围。
    setGroupRule(groupId, [...effectiveAllowedClients(draft, groupId, group.platform)])
    setPendingGroupId('')
  }

  const savePolicy = async () => {
    setSaving(true)
    try {
      const response = await apiClient.put<AuxEnvelope<ClientImportPolicy>>('/admin/client-import/policy', normalizeClientImportPolicy(draft))
      const policy = normalizeClientImportPolicy(response.data ?? draft)
      setSaved(policy)
      setDraft(policy)
      toast.success('客户端导入限制已保存', { description: '用户刷新客户端导入页后按新规则生效。' })
    } catch (err) {
      toast.error('客户端导入限制保存失败', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id={id} className="aux-system-config-card aux-system-config-form-card aux-system-config-section aux-import-policy-card" aria-labelledby={`${id}-title`}>
      <SystemConfigSectionHeading
        id={id}
        icon={ShieldCheck}
        title="客户端导入限制"
        status={<span className="aux-system-config-status"><ShieldCheck aria-hidden="true" />{ruleCount === 0 ? '全部客户端可导入' : `已配置 ${ruleCount} 条规则`}</span>}
      />
      <p className="aux-system-config-description">按 API Key 所属分组的平台或具体分组，限制用户在「客户端导入」页可导入的客户端。未配置规则时全部客户端可导入；分组规则优先于平台规则；未选择分组的 API Key 始终不能导入。</p>

      {loadError ? (
        <Alert className="aux-import-policy-alert is-error">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>客户端导入限制加载失败</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadPolicy()}>重新加载</Button>
          </AlertDescription>
        </Alert>
      ) : saved === null ? (
        <div className="aux-import-policy-loading" role="status"><Loader2 className="aux-system-config-spin" aria-hidden="true" />正在加载导入限制…</div>
      ) : (
        <>
          <div className="aux-import-policy-section">
            <div className="aux-import-policy-section-head">
              <h3>按平台限制</h3>
              <small>对该平台下所有分组生效；关闭「自定义限制」即恢复为全部可导入。</small>
            </div>
            <div className="aux-import-policy-rules">
              {platforms.map((platform) => {
                const rule = draft.platforms.find((item) => item.platform === platform)
                const label = formatGroupPlatform(platform)
                return (
                  <div key={platform} className={`aux-import-policy-rule${rule ? ' is-restricted' : ''}`}>
                    <div className="aux-import-policy-rule-head">
                      <div>
                        <strong>{label}</strong>
                        <small className={rule?.allowedClients.length === 0 ? 'is-warning' : undefined}>{rule ? describeAllowed(rule.allowedClients) : '全部客户端可导入'}</small>
                      </div>
                      <div className="aux-import-policy-toggle">
                        <Label htmlFor={`import-policy-platform-${platform}`}>自定义限制</Label>
                        <Switch
                          id={`import-policy-platform-${platform}`}
                          checked={!!rule}
                          disabled={controlsDisabled}
                          aria-label={`${label} 平台自定义限制`}
                          onCheckedChange={(checked) => setPlatformRule(platform, checked ? [...ALL_CLIENT_IDS] : null)}
                        />
                      </div>
                    </div>
                    {rule && (
                      <ClientSwitchGrid
                        idPrefix={`import-policy-platform-${platform}`}
                        ruleLabel={`${label} 平台`}
                        allowed={rule.allowedClients}
                        disabled={controlsDisabled}
                        onChange={(next) => setPlatformRule(platform, next)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="aux-import-policy-section">
            <div className="aux-import-policy-section-head">
              <h3>按分组限制</h3>
              <small>优先于平台规则，适合为个别分组单独放开或收紧。</small>
            </div>
            {groups.status === 'unavailable' && (
              <Alert className="aux-import-policy-alert aux-import-policy-groups-alert">
                <AlertTriangle aria-hidden="true" />
                <AlertTitle>无法读取 Sub2API 分组</AlertTitle>
                <AlertDescription>
                  <p>{groups.message}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadGroups()}>重试</Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="aux-import-policy-add">
              <Select value={pendingGroupId} onValueChange={setPendingGroupId} disabled={controlsDisabled || groups.status !== 'ready' || addableGroups.length === 0}>
                <SelectTrigger aria-label="选择要限制的分组" className="aux-import-policy-select">
                  <SelectValue placeholder={groups.status === 'loading' ? '正在加载分组…' : addableGroups.length ? '选择要限制的分组' : '暂无可添加的分组'} />
                </SelectTrigger>
                <SelectContent>
                  {addableGroups.map((group) => <SelectItem key={group.id} value={String(group.id)}>{groupLabel(group, group.id)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" className="aux-import-policy-add-button" disabled={controlsDisabled || !pendingGroupId} onClick={addGroupRule}>
                <Plus aria-hidden="true" />添加分组规则
              </Button>
            </div>
            {draft.groups.length === 0 ? (
              <p className="aux-import-policy-empty">暂无分组规则，分组按所属平台的规则生效。</p>
            ) : (
              <div className="aux-import-policy-rules">
                {draft.groups.map((rule) => {
                  const label = groupLabel(groupsById.get(rule.groupId), rule.groupId)
                  return (
                    <div key={rule.groupId} className="aux-import-policy-rule is-restricted">
                      <div className="aux-import-policy-rule-head">
                        <div>
                          <strong>{label}</strong>
                          <small className={rule.allowedClients.length === 0 ? 'is-warning' : undefined}>{describeAllowed(rule.allowedClients)}</small>
                        </div>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="aux-import-policy-remove" disabled={controlsDisabled} aria-label={`移除 ${label} 的分组规则`} onClick={() => setGroupRule(rule.groupId, null)}>
                                <Trash2 aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>移除后该分组按平台规则生效</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <ClientSwitchGrid
                        idPrefix={`import-policy-group-${rule.groupId}`}
                        ruleLabel={label}
                        allowed={rule.allowedClients}
                        disabled={controlsDisabled}
                        onChange={(next) => setGroupRule(rule.groupId, next)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="aux-import-policy-section">
            <div className="aux-import-policy-section-head">
              <h3>多模型候选</h3>
              <small>开启后，用户在「客户端导入」页可为该客户端额外选择多个候选模型 ID，生成的配置以默认模型为首位。CC Switch 深度链接和 Cherry Studio 只支持单个模型，不在此列。</small>
            </div>
            <div className="aux-import-policy-rule is-restricted">
              <div className="aux-import-policy-rule-head">
                <div>
                  <strong><Layers className="aux-import-policy-inline-icon" aria-hidden="true" />允许配置多个模型 ID</strong>
                  <small>{describeMultiModel(draft.multiModelClients)}</small>
                </div>
              </div>
              <div className="aux-import-policy-clients">
                <div className="aux-import-policy-client-grid" role="group" aria-label="允许配置多个模型 ID 的客户端">
                  {MULTI_MODEL_TARGETS.map((target) => {
                    const switchId = `import-policy-multi-model-${target.id}`
                    const checked = draft.multiModelClients.includes(target.id)
                    return (
                      <div key={target.id} className={`aux-import-policy-client${checked ? ' is-allowed' : ''}`}>
                        <Label htmlFor={switchId}>{target.name}</Label>
                        <Switch
                          id={switchId}
                          checked={checked}
                          disabled={controlsDisabled}
                          aria-label={`${target.name} 允许配置多个模型 ID`}
                          onCheckedChange={(next) => setDraft((current) => ({
                            ...current,
                            multiModelClients: toggleClient(current.multiModelClients, target.id, next),
                          }))}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="aux-system-config-actions">
            {/* 恢复不限制只清空导入白名单，不改变多模型候选设置。 */}
            <Button type="button" variant="outline" className="aux-system-config-secondary" disabled={controlsDisabled || ruleCount === 0} onClick={() => setDraft((current) => ({ ...emptyClientImportPolicy(), multiModelClients: current.multiModelClients }))}>
              <RotateCcw aria-hidden="true" />恢复不限制
            </Button>
            <Button type="button" className="aux-system-config-primary" disabled={controlsDisabled || !dirty} onClick={() => void savePolicy()}>
              <Save aria-hidden="true" />{saving ? '保存中…' : '保存限制'}
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
