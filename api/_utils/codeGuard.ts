/**
 * Force any privileged code (one that grants admin / tester / a platform role)
 * to be a BOUNDED bearer token: it must expire, and it must have a use cap.
 *
 * Applies safe defaults when the caller omits them and caps over-broad values,
 * so a privileged code can never again be unlimited-use + never-expiring (the
 * SSI-GOD-2026 class of hole). Non-privileged onboarding codes are untouched.
 */

export interface BoundedLimits {
  expires_at: string
  max_uses: number
}

const DAY_MS = 86400 * 1000
const DEFAULT_EXPIRY_DAYS = 7
const MAX_EXPIRY_DAYS = 90
const DEFAULT_MAX_USES = 1
const MAX_PRIVILEGED_USES = 50

export function boundPrivilegedCodeLimits(
  expiresAtInput: unknown,
  maxUsesInput: unknown,
): BoundedLimits {
  const now = Date.now()

  // max_uses → positive integer; default 1; hard cap 50.
  let maxUses = typeof maxUsesInput === 'number' ? Math.floor(maxUsesInput) : NaN
  if (!Number.isFinite(maxUses) || maxUses < 1) maxUses = DEFAULT_MAX_USES
  if (maxUses > MAX_PRIVILEGED_USES) maxUses = MAX_PRIVILEGED_USES

  // expires_at → valid future date; default now+7d; hard cap now+90d.
  let expiresMs = NaN
  if (typeof expiresAtInput === 'string') {
    const parsed = Date.parse(expiresAtInput)
    if (Number.isFinite(parsed)) expiresMs = parsed
  }
  if (!Number.isFinite(expiresMs) || expiresMs <= now) expiresMs = now + DEFAULT_EXPIRY_DAYS * DAY_MS
  if (expiresMs > now + MAX_EXPIRY_DAYS * DAY_MS) expiresMs = now + MAX_EXPIRY_DAYS * DAY_MS

  return { expires_at: new Date(expiresMs).toISOString(), max_uses: maxUses }
}
