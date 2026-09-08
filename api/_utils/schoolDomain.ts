/**
 * SCHOOL IDENTITY ON THE DOMAIN — the one rule about which email addresses a
 * school's invite links vouch for (job #371, Tom's commission 2026-09-08).
 *
 * A school's teacher link and admin link are MULTI-USE by design: one standing
 * link handed round a staffroom. Until this, holding the link was the whole
 * authorization boundary — api/auth/possession-redeem.ts minted an account for
 * whatever address was typed, and its header says so: "nothing today checks the
 * typed OTP email against who the invite was meant for."
 *
 * Tom's ruling: the FIRST admin to sign a school up claims the school's email
 * domain, and an arrival on the school's links is verified "by a domain level
 * similarity". This module is that similarity, made exact:
 *
 *   - a school owns a set of CLAIMS, rows in `school_identity_claims`:
 *       kind='domain'  — an email domain the school lives on ('example.sch.uk')
 *       kind='address' — one named address the admin has let in by hand
 *                        (supply staff, a teacher on a personal address)
 *   - an ARRIVAL (the address typed at the link) is ON-DOMAIN when it is a
 *     listed address, or its domain equals a claimed domain, or is a SUBDOMAIN
 *     of one ('staff.example.sch.uk' under 'example.sch.uk'). Nothing fuzzier:
 *     'example-sch.uk' is not 'example.sch.uk'. Fuzzy would be quietly wrong.
 *   - a PUBLIC mail domain can never be claimed. gmail.com is where the whole
 *     internet lives; a school "claiming" it would vouch for everyone.
 *
 * What on-domain BUYS, and what it does not. On-domain is the ordinary path
 * and stays ONE TAP — no code, no mail, no waiting on a gateway that eats our
 * mail (the population this whole flow exists for). It records an
 * ATTESTATION: the address is at the school the link belongs to, so the
 * account is born with `needs_verification=false`. It does NOT prove the
 * person owns the mailbox — a squatter holding a leaked link can still type a
 * colleague's address — which is why the contest rule in
 * api/_utils/unclaimedMint.ts stays armed on every schools mint regardless.
 *
 * Off-domain is the CONTESTED shape: it still gets in first time (Tom: working
 * first time outranks security in chronology, never in importance), but it
 * stays `needs_verification=true`, the admin sees it marked on the Teachers
 * page, and its route to being proved is the existing Settings "Verify now"
 * code — which reaches a personal address exactly because it is not behind
 * the school gateway.
 *
 * SHARED TENANTS (job #385, Tom's commission 2026-09-08). Some domains are not
 * one school's identity but a whole nation's: hwbcymru.net is the Welsh
 * Government's Hwb platform and every school in Wales is on it, so a claim on
 * it by whichever school signed up first would make that school's teacher link
 * vouch, with no code and no mail, for any Hwb address in the country. Tom's
 * ruling: a hardcoded list of such tenants is REFUSED — "a list of instances
 * standing in for a rule is this estate's recurring bug, and any list is wrong
 * the day a tenant nobody wrote down appears." The test is DERIVED from the
 * live data, in one place, and both the creation path and the backfill call
 * it, so they agree by construction:
 *
 *   A domain is a SHARED TENANT for school S when another school, outside S's
 *   group, has its FOUNDING ADMIN living at that domain or beneath it.
 *
 * "Living at" is read from `learner_emails` (kept in step with auth by the
 * sync_email_on_auth_user / sync_email_on_identity triggers) joined to
 * `schools.admin_user_id` — the same evidence the backfill used, made cheap
 * enough to run per signup and per arrival (schoolsLivingOn). The founding
 * admin's address is the evidence because it is the one address every school
 * has proved or been vouched for; a teacher who joined some other school
 * off-domain is not counted, deliberately — an off-domain arrival is exactly
 * the unproved shape, and letting it flip a domain would hand anyone with a
 * leaked link a way to switch a real school's one-tap off.
 *
 * What the rule does at each of the three moments:
 *   - CLAIM (claimDomainForSchool): refused as 'shared_tenant' when another
 *     household already lives there. The first school on a fresh tenant is
 *     indistinguishable from a school on its own domain — no evidence exists
 *     yet — so it is claimed, honestly, and the hole closes the moment the
 *     second school proves an address there. That window is the floor of what
 *     the live data can know without a list; it is not papered over.
 *   - ARRIVAL (claimsVouchingFor): a domain row whose domain has SINCE become
 *     shared is SUPPRESSED — it vouches for nobody, re-derived on every
 *     arrival. Nothing is deleted: the row stays as the record that the school
 *     did claim it, and accounts already born verified under it are untouched.
 *     Suppression is the un-claim; there is no other, and none is needed.
 *   - DOOR (schoolsClaimingDomainOf): only an EFFECTIVE holder is a holder. A
 *     head from the second school on a tenant is told who signed up first and
 *     offered the way through in one tap; a head from the third sees no
 *     notice at all, because by then the domain belongs to nobody.
 *
 * Ordering, as everywhere in this file: working first time is the primary
 * function. Every read here fails OPEN at the door and CLOSED at the claim —
 * a derivation that cannot answer lets the signup proceed and refuses the
 * claim, which is today's ordinary state for the thirty-odd schools that
 * hold no claim and whose teachers verify by code.
 *
 * Every function here is pure except the ones that read/write the table and
 * the residents query, so the matching and shared-tenant rules are testable
 * without a network (schoolDomain.test.ts).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isDisposableEmailDomain } from './emailValidation'
import { canonicalEmail, APPLE_RELAY_DOMAIN, LINK_AUTH_EMAIL_DOMAIN } from './identity/emailCanon'

/**
 * THE ONE LIST of public consumer mail domains, and the reason for it: a domain
 * shared by the public cannot identify a school, so it can never be claimed as
 * one. Deliberately a declared list rather than a regex — a regex that "looks
 * public" would one day eat a real school. Extend by adding a line, with the
 * provider's aliases beside it. Sibling of DISPOSABLE_DOMAINS in
 * emailValidation.ts, which answers a different question (is this a mailbox
 * at all) and is consulted here too.
 */
export const PUBLIC_MAIL_DOMAINS = new Set([
  // Google
  'gmail.com', 'googlemail.com',
  // Microsoft
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.de', 'hotmail.es', 'hotmail.it',
  'outlook.com', 'outlook.co.uk', 'outlook.fr', 'outlook.de', 'outlook.es',
  'live.com', 'live.co.uk', 'live.fr', 'live.de', 'msn.com',
  // Apple
  'icloud.com', 'me.com', 'mac.com',
  // Yahoo / AOL
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de', 'yahoo.es', 'yahoo.it', 'yahoo.ie',
  'yahoo.in', 'yahoo.co.in', 'ymail.com', 'rocketmail.com', 'aol.com', 'aol.co.uk',
  // Proton / GMX / mail.com / Zoho / Yandex / Fastmail
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me',
  'gmx.com', 'gmx.de', 'gmx.net', 'gmx.co.uk', 'gmx.at', 'gmx.ch',
  'mail.com', 'email.com', 'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru',
  'fastmail.com', 'fastmail.fm', 'hey.com', 'tutanota.com', 'tuta.io', 'tuta.com',
  // UK / IE ISPs and the rest of the everyday set
  'btinternet.com', 'btopenworld.com', 'sky.com', 'virginmedia.com', 'talktalk.net',
  'ntlworld.com', 'blueyonder.co.uk', 'plus.net', 'eircom.net', 'eir.ie',
  // India — the second market this product ships in
  'rediffmail.com', 'rediff.com', 'sify.com', 'in.com',
  // Comcast / Verizon / Orange / Free / Web.de / T-Online
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'orange.fr', 'wanadoo.fr',
  'free.fr', 'laposte.net', 'sfr.fr', 'web.de', 't-online.de', 'freenet.de', 'libero.it',
  'virgilio.it', 'tiscali.it', 'terra.com', 'telefonica.net', 'qq.com', '163.com', '126.com',
  'naver.com', 'daum.net', 'hanmail.net',
])

/** The domain of an address, lowercased — '' when the input is not an address. */
export function emailDomainOf(email: string | null | undefined): string {
  const exact = canonicalEmail(email)
  if (!exact) return ''
  return exact.slice(exact.lastIndexOf('@') + 1)
}

/** A domain string as we store it: lowercased, trimmed, no leading '@' or dot. */
export function normaliseDomain(domain: string | null | undefined): string {
  return String(domain || '').trim().toLowerCase().replace(/^@+/, '').replace(/^\.+|\.+$/g, '')
}

/** Shaped like a domain a mailbox could live on: at least one dot, only
 *  hostname characters. Not a resolvability check — hasMxRecord is that. */
export function isDomainShaped(domain: string): boolean {
  const d = normaliseDomain(domain)
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d)
}

export type ClaimRefusal = 'not_a_domain' | 'public_mail' | 'disposable' | 'placeholder' | 'relay' | 'shared_tenant'

/**
 * May a school claim this domain as its own? null = yes; otherwise the reason
 * it may not, so a screen can say which. Public consumer domains are the
 * ruling; the rest are the same non-identities the identity model already
 * names (relays, link-auth placeholders, throwaway providers).
 */
export function whyDomainNotClaimable(domain: string): ClaimRefusal | null {
  const d = normaliseDomain(domain)
  if (!isDomainShaped(d)) return 'not_a_domain'
  if (PUBLIC_MAIL_DOMAINS.has(d)) return 'public_mail'
  if (d === LINK_AUTH_EMAIL_DOMAIN) return 'placeholder'
  if (d === APPLE_RELAY_DOMAIN) return 'relay'
  if (isDisposableEmailDomain(`x@${d}`)) return 'disposable'
  return null
}

export function isClaimableDomain(domain: string): boolean {
  return whyDomainNotClaimable(domain) === null
}

/**
 * THE SIMILARITY RULE. True when `arrivalDomain` IS `claimedDomain` or sits
 * beneath it by whole labels. 'staff.example.sch.uk' matches 'example.sch.uk';
 * 'notexample.sch.uk' does not; 'example.sch.uk' never matches
 * 'staff.example.sch.uk' (a claim on a subdomain does not reach its parent).
 */
export function domainMatches(arrivalDomain: string, claimedDomain: string): boolean {
  const a = normaliseDomain(arrivalDomain)
  const c = normaliseDomain(claimedDomain)
  if (!a || !c) return false
  return a === c || a.endsWith('.' + c)
}

/** A school whose founding admin lives at a domain: the evidence unit of the
 *  shared-tenant rule. group_id lets one trust on one domain count as ONE
 *  household. */
export interface DomainResident {
  school_id: string
  group_id: string | null
}

/** The school the question is asked ABOUT. */
export interface SchoolHousehold {
  school_id: string
  group_id: string | null
}

/**
 * THE SHARED-TENANT RULE, pure. True when some resident of the domain is a
 * different household from `school`: another school, not a sibling in the same
 * group. The school's own row is never evidence against itself, and a trust
 * that lives on one domain is one household however many schools it holds.
 */
export function isSharedTenantFor(school: SchoolHousehold, residents: DomainResident[]): boolean {
  return residents.some((r) => r.school_id !== school.school_id && !(school.group_id && r.group_id === school.group_id))
}

/**
 * The residents of a domain: every school whose FOUNDING ADMIN has an address
 * at `domain` or a subdomain of it. Read from learner_emails → learners →
 * schools.admin_user_id — no per-user auth lookups, so it is cheap enough for
 * every signup and every arrival. Returns null when it cannot answer (a read
 * error, a thrown client): callers decide which side to fail on, and both
 * sides are written down beside them.
 */
export async function schoolsLivingOn(
  supabase: SupabaseClient,
  domain: string,
): Promise<DomainResident[] | null> {
  const d = normaliseDomain(domain)
  if (!isDomainShaped(d)) return []
  try {
    // The ilike is a coarse net; domainMatches is the exact rule, applied
    // to what it catches, so a look-alike never slips through on a pattern.
    const { data: addresses, error: aErr } = await supabase
      .from('learner_emails')
      .select('learner_id, email')
      .or(`email.ilike.%@${d},email.ilike.%.${d}`)
    if (aErr) {
      console.error('[schoolDomain] residents read failed:', aErr.message)
      return null
    }
    const learnerIds = Array.from(new Set(
      ((addresses || []) as Array<{ learner_id: string; email: string }>)
        .filter((r) => domainMatches(emailDomainOf(r.email), d))
        .map((r) => r.learner_id),
    ))
    if (!learnerIds.length) return []
    const { data: learners, error: lErr } = await supabase
      .from('learners')
      .select('user_id')
      .in('id', learnerIds)
    if (lErr) {
      console.error('[schoolDomain] residents learners read failed:', lErr.message)
      return null
    }
    const userIds = Array.from(new Set(((learners || []) as Array<{ user_id: string }>).map((r) => r.user_id).filter(Boolean)))
    if (!userIds.length) return []
    const { data: schools, error: sErr } = await supabase
      .from('schools')
      .select('id, group_id')
      .in('admin_user_id', userIds)
    if (sErr) {
      console.error('[schoolDomain] residents schools read failed:', sErr.message)
      return null
    }
    return ((schools || []) as Array<{ id: string; group_id: string | null }>).map((s) => ({
      school_id: String(s.id),
      group_id: s.group_id ? String(s.group_id) : null,
    }))
  } catch (err: any) {
    console.error('[schoolDomain] residents read threw:', err?.message || err)
    return null
  }
}

/** The household a school belongs to, for the rule above. null when the
 *  school cannot be read. */
async function householdOf(supabase: SupabaseClient, schoolId: string): Promise<SchoolHousehold | null> {
  const { data, error } = await supabase
    .from('schools')
    .select('id, group_id')
    .eq('id', schoolId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { id: string; group_id?: string | null }
  return { school_id: String(row.id), group_id: row.group_id ? String(row.group_id) : null }
}

/**
 * Is `domain` a shared tenant from `school`'s point of view, on the live data?
 * `null` = could not answer. The one derivation both the creation path and
 * tools/backfill-school-identity-claims.mjs call.
 */
export async function isSharedTenantOnLiveData(
  supabase: SupabaseClient,
  school: SchoolHousehold,
  domain: string,
): Promise<boolean | null> {
  const residents = await schoolsLivingOn(supabase, domain)
  if (residents === null) return null
  return isSharedTenantFor(school, residents)
}

/**
 * The domain rows among `claims` that still vouch: a domain that has become a
 * shared tenant since it was claimed is dropped, re-derived on every call.
 * Address rows always pass. A derivation that cannot answer keeps the row —
 * one read fault must not switch a real school's one-tap off.
 */
export async function effectiveClaims(
  supabase: SupabaseClient,
  school: SchoolHousehold,
  claims: IdentityClaim[],
): Promise<IdentityClaim[]> {
  const out: IdentityClaim[] = []
  for (const claim of claims) {
    if (claim.kind !== 'domain') { out.push(claim); continue }
    const holder: SchoolHousehold = claim.school_id && claim.school_id !== school.school_id
      ? { school_id: claim.school_id, group_id: school.group_id } // an inherited sibling row: same household
      : school
    const shared = await isSharedTenantOnLiveData(supabase, holder, claim.value)
    if (shared === true) continue
    out.push(claim)
  }
  return out
}

export interface IdentityClaim {
  kind: 'domain' | 'address'
  value: string
  /** The school that holds the claim — may be a sibling in the same group. */
  school_id?: string
}

export type ArrivalMatch =
  | { onDomain: true; via: 'address' | 'domain'; claim: IdentityClaim }
  | { onDomain: false; via: null; claim: null }

/** Pure: does this typed address arrive on-domain against these claims?
 *  A listed address wins over a domain, so the answer names the narrower
 *  reason when both apply. */
export function matchArrival(email: string, claims: IdentityClaim[]): ArrivalMatch {
  const exact = canonicalEmail(email)
  if (!exact) return { onDomain: false, via: null, claim: null }
  const domain = emailDomainOf(exact)
  for (const claim of claims) {
    if (claim.kind === 'address' && canonicalEmail(claim.value) === exact) {
      return { onDomain: true, via: 'address', claim }
    }
  }
  for (const claim of claims) {
    if (claim.kind === 'domain' && domainMatches(domain, claim.value)) {
      return { onDomain: true, via: 'domain', claim }
    }
  }
  return { onDomain: false, via: null, claim: null }
}

/**
 * Every claim that vouches for arrivals at THIS school: its own rows, plus the
 * DOMAIN rows of every sibling school in the same group. A multi-academy trust
 * that lives on one domain claims it once, at whichever school signed up first,
 * and every school under the trust inherits the match. Address rows are never
 * inherited — an admin lets a named person into their own school, not the
 * trust. Read errors answer with no claims, which makes the arrival
 * off-domain: the safe side.
 */
export async function claimsVouchingFor(
  supabase: SupabaseClient,
  schoolId: string,
): Promise<IdentityClaim[]> {
  if (!schoolId) return []
  try {
    const { data: own, error: ownErr } = await supabase
      .from('school_identity_claims')
      .select('kind, value, school_id')
      .eq('school_id', schoolId)
    if (ownErr) {
      console.error('[schoolDomain] claims read failed:', ownErr.message)
      return []
    }
    const claims: IdentityClaim[] = (own || []) as IdentityClaim[]

    const { data: school } = await supabase
      .from('schools')
      .select('group_id')
      .eq('id', schoolId)
      .maybeSingle()
    const groupId = (school as { group_id?: string | null } | null)?.group_id || null
    const household: SchoolHousehold = { school_id: schoolId, group_id: groupId }
    // A domain that has become a shared tenant since it was claimed vouches
    // for nobody (see the header): suppressed here, never deleted.
    if (!groupId) return effectiveClaims(supabase, household, claims)

    const { data: siblings } = await supabase
      .from('schools')
      .select('id')
      .eq('group_id', groupId)
      .neq('id', schoolId)
    const siblingIds = ((siblings || []) as Array<{ id: string }>).map((s) => s.id)
    if (!siblingIds.length) return effectiveClaims(supabase, household, claims)

    const { data: inherited } = await supabase
      .from('school_identity_claims')
      .select('kind, value, school_id')
      .eq('kind', 'domain')
      .in('school_id', siblingIds)
    return effectiveClaims(supabase, household, claims.concat(((inherited || []) as IdentityClaim[])))
  } catch (err: any) {
    // A thrown read is doubt, and doubt is off-domain — the safe side.
    console.error('[schoolDomain] claims read threw:', err?.message || err)
    return []
  }
}

/** The arrival decision for one typed address at one school's link. */
export async function resolveArrival(
  supabase: SupabaseClient,
  schoolId: string,
  email: string,
): Promise<ArrivalMatch> {
  return matchArrival(email, await claimsVouchingFor(supabase, schoolId))
}

export type ClaimSource = 'founding_admin' | 'leader_invite' | 'admin_added'

export type ClaimOutcome =
  | { status: 'claimed'; domain: string }
  | { status: 'already_ours'; domain: string }
  | { status: 'not_claimable'; domain: string; reason: ClaimRefusal }
  | { status: 'error'; domain: string; message: string }

/**
 * Claim the domain of `email` for `schoolId` — the founding act. Idempotent
 * for the school's own repeat; a public or otherwise unclaimable domain is
 * reported and NOT written. Never throws: minting a school must not fail on
 * its identity bookkeeping (the school is the thing; the claim is a fact
 * about it that an admin can add by hand from Settings if it was missed).
 */
export async function claimDomainForSchool(
  supabase: SupabaseClient,
  args: { schoolId: string; email: string; source: ClaimSource; addedBy: string },
): Promise<ClaimOutcome> {
  const domain = emailDomainOf(args.email)
  const reason = whyDomainNotClaimable(domain)
  if (reason) return { status: 'not_claimable', domain, reason }
  try {
    // Fail CLOSED at the claim: if the school or the residents cannot be
    // read, no claim is written. The school still works completely — its
    // teachers arrive off-domain and verify by code — and the founding
    // admin's next pass through provision retries the claim.
    const household = await householdOf(supabase, args.schoolId)
    if (!household) return { status: 'error', domain, message: 'school unreadable for shared-tenant check' }
    const shared = await isSharedTenantOnLiveData(supabase, household, domain)
    if (shared === null) return { status: 'error', domain, message: 'shared-tenant check could not read the live data' }
    if (shared) return { status: 'not_claimable', domain, reason: 'shared_tenant' }
    const { error } = await supabase
      .from('school_identity_claims')
      .insert({ school_id: args.schoolId, kind: 'domain', value: domain, source: args.source, added_by: args.addedBy })
    if (!error) return { status: 'claimed', domain }
    if (error.code === '23505') return { status: 'already_ours', domain }
    console.error('[schoolDomain] domain claim failed:', error.message)
    return { status: 'error', domain, message: error.message }
  } catch (err: any) {
    console.error('[schoolDomain] domain claim threw:', err?.message || err)
    return { status: 'error', domain, message: String(err?.message || err) }
  }
}

/**
 * Which schools EFFECTIVELY hold a claim on the domain of `email`? Used at the
 * self-serve door so a second head from an already-claimed domain is pointed
 * at the school that holds it rather than minting a rival. A holder whose
 * domain has since become a shared tenant is not a holder: once two households
 * live on a domain it identifies nobody, and the door says nothing. Read
 * errors answer "none", which lets the signup proceed — a blocked signup is
 * the worse fault.
 */
export async function schoolsClaimingDomainOf(
  supabase: SupabaseClient,
  email: string,
): Promise<Array<{ school_id: string; school_name: string; domain: string }>> {
  const domain = emailDomainOf(email)
  if (!domain || !isClaimableDomain(domain)) return []
  // The arrival's domain and every parent of it that could be claimed: an
  // address at staff.example.sch.uk is spoken for by a claim on example.sch.uk.
  const labels = domain.split('.')
  const candidates: string[] = []
  for (let i = 0; i < labels.length - 1; i++) candidates.push(labels.slice(i).join('.'))
  try {
    const { data, error } = await supabase
      .from('school_identity_claims')
      .select('school_id, value, schools(school_name, group_id)')
      .eq('kind', 'domain')
      .in('value', candidates)
    if (error || !data) return []
    const holders: Array<{ school_id: string; school_name: string; domain: string }> = []
    for (const row of data as any[]) {
      const holder: SchoolHousehold = {
        school_id: String(row.school_id),
        group_id: row.schools?.group_id ? String(row.schools.group_id) : null,
      }
      const shared = await isSharedTenantOnLiveData(supabase, holder, String(row.value))
      if (shared === true) continue // a suppressed claim is nobody's; fail open on null
      holders.push({
        school_id: holder.school_id,
        school_name: String(row.schools?.school_name || ''),
        domain: String(row.value),
      })
    }
    return holders
  } catch (err: any) {
    // Fail open: a signup blocked by the claims table is the worse fault.
    console.error('[schoolDomain] domain holders read threw:', err?.message || err)
    return []
  }
}
