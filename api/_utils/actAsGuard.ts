/**
 * actAsGuard — server-side read-only enforcement for the ssi_admin
 * "View as" feature (useActAs.ts).
 *
 * The client never re-authenticates as the persona — every API call while
 * acting-as still carries the ADMIN's own bearer token (see useActAs.ts's
 * docstring: "queries still run under the admin's Supabase session"). Most
 * write endpoints already reject that admin token naturally, because they
 * authorize via the CALLER's own scope (resolveVisibleScope), and an
 * ssi_admin has no teacher/school-admin scope of their own. The exception
 * is the small set of endpoints that carry a deliberate ssi_admin support
 * bypass (api/teacher/class-teachers.ts, create-class-join-code.ts,
 * create-class-learner.ts) — those bypasses exist for genuine admin support
 * actions and must keep working OUTSIDE act-as, but must never fire WHILE
 * an admin is browsing read-only as a persona.
 *
 * The client sets the `X-Ssi-View-As: 1` header on every request made while
 * isActingAs is true (useUserRole.viewAsRequestHeaders()). Its presence is
 * sufficient to reject — a plain teacher/school-admin session never sends
 * it, so this can never block a real write by a real staff member.
 */

import type { VercelRequest } from '@vercel/node'

export function isViewAsRequest(req: VercelRequest): boolean {
  return req.headers['x-ssi-view-as'] === '1'
}

/** Returns a 403 body if the request must be rejected, else null. */
export function rejectIfViewAs(req: VercelRequest): { error: string; status: number } | null {
  if (!isViewAsRequest(req)) return null
  return { error: 'Read-only while viewing as another user', status: 403 }
}
