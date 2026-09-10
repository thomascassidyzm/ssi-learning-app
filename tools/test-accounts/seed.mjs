#!/usr/bin/env node
/**
 * seed.mjs — the three Colombo fixture accounts, seeded so they PERSIST.
 *
 * WHY THIS EXISTS. Dulmini's last test pass in Colombo was a guest pass, start
 * to finish, because the emailed sign-in codes never arrived on her network.
 * Every finding she brought back was therefore a finding about the guest path.
 * These three accounts sign in BY PASSWORD, so that cannot happen again.
 *
 *   node tools/test-accounts/seed.mjs --verify                    # read-only, all three
 *   node tools/test-accounts/seed.mjs --account all               # seed all three
 *   node tools/test-accounts/seed.mjs --account wall --state yellow-complete
 *   node tools/test-accounts/seed.mjs --account fresh --state none
 *
 * THERE IS ONE DATABASE. dev, staging and production all point at the same live
 * Supabase project, so every write here is a write to production data. This
 * script touches THREE addresses and nothing else, ever: the three in
 * packages/player-vue/e2e/fixtures/test-accounts.mjs. It refuses to act on any
 * address that is not one of them.
 *
 * WHAT IT WRITES, per account:
 *   - an auth user with `email_confirm: true` and a password. Confirmed at
 *     creation and with NO unclaimed-mint marker in app_metadata, so
 *     api/auth/claim-account.ts finds nothing to claim and does not rotate the
 *     password out from under the tester on her first sign-in. That trap is
 *     real: mayClaim in api/_utils/unclaimedMint.ts fires on the marker, and
 *     an account created here never carries one.
 *   - a learners row with is_internal = true, EXPLICITLY. This is what keeps
 *     the account out of every board number: the canonical exclusion
 *     test_learner_ids() tests is_demo / is_internal / is_class_entity / the
 *     thomas.cassidy+ pattern in verified_emails — and does NOT know the tester
 *     role exists. Never rely on the role for exclusion.
 *   - premium via platform_role = 'tester', never an entitlement row and never
 *     a fake subscription. checkCourseAccess grants a tester full content.
 *   - a course_enrollments row at the named position, by DELETE + INSERT,
 *     because ratchet_highest_completed_round() refuses to lower a ceiling on
 *     an UPDATE. On INSERT the ratchet has no previous value to defend.
 *
 * PASSWORDS live in ~/.secrets/ssi-test-accounts.env, mode 600, outside every
 * repo. They are generated once and REUSED on every re-seed, so a re-seed never
 * invalidates a password already handed to a tester. Nothing here prints one
 * unless you ask with --show-passwords.
 *
 * ENV. Needs SUPABASE_URL and a service key. Source them, e.g.:
 *   set -a; . ~/SSi/ssi-dashboard-v7-clean/.env; set +a
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const { FIXTURES, FIXTURE_COURSE, POSITIONS } = await import(
  join(HERE, '../../packages/player-vue/e2e/fixtures/test-accounts.mjs')
)

const SECRETS_FILE = join(homedir(), '.secrets', 'ssi-test-accounts.env')
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const SERVICE_KEY = (
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
).trim()
const ANON_KEY = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()

// ---------------------------------------------------------------- arguments

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (process.argv[i + 1] ?? true)
}
const has = (name) => process.argv.includes(`--${name}`)

const VERIFY_ONLY = has('verify')
const SHOW_PASSWORDS = has('show-passwords')
const ACCOUNT = arg('account', VERIFY_ONLY ? 'all' : null)
const STATE = arg('state', null)
const ORIGIN = (arg('origin', 'https://staging.saysomethingin.app') || '').replace(/\/$/, '')

if (!SUPABASE_URL || !SERVICE_KEY) {
  die('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.\n' +
      '  set -a; . ~/SSi/ssi-dashboard-v7-clean/.env; set +a')
}
if (!ACCOUNT) {
  die('say which account: --account fresh|wall|premium|all, or --verify')
}
const NAMES = ACCOUNT === 'all' ? Object.keys(FIXTURES) : [ACCOUNT]
for (const n of NAMES) {
  if (!FIXTURES[n]) die(`unknown account "${n}" — one of: ${Object.keys(FIXTURES).join(', ')}, all`)
}
if (STATE && STATE !== 'none' && !POSITIONS[STATE]) {
  die(`unknown state "${STATE}" — one of: ${Object.keys(POSITIONS).join(', ')}, none`)
}

function die(msg) {
  console.error(`\n  ${msg}\n`)
  process.exit(1)
}

// ------------------------------------------------------------------ helpers

async function api(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 400)}`)
  return body
}

/** The passwords file. Read what is there, keep it, only ever ADD. */
function readSecrets() {
  if (!existsSync(SECRETS_FILE)) return {}
  const out = {}
  for (const line of readFileSync(SECRETS_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2]
  }
  return out
}

function writeSecrets(secrets) {
  mkdirSync(dirname(SECRETS_FILE), { recursive: true })
  const header = [
    '# SSi Colombo test-account passwords — written by tools/test-accounts/seed.mjs.',
    '# NEVER commit this file, never publish these, never paste them into a document.',
    '# Hand them over person to person. To print them:',
    '#   grep COLOMBO ~/.secrets/ssi-test-accounts.env',
    '',
  ].join('\n')
  const body = Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n')
  writeFileSync(SECRETS_FILE, `${header}${body}\n`, { mode: 0o600 })
  chmodSync(SECRETS_FILE, 0o600)
}

const keyFor = (name) => `COLOMBO_${name.toUpperCase()}_PASSWORD`

/** Readable, typeable on a phone keyboard, and still 60+ bits of entropy. */
function generatePassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  const chunk = (n) => Array.from(bytes.slice(n, n + 4), (b) => alphabet[b % alphabet.length]).join('')
  return `${chunk(0)}-${chunk(4)}-${chunk(8)}-${chunk(12)}`
}

/** Turn a POSITION name into a live cursor by asking the database, not a constant. */
async function resolvePosition(stateName) {
  const pos = POSITIONS[stateName]
  const rows = await api(
    `/rest/v1/course_legos?select=lego_id,seed_number,lego_index` +
    `&course_code=eq.${FIXTURE_COURSE}&seed_number=eq.${pos.lastSeed}` +
    `&order=lego_index.desc&limit=1`
  )
  if (!rows.length) {
    throw new Error(
      `cannot resolve "${stateName}": ${FIXTURE_COURSE} has no LEGO at seed ${pos.lastSeed}`
    )
  }
  const lastLego = rows[0].lego_id
  // Round index is secondary — the LEGO id is the position, per
  // resolveResumeStart. We still set it so the row is internally consistent.
  const countRes = await fetch(
    `${SUPABASE_URL}/rest/v1/course_legos?select=lego_id&course_code=eq.${FIXTURE_COURSE}` +
    `&lego_id=lte.${lastLego}`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact', Range: '0-0' } }
  )
  const total = Number((countRes.headers.get('content-range') || '/0').split('/')[1]) || 0
  return { legoId: lastLego, seed: pos.lastSeed, roundIndex: total }
}

async function findAuthUser(email) {
  const page = await api(`/auth/v1/admin/users?per_page=200`)
  const users = Array.isArray(page) ? page : (page.users || [])
  return users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase()) || null
}

// --------------------------------------------------------------------- seed

async function seedOne(name, secrets) {
  const fx = FIXTURES[name]
  const wantedState = STATE ?? fx.position ?? 'none'
  console.log(`\n── ${name}  ${fx.email}`)

  // 1. password — generated once, reused for ever after.
  let password = secrets[keyFor(name)]
  if (!password) {
    password = generatePassword()
    secrets[keyFor(name)] = password
    console.log('   password: generated, written to ~/.secrets/ssi-test-accounts.env')
  } else {
    console.log('   password: reusing the one already in ~/.secrets/ssi-test-accounts.env')
  }

  // 2. auth user — confirmed at creation, no unclaimed-mint marker.
  let user = await findAuthUser(fx.email)
  if (!user) {
    user = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: fx.email,
        password,
        email_confirm: true,
        user_metadata: { display_name: fx.displayName },
        app_metadata: { ssi_fixture: name },
      }),
    })
    console.log(`   auth user: created ${user.id}`)
  } else {
    user = await api(`/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password, email_confirm: true }),
    })
    console.log(`   auth user: exists ${user.id}, password re-applied and address confirmed`)
  }
  const mint = user.app_metadata?.unclaimed_mint
  if (mint) {
    // Would be swept by api/auth/claim-account on the first sign-in, taking the
    // password with it. Clear it rather than hand out a credential due to die.
    await api(`/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ app_metadata: { unclaimed_mint: null, ssi_fixture: name } }),
    })
    console.log('   auth user: cleared an unclaimed-mint marker that would have killed the password')
  }

  // 3. learners row — is_internal EXPLICITLY, role for premium.
  const existing = await api(`/rest/v1/learners?select=id,user_id&user_id=eq.${user.id}`)
  const row = {
    user_id: user.id,
    display_name: fx.displayName,
    is_internal: true,
    platform_role: fx.platform_role,
    needs_verification: false,
    verified_emails: [fx.email],
  }
  let learner
  if (existing.length) {
    learner = (await api(`/rest/v1/learners?user_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    }))[0]
  } else {
    learner = (await api('/rest/v1/learners', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    }))[0]
  }
  console.log(`   learner:   ${learner.id}  is_internal=true  platform_role=${fx.platform_role ?? 'none'}`)

  // 4. position — DELETE then INSERT; the ratchet defends nothing on an insert.
  await api(
    `/rest/v1/course_enrollments?learner_id=eq.${learner.id}&course_id=eq.${FIXTURE_COURSE}`,
    { method: 'DELETE' }
  )
  if (wantedState === 'none') {
    console.log(`   position:  cleared — no enrolment on ${FIXTURE_COURSE}, a blank learner`)
  } else {
    const p = await resolvePosition(wantedState)
    await api('/rest/v1/course_enrollments', {
      method: 'POST',
      body: JSON.stringify({
        learner_id: learner.id,
        course_id: FIXTURE_COURSE,
        last_completed_lego_id: p.legoId,
        last_completed_round_index: p.roundIndex,
        highest_completed_seed: p.seed,
        last_practiced_at: new Date().toISOString(),
      }),
    })
    console.log(`   position:  ${wantedState} → ${p.legoId} (seed ${p.seed}, round ${p.roundIndex})`)
  }
  return { name, email: fx.email, userId: user.id, learnerId: learner.id, password }
}

// ------------------------------------------------------------------- verify

/** Sign in for real, with the password, against the same GoTrue the app uses. */
async function verifyOne(name, secrets) {
  const fx = FIXTURES[name]
  const password = secrets[keyFor(name)]
  const out = { name, email: fx.email, signIn: false, notes: [] }
  if (!password) { out.notes.push('no password on file — run the seed first'); return out }
  if (!ANON_KEY) { out.notes.push('no SUPABASE_ANON_KEY in env — cannot sign in as a browser would'); return out }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: fx.email, password }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) {
    out.notes.push(`sign-in FAILED: ${res.status} ${JSON.stringify(body).slice(0, 200)}`)
    return out
  }
  out.signIn = true

  // The SERVER gate, not the client's opinion of it: the bundle route slices
  // the course to the free-preview window and stamps previewOnly when it does.
  const bundle = await fetch(`${ORIGIN}/api/courses/${FIXTURE_COURSE}/bundle`, {
    headers: { Authorization: `Bearer ${body.access_token}` },
  })
  if (bundle.ok) {
    const b = await bundle.json().catch(() => ({}))
    out.previewOnly = b.previewOnly === true
    out.maxSeed = Array.isArray(b.legos)
      ? b.legos.reduce((m, l) => Math.max(m, l.seed_number ?? l.seed ?? 0), 0)
      : null
  } else {
    out.notes.push(`bundle probe on ${ORIGIN} → ${bundle.status}`)
  }

  const user = await findAuthUser(fx.email)
  const learners = user
    ? await api(`/rest/v1/learners?select=id,is_internal,platform_role&user_id=eq.${user.id}`)
    : []
  const learner = learners[0]
  out.isInternal = learner?.is_internal === true
  out.role = learner?.platform_role ?? null
  if (!out.isInternal) out.notes.push('is_internal is NOT true — this account would count as a real learner')
  if (learner) {
    const enrol = await api(
      `/rest/v1/course_enrollments?select=highest_completed_lego_id,highest_completed_seed` +
      `&course_id=eq.${FIXTURE_COURSE}&learner_id=eq.${learner.id}`
    )
    out.position = enrol[0]?.highest_completed_lego_id ?? null
  }
  return out
}

// --------------------------------------------------------------------- main

const secrets = readSecrets()

if (VERIFY_ONLY) {
  console.log(`\nVerifying against ${ORIGIN} — read only, nothing is written.\n`)
  let bad = 0
  for (const name of NAMES) {
    const r = await verifyOne(name, secrets)
    const preview = r.previewOnly === undefined ? '?' : (r.previewOnly ? 'PREVIEW (walled)' : 'FULL COURSE')
    console.log(
      `  ${r.name.padEnd(8)} sign-in ${r.signIn ? 'OK  ' : 'FAIL'}  ` +
      `access ${preview.padEnd(16)} internal ${r.isInternal ? 'yes' : 'NO '}  ` +
      `position ${r.position ?? 'blank'}`
    )
    for (const n of r.notes) console.log(`           ${n}`)
    if (!r.signIn) bad++
  }
  console.log('')
  process.exit(bad ? 1 : 0)
}

const results = []
for (const name of NAMES) results.push(await seedOne(name, secrets))
writeSecrets(secrets)

console.log('\nSeeded. Passwords are in ~/.secrets/ssi-test-accounts.env, mode 600.')
console.log('Print them to hand over:  grep COLOMBO ~/.secrets/ssi-test-accounts.env')
console.log('Prove they work:          node tools/test-accounts/seed.mjs --verify\n')
if (SHOW_PASSWORDS) {
  for (const r of results) console.log(`  ${r.email}  ${r.password}`)
  console.log('')
}
