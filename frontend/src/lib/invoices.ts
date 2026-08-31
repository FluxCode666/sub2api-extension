import { getAdminSessionToken, ADMIN_SESSION_HEADER } from './admin-auth'
import { getEmbeddedContext } from './embedded'

export type InvoiceStatus = 'PENDING' | 'PROCESSING' | 'ISSUED' | 'REJECTED'

export interface InvoiceOrder {
  payment_order_id: number
  out_trade_no: string
  amount: number
  paid_at: string
}

export interface InvoiceRequest {
  id: number
  user_id?: number
  user_email?: string
  user_name?: string
  invoice_title: string
  taxpayer_id: string
  contact_email: string
  contact_phone?: string
  registered_address?: string
  bank_name?: string
  bank_account?: string
  remark?: string
  amount: number
  status: InvoiceStatus
  admin_note?: string
  orders: InvoiceOrder[]
  document_available: boolean
  document_name?: string
  issued_at?: string
  created_at: string
  updated_at: string
}

export interface InvoiceProfile {
  user_id?: number
  invoice_title: string
  taxpayer_id: string
  contact_email: string
  contact_phone?: string
  registered_address?: string
  bank_name?: string
  bank_account?: string
  created_at?: string
  updated_at?: string
}

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return {
    PENDING: '待处理',
    PROCESSING: '开票中',
    ISSUED: '已开具',
    REJECTED: '已驳回',
  }[status]
}

export function invoiceStatusClass(status: InvoiceStatus): string {
  return {
    PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/35 dark:text-amber-200',
    PROCESSING: 'bg-sky-100 text-sky-800 dark:bg-sky-900/35 dark:text-sky-200',
    ISSUED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/35 dark:text-emerald-200',
    REJECTED: 'bg-rose-100 text-rose-800 dark:bg-rose-900/35 dark:text-rose-200',
  }[status]
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(amount || 0)
}

export function formatDate(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

/** Download a protected invoice file with the correct session headers. */
export async function downloadInvoiceFile(path: string): Promise<void> {
  const headers: Record<string, string> = {}
  const session = getAdminSessionToken()
  if (session) headers[ADMIN_SESSION_HEADER] = session
  const embeddedToken = getEmbeddedContext()?.token
  if (embeddedToken) headers['X-Aux-Token'] = embeddedToken
  const response = await fetch(path, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error(`下载失败（${response.status}）`)
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = disposition.match(/filename="?([^";]+)"?/i)
  const filename = match?.[1] || 'invoice-document'
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
