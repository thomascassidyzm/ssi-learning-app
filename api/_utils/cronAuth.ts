/**
 * Cron request authentication (SEC25 INPUT-12).
 *
 * Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. Two properties the
 * hand-rolled `if (cronSecret && authHeader !== \`Bearer ${cronSecret}\`)`
 * checks did not have:
 *
 *  1. CONSTANT-TIME comparison. A plain `!==` on a secret leaks its prefix
 *     through timing. Cheap to fix, so there is no reason not to.
 *  2. FAIL CLOSED ON EVERY DEPLOYED ENVIRONMENT, not just production. The old
 *     guard skipped authentication entirely whenever CRON_SECRET was unset and
 *     VERCEL_ENV wasn't exactly 'production' — so an unconfigured preview or a
 *     self-hosted deployment exposed the job to anyone who could reach the URL.
 *     Anything with VERCEL_ENV set (preview, production, …) or NODE_ENV
 *     production is deployed and must carry the secret. Only a local run with
 *     no CRON_SECRET configured is allowed through, with a warning.
 */
import { timingSafeEqual } from 'node:crypto'

/** Constant-time `authHeader === "Bearer <secret>"`. */
export function cronBearerMatches(authHeader: string, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8')
  const got = Buffer.from(authHeader || '', 'utf8')
  if (got.length !== expected.length) {
    // Compare something of equal length anyway so the mismatch path costs the
    // same as the match path; the length itself is not the secret.
    timingSafeEqual(expected, expected)
    return false
  }
  return timingSafeEqual(got, expected)
}

/** True for any environment that is deployed rather than a developer's laptop. */
export function isDeployedEnvironment(): boolean {
  return Boolean((process.env.VERCEL_ENV || '').trim()) || process.env.NODE_ENV === 'production'
}

export interface CronAuthResult {
  ok: boolean
  /** HTTP status to return when `ok` is false. */
  status?: number
  error?: string
  /** Set when the request was allowed through un-authenticated (local only). */
  warning?: string
}

export function checkCronAuth(authHeader: string, secret: string): CronAuthResult {
  const deployed = isDeployedEnvironment()
  if (!secret) {
    if (deployed) {
      return { ok: false, status: 500, error: 'CRON_SECRET not configured' }
    }
    return { ok: true, warning: 'CRON_SECRET not configured — allowed in a local run only' }
  }
  if (cronBearerMatches(authHeader, secret)) return { ok: true }
  if (deployed) return { ok: false, status: 401, error: 'Unauthorized' }
  return { ok: true, warning: 'CRON_SECRET mismatch — allowed in a local run only' }
}
