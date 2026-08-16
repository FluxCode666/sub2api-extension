import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import InteractionExamplePage from './InteractionExamplePage'

vi.mock('@/lib/telemetry-sdk', () => ({
  trackFeatureClick: vi.fn(),
}))

import { trackFeatureClick } from '@/lib/telemetry-sdk'

describe('InteractionExamplePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates the counter and records each interaction', async () => {
    const user = userEvent.setup()
    render(<InteractionExamplePage />)

    const counter = screen.getByRole('status', { name: '当前计数' })
    expect(counter).toHaveTextContent('0')

    await user.click(screen.getByRole('button', { name: '增加计数' }))
    expect(counter).toHaveTextContent('1')
    expect(trackFeatureClick).toHaveBeenCalledWith(
      'example-interaction',
      'increment-counter',
    )

    await user.click(screen.getByRole('button', { name: '减少计数' }))
    expect(counter).toHaveTextContent('0')
    expect(trackFeatureClick).toHaveBeenCalledWith(
      'example-interaction',
      'decrement-counter',
    )

    await user.click(screen.getByRole('button', { name: '增加计数' }))
    await user.click(screen.getByRole('button', { name: '重置计数' }))
    expect(counter).toHaveTextContent('0')
    expect(trackFeatureClick).toHaveBeenCalledWith(
      'example-interaction',
      'reset-counter',
    )
  })
})
