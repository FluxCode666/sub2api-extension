import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface SystemConfigNavSection {
  id: string
  title: string
  hint: string
  icon: LucideIcon
}

export interface SystemConfigNavGroup {
  label: string
  note: string
  sections: SystemConfigNavSection[]
}

/** 板块顶部越过其 scroll-margin-top 后再留出该余量，即视为当前板块。 */
const SPY_SLACK = 48
/** 点击目录后的平滑滚动期间暂停滚动监听，避免高亮在途经板块间闪烁。 */
const CLICK_LOCK_MS = 900

/** 返回真正发生滚动的祖先；仅声明 overflow 但未限高的容器（如管理端 main）会被跳过。 */
function findScrollParent(node: HTMLElement | null): HTMLElement | null {
  for (let el = node?.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll|overlay)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1) return el
  }
  return null
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 跟随页面滚动计算当前可见的配置板块，并提供点击跳转。 */
export function useSystemConfigScrollSpy(ids: readonly string[], rootRef: RefObject<HTMLElement>) {
  const [activeId, setActiveId] = useState(ids[0] ?? '')
  const lockUntilRef = useRef(0)
  const idsKey = ids.join('|')

  useEffect(() => {
    const sectionIds = idsKey.split('|')
    let frame = 0
    const update = () => {
      frame = 0
      if (Date.now() < lockUntilRef.current) return
      // 布局可能在加载完成或窗口尺寸变化后改变滚动容器，因此每次重新判断。
      const container = findScrollParent(rootRef.current)
      const top = container ? container.getBoundingClientRect().top : 0
      const atBottom = container
        ? container.scrollTop > 0 && container.scrollTop + container.clientHeight >= container.scrollHeight - 2
        : window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      let current = sectionIds[0]
      if (atBottom) {
        current = sectionIds[sectionIds.length - 1]
      } else {
        for (const id of sectionIds) {
          const section = document.getElementById(id)
          if (!section) continue
          const margin = parseFloat(getComputedStyle(section).scrollMarginTop) || 0
          if (section.getBoundingClientRect().top - top <= margin + SPY_SLACK) current = id
        }
      }
      setActiveId(current)
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }
    // scroll 事件不冒泡；在 document 上捕获可同时覆盖窗口滚动和任意容器滚动。
    document.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    update()
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      document.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
  }, [idsKey, rootRef])

  const jumpTo = useCallback((id: string) => {
    const section = document.getElementById(id)
    if (!section) return
    lockUntilRef.current = Date.now() + CLICK_LOCK_MS
    setActiveId(id)
    section.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
    // 将焦点移到板块标题，键盘和读屏用户可以从该板块继续操作。
    section.querySelector<HTMLElement>('[data-section-heading]')?.focus({ preventScroll: true })
  }, [])

  return { activeId, jumpTo }
}

interface SystemConfigNavProps {
  groups: SystemConfigNavGroup[]
  activeId: string
  dirtyIds: ReadonlySet<string>
  onSelect: (id: string) => void
}

/** 系统配置目录：桌面端为左侧吸顶目录，窄屏为顶部横向目录。 */
export function SystemConfigNav({ groups, activeId, dirtyIds, onSelect }: SystemConfigNavProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // 窄屏横向目录中，让当前项保持在可视范围内；只调整目录自身的横向滚动。
  useEffect(() => {
    const list = listRef.current
    if (!list || list.scrollWidth <= list.clientWidth) return
    const item = list.querySelector<HTMLElement>(`[data-section-id="${activeId}"]`)
    if (!item) return
    const left = item.offsetLeft - list.offsetLeft
    if (left < list.scrollLeft || left + item.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: Math.max(0, left - 12), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
  }, [activeId])

  return (
    <nav className="aux-system-config-nav" aria-label="配置目录">
      <p className="aux-system-config-nav-title">配置目录</p>
      <div className="aux-system-config-nav-list" ref={listRef}>
        {groups.map((group) => (
          <div key={group.label} className="aux-system-config-nav-group" role="group" aria-label={group.label}>
            <div className="aux-system-config-nav-group-label">
              <span>{group.label}</span>
              <small>{group.note}</small>
            </div>
            {group.sections.map((section) => {
              const Icon = section.icon
              const active = section.id === activeId
              const dirty = dirtyIds.has(section.id)
              return (
                <Button
                  key={section.id}
                  type="button"
                  variant="ghost"
                  data-section-id={section.id}
                  className={`aux-system-config-nav-item${active ? ' is-active' : ''}`}
                  aria-current={active ? 'location' : undefined}
                  aria-label={dirty ? `${section.title}（有未保存的更改）` : section.title}
                  onClick={() => onSelect(section.id)}
                >
                  <Icon aria-hidden="true" />
                  <span className="aux-system-config-nav-copy">
                    <strong>{section.title}</strong>
                    <small>{section.hint}</small>
                  </span>
                  {dirty && <span className="aux-system-config-nav-dirty" aria-hidden="true" />}
                </Button>
              )
            })}
          </div>
        ))}
      </div>
    </nav>
  )
}

interface SystemConfigSectionHeadingProps {
  id: string
  icon: LucideIcon
  title: string
  status?: ReactNode
}

/** 配置板块标题；目录跳转后焦点落在标题上。 */
export function SystemConfigSectionHeading({ id, icon: Icon, title, status }: SystemConfigSectionHeadingProps) {
  return (
    <div className="aux-system-config-card-heading">
      <div className="aux-system-config-card-title">
        <span className="aux-system-config-card-icon"><Icon aria-hidden="true" /></span>
        <h2 id={`${id}-title`} tabIndex={-1} data-section-heading="">{title}</h2>
      </div>
      {status}
    </div>
  )
}
