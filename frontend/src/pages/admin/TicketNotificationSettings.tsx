import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'

interface NotificationChannel {
  id: number
  name: string
  type: string
  enabled: boolean
}

interface TicketEventConfig {
  channel_ids: number[]
  channel_recipients: Record<string, string[]>
}

export default function TicketNotificationSettings({ channels }: { channels: NotificationChannel[] }) {
  const [selectedIDs, setSelectedIDs] = useState<number[]>([])
  const [recipients, setRecipients] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiClient.get<AuxEnvelope<TicketEventConfig>>('/admin/notifications/events/ticket.created')
      setSelectedIDs(response.data?.channel_ids ?? [])
      setRecipients(Object.fromEntries(Object.entries(response.data?.channel_recipients ?? {}).map(([id, values]) => [id, values.join(', ')])))
    } catch (caught) {
      console.error('[TicketNotificationSettings] failed to load event config', caught)
      setError('工单提醒配置加载失败，请刷新页面重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    setSaving(true)
    const channelRecipients = Object.fromEntries(selectedIDs.map(id => [
      String(id), (recipients[String(id)] ?? '').split(/[\s,;，；]+/).map(value => value.trim()).filter(Boolean),
    ]))
    try {
      await apiClient.put('/admin/notifications/events/ticket.created', { channel_ids: selectedIDs, channel_recipients: channelRecipients })
      toast.success('工单提醒配置已保存')
      await load()
    } catch (caught) {
      console.error('[TicketNotificationSettings] failed to save event config', caught)
      toast.error('工单提醒配置保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="mb-4"><h2 className="text-lg font-semibold">新工单提醒</h2><p className="mt-1 text-xs text-muted-foreground">用户提交新工单后，向勾选渠道发送提醒；邮箱渠道可单独设置收件人。</p></div>
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      {loading ? <p role="status" className="py-4 text-sm text-muted-foreground">正在加载工单提醒配置…</p> : channels.length === 0 ? <p className="py-4 text-sm text-muted-foreground">请先配置通知渠道，再开启工单提醒。</p> : <div className="space-y-3">{channels.map(channel => {
        const checked = selectedIDs.includes(channel.id)
        const supportsRecipients = channel.type === 'email' || channel.type === 'resend'
        return <div key={channel.id} className="flex flex-wrap items-start justify-between gap-4 rounded-md border p-3">
          <div className="flex items-center gap-3"><Switch id={`ticket-channel-${channel.id}`} checked={checked} onCheckedChange={value => setSelectedIDs(current => value ? [...current, channel.id] : current.filter(id => id !== channel.id))} disabled={!channel.enabled && !checked} /><Label htmlFor={`ticket-channel-${channel.id}`} className="cursor-pointer"><span className="font-medium">{channel.name}</span><span className="ml-2 text-xs text-muted-foreground">{channel.type}{channel.enabled ? '' : ' · 已停用'}</span></Label></div>
          {supportsRecipients && checked && <div className="w-full space-y-1 sm:max-w-sm"><Label htmlFor={`ticket-recipient-${channel.id}`} className="text-xs">提醒收件人</Label><Input id={`ticket-recipient-${channel.id}`} value={recipients[String(channel.id)] ?? ''} onChange={event => setRecipients(current => ({ ...current, [String(channel.id)]: event.target.value }))} placeholder="ops@example.com，多个地址用逗号分隔" /></div>}
        </div>
      })}</div>}
      <div className="mt-4 flex justify-end"><Button onClick={() => void save()} disabled={loading || saving || channels.length === 0}>{saving ? '保存中…' : '保存工单提醒'}</Button></div>
    </section>
  )
}
