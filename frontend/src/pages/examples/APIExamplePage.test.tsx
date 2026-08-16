import { StrictMode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import APIExamplePage from './APIExamplePage'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
  },
}))

vi.mock('@/lib/telemetry-sdk', () => ({
  trackFeatureClick: vi.fn(),
}))

import { apiClient } from '@/lib/api-client'
import { trackFeatureClick } from '@/lib/telemetry-sdk'

const firstStatus = {
  service: 'aux-system',
  status: 'ok',
  server_time: '2026-08-16T15:00:00Z',
}

const refreshedStatus = {
  service: 'aux-system',
  status: 'ok',
  server_time: '2026-08-16T15:01:00Z',
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

describe('APIExamplePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading state while the initial request is pending', () => {
    vi.mocked(apiClient.get).mockReturnValueOnce(new Promise(() => {}))

    render(<APIExamplePage />)

    expect(screen.getByText('正在读取服务状态…')).toBeInTheDocument()
  })

  it('renders the authenticated status response', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      code: 0,
      message: 'success',
      data: firstStatus,
    })

    render(<APIExamplePage />)

    expect(await screen.findByText('aux-system')).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.getByText(firstStatus.server_time)).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith(
      '/admin/examples/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('refreshes the response and records the user action', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce({ code: 0, message: 'success', data: firstStatus })
      .mockResolvedValueOnce({ code: 0, message: 'success', data: refreshedStatus })

    render(<APIExamplePage />)
    await screen.findByText(firstStatus.server_time)

    await user.click(screen.getByRole('button', { name: '刷新服务状态' }))

    expect(await screen.findByText(refreshedStatus.server_time)).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledTimes(2)
    expect(trackFeatureClick).toHaveBeenCalledWith(
      'example-api',
      'refresh-status',
    )
  })

  it('aborts stale StrictMode requests and ignores late responses', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    vi.mocked(apiClient.get)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const { unmount } = render(
      <StrictMode>
        <APIExamplePage />
      </StrictMode>,
    )

    await waitFor(() => {
      expect(apiClient.get).toHaveBeenCalledTimes(2)
    })
    const firstSignal = vi.mocked(apiClient.get).mock.calls[0][1]?.signal
    const secondSignal = vi.mocked(apiClient.get).mock.calls[1][1]?.signal
    expect(firstSignal?.aborted).toBe(true)
    expect(secondSignal?.aborted).toBe(false)

    await act(async () => {
      second.resolve({ code: 0, message: 'success', data: refreshedStatus })
    })
    expect(await screen.findByText(refreshedStatus.server_time)).toBeInTheDocument()

    await act(async () => {
      first.resolve({ code: 0, message: 'success', data: firstStatus })
    })
    expect(screen.queryByText(firstStatus.server_time)).not.toBeInTheDocument()
    expect(screen.getByText(refreshedStatus.server_time)).toBeInTheDocument()

    unmount()
    expect(secondSignal?.aborted).toBe(true)
  })

  it('shows an error and retries the request', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error('Aux API request failed: 503'))
      .mockResolvedValueOnce({ code: 0, message: 'success', data: firstStatus })

    render(<APIExamplePage />)

    expect(await screen.findByText('服务状态暂不可用')).toBeInTheDocument()
    expect(screen.getByText(/503/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试请求' }))

    await waitFor(() => {
      expect(screen.getByText(firstStatus.server_time)).toBeInTheDocument()
    })
    expect(trackFeatureClick).toHaveBeenCalledWith(
      'example-api',
      'refresh-status',
    )
  })
})
