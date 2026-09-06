// THE TEST-ACCOUNT REGISTER — one place that says which accounts a harness
// may sign in as, and which it must never touch.
//
// Why this file exists (2026-09-06): on 1 September the six-journey baseline
// harness signed in as thomas.cassidy+ssi@gmail.com — Tom's REAL learner
// account, 3,724 sessions and live cursors in fifteen courses — and journeys
// j2/j4 drove the course picker on it. App.vue writes
// `learners.preferences.last_course_code` on every pick, so his saved course
// was rewritten out from under him mid-session. The database still shows the
// signature: ~150 zero-duration, zero-item sessions on his account that
// morning, alternating spa_mx_for_eng / ita_for_eng — the harness's
// COURSE_A/COURSE_B switch, machine-gunned.
//
// A default that reads like a harmless constant is how that happened, so the
// rule is enforced in code and not in memory: a harness asks this module for
// an account, and minting a session for a protected one THROWS.

// Accounts belonging to a human being. Never sign in as one, never drive the
// app as one, never write anything as one.
export const PROTECTED_ACCOUNTS = new Set([
  'thomas.cassidy+ssi@gmail.com',   // Tom's real learner account
  'thomas.cassidy@gmail.com',
  'tomcassidy@mac.com',
  'thomas.cassidy@icloud.com',
])

// The dedicated learner the journey harness drives. Its progress is disposable
// by definition: nothing here is anybody's learning.
export const TEST_LEARNER = 'thomas.cassidy+e2e-learner@gmail.com'

// The dedicated ssi_admin the admin-side harnesses drive (2026-09-06). Tom's
// own address was ALSO the platform ssi_admin, so seven scripts — the CSP
// audit probe, both org-hierarchy verifiers, the demo-schools verifier, both
// VAD probes and the resolved-session auditor — minted an admin session as
// him. csp-audit-probe is the one that bit: it exercises signed-in learner
// audio playback, so it played lessons on his row. This account is a
// different auth user with platform_role='ssi_admin' and nothing else.
export const TEST_ADMIN = 'thomas.cassidy+e2e-admin@gmail.com'

// Throws rather than returning false: a harness that ignores a boolean is the
// failure mode this file exists to remove.
export function assertNotProtected(email, what = 'sign in') {
  const e = String(email || '').trim().toLowerCase()
  if (PROTECTED_ACCOUNTS.has(e)) {
    throw new Error(
      `REFUSING to ${what} as ${e} — that is a real person's account.\n` +
      `Use ${TEST_LEARNER} for a learner, ${TEST_ADMIN} for ssi_admin — both are\n` +
      `the defaults, so you get them by passing nothing at all.\n` +
      `See packages/player-vue/e2e/_test-accounts.mjs.`
    )
  }
  return e
}

// Resolve the account a harness should use: the env override if given, the
// dedicated learner otherwise — either way, checked.
export function testerEmail(envValue) {
  return assertNotProtected(envValue || TEST_LEARNER)
}

// Same, for a harness that needs ssi_admin rights. An ADMIN_EMAIL env
// override still goes through the guard: "I set an env var" is not a licence
// to drive the app as a human being.
export function adminEmail(envValue) {
  return assertNotProtected(envValue || TEST_ADMIN, 'sign in as admin')
}

// Create the dedicated learner if it does not exist yet. Idempotent: an
// "already registered" error is success. Takes the service-role client so
// this module stays free of key handling.
export async function ensureTestLearner(svcClient, email = TEST_LEARNER) {
  assertNotProtected(email, 'create')
  const { error } = await svcClient.auth.admin.createUser({ email, email_confirm: true })
  if (error && !/already|exists|registered/i.test(error.message)) throw error
  return email
}

// Create the dedicated admin if it does not exist yet, and make sure it
// actually carries ssi_admin. Idempotent, and it only ever touches ITS OWN
// learners row — never anybody else's, never a progress row.
export async function ensureTestAdmin(svcClient, email = TEST_ADMIN) {
  assertNotProtected(email, 'create')
  const { data, error } = await svcClient.auth.admin.createUser({ email, email_confirm: true })
  if (error && !/already|exists|registered/i.test(error.message)) throw error
  let uid = data?.user?.id
  if (!uid) {
    // Already registered: find it. listUsers is paged; the harness fleet is
    // small enough that walking it is cheaper than adding a lookup endpoint.
    for (let page = 1; ; page++) {
      const { data: d, error: e } = await svcClient.auth.admin.listUsers({ page, perPage: 1000 })
      if (e) throw e
      const u = d.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
      if (u) { uid = u.id; break }
      if (d.users.length < 1000) throw new Error(`${email} exists in auth but could not be found`)
    }
  }
  const { data: rows, error: serr } = await svcClient.from('learners').select('id,platform_role').eq('user_id', uid)
  if (serr) throw serr
  if (!rows?.length) {
    const { error: ierr } = await svcClient.from('learners')
      .insert({ user_id: uid, display_name: 'e2e admin (harness)', platform_role: 'ssi_admin', is_internal: true })
    if (ierr) throw ierr
  } else if (rows[0].platform_role !== 'ssi_admin') {
    const { error: uerr } = await svcClient.from('learners')
      .update({ platform_role: 'ssi_admin', is_internal: true }).eq('user_id', uid)
    if (uerr) throw uerr
  }
  return { email, userId: uid }
}
