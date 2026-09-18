/**
 * SCHOOL PROOF — may this school put a code in a child's hands yet?
 *
 * TOM'S RULING 1 (2026-09-18, job #195): "An unproven school can build but
 * not enrol. No pupil join codes, no class codes, nothing a child can use,
 * until the mailbox is proven or an admin vouches. Then an attacker's stolen
 * school is an empty room and the eight days cost nothing."
 *
 * The school door (api/auth/setup-mint.ts) mints a session on whatever
 * address is typed and provisions a school on it with no mail read. The head
 * can set the school up, create classes, name teachers — everything that
 * does not put a code in a child's hands. The one thing held back is
 * ENROLMENT: every route that turns a pupil join code into a child's
 * membership asks this file first, and the gate is on the USABILITY of the
 * code, not on whether a button is shown. A code that is minted but
 * redeemable is not gated.
 *
 * WHAT COUNTS AS PROVEN, in order, any one of which opens enrolment:
 *   1. the school was NOT founded through the no-code door — its founder
 *      carries no `setup_door` stamp. Every school that existed before the
 *      door, and every school whose founder typed a code, is untouched.
 *   2. the founder proved the school's own address: `email_confirmed_manually`
 *      set by api/email/verify.ts on a completed code round trip.
 *   3. the founder proved a DIFFERENT mailbox from the banner's "Use a
 *      different address" — recorded as an entry in learners.verified_emails
 *      that is not the primary address. The primary itself in that list
 *      proves nothing (useAuth back-fills it on every load), which is why
 *      only a second address counts. This is the Hwb case: the school
 *      address eats our mail and the head confirms from a personal one.
 *   4. an admin vouched for the school (api/school/vouch.ts), stamped on the
 *      founder's app_metadata — service-role-writable only, so the founder
 *      cannot vouch for herself by editing her own metadata.
 *
 * FAIL CLOSED. If the founder cannot be read, the school is unproven. Tom's
 * words: "if you cannot determine whether a school is proven, treat it as
 * unproven." A school with no founder pointer at all (admin_user_id null —
 * created by the govt tooling, never by the door) is not door-founded and is
 * open; that is a determination, not a doubt.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMailboxUnproven } from './mailboxProof'

/** The `app_metadata` key an admin's vouch lives under. Service-role only. */
export const SCHOOL_VOUCH_KEY = 'school_vouch'

/** What a pupil, or a teacher sharing a code, is told. Points at the thing
 *  that unblocks it — never a bare refusal. */
export const ENROLMENT_HELD_MESSAGE =
  "This class isn't taking pupils yet. The school's email address needs confirming first — the strip at the top of the school dashboard does it."

export const ENROLMENT_HELD_CODE = 'enrolment_held'

export interface FounderProofInput {
  metadata: Record<string, unknown> | null | undefined
  appMetadata: Record<string, unknown> | null | undefined
  primaryEmail: string | null | undefined
  verifiedEmails: string[] | null | undefined
}

/**
 * The rule as one pure function, mirrored for the browser in
 * packages/player-vue/src/composables/useMailboxPrompt.ts (enrolmentHeldFor)
 * so the teacher's own page can say the same thing the server will.
 */
export function enrolmentHeldFor(input: FounderProofInput): boolean {
  const meta = input.metadata || {}
  if (!meta.setup_door) return false
  if (!isMailboxUnproven(meta)) return false
  const vouch = (input.appMetadata || {})[SCHOOL_VOUCH_KEY]
  if (vouch && typeof vouch === 'object') return false
  const primary = (input.primaryEmail || '').trim().toLowerCase()
  const others = (input.verifiedEmails || [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e && e !== primary)
  if (others.length > 0) return false
  return true
}

/**
 * Is enrolment held on this school? Reads the founder; fails CLOSED on any
 * read error. Exported so the gate has one home and every route asks it.
 */
export async function schoolEnrolmentHeld(svc: SupabaseClient, schoolId: string): Promise<boolean> {
  const { data: school, error: schoolErr } = await svc
    .from('schools')
    .select('admin_user_id')
    .eq('id', schoolId)
    .maybeSingle()
  if (schoolErr || !school) return true
  const founderId = (school as { admin_user_id?: string | null }).admin_user_id
  if (!founderId) return false
  const { data: founder, error: founderErr } = await svc.auth.admin.getUserById(founderId)
  if (founderErr || !founder?.user) return true
  const { data: learner } = await svc
    .from('learners')
    .select('verified_emails')
    .eq('user_id', founderId)
    .maybeSingle()
  return enrolmentHeldFor({
    metadata: founder.user.user_metadata as Record<string, unknown> | undefined,
    appMetadata: founder.user.app_metadata as Record<string, unknown> | undefined,
    primaryEmail: founder.user.email,
    verifiedEmails: (learner as { verified_emails?: string[] } | null)?.verified_emails,
  })
}

/** The same question asked of a class: a class with no school (a tutor's, a
 *  group's) was never door-founded and is open. */
export async function classEnrolmentHeld(svc: SupabaseClient, classId: string): Promise<boolean> {
  const { data: cls, error } = await svc
    .from('classes')
    .select('school_id')
    .eq('id', classId)
    .maybeSingle()
  if (error) return true
  const schoolId = (cls as { school_id?: string | null } | null)?.school_id
  if (!schoolId) return false
  return schoolEnrolmentHeld(svc, schoolId)
}
