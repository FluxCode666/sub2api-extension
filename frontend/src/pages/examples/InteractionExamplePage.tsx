import { useState } from 'react'
import { trackFeatureClick } from '@/lib/telemetry-sdk'

const PAGE_ID = 'example-interaction'

export default function InteractionExamplePage() {
  const [count, setCount] = useState(0)

  const updateCount = (
    next: (current: number) => number,
    featureId: string,
  ) => {
    setCount(next)
    trackFeatureClick(PAGE_ID, featureId)
  }

  return (
    <div className="aux-example-page">
      <header className="aux-example-header">
        <p className="aux-page-kicker">
          操作台
        </p>
        <h1>交互与埋点示例</h1>
      </header>

      <section
        aria-labelledby="counter-heading"
        className="aux-example-card p-6 sm:p-8"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="counter-heading"
              className="text-sm font-medium text-gray-600 dark:text-gray-400"
            >
              当前计数
            </h2>
            <output
              aria-label="当前计数"
              className="mt-2 block min-w-24 text-5xl font-semibold text-gray-900 dark:text-gray-100"
            >
              {count}
            </output>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="减少计数"
              title="减少计数"
              onClick={() =>
                updateCount((current) => current - 1, 'decrement-counter')
              }
              className="h-10 w-10 rounded-md border border-gray-300 text-xl text-gray-700 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              -
            </button>
            <button
              type="button"
              aria-label="增加计数"
              title="增加计数"
              onClick={() =>
                updateCount((current) => current + 1, 'increment-counter')
              }
              className="h-10 w-10 rounded-md bg-blue-700 text-xl text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => updateCount(() => 0, 'reset-counter')}
              className="h-10 rounded-md px-3 text-sm font-medium text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              重置计数
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
