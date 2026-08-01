/**
 * Unit tests for resolveOrgCourseCoverage — the org/workplace coverage lane.
 *
 * The behaviour that matters commercially: an org member is covered for as
 * long as the ORG's own clock is live, coverage is inherited by sub-groups
 * that carry no clock of their own, and it stops dead the moment the org's
 * trial elapses or its subscription cancels.
 *
 * Same fake-supabase idiom as api/entitlement/user.test.ts / classCoverage.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { resolveOrgCourseCoverage } from './orgCoverage'

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

let DB: {
  user_tags: any[]
  groups: any[]
  courses: any[]
}

function makeChainable(table: string) {
  let rows: any[] = [...((DB as any)[table] ?? [])]
  const builder: any = {
    select: () => builder,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder },
    is: (col: string, val: unknown) => {
      rows = rows.filter((r) => (val === null ? r[col] == null : r[col] === val))
      return builder
    },
    in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return builder },
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (resolve: any) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return builder
}

const svc: any = { from: (table: string) => makeChainable(table) }

beforeEach(() => {
  DB = {
    user_tags: [],
    groups: [],
    courses: [
      { course_code: 'spa_for_eng', new_app_status: 'live' },
      { course_code: 'cym_for_eng', new_app_status: 'beta' },
      { course_code: 'hidden_course', new_app_status: 'not_available' },
    ],
  }
})

function tagUserToGroup(groupId: string, userId = 'auth-uid-1') {
  DB.user_tags.push({
    user_id: userId, tag_type: 'group', tag_value: `GROUP:${groupId}`, removed_at: null,
  })
}

describe('resolveOrgCourseCoverage', () => {
  it('grants every live/beta course while the org trial is running', async () => {
    DB.groups.push({ id: 'org-1', parent_id: null, platform_status: 'trial', platform_expires_at: FUTURE })
    tagUserToGroup('org-1')

    const courses = await resolveOrgCourseCoverage(svc, 'auth-uid-1')

    // "Covering ALL languages" — but only the catalogue the paid-grant
    // expansion also uses; a not_available course is not a language on sale.
    expect(courses.sort()).toEqual(['cym_for_eng', 'spa_for_eng'])
  })

  it('grants every live/beta course for a PAID org', async () => {
    DB.groups.push({ id: 'org-1', parent_id: null, platform_status: 'active', platform_expires_at: FUTURE })
    tagUserToGroup('org-1')

    expect((await resolveOrgCourseCoverage(svc, 'auth-uid-1')).sort()).toEqual([
      'cym_for_eng', 'spa_for_eng',
    ])
  })

  it('grants nothing once the trial has elapsed', async () => {
    DB.groups.push({ id: 'org-1', parent_id: null, platform_status: 'trial', platform_expires_at: PAST })
    tagUserToGroup('org-1')

    expect(await resolveOrgCourseCoverage(svc, 'auth-uid-1')).toEqual([])
  })

  it.each(['expired', 'cancelled', 'past_due'])('grants nothing when the org is %s', async (status) => {
    DB.groups.push({ id: 'org-1', parent_id: null, platform_status: status, platform_expires_at: FUTURE })
    tagUserToGroup('org-1')

    expect(await resolveOrgCourseCoverage(svc, 'auth-uid-1')).toEqual([])
  })

  it('inherits coverage from the parent org for a member of a clock-less sub-group', async () => {
    // The live shape: 'Gwynedd Council' (the billed org) → 'Finance Dept'
    // (a sub-group, deliberately carrying no clock of its own).
    DB.groups.push(
      { id: 'org-1', parent_id: null, platform_status: 'active', platform_expires_at: FUTURE },
      { id: 'sub-1', parent_id: 'org-1', platform_status: null, platform_expires_at: null },
    )
    tagUserToGroup('sub-1')

    expect((await resolveOrgCourseCoverage(svc, 'auth-uid-1')).sort()).toEqual([
      'cym_for_eng', 'spa_for_eng',
    ])
  })

  it('stops covering a sub-group when the parent org lapses', async () => {
    DB.groups.push(
      { id: 'org-1', parent_id: null, platform_status: 'trial', platform_expires_at: PAST },
      { id: 'sub-1', parent_id: 'org-1', platform_status: null, platform_expires_at: null },
    )
    tagUserToGroup('sub-1')

    expect(await resolveOrgCourseCoverage(svc, 'auth-uid-1')).toEqual([])
  })

  it('answers from the NEAREST ancestor that has a clock, not the root', async () => {
    // A lapsed org under a live parent must stay locked — otherwise a
    // cancelled customer keeps access through an ancestor it does not pay for.
    DB.groups.push(
      { id: 'root', parent_id: null, platform_status: 'active', platform_expires_at: FUTURE },
      { id: 'org-1', parent_id: 'root', platform_status: 'cancelled', platform_expires_at: FUTURE },
      { id: 'sub-1', parent_id: 'org-1', platform_status: null, platform_expires_at: null },
    )
    tagUserToGroup('sub-1')

    expect(await resolveOrgCourseCoverage(svc, 'auth-uid-1')).toEqual([])
  })

  it('covers a member who is live in ANY one of several orgs', async () => {
    DB.groups.push(
      { id: 'org-dead', parent_id: null, platform_status: 'expired', platform_expires_at: PAST },
      { id: 'org-live', parent_id: null, platform_status: 'active', platform_expires_at: FUTURE },
    )
    tagUserToGroup('org-dead')
    tagUserToGroup('org-live')

    expect((await resolveOrgCourseCoverage(svc, 'auth-uid-1')).sort()).toEqual([
      'cym_for_eng', 'spa_for_eng',
    ])
  })

  it('grants nothing to a user with no org affiliation', async () => {
    DB.groups.push({ id: 'org-1', parent_id: null, platform_status: 'active', platform_expires_at: FUTURE })

    expect(await resolveOrgCourseCoverage(svc, 'auth-uid-1')).toEqual([])
  })

  it('ignores a removed affiliation', async () => {
    DB.groups.push({ id: 'org-1', parent_id: null, platform_status: 'active', platform_expires_at: FUTURE })
    DB.user_tags.push({
      user_id: 'auth-uid-1', tag_type: 'group', tag_value: 'GROUP:org-1', removed_at: PAST,
    })

    expect(await resolveOrgCourseCoverage(svc, 'auth-uid-1')).toEqual([])
  })

  it('ignores another user’s affiliation', async () => {
    DB.groups.push({ id: 'org-1', parent_id: null, platform_status: 'active', platform_expires_at: FUTURE })
    tagUserToGroup('org-1', 'someone-else')

    expect(await resolveOrgCourseCoverage(svc, 'auth-uid-1')).toEqual([])
  })

  it('terminates on a cyclic parent_id instead of hanging', async () => {
    DB.groups.push(
      { id: 'a', parent_id: 'b', platform_status: null, platform_expires_at: null },
      { id: 'b', parent_id: 'a', platform_status: null, platform_expires_at: null },
    )
    tagUserToGroup('a')

    expect(await resolveOrgCourseCoverage(svc, 'auth-uid-1')).toEqual([])
  })
})
