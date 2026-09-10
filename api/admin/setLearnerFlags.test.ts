import { describe, it, expect } from 'vitest'
import { parseFlagChange } from './set-learner-flags'

// The verb that corrects a population flag: only the two flags, only
// booleans, at least one, and always a reason — a flag flip with no reason
// is the next person's mystery.
describe('correcting a flag', () => {
  it('accepts one or both flags with a reason', () => {
    expect(parseFlagChange({ is_demo: false, reason: 'real customer, marked demo by the 2026-05 batch' }))
      .toEqual({ change: { is_demo: false }, reason: 'real customer, marked demo by the 2026-05 batch' })
    expect(parseFlagChange({ is_demo: false, is_internal: false, reason: 'left SSi, now a learner' }))
      .toEqual({ change: { is_demo: false, is_internal: false }, reason: 'left SSi, now a learner' })
  })

  it('refuses a change with no flag, a non-boolean, or no reason', () => {
    expect(parseFlagChange({ reason: 'x' })).toEqual({ error: 'name at least one flag: is_demo or is_internal' })
    expect(parseFlagChange({ is_demo: 'no', reason: 'x' })).toEqual({ error: 'is_demo must be true or false' })
    expect(parseFlagChange({ is_internal: true })).toEqual({ error: 'reason is required — say why the flag was wrong' })
  })
})
