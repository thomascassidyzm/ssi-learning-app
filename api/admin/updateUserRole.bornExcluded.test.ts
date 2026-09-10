import { describe, it, expect } from 'vitest'
import { bornExcludedFor } from './update-user-role'

// Verb 8 of the intelligence surface, born excluded: a role change that
// makes somebody staff marks them internal in the same write, and a change
// away from staff leaves the flag alone — a flag is corrected on purpose,
// through set-learner-flags, never as a side effect.
describe('changing what someone is', () => {
  it('marks a new admin, tester or Popty user internal in the same update', () => {
    expect(bornExcludedFor('platform_role', 'ssi_admin')).toEqual({ is_internal: true })
    expect(bornExcludedFor('platform_role', 'tester')).toEqual({ is_internal: true })
    expect(bornExcludedFor('platform_role', 'popty_user')).toEqual({ is_internal: true })
  })

  it('does nothing on an educational role, or on taking a platform role away', () => {
    expect(bornExcludedFor('educational_role', 'teacher')).toEqual({})
    expect(bornExcludedFor('platform_role', null)).toEqual({})
  })
})
