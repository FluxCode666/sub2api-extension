import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { trackFeatureClick } from '@/lib/telemetry-sdk'

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
        setState({
          status: 'error',
          message: envelope.message || '服务返回的数据格式无效',
        })
        return
      }
      setState({ status: 'success', data: envelope.data })
    } catch (error) {
      if (controller.signal.aborted || requestRef.current.id !== requestId) return
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
    <div className="max-w-4xl space-y-8">
      <header className="flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-gray-700">
        <div>
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
            服务诊断
          </p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
            API 请求示例
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus(true)}
          disabled={state.status === 'loading'}
          className="h-10 rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:bg-blue-400"
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
        <section className="border-y border-red-200 py-6 dark:border-red-900">
          <h2 className="text-lg font-semibold text-red-800 dark:text-red-300">
            服务状态暂不可用
          </h2>
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">
            {state.message}
          </p>
          <button
            type="button"
            onClick={() => void loadStatus(true)}
            className="mt-4 h-10 rounded-md border border-red-300 px-4 text-sm font-medium text-red-800 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            重试请求
          </button>
        </section>
      )}

      {state.status === 'success' && (
        <section aria-labelledby="response-heading">
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
