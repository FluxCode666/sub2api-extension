import {
  BarChart3,
  CircleHelp,
  icons as lucideIcons,
  type LucideIcon,
} from 'lucide-react'

/**
 * 动态管理员菜单允许使用的图标。
 *
 * 图标名存储在页面 metadata.menu_icon 中，而不是让数据库保存组件代码；
 * 这样既保持元数据的通用键值结构，又能在前端从 Lucide 官方图标目录安全解析。
 */
export interface MenuIconOption {
  value: string
  label: string
  icon: LucideIcon
}

/**
 * 兼容现有示例页的中文名称；其余图标使用可读的英文名称。
 * Lucide 当前目录包含 1,700+ 个图标，新增图标无需再改这里。
 */
const MENU_ICON_LABELS: Record<string, string> = {
  menu: '默认菜单',
  'file-text': '文档',
  'layout-dashboard': '仪表盘',
  'bar-chart-3': '图表',
  activity: '活动',
  gauge: '仪表',
  images: '图片',
  settings: '设置',
  star: '收藏',
  'circle-help': '帮助',
  'external-link': '外链',
}

/** 将 Lucide 的 PascalCase 导出名转换为稳定的 metadata 键名。 */
export function toMenuIconValue(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([a-zA-Z])([0-9]+)/g, '$1-$2')
    .toLowerCase()
}

function humanizeIconName(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])([0-9]+)/g, '$1 $2')
}

const iconOptions = Object.entries(lucideIcons)
  .map(([name, icon]) => {
    const value = toMenuIconValue(name)
    return {
      value,
      label: MENU_ICON_LABELS[value] ?? humanizeIconName(name),
      icon: icon as LucideIcon,
    }
  })

// Lucide 保留的历史别名不在 icons 命名空间中，但已有页面可能已经保存了这些值。
iconOptions.push(
  { value: 'bar-chart-3', label: MENU_ICON_LABELS['bar-chart-3'], icon: BarChart3 },
  { value: 'circle-help', label: MENU_ICON_LABELS['circle-help'], icon: CircleHelp },
)

const uniqueIconOptions = Array.from(
  new Map(iconOptions.map((option) => [option.value, option])).values(),
).sort((a, b) => a.value.localeCompare(b.value))

/** 完整 Lucide 图标目录，供管理员页面图标选择器使用。 */
export const MENU_ICON_OPTIONS: readonly MenuIconOption[] = uniqueIconOptions

const MENU_ICON_MAP = new Map<string, LucideIcon>(MENU_ICON_OPTIONS.map((option) => [option.value, option.icon]))

/** 根据数据库中的图标名称解析组件，未知值回退到默认菜单图标。 */
export function getMenuIcon(name?: string): LucideIcon {
  return MENU_ICON_MAP.get(name ?? '') ?? MENU_ICON_MAP.get('menu')!
}
