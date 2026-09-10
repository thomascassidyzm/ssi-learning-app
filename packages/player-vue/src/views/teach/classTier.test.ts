/**
 * Which price tier a class sells its student seat at — the CLIENT's copy of
 * the rule the webhook enforces server-side (api/teacher/paddle-webhook.ts,
 * handleStudentSubscription). Until 2026-09-10 WithTeacher.vue tested
 * school_id alone while by-code.ts and the webhook tested school_id OR
 * group_id, so a group-only class showed £10 for a seat the webhook locked at
 * £5. Zero rows were affected; it bit the first time a group existed.
 */
import { describe, it, expect } from 'vitest'
import { isOrgOwnedClass } from './classTier'

describe('isOrgOwnedClass — school_id OR group_id, same as the webhook', () => {
  it('a school class is org-owned', () => {
    expect(isOrgOwnedClass({ school_id: 'school-1', group_id: null })).toBe(true)
  })
  it('a group-only class is org-owned (commissions never stack)', () => {
    expect(isOrgOwnedClass({ school_id: null, group_id: 'grp-1' })).toBe(true)
  })
  it('a class with neither is a tutor class', () => {
    expect(isOrgOwnedClass({ school_id: null, group_id: null })).toBe(false)
    expect(isOrgOwnedClass({ school_id: null })).toBe(false)
    expect(isOrgOwnedClass(null)).toBe(false)
  })
})
