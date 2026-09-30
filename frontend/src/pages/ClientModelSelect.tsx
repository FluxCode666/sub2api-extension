import { useState } from 'react'
import { Check, ChevronsUpDown, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { isValidClientModel, MAX_CLIENT_MODEL_LENGTH } from '@/lib/client-models'

export type ClientModelCatalogStatus = 'loading' | 'ready' | 'error'

const CUSTOM_PREFIX = '__custom__:'
const CLEAR_VALUE = '__clear__'

/**
 * 可搜索的模型 ID 下拉：接入文档的选项来自 Sub2API 模型广场，客户端导入页来自所选 API Key 的网关模型列表。
 * 列表未包含或不可用时，允许把搜索内容作为自定义模型 ID 使用；提供 clearLabel 时可清空为不指定。
 */
export function ClientModelSelect({
  id,
  value,
  options,
  status,
  theme,
  invalid = false,
  describedBy,
  onChange,
  triggerClassName = 'client-model-trigger',
  contentClassName = 'client-directory-select-content client-model-popover',
  groupHeading = '平台模型',
  placeholder = '选择模型',
  clearLabel,
  disabled = false,
}: {
  id: string
  value: string
  options: readonly string[]
  status: ClientModelCatalogStatus
  theme?: 'light' | 'dark'
  invalid?: boolean
  describedBy?: string
  onChange: (model: string) => void
  triggerClassName?: string
  contentClassName?: string
  groupHeading?: string
  placeholder?: string
  clearLabel?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const items = value && !options.includes(value) ? [value, ...options] : [...options]
  const custom = search.trim()
  const canUseCustom = isValidClientModel(custom) && !items.includes(custom)

  function select(model: string) {
    onChange(model)
    setSearch('')
    setOpen(false)
  }

  return <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch('') }}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-invalid={invalid} aria-describedby={describedBy} disabled={disabled} className={triggerClassName}>
        <span className={value ? undefined : 'client-model-placeholder'}>{value || placeholder}</span>
        {status === 'loading' && !disabled ? <LoaderCircle size={16} className="client-model-spinner" aria-hidden="true" /> : <ChevronsUpDown size={16} aria-hidden="true" />}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" data-theme={theme} className={contentClassName}>
      <Command label="搜索模型">
        <CommandInput wrapperClassName="client-model-search" value={search} onValueChange={setSearch} maxLength={MAX_CLIENT_MODEL_LENGTH} placeholder="搜索或输入模型 ID" />
        <CommandList>
          <CommandEmpty>{status === 'loading' ? '正在读取模型列表…' : status === 'error' ? '模型列表暂不可用，可直接输入模型 ID' : '没有匹配的模型'}</CommandEmpty>
          {items.length > 0 && <CommandGroup heading={status === 'ready' ? groupHeading : undefined}>
            {items.map(model => <CommandItem key={model} value={model} onSelect={() => select(model)}>
              <Check size={15} className={model === value ? 'is-selected' : undefined} aria-hidden="true" />
              <span>{model}</span>
            </CommandItem>)}
          </CommandGroup>}
          {canUseCustom && <CommandGroup heading="自定义">
            <CommandItem value={`${CUSTOM_PREFIX}${custom}`} onSelect={() => select(custom)}>
              <Check size={15} aria-hidden="true" />
              <span>使用「{custom}」</span>
            </CommandItem>
          </CommandGroup>}
          {clearLabel && value && !custom && <CommandGroup>
            <CommandItem value={CLEAR_VALUE} onSelect={() => select('')}>
              <X size={15} className="is-clear" aria-hidden="true" />
              <span>{clearLabel}</span>
            </CommandItem>
          </CommandGroup>}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}
