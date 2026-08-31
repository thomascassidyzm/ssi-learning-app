/**
 * useTestDoorPermission — the server's answer to "may I operate the test doors?"
 *
 * Tom, 2026-08-31: "a client-side-only admin check is not a permission, it is a
 * suggestion." The suggestion in question is `useUserRole`'s `isSsiAdmin`, which
 * is rehydrated from localStorage by `restoreFromCache()` — so a learner could
 * write `{"platformRole":"ssi_admin"}` into their own browser storage and the
 * admin-gated Developer section would render. This composable replaces that
 * belief with a fact from `/api/admin/test-doors`, which verifies the bearer
 * token and reads `learners.platform_role` under the caller's own RLS.
 *
 * THE CACHE IS IN MEMORY AND THAT IS THE ENTIRE POINT. Persisting the grant to
 * localStorage would put the answer straight back under the control of the
 * person being checked, which is the hole this closes. One request per app run
 * is cheap; a forgeable grant is not.
 *
 * A FAILED CHECK IS NOT A DENIAL. 401 and 403 are answers — no. A network
 * failure or a 500 is the question not having been put, and it leaves the grant
 * exactly where it was rather than revoking it, so a wobble does not take an
 * admin's controls away mid-session. Nothing here ever grants on failure.
 *
 * Named for every door, not for the one that prompted it: fourteen test doors in
 * this app are query strings, unreachable on an installed PWA and open to anyone
 * else who knows the string. The same gate is the answer for all of them, and
 * the next one to move in-app calls this same composable.
 */

import { ref, readonly } from 'vue'

/** Server-confirmed. Never seeded from storage, never persisted to it. */
const allowed = ref(false)
/** True once the server has actually answered, either way. */
const checked = ref(false)
let inflight: Promise<boolean> | null = null

/**
 * Ask the server. De-duped, so several surfaces mounting at once cost one
 * request. Pass a token getter rather than a client so this stays usable from
 * anywhere without dragging a Supabase instance through the call.
 */
async function check(getToken: () => Promise<string | null>): Promise<boolean> {
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const token = await getToken()
      // No session at all is a definitive no, and needs no round trip.
      if (!token) {
        allowed.value = false
        checked.value = true
        return false
      }

      const res = await fetch('/api/admin/test-doors', {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (res.status === 200) {
        allowed.value = true
        checked.value = true
        return true
      }
      if (res.status === 401 || res.status === 403) {
        allowed.value = false
        checked.value = true
        return false
      }

      // 5xx — the question did not get put. Leave the grant as it stands and
      // let the next call try again.
      return allowed.value
    } catch {
      // Offline or transport failure — likewise not an answer.
      return allowed.value
    } finally {
      inflight = null
    }
  })()

  return inflight
}

/** Sign-out and test teardown. */
function reset(): void {
  allowed.value = false
  checked.value = false
  inflight = null
}

export function useTestDoorPermission() {
  return {
    allowed: readonly(allowed),
    checked: readonly(checked),
    check,
    reset,
  }
}
