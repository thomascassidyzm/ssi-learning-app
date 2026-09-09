/**
 * useViewAs — lets an ssi_admin see the product as its users see it: pick a
 * role (learner / teacher / school leader / group leader), optionally a real
 * person for their real school/group/class scope, and the app then RENDERS
 * AND ROUTES as that persona until they step back out.
 *
 * Why it exists at all: it was removed on 2026-07-18 (d49aabf8) as "too
 * complicated", NOT for a security reason — the server harness was kept
 * intact throughout (api/admin/view-as.ts, admin_impersonation_audit,
 * api/_utils/actAsGuard.ts). The cost of the removal was that the founder
 * could no longer check any page as its users see it. This restores the
 * capability on the harness that never went away.
 *
 * How it stays safe and reversible:
 *   - Client-side context ONLY: the persona's role overlay in useUserRole and
 *     the persona's scope in useSchoolContext. The admin's own learner row and
 *     auth session are never touched, and no admin↔persona link is stored.
 *   - NOT JWT impersonation. Queries still run under the ADMIN's own Supabase
 *     session, so this grants not one byte of data an ssi_admin could not
 *     already read. Faking the sessionStorage key as a non-admin therefore
 *     buys nothing: you still see only your own data, with staff chrome that
 *     no server will honour.
 *   - READ-SHAPED. Every write while viewing-as is blocked: the schools
 *     write paths carry `X-Ssi-View-As: 1` (useUserRole.viewAsRequestHeaders)
 *     which api/_utils/actAsGuard.ts rejects with 403, and the UI hides its
 *     write controls behind the existing `isAdminView` provide.
 *   - SERVER-GATED ENTRY. Activation waits for POST /api/admin/view-as
 *     ('start') to return 200. That endpoint is verifyAdmin-guarded, so a
 *     non-admin gets 403 and view-as never turns on for them.
 *   - Persisted in sessionStorage, so a reload keeps it within the tab and it
 *     clears when the tab closes.
 */
import { inject, ref, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useUserRole, type ViewAsPersona } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { getSchoolsClient, setSchoolsClient } from '@/composables/schools/client'

// The audit row id for the in-flight view-as session, so stopViewing can close
// it. sessionStorage-backed like the persona itself — a reload keeps it, a
// closed tab loses it (an open-ended audit row is a truthful record of "no
// explicit exit", not a bug).
const AUDIT_ID_KEY = 'ssi-viewing-as-audit'

/** Surfaced to the picker when the server refuses (403 = not an ssi_admin). */
export const viewAsError = ref<string | null>(null)

/**
 * Ask the server to open an audit session. Returns true only on 200 — this
 * IS the server-side gate on the feature, not just logging: verifyAdmin in
 * api/admin/view-as.ts is what decides whether view-as may start at all.
 */
async function logViewAsStart(
  persona: ViewAsPersona,
  authToken: string | undefined,
  schoolId?: string | null,
): Promise<boolean> {
  if (!authToken) {
    viewAsError.value = 'Sign in as a platform admin to use View as.'
    return false
  }
  try {
    const res = await fetch('/api/admin/view-as', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify({
        action: 'start',
        // Role-only view-as has no person; the audit row still needs a
        // target, so record the role itself as the target.
        target_user_id: persona.userId || `role:${persona.role}`,
        target_role: persona.role,
        target_name: persona.name,
        target_school_id: schoolId ?? null,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.id) {
      sessionStorage.setItem(AUDIT_ID_KEY, data.id)
      return true
    }
    viewAsError.value =
      res.status === 403 || res.status === 401
        ? 'View as is for platform admins only.'
        : `View as could not start: ${data?.error || res.status}`
    return false
  } catch (err) {
    viewAsError.value = 'View as could not start — network error.'
    console.warn('[useViewAs] view-as audit start threw:', err)
    return false
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
      console.warn('[useViewAs] view-as audit end failed:', data?.error || res.status)
    }
  } catch (err) {
    console.warn('[useViewAs] view-as audit end threw:', err)
  }
}

export function useViewAs() {
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

  /** Step into a role/persona and land on the surface that persona lives on. */
  async function viewAs(persona: ViewAsPersona): Promise<void> {
    viewAsError.value = null
    if (!role.canViewAs.value) {
      viewAsError.value = 'View as is for platform admins only.'
      return
    }
    const c = client()
    const token = c ? (await c.auth.getSession()).data.session?.access_token : undefined

    if (persona.role === 'student') {
      // A learner is not a school role: nothing to scope. Audit first, then
      // land on the learner's own home — the app with every staff and admin
      // surface correctly absent.
      if (!(await logViewAsStart(persona, token, null))) return
      role.startViewing(persona)
      ctx.clear()
      await router.push('/')
      return
    }

    // Clear any prior context (e.g. a previous persona) before loading.
    ctx.clear()
    if (persona.userId) await ctx.loadAsPersona(persona.userId, c)
    // Audit BEFORE the overlay goes on — the compliance record, and the
    // server's permission, must both exist before anything is seen.
    if (!(await logViewAsStart(persona, token, ctx.currentUser.value?.school_id ?? null))) {
      ctx.clear()
      return
    }
    role.startViewing(persona)
    await router.push('/schools')
  }

  /** Step back out to the admin's own identity. */
  async function stopViewing(): Promise<void> {
    const c = client()
    const token = c ? (await c.auth.getSession()).data.session?.access_token : undefined
    await logViewAsEnd(token)
    // Drop the overlay BEFORE navigating: /admin/* is guarded on
    // canAccessAdmin, which is false while the overlay is on.
    role.stopViewing()
    ctx.clear()
    viewAsError.value = null
    await router.push('/admin/structure')
  }

  /**
   * Re-prime the schools context after a reload. useUserRole.restoreFromCache
   * already restored the role overlay from sessionStorage (so the router
   * guards work); this refills the matching scope. Called once on app mount.
   */
  async function restoreViewAs(): Promise<void> {
    role.restoreFromCache()
    const persona = role.viewingAs.value
    if (!persona) return
    // Role-only and learner personas carry no foreign scope to reprime.
    if (persona.role === 'student' || !persona.userId) return
    if (ctx.currentUser.value?.user_id === persona.userId) return
    await ctx.loadAsPersona(persona.userId, client())
  }

  return { viewAs, stopViewing, restoreViewAs, viewAsError }
}
