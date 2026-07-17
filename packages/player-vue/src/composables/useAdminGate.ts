/**
 * useAdminGate — the ONE reactive access gate every admin/methodology
 * surface must call.
 *
 * Trinity audit (docs/trinity/admin.md) found two holes in how admin access
 * was actually enforced:
 *
 * 1. The top-level router guard (router/index.ts beforeEach) DEFERS rather
 *    than denies on an unresolved role cache — correct, it avoids bouncing
 *    an about-to-resolve admin. But AdminContainer's own reactive gate was
 *    the thing that turned that deferral into an eventual deny for a real
 *    non-admin. The standalone read-view routes — /admin/schools/:id,
 *    /admin/groups/:id, /admin/classes/:id, /admin/users/:learnerId/progress
 *    — are siblings of AdminContainer's children, not nested inside it, so
 *    they had NO gate of their own: a cold-cache non-admin deep link fired
 *    the scoped data query and could render another school/group's live
 *    data before the (nonexistent) correction ever landed. The org tables
 *    these query (schools/classes/groups/…) are RLS-off by design — this
 *    UI-level gate IS the enforcement, not a redundant belt-and-braces.
 *
 * 2. useUserRole's role refs are set ONCE at sign-in (initialize()) and
 *    never re-polled. AdminContainer's `watch(isDenied)` is reactive, but
 *    nothing ever changed platformRole again — so a de-platformed ssi_admin
 *    kept full admin UI, on EVERY admin screen including the correctly
 *    gated ones, until their next reload/sign-out.
 *
 * This composable generalises AdminContainer's original gate to every admin
 * surface (closing #1) and adds periodic + tab-refocus re-validation via the
 * injected auth's refreshRole() — a real DB re-fetch, same one used after
 * invite-code redemption — so a mid-session downgrade revokes access live
 * (closing #2). Deny-not-defer: callers show a loading state while
 * `isCheckingAccess`, must render NOTHING (and start no data fetch) while
 * `isCheckingAccess || isDenied`, and only proceed once both are false.
 */

import { computed, inject, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'

// Cheap re-validation cadence — a real DB round-trip, not a subscription, so
// this stays a plain poll rather than new server/realtime infrastructure.
const REVALIDATE_INTERVAL_MS = 60_000

/**
 * The pure access-state computeds — no router/lifecycle side effects, so
 * this half can be exercised directly in tests without mounting a
 * component. Mirrors AdminContainer's original knowsAnswer/isCheckingAccess/
 * isDenied shape exactly.
 */
export function useAdminAccessState() {
  const { canAccessAdmin, isInitialized, restoreFromCache } = useUserRole()
  restoreFromCache()
  const { isResolved } = useResolvedSession()
  const knowsAnswer = computed(() => isInitialized.value || isResolved.value)
  const isCheckingAccess = computed(() => !knowsAnswer.value)
  const isDenied = computed(() => knowsAnswer.value && !canAccessAdmin.value)
  return { isCheckingAccess, isDenied }
}

interface InjectedAuth {
  refreshRole?: () => Promise<void>
}

export function useAdminGate() {
  const router = useRouter()
  const { isCheckingAccess, isDenied } = useAdminAccessState()
  const auth = inject<InjectedAuth | null>('auth', null)

  watch(
    isDenied,
    (deny) => {
      if (deny) router.replace('/')
    },
    { immediate: true },
  )

  function revalidate(): void {
    void auth?.refreshRole?.()
  }

  function handleVisibility(): void {
    if (document.visibilityState === 'visible') revalidate()
  }

  let intervalId: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    intervalId = setInterval(revalidate, REVALIDATE_INTERVAL_MS)
    document.addEventListener('visibilitychange', handleVisibility)
  })
  onUnmounted(() => {
    if (intervalId !== undefined) clearInterval(intervalId)
    document.removeEventListener('visibilitychange', handleVisibility)
  })

  return { isCheckingAccess, isDenied }
}
