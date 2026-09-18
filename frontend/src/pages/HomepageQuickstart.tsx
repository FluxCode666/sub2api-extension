import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

const QUICKSTART_DURATION = 5.2
type QuickstartStep = {
  index: '01' | '02' | '03'
  title: string
  text: string
  tone: 'peach' | 'violet' | 'mint'
}

const onboardingSteps = [
  { index: '01', title: '注册并创建 API Key', text: '注册并进入控制台，创建 API Key 后选择要使用的模型。', tone: 'peach' },
  { index: '02', title: '配置客户端', text: '将 Base URL、API Key 和模型名称填入你熟悉的 SDK 或应用。', tone: 'violet' },
  { index: '03', title: '发出第一个请求', text: '发送一次测试请求，收到 200 响应，就说明客户端已经接入成功。', tone: 'mint' },
] as const satisfies readonly QuickstartStep[]

const enterpriseDeliverySteps = [
  { index: '01', title: '确认接入方案', text: '梳理调用区域、业务规模、模型需求与安全边界，明确主服务器和优化节点的接入方式。', tone: 'peach' },
  { index: '02', title: '完成联调验证', text: '沿用现有客户端与请求层，在测试环境验证鉴权、路由、监控与异常处理。', tone: 'violet' },
  { index: '03', title: '生产切换与观测', text: '完成生产流量切换后，持续关注可用性、首 Token 响应和用量变化。', tone: 'mint' },
] as const satisfies readonly QuickstartStep[]

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

function QuickstartCardContent({ step, model, variant }: { step: QuickstartStep; model: string; variant: 'developer' | 'enterprise' }) {
  if (variant === 'enterprise') {
    if (step.index === '01') {
      return <div className="sub2api-step-ui-fields"><div><span>接入区域</span><b>中国大陆 / 全球</b></div><div><span>业务类型</span><b>生产级 API 调用</b></div><div><span>交付目标</span><b>稳定、可观测</b></div></div>
    }
    if (step.index === '02') {
      return <div className="sub2api-step-ui-fields"><div><span>身份鉴权</span><b>验证通过</b></div><div><span>智能路由</span><b>策略已确认</b></div><div><span>运行观测</span><b>指标已接入</b></div></div>
    }
    return <><div className="sub2api-step-ui-success"><span />生产流量已接入</div><strong className="sub2api-step-ui-code">LIVE</strong><div className="sub2api-step-ui-footer"><span>运行监控已开启</span><span>持续观测中</span></div></>
  }

  if (step.index === '01') {
    return <><span className="sub2api-step-ui-label">API KEY</span><div className="sub2api-step-ui-input">sk-••••••••••••</div><span className="sub2api-step-ui-status">已创建</span></>
  }
  if (step.index === '02') {
    return <div className="sub2api-step-ui-fields"><div><span>Base URL</span><b>api.sub2api.ai/v1</b></div><div><span>API Key</span><b>sk-••••••••</b></div><div><span>模型</span><b>{model}</b></div></div>
  }
  return <><div className="sub2api-step-ui-success"><span />请求成功</div><strong className="sub2api-step-ui-code">200</strong><div className="sub2api-step-ui-footer"><span>POST /v1/chat/completions</span><span>已收到模型响应</span></div></>
}

export function HomepageQuickstart({ model, variant = 'developer' }: { model: string; variant?: 'developer' | 'enterprise' }) {
  const sectionRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const rotationRef = useRef<gsap.core.Tween | null>(null)
  const panelId = useId()
  const [activeStep, setActiveStep] = useState(0)
  const [countdown, setCountdown] = useState(1)
  const [timerKey, setTimerKey] = useState(0)
  const [inView, setInView] = useState(false)
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const steps = variant === 'enterprise' ? enterpriseDeliverySteps : onboardingSteps
  const step = steps[activeStep]
  const rotating = inView && pageVisible && !reducedMotion && !keyboardFocused

  useEffect(() => {
    const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
    const updateMotion = () => setReducedMotion(media?.matches ?? false)
    const updateVisibility = () => setPageVisible(!document.hidden)
    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 })
      : null
    if (observer && sectionRef.current) observer.observe(sectionRef.current)
    if (!observer) setInView(true)
    media?.addEventListener('change', updateMotion)
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      observer?.disconnect()
      media?.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [])

  useGSAP(() => {
    const timerState = { value: 1 }
    setCountdown(1)
    const rotation = gsap.to(timerState, {
      value: 0,
      duration: QUICKSTART_DURATION,
      ease: 'none',
      paused: true,
      onUpdate: () => setCountdown(timerState.value),
      onComplete: () => {
        setCountdown(1)
        setActiveStep((current) => (current + 1) % steps.length)
      },
    })
    rotationRef.current = rotation
    return () => {
      rotation.kill()
      rotationRef.current = null
    }
  }, { scope: sectionRef, dependencies: [activeStep, timerKey, steps], revertOnUpdate: true })

  useEffect(() => {
    rotationRef.current?.paused(!rotating)
  }, [activeStep, rotating, timerKey])

  useGSAP(() => {
    if (reducedMotion || !contentRef.current) return
    gsap.fromTo(contentRef.current.children,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: 'power3.out' })
  }, { scope: sectionRef, dependencies: [activeStep, reducedMotion], revertOnUpdate: true })

  return <section ref={sectionRef} className="sub2api-section sub2api-steps" id="quickstart">
    <div className="sub2api-steps-heading"><div><p className="sub2api-eyebrow">{variant === 'enterprise' ? 'ENTERPRISE DELIVERY' : 'START IN MINUTES'}</p><h2>{variant === 'enterprise' ? <>从方案确认，<br /><em>到稳定上线。</em></> : <>只需要三步，<br /><em>从注册到第一个请求。</em></>}</h2></div><p>{variant === 'enterprise' ? '基于现有客户端和请求层完成网络评估、联调验证与生产切换，让团队清楚掌握每个交付阶段。' : '沿用现有客户端和请求层，不需要额外工具。把接入变成一条任何团队都能走通的路径。'}</p></div>
    <div className="sub2api-step-list"
      onPointerDownCapture={() => setKeyboardFocused(false)}
      onFocusCapture={(event) => setKeyboardFocused(event.target.matches(':focus-visible'))}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocused(false) }}>
      <div className="sub2api-step-rail" role="group" aria-label={variant === 'enterprise' ? '企业交付步骤' : '快速接入步骤'}>
        {steps.map((item, index) => <button
          className={`sub2api-step-node ${index === activeStep ? 'is-active' : ''}`}
          type="button" aria-pressed={index === activeStep} aria-controls={panelId}
          style={index === activeStep ? { '--step-progress': 1 - countdown } as CSSProperties : undefined}
          onClick={() => {
            setCountdown(1)
            setActiveStep(index)
            setTimerKey((current) => current + 1)
          }} key={item.index}>
          <span>{item.index}</span>
          <b>{item.title}</b>
        </button>)}
      </div>
      <div className={`sub2api-step-card sub2api-step-card--${step.tone}`}>
        <div className="sub2api-step-toolbar">
          <span>STEP {step.index} <span>/ 03</span></span>
        </div>
        <div ref={contentRef} className="sub2api-step-panel" id={panelId} role="region" aria-labelledby={`${panelId}-title`} aria-live={rotating ? 'off' : 'polite'} aria-atomic="true">
          <div className="sub2api-step-preview"><QuickstartCardContent step={step} model={model} variant={variant} /></div>
          <div className="sub2api-step-copy"><h3 id={`${panelId}-title`}>{step.title}</h3><p>{step.text}</p></div>
        </div>
      </div>
    </div>
  </section>
}
