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

// Throws rather than returning false: a harness that ignores a boolean is the
// failure mode this file exists to remove.
export function assertNotProtected(email, what = 'sign in') {
  const e = String(email || '').trim().toLowerCase()
  if (PROTECTED_ACCOUNTS.has(e)) {
    throw new Error(
      `REFUSING to ${what} as ${e} — that is a real person's account.\n` +
      `Use ${TEST_LEARNER} (the default), or set TESTER_EMAIL to another test account.\n` +
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

// Create the dedicated learner if it does not exist yet. Idempotent: an
// "already registered" error is success. Takes the service-role client so
// this module stays free of key handling.
export async function ensureTestLearner(svcClient, email = TEST_LEARNER) {
  assertNotProtected(email, 'create')
  const { error } = await svcClient.auth.admin.createUser({ email, email_confirm: true })
  if (error && !/already|exists|registered/i.test(error.message)) throw error
  return email
}
