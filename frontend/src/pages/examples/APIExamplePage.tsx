import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import { toast } from 'sonner'

interface ExampleStatus {
  service: string
  status: string
  server_time: string
}

type RequestState =
  | { status: 'loading' }
  | { status: 'success'; data: ExampleStatus }
  | { status: 'error'; message: string }

export default function APIExamplePage() {
  const [state, setState] = useState<RequestState>({ status: 'loading' })
  const requestRef = useRef<{ id: number; controller: AbortController | null }>({
    id: 0,
    controller: null,
  })

  const loadStatus = useCallback(async (trackAction = false) => {
    if (trackAction) {
      trackFeatureClick('example-api', 'refresh-status')
    }

    requestRef.current.controller?.abort()
    const requestId = requestRef.current.id + 1
    const controller = new AbortController()
    requestRef.current = { id: requestId, controller }
    setState({ status: 'loading' })

    try {
      const envelope = await apiClient.get<AuxEnvelope<ExampleStatus>>(
        '/admin/examples/status',
        { signal: controller.signal },
      )
      if (controller.signal.aborted || requestRef.current.id !== requestId) return

      if (envelope.code !== 0 || !envelope.data) {
        if (trackAction) {
          toast.error(envelope.message || '服务状态刷新失败')
        }
        setState({
          status: 'error',
          message: envelope.message || '服务返回的数据格式无效',
        })
        return
      }
      setState({ status: 'success', data: envelope.data })
      if (trackAction) {
        toast.success('服务状态刷新成功')
      }
    } catch (error) {
      console.error('[APIExamplePage] status request failed', error)
      if (controller.signal.aborted || requestRef.current.id !== requestId) return
      if (trackAction) {
        toast.error('服务状态刷新失败')
      }
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : '未知请求错误',
      })
    }
  }, [])

  useEffect(() => {
    void loadStatus()
    return () => {
      const current = requestRef.current
      current.controller?.abort()
      requestRef.current = { id: current.id + 1, controller: null }
    }
  }, [loadStatus])

  return (
    <div className="aux-example-page">
      <header className="aux-example-header aux-api-header">
        <div>
          <p className="aux-page-kicker">
            服务诊断
          </p>
          <h1>API 请求示例</h1>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus(true)}
          disabled={state.status === 'loading'}
          className="aux-surface-button"
        >
          刷新服务状态
        </button>
      </header>

      {state.status === 'loading' && (
        <p
          role="status"
          className="border-y border-gray-200 py-8 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400"
        >
          正在读取服务状态…
        </p>
      )}

      {state.status === 'error' && (
        <section className="aux-surface-error py-6">
          <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">
            服务状态暂不可用
          </h2>
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">
            {state.message}
          </p>
          <button
            type="button"
            onClick={() => void loadStatus(true)}
            className="aux-surface-button"
          >
            重试请求
          </button>
        </section>
      )}

      {state.status === 'success' && (
        <section className="aux-example-card p-6 sm:p-8" aria-labelledby="response-heading">
          <h2
            id="response-heading"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            服务响应
          </h2>
          <dl className="mt-3 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-700 dark:border-gray-700">
            <StatusRow label="服务" value={state.data.service} />
            <StatusRow label="状态" value={state.data.status} status />
            <StatusRow label="服务器时间" value={state.data.server_time} mono />
          </dl>
        </section>
      )}
    </div>
  )
}

function StatusRow({
  label,
  value,
  mono = false,
  status = false,
}: {
  label: string
  value: string
  mono?: boolean
  status?: boolean
}) {
  return (
    <div className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:items-center">
      <dt className="text-sm text-gray-500 dark:text-gray-400">{label}</dt>
      <dd
        className={`${mono ? 'font-mono' : ''} ${
          status
            ? 'font-medium text-emerald-700 dark:text-emerald-300'
            : 'text-gray-900 dark:text-gray-100'
        } text-sm`}
      >
        {value}
      </dd>
    </div>
  )
}
