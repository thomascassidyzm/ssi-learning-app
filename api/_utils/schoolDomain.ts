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
 * Every function here is pure except the two that read/write the table, so the
 * matching rule is testable without a network (schoolDomain.test.ts).
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

export type ClaimRefusal = 'not_a_domain' | 'public_mail' | 'disposable' | 'placeholder' | 'relay'

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
  const groupId = (school as { group_id?: string | null } | null)?.group_id
  if (!groupId) return claims

  const { data: siblings } = await supabase
    .from('schools')
    .select('id')
    .eq('group_id', groupId)
    .neq('id', schoolId)
  const siblingIds = ((siblings || []) as Array<{ id: string }>).map((s) => s.id)
  if (!siblingIds.length) return claims

  const { data: inherited } = await supabase
    .from('school_identity_claims')
    .select('kind, value, school_id')
    .eq('kind', 'domain')
    .in('school_id', siblingIds)
  return claims.concat(((inherited || []) as IdentityClaim[]))
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
  const { error } = await supabase
    .from('school_identity_claims')
    .insert({ school_id: args.schoolId, kind: 'domain', value: domain, source: args.source, added_by: args.addedBy })
  if (!error) return { status: 'claimed', domain }
  if (error.code === '23505') return { status: 'already_ours', domain }
  console.error('[schoolDomain] domain claim failed:', error.message)
  return { status: 'error', domain, message: error.message }
}

/**
 * Which schools already hold a claim on the domain of `email`? Used at the
 * self-serve door so a second head from an already-claimed domain is pointed
 * at the school that holds it rather than minting a rival. Read errors answer
 * "none", which lets the signup proceed — a blocked signup is the worse fault.
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
  const { data, error } = await supabase
    .from('school_identity_claims')
    .select('school_id, value, schools(school_name)')
    .eq('kind', 'domain')
    .in('value', candidates)
  if (error || !data) return []
  return (data as any[]).map((row) => ({
    school_id: String(row.school_id),
    school_name: String(row.schools?.school_name || ''),
    domain: String(row.value),
  }))
}
