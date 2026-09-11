// Fixture accounts for human and machine testing — seeded 2026-09-10.
// Seeded and re-seeded by tools/test-accounts/seed.mjs. These accounts EXIST.
// This file exists so a probe signs in BY REFERENCE (FIXTURES.wall.email) and
// never by a literal address, and so the set has a name a person can hold in
// their head.
//
// Rules this file encodes:
//   - every address is a thomas.cassidy+colombo-* plus-address: unmistakable,
//     its mail lands with Tom, and the pattern is already in test_learner_ids().
//   - is_internal is set EXPLICITLY by the seed, never inferred from the address.
//   - real-account-guard.mjs is untouched: no default account, ever. These are
//     the accounts a probe may be TOLD to use, not ones it picks.
//   - premium comes from platform_role='tester', never from a subscription row.
//   - a seeded position is re-applied by delete+insert of the enrolment row,
//     because ratchet_highest_completed_round() refuses to lower a ceiling.
//
// Passwords are NOT here and never will be. They live in
// ~/.secrets/ssi-test-accounts.env, mode 600, outside every repo.

export const FIXTURE_COURSE = 'spa_for_eng'

export const FIXTURES = Object.freeze({
  fresh: {
    email: 'thomas.cassidy+colombo-fresh@gmail.com',
    displayName: 'Colombo fresh',
    platform_role: null,
    is_internal: true,
    position: null, // reset to blank before every pass
    purpose: 'brand-new learner, first belt change',
  },
  wall: {
    email: 'thomas.cassidy+colombo-wall@gmail.com',
    displayName: 'Colombo wall',
    platform_role: null,
    is_internal: true,
    position: 'yellow-complete', // parked at the premium wall
    purpose: 'subscription wall, Maybe later, belt-complete moment',
  },
  premium: {
    email: 'thomas.cassidy+colombo-premium@gmail.com',
    displayName: 'Colombo premium',
    platform_role: 'tester',
    is_internal: true,
    position: 'yellow-complete',
    purpose: 'everything past the wall; switches on the in-app feedback widget',
  },
})

// Positions are named, not numbered, so a belt threshold change moves them all
// at once. RESOLVED, not hard-coded: the seed reads the belt table below and
// the live course_legos rows to turn a name into a cursor at seed time.
//
// 'yellow-complete' means: the last LEGO of the last seed of Yellow Belt has
// been played. Yellow Belt ends at seed 19 — packages/core/src/pricing/types.ts,
// BELT_MAX_SEEDS.yellow — and seed 19 is exactly the premium preview ceiling,
// PREMIUM_PREVIEW_MAX_SEED, which is why this one position serves both the wall
// account and the premium account.
export const POSITIONS = Object.freeze({
  'yellow-complete': {
    belt: 'yellow',
    /** Resolved from BELT_MAX_SEEDS at seed time; the seed asserts it matches. */
    lastSeed: 19,
    /** The seed queries course_legos for the LAST lego_index of `lastSeed`. */
    resolve: 'last LEGO of the last seed of Yellow Belt',
    description: 'last LEGO of Yellow Belt played; the premium preview ceiling',
  },
})

export function fixture(name) {
  const f = FIXTURES[name]
  if (!f) throw new Error(`unknown fixture "${name}" — one of: ${Object.keys(FIXTURES).join(', ')}`)
  return f
}

export function position(name) {
  const p = POSITIONS[name]
  if (!p) throw new Error(`unknown position "${name}" — one of: ${Object.keys(POSITIONS).join(', ')}`)
  return p
}
