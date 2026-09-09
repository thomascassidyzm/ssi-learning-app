/**
 * viewAsFetchGuard — makes view-as READ-SHAPED structurally, not by discipline.
 *
 * While an ssi_admin is viewing-as, every request still carries the ADMIN's own
 * token (see useActAs.ts). Two things follow, and this one wrapper handles both:
 *
 *  1. Direct Supabase REST WRITES (POST/PATCH/PUT/DELETE on /rest/v1/<table>)
 *     would execute as the admin — a real write, attributed to the wrong
 *     person, from a screen the admin is only supposed to be LOOKING at. They
 *     are refused here with a synthetic 403, before they leave the browser.
 *     RPC (/rest/v1/rpc/) is allowed: it is overwhelmingly the read path, and
 *     blocking it would break pages that only display.
 *
 *  2. Our own /api/* calls get `X-Ssi-View-As: 1`, which api/_utils/actAsGuard.ts
 *     rejects on the endpoints that carry a deliberate ssi_admin support bypass
 *     (class-teachers, create-class-join-code, create-class-learner). A real
 *     teacher session never sends the header, so no genuine staff write is ever
 *     affected.
 *
 * Exempt in both directions: GoTrue (/auth/v1/ — the session must still be able
 * to refresh, or the admin is logged out mid-look) and the view-as audit
 * endpoint itself (which has to be able to close its own session).
 *
 * Installed once from App.vue. When view-as is off this is a straight
 * pass-through with a single boolean check.
 */
import { useUserRole } from '@/composables/useUserRole'

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
let installed = false

/** Exported for the unit test — the whole decision, with no fetch involved. */
export function viewAsRequestDecision(
  url: string,
  method: string,
): 'pass' | 'tag' | 'block' {
  const m = method.toUpperCase()
  // GoTrue session handling and the audit endpoint always pass untouched.
  if (url.includes('/auth/v1/')) return 'pass'
  if (url.includes('/api/admin/view-as')) return 'pass'
  if (!WRITE_METHODS.has(m)) return url.includes('/api/') ? 'tag' : 'pass'
  // Supabase REST table write — refuse. RPC is the read path, let it through.
  if (url.includes('/rest/v1/') && !url.includes('/rest/v1/rpc/')) return 'block'
  if (url.includes('/api/')) return 'tag'
  return 'pass'
}

export function installViewAsFetchGuard(): void {
  if (installed || typeof window === 'undefined' || !window.fetch) return
  installed = true
  const original = window.fetch.bind(window)
  const { isActingAs } = useUserRole()

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!isActingAs.value) return original(input, init)

    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
    const decision = viewAsRequestDecision(url, method)

    if (decision === 'block') {
      console.warn('[view-as] write blocked (read-only while viewing as):', method, url)
      return new Response(
        JSON.stringify({ error: 'Read-only while viewing as another user' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      )
    }
    if (decision === 'tag') {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      )
      headers.set('X-Ssi-View-As', '1')
      return original(input, { ...init, headers })
    }
    return original(input, init)
  }
}
