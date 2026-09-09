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
    // Clear any prior context (e.g. a previous persona) before loading.
    ctx.clear()
    await ctx.loadAsPersona(persona.userId, client())
    await router.push('/schools')
  }

  /** Step back out to the admin's own identity. */
  async function exitActAs(): Promise<void> {
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
    if (ctx.currentUser.value?.user_id === persona.userId) return
    await ctx.loadAsPersona(persona.userId, client())
  }

  return { actAs, exitActAs, restoreActAs }
}
