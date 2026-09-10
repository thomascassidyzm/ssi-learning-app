// PROPOSED fixture accounts for human and machine testing — 2026-09-10.
// Design: docs/testing/how-ssi-tests-the-frame-2026-09-10.md. NOT yet seeded;
// nothing reads this file yet. It exists so a probe can sign in BY REFERENCE
// (FIXTURES.wall.email) and never by a literal address, and so the set has a
// name that a person can hold in their head.
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

export const FIXTURE_COURSE = 'spa_for_eng'

export const FIXTURES = Object.freeze({
  fresh: {
    email: 'thomas.cassidy+colombo-fresh@gmail.com',
    platform_role: null,
    is_internal: true,
    position: null, // reset to blank before every pass
    purpose: 'brand-new learner, first belt change',
  },
  wall: {
    email: 'thomas.cassidy+colombo-wall@gmail.com',
    platform_role: null,
    is_internal: true,
    position: 'yellow-complete', // parked at the premium wall
    purpose: 'subscription wall, Maybe later, belt-complete moment',
  },
  premium: {
    email: 'thomas.cassidy+colombo-premium@gmail.com',
    platform_role: 'tester',
    is_internal: true,
    position: 'yellow-complete',
    purpose: 'everything past the wall; switches on the in-app feedback widget',
  },
})

// Positions are named, not numbered, so a belt threshold change moves them all at once.
// Values are the highest_completed_lego_id the seed writes on course_enrollments.
// TODO(seed): resolve 'yellow-complete' from the live belt table at seed time.
export const POSITIONS = Object.freeze({
  'yellow-complete': { belt: 'yellow', description: 'last LEGO of Yellow Belt played' },
})

export function fixture(name) {
  const f = FIXTURES[name]
  if (!f) throw new Error(`unknown fixture "${name}" — one of: ${Object.keys(FIXTURES).join(', ')}`)
  return f
}
