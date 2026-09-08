import { describe, it, expect } from 'vitest'
import { flatViewLanding, PLACE_ROUTE_NAMES } from './flatViewLanding'

const leader = { groupId: 'g1', schoolId: null, isGovtAdmin: true, isSchoolAdmin: false }
const admin = { groupId: null, schoolId: 's1', isGovtAdmin: false, isSchoolAdmin: true }
const teacher = { groupId: null, schoolId: 's1', isGovtAdmin: false, isSchoolAdmin: false }

describe('flatViewLanding (one rule for the container and the Handbook)', () => {
  it('sends a group-scoped leader from the schools list and analytics to their node', () => {
    expect(flatViewLanding('schools-list', leader)).toEqual({ path: '/org/g1', query: { lens: 'schools' } })
    expect(flatViewLanding('analytics', leader)).toBe('/org/g1/insights')
    expect(flatViewLanding('teachers', leader)).toBe(null)
  })
  it('sends a school-scoped admin from dashboard, teachers and analytics to their school node', () => {
    expect(flatViewLanding('schools-dashboard', admin)).toBe('/org/s1')
    expect(flatViewLanding('teachers', admin)).toEqual({ path: '/org/s1', query: { lens: 'teachers' } })
    expect(flatViewLanding('analytics', admin)).toBe('/org/s1/insights')
    expect(flatViewLanding('classes', admin)).toBe(null)
  })
  it('leaves teachers and legacy rows on the flat views', () => {
    expect(flatViewLanding('teachers', teacher)).toBe(null)
    expect(flatViewLanding('schools-dashboard', { ...admin, schoolId: null })).toBe(null)
    expect(flatViewLanding('schools-list', { ...leader, groupId: null })).toBe(null)
  })
  it('names a route for every place the Handbook may need to ask about', () => {
    for (const place of ['teachers', 'dashboard', 'analytics', 'schools-list']) expect(PLACE_ROUTE_NAMES[place]).toBeTruthy()
  })
})
