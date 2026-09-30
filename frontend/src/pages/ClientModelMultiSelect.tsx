import { useState } from 'react'
import { Check, ChevronsUpDown, LoaderCircle, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { isValidClientModel, MAX_CLIENT_MODEL_LENGTH } from '@/lib/client-models'
import type { ClientModelCatalogStatus } from './ClientModelSelect'

const CUSTOM_PREFIX = '__custom__:'
const CLEAR_VALUE = '__clear__'

/**
 * 候选模型 ID 多选：选项来自所选 API Key 的网关模型列表，也可把搜索内容添加为自定义模型 ID。
 * 选择后弹层保持打开以便连续勾选；values 保持用户的选择顺序，生成配置时按该顺序排在默认模型之后。
 */
export function ClientModelMultiSelect({
  id,
  values,
  options,
  status,
  describedBy,
  onChange,
  disabled = false,
}: {
  id: string
  values: readonly string[]
  options: readonly string[]
  status: ClientModelCatalogStatus
  describedBy?: string
  onChange: (models: string[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const items = [...values.filter((model) => !options.includes(model)), ...options]
  const custom = search.trim()
  const canUseCustom = isValidClientModel(custom) && !items.includes(custom)

  function toggle(model: string) {
    onChange(values.includes(model) ? values.filter((item) => item !== model) : [...values, model])
  }

  function addCustom() {
    onChange([...values, custom])
    setSearch('')
  }

  return <div className="client-import-candidates">
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch('') }}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-describedby={describedBy} disabled={disabled} className="client-import-model-trigger">
          <span className={values.length ? undefined : 'client-model-placeholder'}>{values.length ? `已选择 ${values.length} 个候选模型` : '不添加候选模型'}</span>
          {status === 'loading' && !disabled ? <LoaderCircle size={16} className="client-model-spinner" aria-hidden="true" /> : <ChevronsUpDown size={16} aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="client-import-model-popover">
        <Command label="搜索候选模型">
          <CommandInput wrapperClassName="client-model-search" value={search} onValueChange={setSearch} maxLength={MAX_CLIENT_MODEL_LENGTH} placeholder="搜索或输入模型 ID" />
          <CommandList>
            <CommandEmpty>{status === 'loading' ? '正在读取模型列表…' : status === 'error' ? '模型列表暂不可用，可直接输入模型 ID' : '没有匹配的模型'}</CommandEmpty>
            {items.length > 0 && <CommandGroup heading={status === 'ready' ? '该密钥可用模型' : undefined}>
              {items.map((model) => {
                const selected = values.includes(model)
                return <CommandItem key={model} value={model} onSelect={() => toggle(model)}>
                  <Check size={15} className={selected ? 'is-selected' : undefined} aria-hidden="true" />
                  <span>{model}</span>
                </CommandItem>
              })}
            </CommandGroup>}
            {canUseCustom && <CommandGroup heading="自定义">
              <CommandItem value={`${CUSTOM_PREFIX}${custom}`} onSelect={addCustom}>
                <Plus size={15} className="is-clear" aria-hidden="true" />
                <span>添加「{custom}」</span>
              </CommandItem>
            </CommandGroup>}
            {values.length > 0 && !custom && <CommandGroup>
              <CommandItem value={CLEAR_VALUE} onSelect={() => { onChange([]); setOpen(false) }}>
                <X size={15} className="is-clear" aria-hidden="true" />
                <span>清空候选模型</span>
              </CommandItem>
            </CommandGroup>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {values.length > 0 && <ul className="client-import-candidate-list" aria-label="已选择的候选模型">
      {values.map((model) => <li key={model}>
        <Badge variant="outline" className="client-import-candidate">
          <span>{model}</span>
          <Button type="button" variant="ghost" size="icon" className="client-import-candidate-remove" disabled={disabled} aria-label={`移除候选模型 ${model}`} onClick={() => toggle(model)}>
            <X size={12} aria-hidden="true" />
          </Button>
        </Badge>
      </li>)}
    </ul>}
  </div>
}
