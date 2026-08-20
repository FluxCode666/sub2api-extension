import { useEffect, useState } from 'react'
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
import { LayoutDashboard, FileText, FilePlus2, ExternalLink, Images } from 'lucide-react'
import { fetchDynamicPages, getMergedRegistry, subscribeDynamicPages } from '@/lib/dynamic-pages'
import { getMenuIcon } from '@/lib/menu-icons'
import { Toaster } from '@/components/ui/sonner'
import '@fontsource-variable/geist'
import './AdminConsole.css'

/**
 * 管理端外壳布局 —— 侧边菜单栏。
 *
 * 用 shadcn Sidebar 替换原顶部导航栏(U6 时代)。菜单项由合并注册表
 * (静态核心页 + 动态页)驱动: 仪表盘、页面管理, 以及动态 admin 页。
 * 支持折叠/展开(桌面)、抽屉(移动)、暗色模式。
 */
export default function AdminLayout() {
  // 页面清单在 App 启动时异步加载；订阅一次完成信号，确保数据库动态页面
  // 加载完成后侧边栏会重新渲染，而不是停留在首屏的静态注册表快照。
  const [, setRegistryVersion] = useState(0)
  useEffect(() => {
    let active = true
    const unsubscribe = subscribeDynamicPages(() => {
      if (active) setRegistryVersion((version) => version + 1)
    })
    // Admin 菜单需要动态 admin 页；此调用发生在 AdminGuard 放行后，
    // 使用受守卫的 /api/aux/admin/pages，不再通过公开清单暴露 admin 元数据。
    fetchDynamicPages({ includeAdmin: true }).catch(() => {})
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  // 合并注册表的 admin 页(静态核心 + 动态)
  const registry = getMergedRegistry()
  const adminPages = registry.filter((p) => p.visibility === 'admin')
  // 动态页单独分组(来自 DB)
  const dynamicAdminPages = adminPages.filter((p) => p.id.startsWith('page:'))
  const staticAdminPages = adminPages.filter((p) => !p.id.startsWith('page:') && p.id !== 'image-assets')

  // 静态核心管理页的图标映射
  const staticIcons: Record<string, React.ElementType> = {
    dashboard: LayoutDashboard,
    'image-assets': Images,
  }

  return (
    <SidebarProvider className="aux-admin-shell">
      <Sidebar collapsible="icon" className="aux-admin-sidebar">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
              A
            </div>
            <div className="flex flex-col overflow-hidden group-data-[collapsible=icon]:hidden">
              <span className="aux-admin-brand-title truncate text-sm font-semibold">
                Aux Admin
              </span>
              <span className="aux-admin-brand-subtitle truncate text-xs">
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

          {/* 页面与图片资源管理入口 */}
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
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <NavLink to="/admin/assets" end>
                      <Images className="h-4 w-4" />
                      <span>图片资源</span>
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
                          <DynamicPageIcon name={page.icon} />
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
                <NavLink to="/p/home" end>
                  <ExternalLink className="h-4 w-4" />
                  <span>返回官网</span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="aux-admin-inset">
        <header className="aux-admin-topbar flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <div className="flex items-center gap-2">
            <span className="aux-admin-topbar-title">
              Aux Admin
            </span>
          </div>
          <div className="aux-admin-topbar-meta"><span className="aux-topbar-dot" />运营控制台</div>
        </header>
        <main className="aux-admin-main flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </SidebarInset>
      {/* 管理端所有写操作共用同一套成功/失败反馈。 */}
      <Toaster position="top-right" />
    </SidebarProvider>
  )
}

function DynamicPageIcon({ name }: { name?: string }) {
  const Icon = getMenuIcon(name)
  return <Icon className="h-4 w-4" aria-hidden="true" />
}
