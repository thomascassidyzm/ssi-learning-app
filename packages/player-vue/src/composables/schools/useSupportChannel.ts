/**
 * The support channel, her side. Three calls onto the three routes, and one
 * shared unread count for the user-menu dot.
 *
 * The transport is the database (Tom, 2026-09-10): a question is a row this
 * posts through the app's server; the answer is a row the watcher on
 * watson-1 writes back. Nothing here subscribes to anything — the thread view
 * polls on open and on focus, which at this volume is indistinguishable from
 * realtime and has nothing to be down.
 */
import { ref } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useI18n } from '@/composables/useI18n'

export interface SupportMessage {
  id: string
  body: string
  direction: 'in' | 'out'
  author_source: string
  author_name: string | null
  in_reply_to: string | null
  escalated_at: string | null
  escalation_resolved_at: string | null
  answered_at: string | null
  created_at: string
}

export interface SupportThread {
  id: string
  language: string | null
  standing_notes: Record<string, unknown>
  created_at: string
}

export interface SendSupportMessageInput {
  text: string
  anchor?: string
  displayed_label?: string
  displayed_value?: string
}

// Module-level so the top bar's dot and the thread view share one number.
const unread = ref(0)

declare const __BUILD_NUMBER__: string | undefined

function buildVersion(): string {
  return typeof __BUILD_NUMBER__ !== 'undefined' ? String(__BUILD_NUMBER__) : 'dev'
}

export function useSupportChannel() {
  const { getAuthToken } = useAdminClient()
  const { locale } = useI18n()

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAuthToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  /** Her thread, oldest-first. Opening it marks it read server-side. */
  async function loadThread(): Promise<{ thread: SupportThread; messages: SupportMessage[] }> {
    const resp = await fetch('/api/support/thread', { headers: await authHeaders() })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'thread')
    unread.value = 0
    return { thread: data.thread, messages: data.messages ?? [] }
  }

  /** The dot: how many replies since she last opened the thread. Never marks read. */
  async function peekUnread(): Promise<number> {
    try {
      const resp = await fetch('/api/support/thread?peek=1', { headers: await authHeaders() })
      if (!resp.ok) return unread.value
      const data = await resp.json().catch(() => ({}))
      unread.value = Number(data.unread) || 0
    } catch {
      /* offline or signed out — the dot simply keeps its last value */
    }
    return unread.value
  }

  /** Her question. The server assembles the envelope from her scope; this adds only what the browser knows. */
  async function sendMessage(input: SendSupportMessageInput): Promise<SupportMessage> {
    const lang = String(locale.value || '').startsWith('cym') ? 'cym' : 'eng'
    const body = {
      text: input.text,
      anchor: input.anchor,
      displayed_label: input.displayed_label,
      displayed_value: input.displayed_value,
      route: typeof window !== 'undefined' ? window.location.pathname + window.location.search : undefined,
      build_version: buildVersion(),
      device_info: typeof navigator !== 'undefined'
        ? { userAgent: navigator.userAgent, screen: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`, language: navigator.language }
        : undefined,
      language: lang,
    }
    const resp = await fetch('/api/support/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'send')
    return data.message as SupportMessage
  }

  return { unread, loadThread, peekUnread, sendMessage }
}
