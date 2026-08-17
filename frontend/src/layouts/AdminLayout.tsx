import { Outlet, NavLink } from 'react-router-dom'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { LayoutDashboard, Settings, FileText, FilePlus2, ExternalLink } from 'lucide-react'
import { getMergedRegistry } from '@/lib/dynamic-pages'

/**
 * 管理端外壳布局 —— 侧边菜单栏。
 *
 * 用 shadcn Sidebar 替换原顶部导航栏(U6 时代)。菜单项由合并注册表
 * (静态核心页 + 动态页)驱动: 仪表盘、官网配置、页面管理, 以及动态 admin 页。
 * 支持折叠/展开(桌面)、抽屉(移动)、暗色模式。
 */
export default function AdminLayout() {
  // 合并注册表的 admin 页(静态核心 + 动态)
  const registry = getMergedRegistry()
  const adminPages = registry.filter((p) => p.visibility === 'admin')
  // 动态页单独分组(来自 DB)
  const dynamicAdminPages = adminPages.filter((p) => p.id.startsWith('page:'))
  const staticAdminPages = adminPages.filter((p) => !p.id.startsWith('page:'))

  // 静态核心管理页的图标映射
  const staticIcons: Record<string, React.ElementType> = {
    dashboard: LayoutDashboard,
    'homepage-config': Settings,
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-xs font-bold text-gray-50 dark:bg-gray-100 dark:text-gray-900">
              A
            </div>
            <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                Aux Admin
              </span>
              <span className="truncate text-xs text-gray-500 dark:text-gray-400">
                页面管理系统
              </span>
            </div>
          </div>
        </SidebarHeader>
        <SidebarSeparator />
        <SidebarContent>
          {/* 静态核心管理页 */}
          <SidebarGroup>
            <SidebarGroupLabel>核心</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {staticAdminPages.map((page) => {
                  const Icon = staticIcons[page.id] ?? FileText
                  return (
                    <SidebarMenuItem key={page.id}>
                      <SidebarMenuButton asChild>
                        <NavLink to={page.path} end>
                          <Icon className="h-4 w-4" />
                          <span>{page.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* 页面管理入口(Phase 5 实现) */}
          <SidebarGroup>
            <SidebarGroupLabel>管理</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/admin/pages" end>
                      <FilePlus2 className="h-4 w-4" />
                      <span>页面管理</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* 动态 admin 页(来自 DB, 合并注册表) */}
          {dynamicAdminPages.length > 0 && (
            <SidebarGroup>
              <SidebarGroupLabel>动态页面</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {dynamicAdminPages.map((page) => (
                    <SidebarMenuItem key={page.id}>
                      <SidebarMenuButton asChild>
                        <NavLink to={page.path} end>
                          <ExternalLink className="h-4 w-4" />
                          <span>{page.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <NavLink to="/" end>
                  <ExternalLink className="h-4 w-4" />
                  <span>返回官网</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 px-4 dark:border-gray-800">
          <SidebarTrigger className="-ml-1" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Sub2API Aux Admin
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
