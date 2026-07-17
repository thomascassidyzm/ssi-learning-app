/**
 * useActAs — lets an ssi_admin step into a real persona (teacher / school
 * leader / group admin) and experience the live /schools app exactly as they
 * would, then step back out.
 *
 * How it stays safe and reversible:
 *   - It only sets client-side context: the persona's school role overlay in
 *     useUserRole + the persona's scope in useSchoolContext. The admin's own
 *     learner row and auth session are never touched, so no admin↔persona
 *     link is ever stored.
 *   - Queries still run under the admin's Supabase session (RLS is off; when
 *     it returns, the ssi_admin bypass covers any scope). This is NOT JWT
 *     impersonation — the removed god-mode kind that fought RLS.
 *   - Persisted in sessionStorage, so a reload keeps the act-as within the
 *     tab and it clears automatically when the tab closes.
 */
import { inject, ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useUserRole, type ActAsPersona } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { getSchoolsClient, setSchoolsClient } from '@/composables/schools/client'

// The audit row id for the in-flight view-as session, so exitActAs can close
// it. sessionStorage-backed like the persona itself (ACT_AS_KEY in
// useUserRole.ts) — a reload keeps it, a closed tab loses it (an
// open-ended audit row is a truthful record of "no explicit exit", not a
// bug — see the migration's docstring).
const AUDIT_ID_KEY = 'ssi-acting-as-audit-id'

async function logViewAsStart(persona: ActAsPersona, authToken: string | undefined, schoolId?: string | null): Promise<void> {
  if (!authToken) return
  try {
    const res = await fetch('/api/admin/view-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        action: 'start',
        target_user_id: persona.userId,
        target_role: persona.role,
        target_name: persona.name,
        target_school_id: schoolId ?? null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.id) sessionStorage.setItem(AUDIT_ID_KEY, data.id)
    else if (!res.ok) console.warn('[useActAs] view-as audit start failed:', data?.error || res.status)
  } catch (err) {
    console.warn('[useActAs] view-as audit start threw:', err)
  }
}

async function logViewAsEnd(authToken: string | undefined): Promise<void> {
  let id: string | null = null
  try {
    id = sessionStorage.getItem(AUDIT_ID_KEY)
    sessionStorage.removeItem(AUDIT_ID_KEY)
  } catch {
    // sessionStorage unavailable
  }
  if (!id || !authToken) return
  try {
    const res = await fetch('/api/admin/view-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({ action: 'end', id }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      console.warn('[useActAs] view-as audit end failed:', data?.error || res.status)
    }
  } catch (err) {
    console.warn('[useActAs] view-as audit end threw:', err)
  }
}

export function useActAs() {
  const router = useRouter()
  const role = useUserRole()
  const ctx = useSchoolContext()
  const supabase = inject<Ref<SupabaseClient | null>>('supabase', ref(null))

  function client(): SupabaseClient | undefined {
    if (supabase.value) {
      setSchoolsClient(supabase.value)
      return supabase.value
    }
    try {
      return getSchoolsClient()
    } catch {
      return undefined
    }
  }

  /** Step into a persona and open the live schools dashboard as them. */
  async function actAs(persona: ActAsPersona): Promise<void> {
    if (!role.canActAs.value) return
    role.startActingAs(persona)
    const c = client()
    const token = c ? (await c.auth.getSession()).data.session?.access_token : undefined

    if (persona.role === 'student') {
      // Learners aren't a school role, and the live player must never be
      // driven read-only (no session writes / position changes) — land on
      // the existing admin read-view of their progress instead of /schools.
      // Audit BEFORE navigating, same as every other persona.
      await logViewAsStart(persona, token, null)
      await router.push(`/admin/users/${persona.learnerId}/progress`)
      return
    }

    // Clear any prior context (e.g. a previous persona) before loading.
    ctx.clear()
    await ctx.loadAsPersona(persona.userId, c)
    // Audit BEFORE navigating — the compliance record must exist before the
    // admin can see anything, not as an afterthought.
    await logViewAsStart(persona, token, ctx.currentUser.value?.school_id ?? null)
    await router.push('/schools')
  }

  /** Step back out to the admin's own identity. */
  async function exitActAs(): Promise<void> {
    const c = client()
    const token = c ? (await c.auth.getSession()).data.session?.access_token : undefined
    await logViewAsEnd(token)
    role.stopActingAs()
    ctx.clear()
    await router.push('/admin/access')
  }

  /**
   * Re-prime the schools context after a reload. useUserRole.restoreFromCache
   * already restored the role overlay from sessionStorage (so the router guard
   * works); this refills the matching scope. Call once on app mount.
   */
  async function restoreActAs(): Promise<void> {
    // Make sure the overlay is rehydrated from sessionStorage even if the
    // router guard hasn't run yet on this load.
    role.restoreFromCache()
    const persona = role.actingAs.value
    if (!persona) return
    // The student path never used useSchoolContext (AdminUserProgress.vue
    // manages its own context from the route's :learnerId) — nothing to reprime.
    if (persona.role === 'student') return
    if (ctx.currentUser.value?.user_id === persona.userId) return
    await ctx.loadAsPersona(persona.userId, client())
  }

  return { actAs, exitActAs, restoreActAs }
}
