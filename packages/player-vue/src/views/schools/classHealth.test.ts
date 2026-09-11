import { describe, it, expect } from 'vitest'
import { deriveClassHealth } from './classHealth'

// Job #217, 2026-09-11. Ysgol Cas-gwent runs 34 classes as whole-class play
// from the front with NO pupil accounts, and every one of them read
// "Inactive" on the class list next to a row saying hours in the app this
// week — the rule said "no pupils means inactive" before it looked at
// whether the class had practised. The Handbook sentence for that column is
// "Health is worked out from how many of the last seven days the class
// practised on", and that is the rule pinned here.
describe('deriveClassHealth', () => {
  it('a class with no pupil accounts that practised as a class this week is NOT inactive — its days count', () => {
    expect(deriveClassHealth({ studentCount: 0, reportActiveDays: null, inAppActiveDays: 1 })).toBe('needs-attention')
    expect(deriveClassHealth({ studentCount: 0, reportActiveDays: null, inAppActiveDays: 2 })).toBe('good')
    expect(deriveClassHealth({ studentCount: 0, reportActiveDays: null, inAppActiveDays: 5 })).toBe('excellent')
  })
  it('a class with no pupil accounts and no play this week is inactive', () => {
    expect(deriveClassHealth({ studentCount: 0, reportActiveDays: null, inAppActiveDays: 0 })).toBe('inactive')
  })
  it('classes with pupils keep the rule they had', () => {
    expect(deriveClassHealth({ studentCount: 12, reportActiveDays: null, inAppActiveDays: 0 })).toBe('good')
    expect(deriveClassHealth({ studentCount: 12, reportActiveDays: 0, inAppActiveDays: 0 })).toBe('needs-attention')
    expect(deriveClassHealth({ studentCount: 12, reportActiveDays: 2, inAppActiveDays: 0 })).toBe('good')
    expect(deriveClassHealth({ studentCount: 12, reportActiveDays: 5, inAppActiveDays: 0 })).toBe('excellent')
  })
  it('the higher of the two day counts wins — the diary sees whole-class play the report cannot', () => {
    expect(deriveClassHealth({ studentCount: 12, reportActiveDays: 1, inAppActiveDays: 5 })).toBe('excellent')
  })
})
