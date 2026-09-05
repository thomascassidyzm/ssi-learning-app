/**
 * GET /api/admin/test-doors — may this caller use the app's test doors?
 *
 * TOM'S RULING, 2026-08-31: "it could go with account privileges, e.g. for my
 * admin account — also any ssi admins", and — the reason this file exists at all
 * — "a client-side-only admin check is not a permission, it is a suggestion."
 *
 * He is concretely right, and the hole was real. The client's `isSsiAdmin` is
 * read from `useUserRole`, whose `restoreFromCache()` rehydrates `platformRole`
 * straight out of localStorage. Anyone could set that key to
 * `{"platformRole":"ssi_admin"}` and the admin-only Developer section would
 * render for them. So the client's belief about its own role is not a
 * permission; it is a claim, and the claim has to be checked somewhere that the
 * claimant does not control.
 *
 * Here. `verifyAdmin` — the existing helper every other admin route already uses,
 * deliberately not a new flag, not an email list, not a build-time constant —
 * verifies the bearer token and reads `learners.platform_role` under the
 * caller's own RLS. A learner cannot write that row, so they cannot grant
 * themselves this.
 *
 * WHY IT IS NAMED FOR ALL THE DOORS AND NOT FOR ONE. Fourteen test doors in this
 * app are query strings, which means they are invisible to anyone on the
 * installed PWA and simultaneously open to anyone else who knows the string.
 * The answer to both halves is the same privilege gate, so this route answers
 * the general question — "is this account allowed to operate the app's test
 * controls?" — rather than being about the practising switch that prompted it.
 * The next door to move in-app calls this same endpoint.
 *
 * WHAT THIS HONESTLY BUYS, stated rather than oversold. It makes the controls a
 * PERMISSION instead of a SECRET: it cannot be stumbled into, it cannot be
 * shared around as a URL, and it is therefore safe on any environment including
 * production. What it cannot do is stop somebody who already has devtools open
 * on their own session from calling the client function directly — no
 * client-side effect can be defended against that. It does not need to be: the
 * effects behind this gate change nothing on the server and write nothing about
 * anybody's progress. The thing worth preventing is an ordinary learner
 * stumbling into a test control or forging a role to reach one, and that is
 * exactly what this prevents.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  // Without this the native WebView's preflight for the `Authorization`
  // header goes unanswered and the call fails there while working on the web.
  if (applyCors(req, res, { methods: 'GET' })) return

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Never cached — a role can be revoked mid-session (see useAdminGate's
  // periodic re-validation), and a cached 200 would outlive the revocation.
  res.setHeader('Cache-Control', 'no-store')

  const auth = await verifyAdmin(req)
  if ('error' in auth) {
    // 401 unauthenticated / 403 not an admin / 500 verification itself failed.
    // The 500 case is deliberately NOT collapsed into "not allowed": a transient
    // RLS or network blip must not silently look like a demotion, or a real
    // admin loses their controls for the session with no way to tell why.
    return res.status(auth.status).json({ allowed: false, error: auth.error })
  }

  return res.status(200).json({ allowed: true, userId: auth.userId })
}
