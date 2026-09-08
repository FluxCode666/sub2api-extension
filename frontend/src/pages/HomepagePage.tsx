import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ArrowDown, ArrowUpRight, Check, ExternalLink, LockKeyhole, Menu, ScanSearch, ShieldCheck, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { DEFAULT_HOMEPAGE_CONFIG, fetchHomepageConfig, isHomepageNavigationHref, type HomepageConfig } from '@/lib/homepage'
import { ThinkingOrbRuntime } from '@/lib/thinkingOrbRuntime'
import { HomepageQuickstart } from './HomepageQuickstart'
import './HomepagePage.css'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const securityCards = [
  { index: '01', title: '不用于蒸馏与训练', text: '你的提示词、输入输出与业务数据，仅用于完成当前请求，不用于模型蒸馏、训练或改进基础模型。', Icon: ShieldCheck },
  { index: '02', title: '数据边界清晰', text: '按合作约定明确数据范围、处理方式与访问边界，减少不必要的数据暴露与留存。', Icon: LockKeyhole },
  { index: '03', title: '支持签署保密协议', text: '商务合作可按项目需要签署 NDA，明确双方保密义务与数据使用责任。', Icon: ScanSearch },
]

function safeExternalHref(value: string) {
  return /^(https?:|mailto:)/i.test(value) ? value : undefined
}

function integrationCoordinates(index: number, total: number) {
  const angle = -90 + (360 / total) * index
  const radians = angle * Math.PI / 180
  const radius = 37
  return {
    angle,
    x: 50 + Math.cos(radians) * radius,
    y: 50 + Math.sin(radians) * radius,
  }
}

function integrationLayout(index: number, total: number): CSSProperties {
  const coordinates = integrationCoordinates(index, total)
  return {
    '--node-x': `${coordinates.x}%`,
    '--node-y': `${coordinates.y}%`,
  } as CSSProperties
}

type MetricValue = {
  prefix: string
  amount: number
  suffix: string
  decimals: number
  useGrouping: boolean
}

function parseMetricValue(value: string): MetricValue | null {
  const match = value.trim().match(/^([^0-9+-]*)([-+]?\d[\d,]*(?:\.\d+)?)(.*)$/)
  if (!match) return null

  const numericText = match[2].replace(/,/g, '')
  const amount = Number(numericText)
  if (!Number.isFinite(amount)) return null

  return {
    prefix: match[1],
    amount,
    suffix: match[3],
    decimals: numericText.split('.')[1]?.length ?? 0,
    useGrouping: match[2].includes(','),
  }
}

function formatMetricValue(metric: MetricValue, amount: number) {
  const factor = 10 ** metric.decimals
  const rounded = Math.round(amount * factor) / factor
  const formatted = metric.useGrouping
    ? rounded.toLocaleString('en-US', { minimumFractionDigits: metric.decimals, maximumFractionDigits: metric.decimals })
    : metric.decimals > 0
      ? rounded.toFixed(metric.decimals)
      : String(Math.round(rounded))
  return `${metric.prefix}${formatted}${metric.suffix}`
}

function BrandMark({ logoUrl }: { logoUrl: string }) {
  return <span className={`sub2api-brand-mark ${logoUrl ? 'sub2api-brand-mark--image' : ''}`}>{logoUrl ? <img src={logoUrl} alt="" /> : 'S2'}</span>
}

function ThinkingOrb() {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return

    const getSize = () => {
      const bounds = stage.getBoundingClientRect()
      return Math.max(1, Math.round(Math.min(bounds.width, bounds.height)))
    }
    const orb = new ThinkingOrbRuntime(canvas, {
      state: 'spiral',
      shape: 'sphere',
      density: 1,
      layers: 5,
      depth: 0.34,
      contrast: 0.72,
      dotScale: 0.95,
      tilt: -0.4538,
      rotation: 0,
      color: '#171717',
      size: getSize(),
      theme: 'light',
      speed: 3,
    })
    const resize = () => orb.update({ size: getSize() })
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    resize()
    return () => {
      observer.disconnect()
      orb.destroy()
    }
  }, [])

  return <div ref={stageRef} className="sub2api-thinking-orb-stage"><canvas ref={canvasRef} className="sub2api-thinking-orb" role="img" aria-label="AI thinking orb" /></div>
}

export default function HomepagePage() {
  const location = useLocation()
  const flowGradientPrefix = useId()
  const isEmbedded = location.pathname === '/embed' || new URLSearchParams(location.search).get('ui_mode') === 'embedded'
  const rootRef = useRef<HTMLDivElement>(null)
  const [config, setConfig] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let active = true
    fetchHomepageConfig()
      .then((next) => { if (active) setConfig(next) })
      .catch((error: unknown) => console.warn('[HomepagePage] using defaults', error))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useGSAP((_, contextSafe) => {
    if (loading) return

    const media = gsap.matchMedia()
    media.add({
      desktop: '(min-width: 761px)',
      reduceMotion: '(prefers-reduced-motion: reduce)',
    }, ({ conditions }) => {
      const { desktop, reduceMotion } = conditions as { desktop: boolean; reduceMotion: boolean }
      const nav = rootRef.current?.querySelector<HTMLElement>('.sub2api-nav')
      if (!nav) return

      if (reduceMotion) {
        gsap.set(nav, { autoAlpha: 1 })
        return
      }

      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
      intro.from(nav, { yPercent: -100, autoAlpha: 0, duration: 0.65 })
        .from('.sub2api-hero-kicker', { y: 18, autoAlpha: 0, duration: 0.45 }, '-=0.24')
        .from('.sub2api-hero-title', { y: 30, autoAlpha: 0, duration: 0.85 }, '-=0.18')
        .from('.sub2api-hero-description', { y: 18, autoAlpha: 0, duration: 0.55 }, '-=0.48')
        .from('.sub2api-hero-actions', { y: 16, autoAlpha: 0, duration: 0.55 }, '-=0.34')
        .from('.sub2api-hero-art', { x: 36, scale: 0.92, autoAlpha: 0, duration: 1 }, '-=0.76')
        .from('.sub2api-scroll-cue', { y: 14, autoAlpha: 0, duration: 0.45 }, '-=0.44')

      gsap.to('.sub2api-scroll-cue svg', { y: 5, duration: 1.6, repeat: -1, yoyo: true, ease: 'sine.inOut' })
      gsap.to('.sub2api-hero-art', {
        y: -22,
        scale: 1.03,
        scrollTrigger: { trigger: '.sub2api-hero', start: 'top top', end: 'bottom top', scrub: 1 },
      })

      let navIsScrolled = false
      ScrollTrigger.create({
        trigger: rootRef.current,
        start: 'top top',
        end: 'max',
        onUpdate: (self) => {
          const shouldCompact = self.scroll() > 32
          if (shouldCompact === navIsScrolled) return
          navIsScrolled = shouldCompact
          nav.classList.toggle('is-scrolled', shouldCompact)
        },
      })

      const reveal = (targets: string, trigger: string, vars: gsap.TweenVars = {}) => {
        gsap.from(targets, {
          autoAlpha: 0,
          y: 34,
          duration: 0.8,
          stagger: 0.1,
          ease: 'power3.out',
          scrollTrigger: { trigger, start: 'top 80%', once: true },
          ...vars,
        })
      }

      reveal('.sub2api-trust > *', '.sub2api-trust', { y: 20, stagger: 0.16 })
      reveal('.sub2api-metrics-heading > *', '.sub2api-metrics', { y: 26, stagger: 0.08 })
      reveal('.sub2api-metric', '.sub2api-metrics-grid', { y: 42, stagger: 0.14 })

      gsap.utils.toArray<HTMLElement>('.sub2api-metric-value').forEach((element, index) => {
        const metric = parseMetricValue(element.dataset.value ?? element.textContent ?? '')
        if (!metric) return

        const counter = { amount: 0 }
        element.textContent = formatMetricValue(metric, counter.amount)
        gsap.to(counter, {
          amount: metric.amount,
          duration: 1.55,
          delay: index * 0.13,
          ease: 'power2.out',
          snap: { amount: 10 ** -metric.decimals },
          onUpdate: () => { element.textContent = formatMetricValue(metric, counter.amount) },
          scrollTrigger: { trigger: '.sub2api-metrics-grid', start: 'top 78%', once: true },
        })
      })

      if (config.showQuickstartSection) reveal('.sub2api-steps-heading > *', '.sub2api-steps', { y: 28, stagger: 0.1 })
      reveal('.sub2api-security .sub2api-section-heading > *', '.sub2api-security', { y: 30, stagger: 0.08 })
      reveal('.sub2api-story-copy > *', '.sub2api-story', { x: -34, y: 0, stagger: 0.1 })
      reveal('.sub2api-final-cta > *', '.sub2api-final-cta', { y: 28, stagger: 0.1 })
      reveal('.sub2api-footer > *', '.sub2api-footer', {
        y: 20,
        stagger: 0.12,
        scrollTrigger: { trigger: '.sub2api-footer', start: 'top bottom', once: true },
      })

      if (config.showQuickstartSection) {
        gsap.from('.sub2api-step-node', {
          x: 28,
          autoAlpha: 0,
          duration: 0.65,
          stagger: 0.12,
          ease: 'power3.out',
          scrollTrigger: { trigger: '.sub2api-step-list', start: 'top 78%', once: true },
        })
      }

      gsap.from('.sub2api-ecosystem-copy > *', {
        x: -36,
        autoAlpha: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.sub2api-ecosystem', start: 'top 78%', once: true },
      })
      gsap.from('.sub2api-ecosystem-network', {
        x: 38,
        scale: 0.96,
        autoAlpha: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.sub2api-ecosystem', start: 'top 78%', once: true },
      })
      gsap.from('.sub2api-ecosystem-node', {
        scale: 0.58,
        autoAlpha: 0,
        duration: 0.7,
        stagger: { each: 0.09, from: 'center' },
        ease: 'back.out(1.7)',
        scrollTrigger: { trigger: '.sub2api-ecosystem-network', start: 'top 80%', once: true },
      })

      const beamLines = gsap.utils.toArray<SVGLineElement>('.sub2api-ecosystem-flow-beam')
      const coreLines = gsap.utils.toArray<SVGLineElement>('.sub2api-ecosystem-flow-core')
      const burstProfiles = [
        { duration: 1.86, delay: 0.18, repeatDelay: 1.68 },
        { duration: 2.08, delay: 0.63, repeatDelay: 2.24 },
        { duration: 1.78, delay: 0.37, repeatDelay: 1.94 },
        { duration: 1.98, delay: 1.08, repeatDelay: 1.56 },
        { duration: 1.84, delay: 0.51, repeatDelay: 2.1 },
        { duration: 2.22, delay: 1.32, repeatDelay: 1.86 },
        { duration: 1.8, delay: 0.88, repeatDelay: 2.36 },
        { duration: 2.04, delay: 0.24, repeatDelay: 2.02 },
      ]
      beamLines.forEach((beam, index) => {
        const core = coreLines[index]
        const gradient = beam.ownerSVGElement?.querySelector('linearGradient')
        if (!core || !gradient) return
        const profile = burstProfiles[index % burstProfiles.length]
        const startX = Number(beam.getAttribute('x1'))
        const startY = Number(beam.getAttribute('y1'))
        const beamLength = 0.24
        const progress = { value: -beamLength }
        const updateBeam = () => {
          const headProgress = gsap.utils.clamp(0, 1, progress.value)
          const tailProgress = gsap.utils.clamp(0, 1, progress.value - beamLength)
          const headX = startX + (50 - startX) * headProgress
          const headY = startY + (50 - startY) * headProgress
          const tailX = startX + (50 - startX) * tailProgress
          const tailY = startY + (50 - startY) * tailProgress
          for (const line of [beam, core, gradient]) {
            line.setAttribute('x1', String(tailX))
            line.setAttribute('y1', String(tailY))
            line.setAttribute('x2', String(headX))
            line.setAttribute('y2', String(headY))
          }
          const fadeIn = gsap.utils.clamp(0, 1, (progress.value + beamLength) / 0.16)
          const fadeOut = progress.value > 1 ? gsap.utils.clamp(0, 1, (1 + beamLength - progress.value) / 0.16) : 1
          beam.style.opacity = String(Math.min(fadeIn, fadeOut) * 0.94)
          core.style.opacity = String(Math.min(fadeIn, fadeOut))
        }
        gsap.fromTo(progress, { value: -beamLength }, {
          value: 1 + beamLength,
          duration: profile.duration * 1.4,
          delay: profile.delay,
          repeat: -1,
          repeatDelay: profile.repeatDelay,
          ease: 'power3.in',
          onUpdate: updateBeam,
        })
      })
      gsap.utils.toArray<HTMLElement>('.sub2api-ecosystem-core-ripple').forEach((ripple, index) => {
        const rippleDelays = [0, 1.45, 3.1]
        gsap.fromTo(ripple, { scale: 0.84, opacity: 0.34 }, {
          scale: 1.48,
          opacity: 0,
          duration: 5.2 + index * 0.7,
          delay: rippleDelays[index] ?? index * 1.4,
          repeat: -1,
          ease: 'sine.out',
        })
      })

      gsap.from('.sub2api-security-card', {
        y: 46,
        autoAlpha: 0,
        duration: 0.82,
        stagger: 0.14,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.sub2api-security-grid', start: 'top 80%', once: true },
      })
      gsap.from('.sub2api-security-card-top svg', {
        rotation: -18,
        scale: 0.65,
        autoAlpha: 0,
        duration: 0.65,
        stagger: 0.14,
        ease: 'back.out(1.6)',
        scrollTrigger: { trigger: '.sub2api-security-grid', start: 'top 80%', once: true },
      })
      gsap.from('.sub2api-story-art', {
        x: 42,
        autoAlpha: 0,
        duration: 1,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.sub2api-story', start: 'top 74%', once: true },
      })
      gsap.to('.sub2api-code-window', {
        y: -12,
        rotation: 1.2,
        duration: 3.8,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })

      let cleanupParallax = () => {}
      if (desktop) {
        const hero = rootRef.current?.querySelector<HTMLElement>('.sub2api-hero')
        const art = rootRef.current?.querySelector<HTMLElement>('.sub2api-hero-art')
        if (hero && art) {
          const safeContext: <T extends Function>(callback: T) => T = contextSafe ?? ((callback) => callback)
          const xTo = gsap.quickTo(art, 'x', { duration: 0.8, ease: 'power3.out' })
          const rotationTo = gsap.quickTo(art, 'rotation', { duration: 0.8, ease: 'power3.out' })
          const handlePointerMove = safeContext((event: PointerEvent) => {
            const bounds = hero.getBoundingClientRect()
            xTo(((event.clientX - bounds.left) / bounds.width - 0.5) * 12)
            rotationTo(((event.clientY - bounds.top) / bounds.height - 0.5) * 1.4)
          })
          const resetParallax = safeContext(() => {
            xTo(0)
            rotationTo(0)
          })
          hero.addEventListener('pointermove', handlePointerMove)
          hero.addEventListener('pointerleave', resetParallax)
          cleanupParallax = () => {
            hero.removeEventListener('pointermove', handlePointerMove)
            hero.removeEventListener('pointerleave', resetParallax)
          }
        }
      }

      ScrollTrigger.refresh()
      return cleanupParallax
    })
    return () => media.revert()
  }, { scope: rootRef, dependencies: [loading], revertOnUpdate: true })

  const linkProps = (href: string) => {
    return { href, target: href.startsWith('#') ? undefined : '_top', rel: safeExternalHref(href) ? 'noreferrer' : undefined }
  }
  const showDocsButton = config.showDevelopersSection || config.docsHref !== '#developers'
  const developersDocsHref = [config.developersDocsUrl, config.documentationUrl]
    .find((href) => isHomepageNavigationHref(href))?.trim()
  const navigationItems = config.navigationItems.filter((item) => {
    if (!item.label.trim() || !isHomepageNavigationHref(item.href)) return false
    const href = item.href.trim()
    if (href === '#developers') return config.showDevelopersSection
    if (href === '#quickstart') return config.showQuickstartSection
    if (href === '#partners') return config.trustedPartners.length > 0
    return true
  })
  const curlExample = `curl https://api.example.com/v1/chat/completions \\
  -H "Authorization: Bearer your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": ${JSON.stringify(config.model)},
    "messages": [
      {
        "role": "user",
        "content": "你好，请介绍一下你自己。"
      }
    ]
  }'`

  return (
    <div ref={rootRef} className={`sub2api-home ${isEmbedded ? 'sub2api-home--embedded' : ''}`} data-loading={loading}>
      <nav className="sub2api-nav" aria-label="主导航">
        <a href="#top" className="sub2api-brand"><BrandMark logoUrl={config.siteLogoUrl} /><span>{config.siteName}</span></a>
        <div className={`sub2api-nav-links ${menuOpen ? 'is-open' : ''}`}>
          <div className="sub2api-nav-items">{navigationItems.map((item, index) => <a key={`navigation-${index}`} {...linkProps(item.href.trim())} onClick={() => setMenuOpen(false)}>{item.label}</a>)}</div>
          <a {...linkProps(config.consoleHref)} className="sub2api-nav-cta" onClick={() => setMenuOpen(false)}>进入控制台 <ArrowUpRight size={15} /></a>
        </div>
        <button className="sub2api-menu-button" aria-label={menuOpen ? '关闭菜单' : '打开菜单'} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X /> : <Menu />}</button>
      </nav>

      <main id="top">
        <section className="sub2api-hero">
          <div className="sub2api-hero-copy">
            <p className="sub2api-hero-kicker"><span className="sub2api-live-dot" />{config.heroLabel}</p>
            <h1 className="sub2api-hero-title">{config.heroTitle}</h1>
            <p className="sub2api-hero-description">{config.heroDescription}</p>
            <div className="sub2api-hero-actions">
              <a className="sub2api-button sub2api-button--dark" {...linkProps(config.primaryHref)}>{config.primaryCta}<ArrowUpRight size={17} /></a>
              {showDocsButton ? <a className="sub2api-button sub2api-button--line" {...linkProps(config.docsHref)}>{config.docsCta}<ArrowDown size={16} /></a> : null}
            </div>
          </div>
          <div className="sub2api-hero-art"><ThinkingOrb /><span className="sub2api-orb-label sub2api-orb-label--one">THINKING / LIVE</span><span className="sub2api-orb-label sub2api-orb-label--two">STREAM / READY</span></div>
          <a href="#metrics" className="sub2api-scroll-cue"><span>Scroll to explore</span><ArrowDown size={15} /></a>
        </section>

        {config.trustedPartners.length ? <section className="sub2api-trust" id="partners">
          <p>合作伙伴</p>
          <div className="sub2api-partner-row">
            {config.trustedPartners.map((partner) => {
              const content = <>{partner.logoUrl ? <img src={partner.logoUrl} alt="" /> : <span className="sub2api-partner-monogram">{partner.name.slice(0, 1)}</span>}<strong>{partner.name}</strong></>
              return partner.linkUrl ? <a key={partner.name} {...linkProps(partner.linkUrl)}>{content}</a> : <div key={partner.name}>{content}</div>
            })}
          </div>
        </section> : null}

        <section className="sub2api-metrics" id="metrics" aria-labelledby="metrics-title">
          <div className="sub2api-metrics-heading"><p className="sub2api-eyebrow">SERVICE SIGNALS</p><h2 id="metrics-title">关键指标，<br /><em>一眼可见。</em></h2><p>用真实可读的运行数据，帮助你快速判断服务是否适合当前业务。</p></div>
          <div className="sub2api-metrics-grid">
            <article className="sub2api-metric"><span className="sub2api-metric-label">SERVICE AVAILABILITY</span><strong className="sub2api-metric-value" data-value={config.availability} aria-label={config.availability}>{config.availability}</strong><h3>服务可用性</h3><p>{config.availabilityDescription}</p></article>
            <article className="sub2api-metric"><span className="sub2api-metric-label">TIME TO FIRST TOKEN</span><strong className="sub2api-metric-value" data-value={config.firstTokenResponseTime} aria-label={config.firstTokenResponseTime}>{config.firstTokenResponseTime}</strong><h3>首 Token 响应时间</h3><p>{config.firstTokenResponseTimeDescription}</p></article>
            <article className="sub2api-metric"><span className="sub2api-metric-label">PROMPT CACHE HIT RATE</span><strong className="sub2api-metric-value" data-value={config.promptCacheRate} aria-label={config.promptCacheRate}>{config.promptCacheRate}</strong><h3>提示词缓存率</h3><p>{config.promptCacheRateDescription}</p></article>
          </div>
        </section>

      {config.showQuickstartSection ? <HomepageQuickstart model={config.model} /> : null}

        <section className="sub2api-section sub2api-ecosystem" id="ecosystem">
          <div className="sub2api-ecosystem-copy"><p className="sub2api-eyebrow">ONE ENTRY, EVERY WORKFLOW</p><h2>一个入口，<br />接入你的工作流。</h2><p>连接模型、工具和开发环境。点击一个应用，查看对应的接入文档。</p></div>
          <div className="sub2api-ecosystem-network" aria-label="Sub2API 接入生态">
            <div className="sub2api-ecosystem-spokes" aria-hidden="true">{config.integrations.slice(0, 8).map((_, index, visibleIntegrations) => {
              const coordinates = integrationCoordinates(index, visibleIntegrations.length)
              const gradientId = `${flowGradientPrefix}-flow-${index}`
              return <svg className="sub2api-ecosystem-spoke-svg" viewBox="0 0 100 100" preserveAspectRatio="none" key={`spoke-${index}`}>
                <defs><linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={coordinates.x} y1={coordinates.y} x2="50" y2="50"><stop offset="0%" stopColor="#bdebd7" /><stop offset="49%" stopColor="#b9dfce" /><stop offset="100%" stopColor="#ffe4a5" /></linearGradient></defs>
                <line className="sub2api-ecosystem-spoke" x1="50" y1="50" x2={coordinates.x} y2={coordinates.y} />
                <line className="sub2api-ecosystem-flow-beam" stroke={`url(#${gradientId})`} x1={coordinates.x} y1={coordinates.y} x2="50" y2="50" />
                <line className="sub2api-ecosystem-flow-core" stroke={`url(#${gradientId})`} x1={coordinates.x} y1={coordinates.y} x2="50" y2="50" />
              </svg>
            })}</div>
            <div className="sub2api-ecosystem-core"><span className="sub2api-ecosystem-core-ripple" aria-hidden="true" /><span className="sub2api-ecosystem-core-ripple" aria-hidden="true" /><span className="sub2api-ecosystem-core-ripple" aria-hidden="true" /><BrandMark logoUrl={config.siteLogoUrl} /></div>
            {config.integrations.slice(0, 8).map((integration, index, visibleIntegrations) => {
              const content = <><span className="sub2api-ecosystem-node-icon">{integration.logoUrl ? <img src={integration.logoUrl} alt="" /> : integration.name.slice(0, 1)}</span><i /></>
              const className = 'sub2api-ecosystem-node'
              const style = integrationLayout(index, visibleIntegrations.length)
              const node = integration.documentationUrl ? <a className={className} {...linkProps(integration.documentationUrl)} aria-label={`查看 ${integration.name} 接入文档`}>{content}</a> : <div className={className}>{content}</div>
              return <div className="sub2api-ecosystem-item" style={style} key={`${integration.name}-${index}`}>{node}</div>
            })}
            {config.integrations.length === 0 ? <div className="sub2api-ecosystem-empty">在官网配置中添加应用节点</div> : null}
          </div>
        </section>

        <section className="sub2api-section sub2api-security" id="security">
          <div className="sub2api-section-heading"><p className="sub2api-eyebrow">DATA SECURITY &amp; PRIVACY</p><h2>你的数据，<br /><em>只用于完成你的请求。</em></h2><p className="sub2api-security-lede">我们尊重每一份模型调用数据，不将你的业务内容用于蒸馏或训练，并支持在商务合作中签署保密协议。</p></div>
          <div className="sub2api-security-grid">{securityCards.map((card) => { const Icon = card.Icon; return <article className="sub2api-security-card" key={card.index}><div className="sub2api-security-card-top"><span>{card.index}</span><Icon size={21} strokeWidth={1.7} /></div><h3>{card.title}</h3><p>{card.text}</p></article> })}</div>
        </section>

        {config.showDevelopersSection ? <section className="sub2api-section sub2api-story" id="developers">
          <div className="sub2api-story-copy"><p className="sub2api-eyebrow">BUILT FOR BUILDERS</p><h2>从代码，<br />到增长。</h2><p>清晰 API，快速接入，专注业务增长。</p>{developersDocsHref ? <a className="sub2api-button sub2api-button--dark sub2api-developers-docs" {...linkProps(developersDocsHref)}>接入文档 <ArrowUpRight size={16} /></a> : null}</div>
          <div className="sub2api-story-art" aria-hidden="true"><div className="sub2api-code-window"><div className="sub2api-code-top"><span /><span /><span /><b>request.sh</b></div><pre><code>{curlExample}</code></pre><div className="sub2api-code-status"><Check size={14} /> OpenAI-compatible API <span>POST /v1/chat/completions</span></div></div></div>
        </section> : null}

        <section className="sub2api-final-cta"><p className="sub2api-eyebrow">READY WHEN YOU ARE</p><h2>让下一次调用，<br /><em>更有把握。</em></h2><a className="sub2api-button sub2api-button--light" {...linkProps(config.primaryHref)}>{config.primaryCta}<ArrowUpRight size={17} /></a></section>
      </main>

      <footer className="sub2api-footer"><div className="sub2api-footer-brand"><BrandMark logoUrl={config.siteLogoUrl} /><strong>{config.siteName}</strong><p>为每一次 AI 调用<br />提供可靠的起点。</p></div><div className="sub2api-footer-links"><div><span>资源</span>{config.documentationUrl ? <a {...linkProps(config.documentationUrl)}>使用文档 <ExternalLink size={13} /></a> : null}{config.showDevelopersSection ? <a href="#developers">开发者</a> : null}</div><div><span>协议</span>{config.termsUrl ? <a {...linkProps(config.termsUrl)}>服务条款</a> : null}{config.userTermsUrl ? <a {...linkProps(config.userTermsUrl)}>用户条款</a> : null}{config.privacyUrl ? <a {...linkProps(config.privacyUrl)}>隐私协议</a> : null}</div></div><p className="sub2api-footer-copy">© {new Date().getFullYear()} {config.siteName}. All rights reserved.</p></footer>
    </div>
  )
}
