import { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { ArrowDown, ArrowUpRight, Check, ExternalLink, Menu, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { DEFAULT_HOMEPAGE_CONFIG, fetchHomepageConfig, type HomepageConfig } from '@/lib/homepage'
import './HomepagePage.css'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const valueCards = [
  { index: '01', title: '一处接入', text: '统一模型、密钥与团队权限，让接入路径从复杂变得清楚。' },
  { index: '02', title: '实时可见', text: '从请求到成本，每一次调用都有迹可循，运营决策不再靠猜。' },
  { index: '03', title: '稳稳上线', text: '为生产环境而生的路由、限流与故障隔离，给业务留出余量。' },
]

function safeExternalHref(value: string) {
  return /^(https?:|mailto:)/i.test(value) ? value : undefined
}

export default function HomepagePage() {
  const location = useLocation()
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

  useGSAP(() => {
    if (loading || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const intro = gsap.timeline({ defaults: { ease: 'power3.out' } })
    intro.from('.sub2api-hero-kicker, .sub2api-hero-title, .sub2api-hero-copy, .sub2api-hero-actions', { y: 28, opacity: 0, duration: 0.8, stagger: 0.08 })
      .from('.sub2api-hero-art', { scale: 0.82, opacity: 0, rotate: -5, duration: 1.1 }, '-=0.65')
    gsap.from('.sub2api-value-card', { scrollTrigger: { trigger: '.sub2api-values', start: 'top 75%' }, y: 42, opacity: 0, stagger: 0.12, duration: 0.8, ease: 'power3.out' })
    gsap.from('.sub2api-story-copy > *', { scrollTrigger: { trigger: '.sub2api-story', start: 'top 72%' }, x: -32, opacity: 0, stagger: 0.1, duration: 0.75, ease: 'power3.out' })
    gsap.from('.sub2api-story-art', { scrollTrigger: { trigger: '.sub2api-story', start: 'top 72%' }, x: 42, opacity: 0, duration: 1, ease: 'power3.out' })
    return () => { intro.kill() }
  }, { scope: rootRef, dependencies: [loading] })

  const linkProps = (href: string) => {
    const external = safeExternalHref(href)
    return external ? { href: external, target: '_blank', rel: 'noreferrer' } : { href }
  }

  return (
    <div ref={rootRef} className={`sub2api-home ${isEmbedded ? 'sub2api-home--embedded' : ''}`} data-loading={loading}>
      <nav className="sub2api-nav" aria-label="主导航">
        <a href="#top" className="sub2api-brand"><span className="sub2api-brand-mark">S2</span><span>{config.siteName}</span></a>
        <div className={`sub2api-nav-links ${menuOpen ? 'is-open' : ''}`}>
          <a href="#platform" onClick={() => setMenuOpen(false)}>平台</a>
          <a href="#developers" onClick={() => setMenuOpen(false)}>开发者</a>
          <a href="#partners" onClick={() => setMenuOpen(false)}>合作伙伴</a>
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
              <a className="sub2api-button sub2api-button--line" {...linkProps(config.docsHref)}>{config.docsCta}<ArrowDown size={16} /></a>
            </div>
          </div>
          <div className="sub2api-hero-art" aria-hidden="true">
            <div className="sub2api-orbit sub2api-orbit--one" /><div className="sub2api-orbit sub2api-orbit--two" />
            <div className="sub2api-orbit-core"><span>API</span><strong>{config.model}</strong><small>READY FOR PRODUCTION</small></div>
            <span className="sub2api-art-label sub2api-art-label--one">ROUTE / 200</span><span className="sub2api-art-label sub2api-art-label--two">OBSERVE / LIVE</span>
          </div>
          <a href="#platform" className="sub2api-scroll-cue"><span>Scroll to explore</span><ArrowDown size={15} /></a>
        </section>

        <section className="sub2api-trust" id="partners">
          <p>值得信赖的合作伙伴</p>
          <div className="sub2api-partner-row">
            {config.trustedPartners.length ? config.trustedPartners.map((partner) => {
              const content = <>{partner.logoUrl ? <img src={partner.logoUrl} alt="" /> : <span className="sub2api-partner-monogram">{partner.name.slice(0, 1)}</span>}<strong>{partner.name}</strong></>
              return partner.linkUrl ? <a key={partner.name} href={partner.linkUrl} target="_blank" rel="noreferrer">{content}</a> : <div key={partner.name}>{content}</div>
            }) : <div><span className="sub2api-partner-monogram">+</span><strong>一起构建下一代 AI 应用</strong></div>}
          </div>
        </section>

        <section className="sub2api-section sub2api-values" id="platform">
          <div className="sub2api-section-heading"><p className="sub2api-eyebrow">THE PLATFORM</p><h2>把复杂留在后台，<br /><em>把确定性交给业务。</em></h2></div>
          <div className="sub2api-value-grid">{valueCards.map((card) => <article className="sub2api-value-card" key={card.index}><span>{card.index}</span><h3>{card.title}</h3><p>{card.text}</p><ArrowUpRight size={18} /></article>)}</div>
        </section>

        <section className="sub2api-section sub2api-story" id="developers">
          <div className="sub2api-story-copy"><p className="sub2api-eyebrow">BUILT FOR BUILDERS</p><h2>从第一行代码，<br />到每一次增长。</h2><p>清晰的 API、完整的观测和可控的成本，组成一条不打扰创造力的基础设施。</p>{config.documentationUrl ? <a className="sub2api-text-link" {...linkProps(config.documentationUrl)}>阅读使用文档 <ArrowUpRight size={16} /></a> : null}</div>
          <div className="sub2api-story-art" aria-hidden="true"><div className="sub2api-code-window"><div className="sub2api-code-top"><span /><span /><span /><b>request.ts</b></div><pre><code><span className="code-purple">const</span> response = <span className="code-purple">await</span> sub2api.<span className="code-blue">chat</span>({'{'}{`\n  `}<span className="code-key">model</span>: <span className="code-green">'{config.model}'</span>,{`\n  `}<span className="code-key">stream</span>: <span className="code-orange">true</span>{`\n`}{'}'})</code></pre><div className="sub2api-code-status"><Check size={14} /> Request completed <span>184ms</span></div></div></div>
        </section>

        <section className="sub2api-final-cta"><p className="sub2api-eyebrow">READY WHEN YOU ARE</p><h2>让下一次调用，<br /><em>更有把握。</em></h2><a className="sub2api-button sub2api-button--light" {...linkProps(config.primaryHref)}>{config.primaryCta}<ArrowUpRight size={17} /></a></section>
      </main>

      <footer className="sub2api-footer"><div className="sub2api-footer-brand"><span className="sub2api-brand-mark">S2</span><strong>{config.siteName}</strong><p>为每一次 AI 调用<br />提供可靠的起点。</p></div><div className="sub2api-footer-links"><div><span>资源</span>{config.documentationUrl ? <a {...linkProps(config.documentationUrl)}>使用文档 <ExternalLink size={13} /></a> : null}<a href="#developers">开发者</a></div><div><span>协议</span>{config.termsUrl ? <a {...linkProps(config.termsUrl)}>服务条款</a> : null}{config.userTermsUrl ? <a {...linkProps(config.userTermsUrl)}>用户条款</a> : null}{config.privacyUrl ? <a {...linkProps(config.privacyUrl)}>隐私协议</a> : null}</div></div><p className="sub2api-footer-copy">© {new Date().getFullYear()} {config.siteName}. All rights reserved.</p></footer>
    </div>
  )
}
