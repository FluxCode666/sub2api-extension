import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { MENU_ICON_OPTIONS, type MenuIconOption } from '@/lib/menu-icons'

interface MenuIconPickerProps {
  value: string
  onValueChange: (value: string) => void
  options?: readonly MenuIconOption[]
  id?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

function normalizeSearchValue(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

/**
 * 可搜索的菜单图标选择器。
 *
 * 图标目录较大时，普通 Select 需要滚动很久才能找到目标；这里使用
 * combobox + listbox 模式，搜索值同时匹配 metadata 值和显示名称，并保留
 * 上下键、Enter、Esc 等键盘操作。
 */
export function MenuIconPicker({
  value,
  onValueChange,
  options = MENU_ICON_OPTIONS,
  id = 'menu-icon',
  placeholder = '选择菜单图标',
  disabled = false,
  className,
}: MenuIconPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const instanceId = useId().replace(/:/g, '')
  const listboxId = `${id}-${instanceId}-options`

  const selectedOption = options.find((option) => option.value === value)
  const SelectedIcon = selectedOption?.icon
  const normalizedQuery = normalizeSearchValue(query)
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options
    return options.filter((option) => (
      normalizeSearchValue(option.value).includes(normalizedQuery)
      || normalizeSearchValue(option.label).includes(normalizedQuery)
    ))
  }, [normalizedQuery, options])

  useEffect(() => {
    if (!open) return

    setQuery('')
    const selectedIndex = options.findIndex((option) => option.value === value)
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)

    // Radix focuses the content by default. Move focus to the search box so
    // typing immediately filters the list after opening the picker.
    const timeout = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(timeout)
  }, [open, options, value])

  const closePicker = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const selectOption = (option: MenuIconOption) => {
    onValueChange(option.value)
    closePicker()
  }

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent Radix's menu typeahead from competing with the combobox input.
    event.stopPropagation()

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredOptions.length > 0) {
        setActiveIndex((index) => Math.min(index + 1, filteredOptions.length - 1))
      }
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredOptions.length > 0) {
        setActiveIndex((index) => Math.max(index - 1, 0))
      }
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      if (filteredOptions.length > 0) setActiveIndex(0)
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      if (filteredOptions.length > 0) setActiveIndex(filteredOptions.length - 1)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const option = filteredOptions[activeIndex]
      if (option) selectOption(option)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closePicker()
    }
  }

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery)
    setActiveIndex(0)
  }

  const handleListWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // Radix's menu content also listens for pointer/focus events. Keep wheel
    // input inside the list and explicitly advance the scroll position so the
    // long icon catalog remains usable in browsers where nested overflow is
    // otherwise captured by the portalled menu.
    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * event.currentTarget.clientHeight
        : event.deltaY
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.scrollTop += delta
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        className={cn(
          'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {SelectedIcon ? <SelectedIcon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
          <span className={cn(!selectedOption && 'text-muted-foreground')}>
            {selectedOption?.label ?? (value || placeholder)}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        role="dialog"
        aria-label="选择菜单图标"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          triggerRef.current?.focus()
        }}
        className="w-[min(24rem,calc(100vw-2rem))] min-w-0 overflow-hidden p-2"
      >
        <div className="relative mb-2">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="search"
            role="combobox"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="搜索图标名称或值…"
            aria-label="搜索菜单图标"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={filteredOptions[activeIndex] ? `${listboxId}-${filteredOptions[activeIndex].value}` : undefined}
            className="flex h-9 w-full rounded-md border border-input bg-transparent py-1 pl-8 pr-3 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
        </div>
        <div
          id={listboxId}
          role="listbox"
          aria-label="菜单图标选项"
          onWheel={handleListWheel}
          className="max-h-64 overflow-y-auto overscroll-contain"
        >
          {filteredOptions.length === 0 ? (
            <p role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">
              未找到匹配的图标
            </p>
          ) : (
            filteredOptions.map((option, index) => {
              const Icon = option.icon
              const selected = option.value === value
              const active = index === activeIndex
              return (
                <div
                  key={option.value}
                  id={`${listboxId}-${option.value}`}
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none',
                    active && 'bg-accent text-accent-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <code className="shrink-0 text-xs text-muted-foreground">{option.value}</code>
                  {selected ? <Check className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                </div>
              )
            })
          )}
        </div>
        <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
          ↑↓ 选择 · Enter 确认 · Esc 关闭
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
