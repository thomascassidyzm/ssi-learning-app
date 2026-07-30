/**
 * useFamilyManagement — the owner-facing family page's data layer
 * (FAMILY-PLAN-SPEC.md §4). Thin wrapper over /api/family/* — every write
 * refreshes the list from the server rather than optimistically patching
 * local state, so the parent always sees the server's truth (seat cap races,
 * immediate-attach, etc. all resolve server-side).
 */

import { ref, inject, type Ref } from 'vue'

export interface FamilyMember {
  id: string
  status: 'invited' | 'active' | 'removed'
  is_child_account: boolean
  invited_email: string | null
  display_name: string | null
  created_at: string
}

export interface FamilyState {
  isOwner: boolean
  hasFamilyPlan: boolean
  seatsUsed: number
  seatCap: number
  members: FamilyMember[]
}

const EMPTY_STATE: FamilyState = { isOwner: false, hasFamilyPlan: false, seatsUsed: 0, seatCap: 6, members: [] }

export function useFamilyManagement() {
  const supabase = inject<Ref<any>>('supabase', ref(null))

  const state = ref<FamilyState>({ ...EMPTY_STATE })
  const isLoading = ref(false)
  const error = ref('')
  /** Set once, right after a create-child call, so the UI can show the QR/link before the caller navigates away. Cleared on next load(). */
  const lastSignInLink = ref<string | null>(null)

  async function authHeaders(): Promise<Record<string, string>> {
    if (!supabase.value) return {}
    const { data: { session } } = await supabase.value.auth.getSession()
    const token = session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function load(): Promise<void> {
    isLoading.value = true
    error.value = ''
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/family', { headers })
      if (!res.ok) throw new Error('Failed to load family')
      state.value = await res.json()
    } catch (e: any) {
      error.value = e?.message || 'Failed to load family'
    } finally {
      isLoading.value = false
    }
  }

  async function inviteByEmail(email: string): Promise<{ ok: boolean; error?: string }> {
    error.value = ''
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/family/invite', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        error.value = body?.error || 'Failed to invite'
        return { ok: false, error: error.value }
      }
      await load()
      return { ok: true }
    } catch (e: any) {
      error.value = e?.message || 'Failed to invite'
      return { ok: false, error: error.value }
    }
  }

  async function addChild(displayName: string): Promise<{ ok: boolean; signInLink?: string | null; error?: string }> {
    error.value = ''
    lastSignInLink.value = null
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/family/create-child', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        error.value = body?.error || 'Failed to add child'
        return { ok: false, error: error.value }
      }
      lastSignInLink.value = body.signInLink ?? null
      await load()
      return { ok: true, signInLink: body.signInLink ?? null }
    } catch (e: any) {
      error.value = e?.message || 'Failed to add child'
      return { ok: false, error: error.value }
    }
  }

  async function getSignInLink(memberId: string): Promise<{ ok: boolean; signInLink?: string; error?: string }> {
    error.value = ''
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/family/signin-link', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        error.value = body?.error || 'Failed to get sign-in link'
        return { ok: false, error: error.value }
      }
      return { ok: true, signInLink: body.signInLink }
    } catch (e: any) {
      error.value = e?.message || 'Failed to get sign-in link'
      return { ok: false, error: error.value }
    }
  }

  async function removeMember(memberId: string): Promise<{ ok: boolean; error?: string }> {
    error.value = ''
    try {
      const headers = await authHeaders()
      const res = await fetch('/api/family/remove', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        error.value = body?.error || 'Failed to remove member'
        return { ok: false, error: error.value }
      }
      await load()
      return { ok: true }
    } catch (e: any) {
      error.value = e?.message || 'Failed to remove member'
      return { ok: false, error: error.value }
    }
  }

  return {
    state,
    isLoading,
    error,
    lastSignInLink,
    load,
    inviteByEmail,
    addChild,
    getSignInLink,
    removeMember,
  }
}
