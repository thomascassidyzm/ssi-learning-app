/**
 * useAdminGate — the ONE reactive access gate every admin/methodology
 * surface must call.
 *
 * Doctrine (founder ruling, 2026-07-19 — "security lives on the server, per
 * request; a browser timer is UX, not enforcement"):
 *
 *   THE SERVER IS THE ENFORCEMENT. Every endpoint that reads or writes
 *   org/admin data re-verifies the caller's role/scope on EVERY request —
 *   verifyAdmin / an inline platform_role check (admin endpoints),
 *   resolveVisibleScope (school endpoints), or resolveGroupTreeCaller +
 *   callerCanSeeGroup (the node-home endpoint behind the /admin/schools|
 *   groups|classes/:id read-views). A de-platformed ssi_admin's requests
 *   therefore 403 the instant they're made, regardless of any client state.
 *   The /admin/users/:learnerId/progress read-view reads learner rows under
 *   own-row RLS (+ admin-bypass), also enforced server-side per request.
 *   (Full server-side audit: docs/trinity/admin.md — 0 endpoint gaps.)
 *
 * So this gate is a UX affordance, not a security control: it keeps a
 * revoked admin from staring at a dead shell whose every request 403s, by
 * bouncing them to `/`. It re-validates on NAVIGATION (each route change
 * re-runs the injected auth's refreshRole() DB re-fetch) — NOT on a timer.
 * There is deliberately NO interval and NO tab-refocus re-check: those were
 * the last idle network chatter on admin surfaces, and since the server
 * enforces per request they bought no security, only ~1 request/min of noise
 * (founder: "are we sure we need that?" — we are not; removed). A mid-session
 * downgrade is caught on the admin's next navigation or reload; in the idle
 * gap between, every server request they make already 403s.
 *
 * Two jobs remain, both about the SHELL, not data access:
 * 1. Gate the standalone read-view routes (/admin/schools|groups|classes/:id,
 *    /admin/users/:learnerId/progress) — siblings of AdminContainer's
 *    children, so they'd otherwise render with no reactive gate.
 * 2. Bounce on a mid-session role change discovered by navigation revalidation.
 *
 * Deny-not-defer: callers show a loading state while `isCheckingAccess`, must
 * render NOTHING (and start no data fetch) while `isCheckingAccess ||
 * isDenied`, and only proceed once both are false.
 */

import { computed, inject, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'

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

/**
 * Where a denied visitor goes.
 *
 * A signed-in non-admin is a learner who tapped an admin link: the player at
 * '/' is the right home for them, and asking them to sign in again would be
 * nonsense — they already are.
 *
 * A GUEST is a different person entirely: almost always the operator opening
 * an /admin deep link in a browser that has no session — a phone tapping a
 * link out of a chat app, an in-app webview with its own empty storage, a
 * fresh browser. Dropping them into the player looked exactly like a broken
 * link (owner, 2026-08-19: "I can't see those links, they're redirecting"),
 * because nothing on that screen says "you are signed out" or offers a way
 * in. So send them to the one surface that already carries an inline email
 * sign-in — /schools — and hand it the destination as `next`, which
 * SchoolsContainer replays once the role resolves to ssi_admin. The deep link
 * survives the sign-in instead of being silently eaten.
 *
 * Not a security decision: the server re-verifies every admin request
 * regardless (see the doctrine block above). This is purely about a guest
 * being able to SEE where the door is.
 */
export function deniedDestination(status: string, fullPath: string) {
  if (status !== 'guest') return '/'
  return { path: '/schools', query: { next: fullPath } }
}

export function useAdminGate() {
  const router = useRouter()
  const route = useRoute()
  const { isCheckingAccess, isDenied } = useAdminAccessState()
  const { status } = useResolvedSession()
  const auth = inject<InjectedAuth | null>('auth', null)

  watch(
    isDenied,
    (deny) => {
      if (deny) router.replace(deniedDestination(status.value, route.fullPath))
    },
    { immediate: true },
  )

  // Revalidate the caller's role on NAVIGATION only — each route change (incl.
  // the initial mount, immediate:true) re-runs the real DB re-fetch, so a
  // mid-session downgrade is discovered the next time the admin moves. No
  // interval, no tab-refocus timer: the server enforces per request, so those
  // bought no security — only idle chatter. An explicit refresh navigates /
  // reloads, which re-runs this too.
  watch(
    () => route.fullPath,
    () => {
      void auth?.refreshRole?.()
    },
    { immediate: true },
  )

  return { isCheckingAccess, isDenied }
}
