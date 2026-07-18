/**
 * getAppOrigin — derive the app origin from the request, never a
 * client-supplied value (same pattern as api/admin/create-signin-link.ts
 * and api/groups/[id]/demo-mint.ts). Links-first (THE-MODEL.md §1.10): the
 * URL is the artifact, the code is internal plumbing.
 */
import type { VercelRequest } from '@vercel/node'

export function getAppOrigin(req: VercelRequest): string {
  const host = ((req.headers['host'] as string) || '').toLowerCase().replace(/:\d+$/, '')
  if (host === 'saysomethingin.app' || host === 'www.saysomethingin.app') return 'https://saysomethingin.app'
  if (host === 'staging.saysomethingin.app') return 'https://staging.saysomethingin.app'
  if (host) return `https://${host}`
  return 'https://saysomethingin.app'
}

/** Redemption path per invite role — leader lands on the /group door (govt_admin invite flow), everyone else on the general /redeem link. */
export function redeemPathForRole(role: string): 'group' | 'redeem' {
  return role === 'leader' ? 'group' : 'redeem'
}
