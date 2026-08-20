import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlarmClock, ChartBar, FileText, Menu } from 'lucide-react'
import { MenuIconPicker } from './MenuIconPicker'
import type { MenuIconOption } from '@/lib/menu-icons'

const options: readonly MenuIconOption[] = [
  { value: 'alarm-clock', label: 'Alarm Clock', icon: AlarmClock },
  { value: 'chart-bar', label: 'Chart Bar', icon: ChartBar },
  { value: 'file-text', label: '文档', icon: FileText },
  { value: 'menu', label: '默认菜单', icon: Menu },
]

function renderPicker(onValueChange = vi.fn()) {
  render(
    <MenuIconPicker
      value="menu"
      onValueChange={onValueChange}
      options={options}
    />,
  )
  return onValueChange
}

describe('MenuIconPicker', () => {
  it('filters by icon value and selects with Enter', async () => {
    const user = userEvent.setup()
    const onValueChange = renderPicker()

    await user.click(screen.getByRole('button', { name: '默认菜单' }))
    const search = await screen.findByRole('combobox', { name: '搜索菜单图标' })
    await user.type(search, 'file-text')

    expect(screen.getByRole('option', { name: /文档/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Alarm Clock/ })).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(onValueChange).toHaveBeenCalledWith('file-text')
  })

  it('supports arrow-key navigation and reports empty results', async () => {
    const user = userEvent.setup()
    function ControlledPicker() {
      const [value, setValue] = useState('menu')
      return <MenuIconPicker value={value} onValueChange={setValue} options={options} />
    }
    render(<ControlledPicker />)

    await user.click(screen.getByRole('button', { name: '默认菜单' }))
    const search = await screen.findByRole('combobox', { name: '搜索菜单图标' })
    await user.type(search, 'chart')
    await user.keyboard('{ArrowDown}{Enter}')

    expect(screen.getByRole('button', { name: 'Chart Bar' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Chart Bar' }))
    const reopenedSearch = await screen.findByRole('combobox', { name: '搜索菜单图标' })
    await user.clear(reopenedSearch)
    await user.type(reopenedSearch, 'does-not-exist')
    expect(screen.getByRole('status')).toHaveTextContent('未找到匹配的图标')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('combobox', { name: '搜索菜单图标' })).not.toBeInTheDocument()
  })

  it('scrolls the option list with a mouse wheel', async () => {
    const user = userEvent.setup()
    renderPicker()

    await user.click(screen.getByRole('button', { name: '默认菜单' }))
    const listbox = await screen.findByRole('listbox', { name: '菜单图标选项' })
    fireEvent.wheel(listbox, { deltaY: 120 })

    expect(listbox).toHaveProperty('scrollTop', 120)
  })
})
