/**
 * SSi Family membership helpers — FAMILY-PLAN-SPEC.md §1, §4.
 *
 * Shared by every /api/family/* endpoint plus the claim-on-signin fold-in
 * (api/access/claim.ts). Deliberately dumb: family_members is RLS-on-no-
 * policies (service-role-only), so all authz here is server-mediated —
 * "is this my row?" belongs to endpoints, not policies (CLAUDE.md RLS
 * doctrine rule 1).
 */

/** Up to 6 learner accounts INCLUDING the payer (D1, confirmed 2026-07-10). */
export const FAMILY_SEAT_CAP = 6

// Loosely typed service client, matching the rest of api/_utils/*.ts.
type ServiceClient = { from: (table: string) => any; auth: any }

export interface FamilyMemberRow {
  id: string
  owner_learner_id: string
  member_learner_id: string | null
  invited_email: string | null
  is_child_account: boolean
  status: 'invited' | 'active' | 'removed'
  created_at: string
  updated_at: string
  removed_at: string | null
}

/** Resolve the learners.id for an auth user id. Null if no learner row yet. */
export async function resolveLearnerId(
  supabase: ServiceClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase.from('learners').select('id').eq('user_id', userId).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/** Live (not-removed) rows for a family, whatever their invited/active status. */
export async function liveFamilyRows(
  supabase: ServiceClient,
  ownerLearnerId: string,
): Promise<FamilyMemberRow[]> {
  const { data } = await supabase
    .from('family_members')
    .select('*')
    .eq('owner_learner_id', ownerLearnerId)
    .is('removed_at', null)
  return (data as FamilyMemberRow[] | null) ?? []
}

/**
 * Seats currently used: 1 (the owner) + every live invited/active member.
 * 'invited' counts — an unclaimed invite reserves a seat, matching the
 * spec's own worked example ("5 seats used of six" with one still pending).
 */
export async function countUsedSeats(
  supabase: ServiceClient,
  ownerLearnerId: string,
): Promise<number> {
  return 1 + (await liveFamilyRows(supabase, ownerLearnerId)).length
}

/** True if this learner is already a live member of ANY family (self or other) — no silent steal. */
export async function isInAnyLiveFamily(
  supabase: ServiceClient,
  learnerId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('family_members')
    .select('id')
    .eq('member_learner_id', learnerId)
    .is('removed_at', null)
    .maybeSingle()
  return !!data
}

/**
 * Attach every still-pending invite for `normalizedEmail` to `learnerId` —
 * the shared core of both the immediate-apply-at-invite-time path
 * (grant-emails.ts pattern) and the claim-on-next-signin path
 * (access/claim.ts). Idempotent; skips (does not attach) when:
 *   - the seat cap would be exceeded (belt + braces against racing invites)
 *   - the learner is already a live member of ANY family (no silent steal —
 *     the invite is left pending; the owner's page shows it as still
 *     invited rather than quietly stealing someone else's member)
 * Returns how many invites were actually attached (0 or 1 in practice — the
 * invite_dedupe unique index means at most one live invite per owner+email,
 * but a learner could theoretically hold pending invites from >1 owner).
 */
export async function attachPendingInvitesForEmail(
  supabase: ServiceClient,
  learnerId: string,
  normalizedEmail: string,
): Promise<{ attached: number }> {
  const { data: pending } = await supabase
    .from('family_members')
    .select('id, owner_learner_id')
    .eq('invited_email', normalizedEmail)
    .eq('status', 'invited')
    .is('removed_at', null)

  if (!pending || pending.length === 0) return { attached: 0 }

  // Already claimed elsewhere → leave every pending invite untouched, no steal.
  if (await isInAnyLiveFamily(supabase, learnerId)) return { attached: 0 }

  let attached = 0
  for (const invite of pending as Array<{ id: string; owner_learner_id: string }>) {
    // Belt + braces: re-check the seat cap fresh for each owner right before
    // attaching (the row being claimed is already counted as a used seat, so
    // this only ever blocks a genuine race-created overflow, never the
    // ordinary claim itself).
    const usedSeats = await countUsedSeats(supabase, invite.owner_learner_id)
    if (usedSeats > FAMILY_SEAT_CAP) continue

    const { error } = await supabase
      .from('family_members')
      .update({ member_learner_id: learnerId, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', invite.id)
      .eq('status', 'invited') // idempotency: no-op if another request already claimed it

    if (!error) attached += 1
    // A 23505 on family_members_one_family here means a concurrent claim won
    // the race for this learner — safe to ignore, not a failure.
  }

  return { attached }
}
