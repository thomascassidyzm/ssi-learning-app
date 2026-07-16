/**
 * useResolvedSession — the ONE shared "is identity known yet" gate.
 *
 * Kills the async user/role race bug class: router guards used to read only
 * the synchronous localStorage role cache (empty/stale on a fresh browser —
 * a minted sign-in link, a deep link, a first visit), and schools/admin data
 * composables started fetching (or rendered an empty-state) before auth had
 * actually resolved who the user is. "Loading" and "empty" were the same
 * falsy value everywhere.
 *
 * useAuth() is the sole writer, via resolve() — called once per identity
 * change (initial boot, sign-in, sign-out) after the learner row + role are
 * known (or definitively absent — a guest). Everything downstream — router
 * guards (which run with no component/injection context, so they can't reach
 * useAuth()'s injected instance), schools/admin composables, and views —
 * reads this module-level singleton directly, the same reachable-from-
 * anywhere shape as useUserRole/useSchoolContext.
 *
 * Deliberately doesn't duplicate role/user state: it's a readiness signal
 * layered on top of useUserRole's existing state, not a second copy of it.
 */

import { ref, computed, watch } from 'vue'
import { useUserRole } from '@/composables/useUserRole'

export type SessionStatus = 'pending' | 'authenticated' | 'guest'

const status = ref<SessionStatus>('pending')

let waiters: Array<() => void> = []

const { isInitialized: roleInitialized } = useUserRole()

// A 'guest' has nothing further to wait for. An 'authenticated' session is
// only actually resolved once the role row has loaded too — useAuth's
// ensureLearnerExists() sets both together on the happy path, but gating on
// roleInitialized here as well means the promise/computed stay correct even
// if those two ever fall out of lockstep (e.g. a future caller that awaits
// resolve() before the role sync completes).
const isResolved = computed(
  () => status.value === 'guest' || (status.value === 'authenticated' && roleInitialized.value),
)

function flush(): void {
  const pending = waiters
  waiters = []
  pending.forEach((fn) => fn())
}

/** useAuth() calls this once identity is known: authenticated or guest. */
function resolve(authenticated: boolean): void {
  status.value = authenticated ? 'authenticated' : 'guest'
  if (isResolved.value) flush()
}

// Covers the case where resolve('authenticated') and the role sync don't
// land in the same tick — flush any waiters the moment the role catches up.
watch(roleInitialized, () => {
  if (isResolved.value) flush()
})

/** Resolves once identity is known. Resolves immediately if already known. */
function whenResolved(): Promise<void> {
  if (isResolved.value) return Promise.resolve()
  return new Promise((res) => waiters.push(res))
}

/** Sign-out / test isolation: return the gate to its pre-boot pending state. */
function reset(): void {
  status.value = 'pending'
  waiters = []
}

export function useResolvedSession() {
  return {
    status,
    isResolved,
    resolve,
    whenResolved,
    reset,
  }
}
