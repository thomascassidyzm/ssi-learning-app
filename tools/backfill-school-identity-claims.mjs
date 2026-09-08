#!/usr/bin/env node
/**
 * Backfill: claim each EXISTING school's domain from its founding admin's address.
 *
 * The class (job #371, 2026-09-08): school identity on the domain claims the founding
 * admin's domain at CREATION time, on both minting paths. Schools that already existed
 * when that shipped are never retro-claimed — so every teacher arriving on their link
 * reads as off-domain, stays needs_verification=true and is marked "unverified" to their
 * own admin. This heals the schools created before it. One-off, but idempotent.
 *
 * WRITES ONLY school_identity_claims INSERTs, through the app's own
 * api/_utils/schoolDomain.ts — never a second copy of the rules. So it refuses exactly
 * what the running code refuses: a public mail domain (gmail and friends), a disposable
 * one, the link-auth placeholder, an Apple relay. Those schools get NO claim and are
 * listed as skipped with the reason. That is the correct outcome, not a failure — a
 * school whose head is on gmail cannot vouch for arrivals by domain, and pretending
 * otherwise would let anyone with a gmail address onto their roster as proven.
 *
 * A domain that ANOTHER school's founding admin lives on is a SHARED TENANT, not one school's
 * identity, and is never claimed. hwbcymru.net is the case that forced this rule: it is the
 * Welsh Government's national Hwb platform and every school in Wales is on it, so a claim by
 * whichever school ran first would make that school's teacher link vouch for any Hwb address
 * in the country. The test is DERIVED from the live data, not a pasted list, and since job
 * #385 it lives in ONE place — isSharedTenantOnLiveData in api/_utils/schoolDomain.ts — which
 * the live creation path calls at claim time and at every arrival, and which this script calls
 * here. The two sides agree by construction: there is no second implementation to drift.
 *
 * A domain already held by ANOTHER school is a CONFLICT and is logged, never forced —
 * unless that other school is a sibling in the same group, in which case the claim is
 * already inherited (claimsVouchingFor reads sibling domain rows) and a second row
 * would be noise.
 *
 * No deletions. No updates to schools, learners or anything else. Re-derives its target
 * set from the live database on every run — never a pasted list — and claimDomainForSchool
 * treats a duplicate as 'already_ours', so a second run is a no-op.
 *
 * Usage (service role required):
 *   set -a; . ~/.secrets/ssi-dashboard.env; set +a
 *   node --experimental-strip-types --import ./tools/ts-extension-resolver.mjs \
 *     tools/backfill-school-identity-claims.mjs            # DRY RUN (default)
 *   ... tools/backfill-school-identity-claims.mjs --apply  # write
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY).
 *
 * A per-row JSON log is written next to the script as
 * backfill-school-identity-claims-{dryrun,applied}-log.json.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  emailDomainOf,
  whyDomainNotClaimable,
  claimDomainForSchool,
  isSharedTenantOnLiveData,
} from '../api/_utils/schoolDomain.ts'

const APPLY = process.argv.includes('--apply')
const HERE = dirname(fileURLToPath(import.meta.url))

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (service role required).')
  process.exit(1)
}
const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/** Re-derive the target set from the live DB. Never trust a pasted list. */
async function plan() {
  const { data: schools, error } = await svc
    .from('schools')
    .select('id, school_name, admin_user_id, group_id, created_at')
    .order('created_at', { ascending: true })
  if (error) throw error

  const { data: existing, error: cErr } = await svc
    .from('school_identity_claims')
    .select('school_id, kind, value')
    .eq('kind', 'domain')
  if (cErr) throw cErr
  /** domain -> [school_id] already holding it */
  const holders = new Map()
  for (const row of existing || []) {
    if (!holders.has(row.value)) holders.set(row.value, [])
    holders.get(row.value).push(row.school_id)
  }
  const groupOf = new Map((schools || []).map((s) => [s.id, s.group_id || null]))

  // Each school's own founding address — the address of record, from auth.
  // (The shared-tenant test below does NOT re-derive this; it reads
  // learner_emails through schoolDomain.ts, exactly as the creation path does.)
  const adminEmail = new Map()
  for (const s of schools || []) {
    if (!s.admin_user_id) continue
    const { data: u } = await svc.auth.admin.getUserById(s.admin_user_id)
    const email = u?.user?.email || null
    if (email) adminEmail.set(s.id, email)
  }

  const rows = []
  for (const s of schools || []) {
    const base = { school_id: s.id, school_name: s.school_name, created_at: s.created_at }
    if (!s.admin_user_id) {
      rows.push({ ...base, action: 'skip', reason: 'no_admin_user_id' })
      continue
    }
    const email = adminEmail.get(s.id) || null
    if (!email) {
      rows.push({ ...base, action: 'skip', reason: 'admin_has_no_email_or_lookup_failed' })
      continue
    }
    const domain = emailDomainOf(email)
    const refusal = whyDomainNotClaimable(domain)
    if (refusal) {
      rows.push({ ...base, admin_email: email, domain, action: 'skip', reason: refusal })
      continue
    }
    const shared = await isSharedTenantOnLiveData(svc, { school_id: s.id, group_id: s.group_id || null }, domain)
    if (shared === null) {
      rows.push({ ...base, admin_email: email, domain, action: 'skip', reason: 'shared_tenant_check_unreadable' })
      continue
    }
    if (shared) {
      rows.push({ ...base, admin_email: email, domain, action: 'skip', reason: 'shared_tenant' })
      continue
    }
    const held = holders.get(domain) || []
    if (held.includes(s.id)) {
      rows.push({ ...base, admin_email: email, domain, action: 'skip', reason: 'already_ours' })
      continue
    }
    const sibling = held.find((other) => groupOf.get(other) && groupOf.get(other) === (s.group_id || null))
    if (sibling) {
      rows.push({ ...base, admin_email: email, domain, action: 'skip', reason: 'inherited_from_sibling', sibling_school_id: sibling })
      continue
    }
    if (held.length) {
      rows.push({ ...base, admin_email: email, domain, action: 'conflict', reason: 'claimed_by_another_school', held_by: held })
      continue
    }
    rows.push({ ...base, admin_email: email, admin_user_id: s.admin_user_id, domain, action: 'claim' })
    // a later school in this same run must see the claim this one is about to take
    holders.set(domain, [s.id])
  }
  return rows
}

const rows = await plan()
const counts = rows.reduce((a, r) => ((a[r.action] = (a[r.action] || 0) + 1), a), {})
const bySkip = rows.filter((r) => r.action === 'skip').reduce((a, r) => ((a[r.reason] = (a[r.reason] || 0) + 1), a), {})

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} schools`)
console.log('  actions:', JSON.stringify(counts))
console.log('  skip reasons:', JSON.stringify(bySkip))
for (const r of rows.filter((x) => x.action === 'claim')) console.log(`  claim  ${r.domain}  <- ${r.school_name}`)
for (const r of rows.filter((x) => x.action === 'conflict')) console.log(`  CONFLICT  ${r.domain}  ${r.school_name} — already held by ${r.held_by.join(', ')}`)
const shared = new Map()
for (const r of rows.filter((x) => x.reason === 'shared_tenant')) shared.set(r.domain, (shared.get(r.domain) || 0) + 1)
for (const [d, n] of shared) console.log(`  SHARED TENANT — not claimed: ${d} (${n} schools live on it)`)

if (APPLY) {
  for (const r of rows) {
    if (r.action !== 'claim') continue
    const out = await claimDomainForSchool(svc, {
      schoolId: r.school_id, email: r.admin_email, source: 'founding_admin', addedBy: r.admin_user_id,
    })
    r.result = out.status
    if (out.status !== 'claimed' && out.status !== 'already_ours') {
      console.error(`  FAILED  ${r.domain} for ${r.school_name}: ${out.status} ${out.message || out.reason || ''}`)
    }
  }
  const wrote = rows.filter((r) => r.result === 'claimed').length
  console.log(`  written: ${wrote} claims`)
}

const logPath = join(HERE, `backfill-school-identity-claims-${APPLY ? 'applied' : 'dryrun'}-log.json`)
writeFileSync(logPath, JSON.stringify({ ranAt: new Date().toISOString(), apply: APPLY, counts, bySkip, rows }, null, 2))
console.log(`  log: ${logPath}`)
