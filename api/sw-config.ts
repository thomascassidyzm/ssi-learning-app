/**
 * Service Worker Config API - GET /api/sw-config
 *
 * Remote kill switch for the SW safety system.
 * Clients poll this on load (see useServiceWorkerSafety.ts).
 *
 * Flip via Vercel env vars without a code deploy:
 *   SW_KILL_SWITCH=true   → unregister SW + clear caches on all clients
 *   SW_FORCE_UPDATE=true  → trigger immediate SW update
 *   SW_MESSAGE="..."      → optional message shown in console
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default function handler(
  req: VercelRequest,
  res: VercelResponse
): void {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const killSwitch = (process.env.SW_KILL_SWITCH || '').trim().toLowerCase() === 'true'
  const forceUpdate = (process.env.SW_FORCE_UPDATE || '').trim().toLowerCase() === 'true'
  const message = (process.env.SW_MESSAGE || '').trim() || undefined

  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate')
  res.status(200).json({ killSwitch, forceUpdate, message })
}
