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
    // BORN EXCLUDED, the other half of the fix landed in api/code/redeem.ts.
    // That one covers invite codes; this is the path an ENTITLEMENT code takes
    // when it grants dashboard access, and it grants exactly the same staff
    // roles — ssi_admin, tester, popty_user, the only three the column allows.
    // Staff and QA are not real learners in any number we report, and the flag
    // rides with the role so exclusion is a property of granting privilege
    // rather than of somebody remembering a back-fill.
    //
    // A GIFT does not come through here: this function returns at the top when
    // there is no grants_platform_role, so a comped learner never acquires the
    // flag. Free is not fake (Tom's ruling, 2026-09-10).
    is_internal: true,
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

// ============================================================================
// GIFTING — a real person whom billing must not expect money from
// ============================================================================

/**
 * The shape of a gift. Deliberately the same four fields
 * api/admin/grant-entitlement.ts has always taken, because a gift IS an
 * admin-granted entitlement — Tom's ruling of 2026-09-10 is that gifting needs
 * no new status, only the entitlement machinery that already exists.
 */
export interface GiftSpec {
  access_type: 'full' | 'courses'
  granted_courses?: string[] | null
  duration_type?: 'lifetime' | 'time_limited' | null
  duration_days?: number | null
}

export interface GiftAuditCtx {
  actorUserId?: string | null
  source?: 'grant-entitlement' | 'mint-learner'
}

/** Reject a malformed gift before it reaches the database. Returns null when fine. */
export function validateGift(gift: GiftSpec | null | undefined): string | null {
  if (!gift) return 'gift is required'
  if (!gift.access_type || !['full', 'courses'].includes(gift.access_type)) {
    return 'Invalid access_type'
  }
  if (gift.access_type === 'courses' && (!Array.isArray(gift.granted_courses) || gift.granted_courses.length === 0)) {
    return 'granted_courses required for "courses" access type'
  }
  if (gift.duration_type && !['lifetime', 'time_limited'].includes(gift.duration_type)) {
    return 'Invalid duration_type'
  }
  return null
}

export type GiftOutcome = { ok: true; entitlement: unknown } | { ok: false; detail?: string }

/**
 * Write the gift. One writer for both doors — api/admin/grant-entitlement.ts
 * gifting somebody who already exists, and mintPerson() gifting somebody at
 * birth — so the row they produce cannot drift apart.
 *
 * The gift also leaves a record. `role_change_audit` is the estate's existing
 * "who did what to whom" table and it already carries a `detail` jsonb, so the
 * gift needs no table of its own: field `entitlement`, new value the access
 * type, source naming the door. That row is what lets somebody later ask who
 * comped a particular learner, which the cohort read alone cannot answer.
 *
 * The audit is best-effort inside recordRoleChange, exactly as every other
 * privilege change on this estate is: a logging blip must never cost the
 * learner the access they were just given.
 */
export async function grantGiftEntitlement(
  supabase: ServiceClient,
  learnerId: string,
  gift: GiftSpec,
  audit?: GiftAuditCtx,
): Promise<GiftOutcome> {
  const expires_at = computeEntitlementExpiry({
    access_type: gift.access_type,
    duration_type: gift.duration_type ?? 'lifetime',
    duration_days: gift.duration_days ?? null,
  })

  const { data, error } = await supabase
    .from('user_entitlements')
    .insert({
      learner_id: learnerId,
      entitlement_code_id: null,
      access_type: gift.access_type,
      granted_courses: gift.access_type === 'courses' ? gift.granted_courses ?? null : null,
      expires_at,
    })
    .select()
    .single()

  if (error) {
    console.error('[entitlementGrant] gift insert failed:', error.message)
    return { ok: false, detail: error.message }
  }

  await recordRoleChange(supabase, {
    actorUserId: audit?.actorUserId ?? null,
    targetLearnerId: learnerId,
    field: 'entitlement',
    oldValue: null,
    newValue: gift.access_type,
    source: audit?.source ?? 'grant-entitlement',
    detail: {
      granted_courses: gift.access_type === 'courses' ? gift.granted_courses ?? null : null,
      expires_at,
    },
  })

  return { ok: true, entitlement: data }
}
