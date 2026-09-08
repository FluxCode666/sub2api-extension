import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'

gsap.registerPlugin(useGSAP)

const QUICKSTART_DURATION = 5.2
const onboardingSteps = [
  { index: '01', title: '注册并创建 API Key', text: '注册并进入控制台，创建 API Key 后选择要使用的模型。', tone: 'peach' },
  { index: '02', title: '配置客户端', text: '将 Base URL、API Key 和模型名称填入你熟悉的 SDK 或应用。', tone: 'violet' },
  { index: '03', title: '发出第一个请求', text: '发送一次测试请求，收到 200 响应，就说明客户端已经接入成功。', tone: 'mint' },
] as const

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

function QuickstartCardContent({ step, model }: { step: typeof onboardingSteps[number]; model: string }) {
  if (step.index === '01') {
    return <><span className="sub2api-step-ui-label">API KEY</span><div className="sub2api-step-ui-input">sk-••••••••••••</div><span className="sub2api-step-ui-status">已创建</span></>
  }
  if (step.index === '02') {
    return <div className="sub2api-step-ui-fields"><div><span>Base URL</span><b>api.sub2api.ai/v1</b></div><div><span>API Key</span><b>sk-••••••••</b></div><div><span>模型</span><b>{model}</b></div></div>
  }
  return <><div className="sub2api-step-ui-success"><span />请求成功</div><strong className="sub2api-step-ui-code">200</strong><div className="sub2api-step-ui-footer"><span>POST /v1/chat/completions</span><span>已收到模型响应</span></div></>
}

export function HomepageQuickstart({ model }: { model: string }) {
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
  const step = onboardingSteps[activeStep]
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
        setActiveStep((current) => (current + 1) % onboardingSteps.length)
      },
    })
    rotationRef.current = rotation
    return () => {
      rotation.kill()
      rotationRef.current = null
    }
  }, { scope: sectionRef, dependencies: [activeStep, timerKey], revertOnUpdate: true })

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
    <div className="sub2api-steps-heading"><div><p className="sub2api-eyebrow">START IN MINUTES</p><h2>只需要三步，<br /><em>从注册到第一个请求。</em></h2></div><p>沿用现有客户端和请求层，不需要额外工具。把接入变成一条任何团队都能走通的路径。</p></div>
    <div className="sub2api-step-list"
      onPointerDownCapture={() => setKeyboardFocused(false)}
      onFocusCapture={(event) => setKeyboardFocused(event.target.matches(':focus-visible'))}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocused(false) }}>
      <div className="sub2api-step-rail" role="group" aria-label="快速接入步骤">
        {onboardingSteps.map((item, index) => <button
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
          <div className="sub2api-step-preview"><QuickstartCardContent step={step} model={model} /></div>
          <div className="sub2api-step-copy"><h3 id={`${panelId}-title`}>{step.title}</h3><p>{step.text}</p></div>
        </div>
      </div>
    </div>
  </section>
}
