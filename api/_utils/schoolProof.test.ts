/**
 * TOM'S RULING 1 (job #195, 2026-09-18): "An unproven school can build but
 * not enrol." The rule as a predicate, and its fail-closed reads.
 */
import { describe, it, expect } from 'vitest'
import { enrolmentHeldFor, schoolEnrolmentHeld, classEnrolmentHeld, SCHOOL_VOUCH_KEY } from './schoolProof'

const door = { onboarded_via: 'possession', setup_door: 'school' }

describe('enrolmentHeldFor — the pure rule', () => {
  it('holds a door-founded school whose founder has proved nothing', () => {
    expect(enrolmentHeldFor({ metadata: door, appMetadata: {}, primaryEmail: 'head@school.wales', verifiedEmails: ['head@school.wales'] })).toBe(true)
  })
  it('never holds a school that did not come through the door', () => {
    expect(enrolmentHeldFor({ metadata: { onboarded_via: 'possession' }, appMetadata: {}, primaryEmail: 'a@b.c', verifiedEmails: [] })).toBe(false)
    expect(enrolmentHeldFor({ metadata: {}, appMetadata: {}, primaryEmail: 'a@b.c', verifiedEmails: [] })).toBe(false)
    expect(enrolmentHeldFor({ metadata: null, appMetadata: null, primaryEmail: null, verifiedEmails: null })).toBe(false)
  })
  it('opens when the founder proved the school address', () => {
    expect(enrolmentHeldFor({ metadata: { ...door, email_confirmed_manually: true }, appMetadata: {}, primaryEmail: 'head@school.wales', verifiedEmails: [] })).toBe(false)
  })
  it('opens when the founder proved a DIFFERENT mailbox from the banner — the Hwb case', () => {
    expect(enrolmentHeldFor({ metadata: door, appMetadata: {}, primaryEmail: 'head@hwbcymru.net', verifiedEmails: ['head@hwbcymru.net', 'Head.Personal@Gmail.com'] })).toBe(false)
  })
  it('the primary address in verified_emails proves nothing on its own', () => {
    expect(enrolmentHeldFor({ metadata: door, appMetadata: {}, primaryEmail: 'Head@School.wales', verifiedEmails: ['head@school.wales'] })).toBe(true)
  })
  it('opens when an admin vouched', () => {
    expect(enrolmentHeldFor({ metadata: door, appMetadata: { [SCHOOL_VOUCH_KEY]: { school_id: 's1', by: 'admin', at: 'now' } }, primaryEmail: 'a@b.c', verifiedEmails: [] })).toBe(false)
  })
})

function svcWith(opts: {
  school?: { data: any; error: any }
  founder?: { data: any; error: any }
  learner?: { data: any; error: any }
  cls?: { data: any; error: any }
}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              table === 'schools' ? (opts.school ?? { data: null, error: null })
              : table === 'classes' ? (opts.cls ?? { data: null, error: null })
              : (opts.learner ?? { data: null, error: null }),
            ),
        }),
      }),
    }),
    auth: { admin: { getUserById: () => Promise.resolve(opts.founder ?? { data: { user: null }, error: null }) } },
  } as any
}

describe('schoolEnrolmentHeld — reads, and fails CLOSED', () => {
  it('holds when the school cannot be read', async () => {
    expect(await schoolEnrolmentHeld(svcWith({ school: { data: null, error: { message: 'down' } } }), 's1')).toBe(true)
  })
  it('holds when the founder cannot be read', async () => {
    expect(await schoolEnrolmentHeld(svcWith({ school: { data: { admin_user_id: 'u1' }, error: null }, founder: { data: { user: null }, error: { message: 'down' } } }), 's1')).toBe(true)
  })
  it('opens a school with no founder pointer — never door-founded', async () => {
    expect(await schoolEnrolmentHeld(svcWith({ school: { data: { admin_user_id: null }, error: null } }), 's1')).toBe(false)
  })
  it('holds a door-founded school and opens it once proved', async () => {
    const school = { data: { admin_user_id: 'u1' }, error: null }
    const unproved = { data: { user: { id: 'u1', email: 'head@school.wales', user_metadata: door, app_metadata: {} } }, error: null }
    expect(await schoolEnrolmentHeld(svcWith({ school, founder: unproved }), 's1')).toBe(true)
    const proved = { data: { user: { id: 'u1', email: 'head@school.wales', user_metadata: { ...door, email_confirmed_manually: true }, app_metadata: {} } }, error: null }
    expect(await schoolEnrolmentHeld(svcWith({ school, founder: proved }), 's1')).toBe(false)
  })
})

describe('classEnrolmentHeld', () => {
  it('opens a class with no school — a tutor or group class was never door-founded', async () => {
    expect(await classEnrolmentHeld(svcWith({ cls: { data: { school_id: null }, error: null } }), 'c1')).toBe(false)
  })
  it('holds when the class cannot be read', async () => {
    expect(await classEnrolmentHeld(svcWith({ cls: { data: null, error: { message: 'down' } } }), 'c1')).toBe(true)
  })
})
