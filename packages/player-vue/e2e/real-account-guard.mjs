// REAL-ACCOUNT GUARD (2026-09-07) — shared by every probe that signs in as a
// human and therefore writes to that human's real row.
//
// Lifted verbatim in shape from the guard already in e2e/journeys/run.mjs
// (af71301f). The rule it enforces is the estate's standing ruling: NEVER
// TOUCH LEARNER PROGRESS. A probe that mints a session and drives the app is
// machine entry on whatever row it signs into, so "which human's account
// should this machine touch" has no safe default — and so there isn't one.
//
// Behaviour:
//   - the account must be named explicitly in an env var; no fallback, ever
//   - a handful of known real accounts are refused even when passed explicitly
//   - either failure is a refusal: a message saying why and what to set, and
//     process.exit(1)
//
// Add a real address here the moment you learn of one. The cost of a false
// refusal is one env var; the cost of a miss is progress written on a human.
export const REAL_ACCOUNT_DENYLIST = new Set([
  'thomas.cassidy+ssi@gmail.com', // the founder's own ssi_admin + learner row
  'thomas.cassidy@gmail.com',
  'tomcassidy@mac.com',
])

const ACCOUNT_ENV_VARS = ['TESTER_EMAIL', 'ADMIN_EMAIL', 'TEACHER_EMAIL', 'LEADER_EMAIL']

function refuse(message) {
  console.error(message)
  process.exit(1)
}

/**
 * Refuse if ANY account env var holds a real human account, whichever var this
 * particular script happens to read. Called automatically by requireAccount(),
 * so a script can never be talked into a real address through the back door.
 */
export function assertNoRealAccountsInEnv() {
  for (const name of ACCOUNT_ENV_VARS) {
    const v = process.env[name]
    if (v && REAL_ACCOUNT_DENYLIST.has(v.trim().toLowerCase())) {
      refuse(`${name} "${v}" is a real human account, not a test account. This probe refuses to sign in as a real person and enter progress on their row. Use a disposable test alias instead.`)
    }
  }
}

/**
 * The account this probe should sign in as, or a refusal.
 *
 * @param {string} varName  env var to read, e.g. 'TESTER_EMAIL' / 'ADMIN_EMAIL'
 * @param {string} purpose  one clause saying what the probe does with the account,
 *                          so the refusal message explains itself
 * @param {string} [example] a disposable alias to suggest
 */
export function requireAccount(varName, purpose, example = 'thomas.cassidy+bumface@gmail.com') {
  assertNoRealAccountsInEnv()
  const raw = process.env[varName]
  if (!raw || !raw.trim()) {
    refuse(`${varName} is required. This probe refuses to run without an explicit target account — it ${purpose}. There is no default: pass a disposable test-account email, e.g. ${varName}=${example}.`)
  }
  return raw.trim()
}
