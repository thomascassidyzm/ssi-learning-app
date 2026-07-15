/**
 * Shared entitlement-granting helpers.
 *
 * The same "give this learner access" logic is needed by two paths:
 *   - api/code/redeem.ts        (learner typed an entitlement code)
 *   - api/access/claim.ts       (learner's email was on the allowlist)
 *   - api/access/grant-emails.ts (admin pre-grants, applied immediately to
 *                                 existing accounts)
 *
 * Factoring it here keeps the access-type / duration / dashboard-role behaviour
 * identical across all three and avoids drift.
 */

import { recordRoleChange } from './auditRole'

// Loosely typed so the same helper accepts the various service-role clients
// created across the api/ routes without fighting @supabase/supabase-js generics
// (these routes run transpile-only on Vercel; the project gate is the player-vue
// typecheck). Matches the untyped-client pattern used throughout api/.
type ServiceClient = {
  from: (table: string) => any
}

/** Who/how a dashboard-role grant happened, for the audit log. */
export interface GrantAuditCtx {
  actorUserId?: string | null
  source?: 'entitlement-code' | 'email-allowlist'
  codeUsed?: string | null
}

/** Shape of the access being granted — shared by entitlement codes and email grants. */
export interface GrantSpec {
  access_type: string // 'full' | 'courses'
  granted_courses?: string[] | null
  duration_type?: string | null // 'lifetime' | 'time_limited'
  duration_days?: number | null
  grants_platform_role?: string | null
  grants_dashboard_courses?: string[] | null
}

/**
 * Compute the entitlement expiry from a duration spec.
 * Returns null for lifetime (or a missing day count) — same semantics as the
 * original redeemEntitlementCode.
 */
export function computeEntitlementExpiry(spec: GrantSpec): string | null {
  if (spec.duration_type === 'time_limited' && spec.duration_days) {
    const expires = new Date()
    expires.setDate(expires.getDate() + spec.duration_days)
    return expires.toISOString()
  }
  return null
}

/**
 * If the grant carries dashboard (Popty) access, apply platform_role and
 * (optionally) dashboard_courses to the learner. Non-fatal: failures are logged
 * but never thrown, so a transient role-update blip can't undo a granted
 * entitlement. Returns whether the role update actually applied — callers
 * that report redemption success to the user should surface a `false` here
 * rather than silently claiming the dashboard grant took (finding #10,
 * 2026-07-13 audit); returns true when there's nothing to apply (no
 * grants_platform_role on the spec).
 */
export async function applyDashboardRole(
  supabase: ServiceClient,
  learnerId: string,
  spec: GrantSpec,
  audit?: GrantAuditCtx,
): Promise<boolean> {
  if (!spec.grants_platform_role) return true

  // Capture the prior role for the audit (best-effort).
  let oldRole: string | null = null
  try {
    const { data } = await supabase.from('learners').select('platform_role').eq('id', learnerId).single()
    oldRole = data?.platform_role ?? null
  } catch { /* best-effort */ }

  const learnerUpdate: Record<string, unknown> = {
    platform_role: spec.grants_platform_role,
  }
  if (spec.grants_dashboard_courses) {
    learnerUpdate.dashboard_courses = spec.grants_dashboard_courses
  }
  const { error } = await supabase
    .from('learners')
    .update(learnerUpdate)
    .eq('id', learnerId)
  if (error) {
    console.error('[entitlementGrant] Failed to update platform_role:', error)
    return false
  }
  console.log(
    '[entitlementGrant] Granted dashboard access:',
    spec.grants_platform_role,
    'courses:',
    spec.grants_dashboard_courses,
  )
  await recordRoleChange(supabase, {
    actorUserId: audit?.actorUserId ?? null,
    targetLearnerId: learnerId,
    field: 'platform_role',
    oldValue: oldRole,
    newValue: spec.grants_platform_role,
    source: audit?.source ?? 'entitlement-code',
    codeUsed: audit?.codeUsed ?? null,
    detail: spec.grants_dashboard_courses ? { dashboard_courses: spec.grants_dashboard_courses } : null,
  })
  return true
}
