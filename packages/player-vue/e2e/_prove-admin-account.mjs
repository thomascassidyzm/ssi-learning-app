// PROOF for the 2026-09-06 admin-account fix (#939).
//
// The claim being proved, in three parts:
//   1. There is a dedicated harness ssi_admin — a DIFFERENT auth user from
//      Tom's, carrying platform_role='ssi_admin'.
//   2. Naming Tom's address at any of the seven admin-side scripts now DIES
//      BEFORE A BROWSER OPENS — the guard is on the module's constant, so the
//      process exits during import, not somewhere inside a Playwright run.
//   3. Running the dangerous one — csp-audit-probe, which drives signed-in
//      learner audio playback — leaves Tom's learner row and every one of his
//      progress tables byte-identical.
//
// This script is READ-ONLY against Tom's data. It never writes a learner row.
//
//   node e2e/_prove-admin-account.mjs            # parts 1 + 2 only (fast)
//   PROVE_CSP=1 node e2e/_prove-admin-account.mjs  # + part 3, runs the probe
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createClient } from '@supabase/supabase-js'
import { PROTECTED_ACCOUNTS, TEST_ADMIN, adminEmail } from './_test-accounts.mjs'

const TOM_EMAIL = 'thomas.cassidy+ssi@gmail.com'
const TOM_AUTH = 'ef65ea1f-57d0-4cf4-b744-33870c9449e8'
const TOM_LEARNER = '81987d60-0c00-4553-8a36-79f83cdf1774'

const SB_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const SERVICE_KEY = readFileSync(homedir() + '/.ssi-sentinel.env', 'utf8')
  .match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const s = createClient(SB_URL, SERVICE_KEY)

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

// ── Tom's data, as a comparable fingerprint ─────────────────────────────────
// The learner row in full, plus row count and newest timestamp for every table
// that carries his learning. A played lesson moves at least one of these.
const PROGRESS_TABLES = [
  ['sessions', 'learner_id', TOM_LEARNER],
  ['lego_progress', 'learner_id', TOM_LEARNER],
  ['seed_progress', 'learner_id', TOM_LEARNER],
  ['course_enrollments', 'learner_id', TOM_LEARNER],
  ['daily_contributions', 'learner_id', TOM_LEARNER],
  ['response_metrics', 'learner_id', TOM_LEARNER],
  ['player_events', 'user_id', TOM_LEARNER],
]
async function snapshot() {
  const out = {}
  const { data: row, error } = await s.from('learners').select('*').eq('user_id', TOM_AUTH).single()
  if (error) throw error
  out.learners_row = row
  for (const [table, col, val] of PROGRESS_TABLES) {
    const { count, error: cerr } = await s.from(table).select('*', { count: 'exact', head: true }).eq(col, val)
    if (cerr) { out[table] = `UNREADABLE: ${cerr.message}`; continue }
    const { data: newest } = await s.from(table).select('*').eq(col, val)
      .order('created_at', { ascending: false }).limit(1)
    out[table] = { count, newest: newest?.[0] ?? null }
  }
  return JSON.stringify(out)
}

const before = await snapshot()

// ── Part 1: the dedicated admin exists and is not Tom ───────────────────────
check('Tom is in the protected register', PROTECTED_ACCOUNTS.has(TOM_EMAIL))
check('the harness admin is not Tom', TEST_ADMIN !== TOM_EMAIL, TEST_ADMIN)
check('adminEmail() defaults to the harness admin', adminEmail() === TEST_ADMIN)
try {
  adminEmail(TOM_EMAIL)
  check('adminEmail() REFUSES Tom', false, 'it returned instead of throwing')
} catch (e) {
  check('adminEmail() REFUSES Tom', /REFUSING to sign in as admin/.test(e.message), e.message.split('\n')[0])
}

let adminUid = null
{
  let found = null
  for (let page = 1; ; page++) {
    const { data, error } = await s.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    found = data.users.find((u) => u.email?.toLowerCase() === TEST_ADMIN)
    if (found || data.users.length < 1000) break
  }
  adminUid = found?.id ?? null
  check('the harness admin exists in the live project', !!adminUid, adminUid || 'not found')
  check('it is a different auth user from Tom', adminUid !== TOM_AUTH, `${adminUid} vs ${TOM_AUTH}`)
}
if (adminUid) {
  const { data: l } = await s.from('learners').select('id,platform_role').eq('user_id', adminUid).single()
  check('it carries platform_role = ssi_admin', l?.platform_role === 'ssi_admin', String(l?.platform_role))
  check('it is a different learner row from Tom', l?.id !== TOM_LEARNER, `${l?.id} vs ${TOM_LEARNER}`)
}

// ── Part 2: every admin-side script dies before a browser opens ─────────────
const SCRIPTS = [
  'csp-audit-probe.mjs',
  'ime-vad-topup-probe.mjs',
  'vad-empty-state-ui-probe.mjs',
  'org-hierarchy/verify-org-tree.mjs',
  'org-hierarchy/verify-neutral-dressing.mjs',
  'demo-schools/verify-demo-schools.mjs',
  'resolved-session-audit/mint-sessions.mjs',
]
const here = new URL('.', import.meta.url).pathname
for (const script of SCRIPTS) {
  // Real keys supplied, so a refusal can only be the guard — never a missing
  // env var wearing the guard's clothes. CHROME_BIN is deliberately bogus:
  // if a browser were ever reached, the error would say so.
  const r = spawnSync('node', [here + script], {
    env: {
      ...process.env,
      ADMIN_EMAIL: TOM_EMAIL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      SUPABASE_SERVICE_KEY: SERVICE_KEY,
      VITE_SUPABASE_ANON_KEY: ANON_KEY,
      CHROME_BIN: '/nonexistent/chrome-must-never-be-launched',
    },
    encoding: 'utf8',
    timeout: 60000,
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  const refused = r.status !== 0 && /REFUSING to sign in as admin as thomas\.cassidy\+ssi@gmail\.com/.test(out)
  const noBrowser = !/chrome-must-never-be-launched/.test(out)
  check(`${script} refuses Tom's address`, refused, (out.split('\n').find((l) => /REFUSING/.test(l)) || out.slice(0, 120)).trim())
  check(`${script} refused before any browser launch`, refused && noBrowser)
}

// ── Part 3: run the dangerous probe as the new admin ────────────────────────
if (process.env.PROVE_CSP) {
  console.log('\n— running csp-audit-probe as the harness admin (this takes a few minutes) —')
  const r = spawnSync('node', [here + 'csp-audit-probe.mjs'], {
    env: { ...process.env, OUT_DIR: process.env.OUT_DIR || '/tmp/csp-audit-939/' },
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  check('csp-audit-probe ran to completion', r.status === 0, `exit ${r.status}`)
}

const after = await snapshot()
check("Tom's learner row and every progress table are byte-identical", before === after,
  before === after ? `${before.length} bytes unchanged` : 'CHANGED — see diff below')
if (before !== after) {
  console.log('BEFORE:', before)
  console.log('AFTER :', after)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
