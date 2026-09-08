import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import gsap from 'gsap'
import { describe, expect, it } from 'vitest'
import { HomepageQuickstart } from './HomepageQuickstart'

describe('HomepageQuickstart', () => {
  it('uses one shared card and switches content from the step nodes', async () => {
    const user = userEvent.setup()
    const { container } = render(<HomepageQuickstart model="gpt-6-astra" />)

    expect(container.querySelectorAll('.sub2api-step-card')).toHaveLength(1)
    expect(container.querySelectorAll('.sub2api-step-node.is-active')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: '注册并创建 API Key' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '02 配置客户端' }))

    expect(screen.getByRole('heading', { name: '配置客户端' })).toBeInTheDocument()
    expect(screen.getByText('gpt-6-astra')).toBeInTheDocument()
    expect(container.querySelectorAll('.sub2api-step-node.is-active')).toHaveLength(1)
  })

  it('keeps progress moving while the pointer hovers over a node or card', async () => {
    const user = userEvent.setup()
    const { container } = render(<HomepageQuickstart model="gpt-6-astra" />)
    const progress = () => Number(container.querySelector<HTMLElement>('.sub2api-step-node.is-active')?.style.getPropertyValue('--step-progress'))
    const advance = () => act(() => { gsap.globalTimeline.time(gsap.globalTimeline.time() + 1) })

    advance()
    const beforeNodeHover = progress()
    await user.hover(screen.getByRole('button', { name: '01 注册并创建 API Key' }))
    advance()
    expect(progress()).toBeGreaterThan(beforeNodeHover)

    const beforeCardHover = progress()
    await user.hover(screen.getByRole('region', { name: '注册并创建 API Key' }))
    advance()
    expect(progress()).toBeGreaterThan(beforeCardHover)
  })

  it('preserves progress while keyboard focus pauses rotation', async () => {
    const user = userEvent.setup()
    const { container } = render(<HomepageQuickstart model="gpt-6-astra" />)
    const progress = () => Number(container.querySelector<HTMLElement>('.sub2api-step-node.is-active')?.style.getPropertyValue('--step-progress'))
    act(() => { gsap.globalTimeline.time(gsap.globalTimeline.time() + 1) })
    const beforeFocus = progress()

    await user.tab()
    expect(screen.getByRole('button', { name: '01 注册并创建 API Key' })).toHaveFocus()
    expect(screen.getByRole('region', { name: '注册并创建 API Key' })).toHaveAttribute('aria-live', 'polite')
    expect(progress()).toBeCloseTo(beforeFocus, 1)
    const pausedProgress = progress()
    act(() => { gsap.globalTimeline.time(gsap.globalTimeline.time() + 1) })
    expect(progress()).toBeCloseTo(pausedProgress, 5)
  })
})
