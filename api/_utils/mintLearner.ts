/**
 * Minting a learner by hand — api/_utils/mintLearner.ts
 * =====================================================
 *
 * THE RULING THIS IMPLEMENTS (Tom, 2026-09-10). The first design of the verbs
 * half had a minted plain learner born EXCLUDED from analytics, on the grounds
 * that a wrong inclusion inflates every number silently. Tom rejected it:
 *
 *   > "why cant they be included? if theyre in the data as proper learners,
 *   > they can just be minted as GIFTED, so the payment side of things doesnt
 *   > expect them."
 *
 * The error was carrying two different facts on one flag. **Did they pay** and
 * **are they a real person learning** are independent, and only the second one
 * decides whether somebody counts. A comped teacher, a gifted friend and a
 * pilot school are real humans genuinely learning: their sessions, their weak
 * points and their drop-off are true signal, and hiding them makes the numbers
 * LESS accurate, not safer.
 *
 * So there are THREE kinds, not two:
 *
 *   paying        — a real person, included, billing expects money.
 *   gifted        — a real person, included, billing expects nothing because
 *                   they hold an entitlement. An ENTITLEMENT fact, on the money
 *                   side, with no effect whatsoever on analytics inclusion.
 *   not-a-person  — a demo fixture or a test/staff account. The ONLY thing that
 *                   is ever excluded from analytics.
 *
 * `gifted` is therefore not a status on the learner and this file does not
 * invent one. It is a `user_entitlements` row, written by the machinery that
 * already grants entitlements (api/_utils/entitlementGrant.ts), and read back
 * as a cohort by api/_utils/entitlementCohort.ts.
 *
 * TWO DOORS, DELIBERATELY. `mintPerson()` mints somebody real and included;
 * `mintNotAPerson()` mints a demo or a test account and is the only thing that
 * sets an exclusion flag. They are separate exported functions behind separate
 * endpoints, because a checkbox on one form is exactly how "is this real?" gets
 * answered by whatever the last person left ticked.
 *
 * The learner row itself follows api/admin/create-staff.ts: a service-role
 * insert with a synthetic `user_id`, and a compensating delete if a later step
 * fails, since there is no cross-table transaction available through
 * supabase-js. A synthetic user_id is claimed by the real auth uid when the
 * person actually signs in, exactly as a staff row is.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { grantGiftEntitlement, type GiftSpec } from './entitlementGrant'

/** The three kinds. `person` is the normal path; the other two are the demo door. */
export type MintKind = 'person' | 'demo' | 'test'

export interface MintSpec {
  displayName: string
  email?: string | null
  /** Only meaningful for `person`: the gift that stops billing expecting payment. */
  gift?: GiftSpec | null
  /** Auth uid of the admin doing the minting, for the audit row. */
  actorUserId?: string | null
}

export interface MintResult {
  learnerId: string
  userId: string
  /** True when a gift entitlement was written alongside the learner. */
  gifted: boolean
}

export type MintOutcome = MintResult | { error: string; detail?: string }

/**
 * The exclusion flags each kind is born with. This function is the whole
 * ruling in four lines, which is why it is separate and tested directly.
 *
 * A person carries BOTH flags explicitly false rather than relying on the
 * column defaults. The defaults agree today; stating it means a future change
 * to a default cannot quietly start excluding real people.
 */
export function birthFlags(kind: MintKind): { is_demo: boolean; is_internal: boolean } {
  switch (kind) {
    case 'demo':
      return { is_demo: true, is_internal: false }
    case 'test':
      return { is_demo: false, is_internal: true }
    case 'person':
    default:
      return { is_demo: false, is_internal: false }
  }
}

/** Synthetic user_id prefix, so a row's origin is legible in the table itself. */
function syntheticUserId(kind: MintKind): string {
  const prefix = kind === 'person' ? 'minted' : kind === 'demo' ? 'demo' : 'test'
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`
}

async function insertLearner(
  supabase: SupabaseClient,
  kind: MintKind,
  spec: MintSpec,
): Promise<{ learnerId: string; userId: string } | { error: string; detail?: string }> {
  const displayName = (spec.displayName || '').trim()
  if (!displayName) return { error: 'display_name is required' }

  const email = (spec.email || '').trim().toLowerCase()
  const userId = syntheticUserId(kind)

  const { data, error } = await supabase
    .from('learners')
    .insert({
      user_id: userId,
      display_name: displayName,
      verified_emails: email ? [email] : [],
      ...birthFlags(kind),
    })
    .select('id, user_id')
    .single()

  if (error || !data) {
    return { error: 'Failed to create learner', detail: error?.message }
  }
  return { learnerId: data.id as string, userId: data.user_id as string }
}

/**
 * Mint a REAL person. Included in every number from birth.
 *
 * If `gift` is supplied they are minted gifted: an entitlement row is written
 * through the ordinary grant machinery so the payment side expects nothing.
 * The gift is part of the same act, so a failure to write it rolls the learner
 * back — a person minted for a pilot who then hits a paywall is a worse outcome
 * than the mint plainly failing and being retried.
 */
export async function mintPerson(supabase: SupabaseClient, spec: MintSpec): Promise<MintOutcome> {
  const made = await insertLearner(supabase, 'person', spec)
  if ('error' in made) return made

  if (!spec.gift) return { ...made, gifted: false }

  const granted = await grantGiftEntitlement(supabase, made.learnerId, spec.gift, {
    actorUserId: spec.actorUserId ?? null,
    source: 'mint-learner',
  })
  if (!granted.ok) {
    // Compensating delete: no half-minted person left behind.
    const { error } = await supabase.from('learners').delete().eq('id', made.learnerId)
    if (error) console.error('[mintLearner] compensating delete failed:', error.message)
    return { error: 'Failed to grant the gift', detail: granted.detail }
  }

  return { ...made, gifted: true }
}

/**
 * Mint something that is NOT a person — a demo fixture or a test account.
 *
 * This is the only door that sets an exclusion flag, and it is a different door
 * on purpose. It takes no gift: a fixture holding an entitlement would appear
 * in the gifted cohort, which is a cohort of real people.
 */
export async function mintNotAPerson(
  supabase: SupabaseClient,
  kind: 'demo' | 'test',
  spec: MintSpec,
): Promise<MintOutcome> {
  const made = await insertLearner(supabase, kind, spec)
  if ('error' in made) return made
  return { ...made, gifted: false }
}
