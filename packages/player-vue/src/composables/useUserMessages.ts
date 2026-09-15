/**
 * The in-app inbox, client side (job #684). One shared state for every
 * rendering — the schools avatar-menu badge, the schools Inbox page, the
 * learner Library card and the learner Inbox page all read the same rows.
 *
 * READ STATE IS REAL. Listing never marks anything read; only markRead (the
 * person tapped it) does, and opening the Support thread on the server side.
 * Dismiss is the Library card only: the message stays in the inbox, unread.
 *
 * VIEW AS. The routes refuse a tagged request, so nothing is fetched while an
 * ssi_admin tours as someone else: the inbox renders empty and read-only, and
 * the screens say so.
 */
import { ref, computed, inject, type Ref } from 'vue'
import { useUserRole } from '@/composables/useUserRole'

export type UserMessageActionKind = 'undo_class_play_copy' | 'open_support'

export interface UserMessage {
  id: string
  source: 'support_reply' | 'class_play_copied'
  title: string
  body: string
  action: { kind: UserMessageActionKind; label: string } | null
  action_taken_at: string | null
  read_at: string | null
  dismissed_at: string | null
  created_at: string
}

export interface ActOutcome {
  ok: boolean
  /** Server's plain sentence when refused, e.g. "played since the copy". */
  error?: string
  reason?: string
}

// Module-level so every rendering shares one number and one list.
const messages = ref<UserMessage[]>([])
const loaded = ref(false)
const loading = ref(false)
const loadError = ref<string | null>(null)

export function useUserMessages() {
  const supabaseRef = inject<Ref<any> | null>('supabase', null)
  const { isViewingAs } = useUserRole()

  async function authHeaders(): Promise<Record<string, string> | null> {
    const sb = supabaseRef?.value
    if (!sb) return null
    try {
      const { data } = await sb.auth.getSession()
      const token = data?.session?.access_token
      return token ? { Authorization: `Bearer ${token}` } : null
    } catch {
      return null
    }
  }

  const unread = computed(() => messages.value.filter((m) => !m.read_at).length)
  /** "9+" past nine, so a badge never grows a third digit. */
  const unreadBadge = computed(() => (unread.value > 9 ? '9+' : String(unread.value)))
  /** The newest unread, undismissed message — what the Library card shows, once. */
  const cardMessage = computed(() => messages.value.find((m) => !m.read_at && !m.dismissed_at) ?? null)

  /** Fetch the inbox. Silent when signed out or viewing as: the list simply stays as it is. */
  async function refresh(): Promise<void> {
    if (isViewingAs.value || loading.value) return
    const headers = await authHeaders()
    if (!headers) { messages.value = []; loaded.value = true; return }
    loading.value = true
    try {
      const resp = await fetch('/api/messages', { headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || 'inbox')
      messages.value = (data.messages ?? []) as UserMessage[]
      loadError.value = null
      loaded.value = true
    } catch (err) {
      loadError.value = err instanceof Error ? err.message : 'inbox'
    } finally {
      loading.value = false
    }
  }

  async function post(path: string, id: string): Promise<{ resp: Response; data: any } | null> {
    if (isViewingAs.value) return null
    const headers = await authHeaders()
    if (!headers) return null
    const resp = await fetch(`/api/messages/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ id }),
    })
    const data = await resp.json().catch(() => ({}))
    return { resp, data }
  }

  function replace(m: UserMessage | undefined): void {
    if (!m) return
    messages.value = messages.value.map((x) => (x.id === m.id ? m : x))
  }

  /** The person tapped it. */
  async function markRead(id: string): Promise<void> {
    const m = messages.value.find((x) => x.id === id)
    if (!m || m.read_at) return
    const r = await post('read', id)
    if (r?.resp.ok) replace(r.data.message)
  }

  /** The Library card's Dismiss. Not reading. */
  async function dismiss(id: string): Promise<void> {
    const r = await post('dismiss', id)
    if (r?.resp.ok) replace(r.data.message)
  }

  /** Run the one-tap action. */
  async function act(id: string): Promise<ActOutcome> {
    const r = await post('act', id)
    if (!r) return { ok: false, error: 'not available' }
    if (r.data?.message) replace(r.data.message)
    if (!r.resp.ok) return { ok: false, error: String(r.data?.error || 'failed'), reason: r.data?.reason }
    return { ok: true }
  }

  return { messages, unread, unreadBadge, cardMessage, loaded, loading, loadError, refresh, markRead, dismiss, act }
}
