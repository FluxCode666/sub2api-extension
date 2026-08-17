import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import {
  DEFAULT_HOMEPAGE_CONFIG,
  normalizeHomepageConfigForDisplay,
  type HomepageConfig,
  type TrustedPartner,
} from '@/lib/homepage-config'
import { trackFeatureClick } from '@/lib/telemetry-sdk'

type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function HomepageConfigPage() {
  const [config, setConfig] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoadState('loading')
    setMessage('')
    try {
      const envelope = await apiClient.get<AuxEnvelope<HomepageConfig>>('/admin/homepage/config')
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '配置数据不可用')
      setConfig(normalizeHomepageConfigForDisplay(envelope.data))
      setLoadState('ready')
    } catch (error) {
      setLoadState('error')
      setMessage(error instanceof Error ? error.message : '读取配置失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const updateField = <K extends keyof HomepageConfig>(key: K, value: HomepageConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }))
    setSaveState('idle')
  }

  const updatePartner = (index: number, patch: Partial<TrustedPartner>) => {
    updateField(
      'trustedPartners',
      config.trustedPartners.map((partner, partnerIndex) =>
        partnerIndex === index ? { ...partner, ...patch } : partner,
      ),
    )
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (saveState === 'saving') return
    setSaveState('saving')
    setMessage('')
    trackFeatureClick('homepage-config', 'save-config')
    try {
      const envelope = await apiClient.put<AuxEnvelope<HomepageConfig>>('/admin/homepage/config', config)
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '保存失败')
      setConfig(envelope.data)
      setSaveState('saved')
      setMessage('官网首页配置已保存。')
    } catch (error) {
      setSaveState('error')
      setMessage(error instanceof Error ? error.message : '保存失败')
    }
  }

  if (loadState === 'loading') {
    return <ConfigShell><p className="text-sm text-gray-600 dark:text-gray-400">正在读取官网配置...</p></ConfigShell>
  }

  if (loadState === 'error') {
    return (
      <ConfigShell>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/70 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
          <button type="button" onClick={() => void load()} className="mt-3 rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-800 dark:text-red-300">重新加载</button>
        </div>
      </ConfigShell>
    )
  }

  return (
    <ConfigShell>
      <form onSubmit={save} className="space-y-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
          <SectionHeader title="首屏内容" description="调整官网首屏的定位、主文案与两个入口。" />
          <div className="mt-5 grid gap-5">
            <TextField label="定位标签" value={config.heroLabel} maxLength={120} onChange={(value) => updateField('heroLabel', value)} />
            <TextField label="主标题" value={config.heroTitle} maxLength={160} onChange={(value) => updateField('heroTitle', value)} />
            <TextField label="简介" value={config.heroDescription} maxLength={360} multiline onChange={(value) => updateField('heroDescription', value)} />
            <TextField label="默认模型（开发者示例）" value={config.model} maxLength={120} onChange={(value) => updateField('model', value)} />
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label="主按钮文案" value={config.primaryCta} maxLength={48} onChange={(value) => updateField('primaryCta', value)} />
              <TextField label="主按钮链接" value={config.primaryHref} onChange={(value) => updateField('primaryHref', value)} />
              <TextField label="文档入口文案" value={config.docsCta} maxLength={48} onChange={(value) => updateField('docsCta', value)} />
              <TextField label="文档入口链接" value={config.docsHref} onChange={(value) => updateField('docsHref', value)} />
              <TextField label="顶部导航控制台链接" value={config.consoleHref} onChange={(value) => updateField('consoleHref', value)} />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <SectionHeader title="受信赖的伙伴" description="列表为空时，官网不会展示该板块。Logo 未配置时只展示品牌名称。" />
            <button
              type="button"
              onClick={() => updateField('trustedPartners', [...config.trustedPartners, { name: '', logoUrl: '', linkUrl: '' }])}
              className="min-h-11 rounded-xl border border-gray-300 px-4 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 active:translate-y-px dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
            >
              添加伙伴
            </button>
          </div>

          {config.trustedPartners.length === 0 ? (
            <div className="mt-5 rounded-xl border border-dashed border-gray-300 px-5 py-8 text-center dark:border-gray-600">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">当前不展示伙伴板块</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">添加至少一个有名称的伙伴后，官网将启用自动循环滚动。</p>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              {config.trustedPartners.map((partner, index) => (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50" key={index}>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">伙伴 {index + 1}</p>
                    <button
                      type="button"
                      onClick={() => updateField('trustedPartners', config.trustedPartners.filter((_, partnerIndex) => partnerIndex !== index))}
                      className="min-h-10 px-2 text-sm font-medium text-red-600 hover:text-red-700 dark:text-red-400"
                    >
                      移除
                    </button>
                  </div>
                  <div className="mt-3 grid gap-4 md:grid-cols-3">
                    <TextField label="品牌名称" value={partner.name} maxLength={80} required onChange={(value) => updatePartner(index, { name: value })} />
                    <TextField label="Logo URL（可选）" value={partner.logoUrl || ''} onChange={(value) => updatePartner(index, { logoUrl: value })} />
                    <TextField label="跳转链接（可选）" value={partner.linkUrl || ''} onChange={(value) => updatePartner(index, { linkUrl: value })} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
          <p className={`text-sm ${saveState === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'}`} aria-live="polite">
            {message || '保存后，公开首页会在下一次加载时读取最新配置。'}
          </p>
          <button
            type="submit"
            disabled={saveState === 'saving'}
            className="min-h-11 rounded-xl bg-gray-900 px-5 text-sm font-semibold text-gray-50 transition hover:bg-gray-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {saveState === 'saving' ? '保存中...' : '保存配置'}
          </button>
        </div>
      </form>
    </ConfigShell>
  )
}

function ConfigShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">官网首页配置</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">维护 TERALEMO 官网首屏文案与伙伴列表。</p>
        </div>
        <Link to="/" target="_blank" className="min-h-11 rounded-xl border border-gray-300 px-4 py-3 text-sm font-semibold text-gray-800 transition hover:bg-white dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-800">
          预览官网
        </Link>
      </div>
      {children}
    </div>
  )
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2><p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</p></div>
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  maxLength,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  maxLength?: number
  required?: boolean
}) {
  const className = 'mt-1.5 block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100'
  return (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
      {label}
      {multiline ? (
        <textarea rows={4} value={value} maxLength={maxLength} required={required} onChange={(event) => onChange(event.target.value)} className={className} />
      ) : (
        <input value={value} maxLength={maxLength} required={required} onChange={(event) => onChange(event.target.value)} className={className} />
      )}
    </label>
  )
}
