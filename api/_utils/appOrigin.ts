/**
 * getAppOrigin — derive the app origin for a minted link.
 *
 * Links-first (THE-MODEL.md §1.10): the URL is the artifact, the code is
 * internal plumbing. Which means the origin half of that URL is a security
 * decision, not a formatting one — a redeem link is a bearer credential, and
 * whoever controls its origin controls where the holder types their code.
 *
 * AUTH-CORE-08 / INPUT-10 (fixed 2026-08-25): this used to end
 * `if (host) return \`https://${host}\`` — i.e. it pinned the two canonical
 * hosts and then echoed ANY other caller-written `Host` header verbatim into
 * an https:// origin. `Host` is written by the client; a poisoned one pointed
 * a freshly minted invite/redeem URL at an attacker's domain, on a link the
 * legitimate system then emailed out under its own name.
 *
 * It is now an ALLOWLIST with a safe default. Anything unrecognised falls back
 * to production rather than being trusted.
 *
 * Deliberately still allowed, because they are how the team actually tests:
 * every `*.saysomethingin.app` subdomain we own, and this project's Vercel
 * preview aliases, which are namespaced by the team slug
 * (`ssi-learning-app-git-dev-zenjin.vercel.app`, and the per-commit
 * `ssi-learning-app-<hash>-zenjin.vercel.app`). Both halves of that pattern
 * must match — an attacker's own `*.vercel.app` project cannot satisfy the
 * `-zenjin.vercel.app` suffix, and no non-project host satisfies the prefix.
 *
 * Not allowed, and not a regression: bare `localhost`. The port is stripped a
 * line below, so a local dev host already produced the unusable
 * `https://localhost` under the old code — nothing that worked stops working.
 */
import type { VercelRequest } from '@vercel/node'

const PRODUCTION_ORIGIN = 'https://saysomethingin.app'

/** Vercel preview aliases for THIS project only — both ends must match. */
const PREVIEW_PREFIX = 'ssi-learning-app-'
const PREVIEW_SUFFIX = '-zenjin.vercel.app'

function isTrustedHost(host: string): boolean {
  if (host === 'saysomethingin.app') return true
  if (host.endsWith('.saysomethingin.app')) return true
  if (host.startsWith(PREVIEW_PREFIX) && host.endsWith(PREVIEW_SUFFIX)) return true
  return false
}

export function getAppOrigin(req: VercelRequest): string {
  const host = ((req.headers['host'] as string) || '').toLowerCase().replace(/:\d+$/, '')
  if (host === 'saysomethingin.app' || host === 'www.saysomethingin.app') return PRODUCTION_ORIGIN
  if (host === 'staging.saysomethingin.app') return 'https://staging.saysomethingin.app'
  if (isTrustedHost(host)) return `https://${host}`
  return PRODUCTION_ORIGIN
}

/** Redemption path per invite role — leader lands on the /group door (govt_admin invite flow), everyone else on the general /redeem link. */
export function redeemPathForRole(role: string): 'group' | 'redeem' {
  return role === 'leader' ? 'group' : 'redeem'
}
