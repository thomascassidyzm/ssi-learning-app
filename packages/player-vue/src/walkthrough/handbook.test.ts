// The Handbook's data layer. The point of these tests is the two founder
// rulings of 2026-09-07: the page shows EVERY capability badged by role, and
// nothing on it is a hand-written list — every entry comes from the compiled
// pack, which the compiler will not emit unless the anchor is still live.
import { describe, it, expect } from 'vitest'
import {
  HANDBOOK_SECTIONS, ROLE_BADGES, handbookEntries, handbookSections,
  searchHandbook, viewerPersona, isMine, badgesFor, placeLink, PLACE_LINKS,
  type HandbookEntry,
} from './handbook'

const entry = (over: Partial<HandbookEntry> = {}): HandbookEntry => ({
  id: 'e', title: 'Bring your first teacher in', section: 'getting-people-in',
  personas: ['school_admin'], keywords: ['teacher', 'invite'],
  place: { route: 'node-home' }, anchor: 'verb-invite-person', walk: 'invite-first-teacher',
  what: 'Getting a colleague in.', where: 'Your school home page.', how: ['Tap invite.'],
  ...over,
})

describe('the compiled pack, read as a map', () => {
  it('carries entries, each with prose and a live anchor', () => {
    const all = handbookEntries()
    expect(all.length).toBeGreaterThan(0)
    for (const e of all) {
      expect(e.what.trim()).not.toBe('')
      expect(e.where.trim()).not.toBe('')
      expect(e.how.length).toBeGreaterThan(0)
      expect(e.anchor).toBeTruthy()
      expect(HANDBOOK_SECTIONS.some((s) => s.id === e.section)).toBe(true)
    }
  })
  it('never carries a learner-only entry — the handbook is the non-learner map', () => {
    for (const e of handbookEntries()) {
      expect(e.personas.some((p) => p !== 'learner')).toBe(true)
    }
  })
  it('groups into sections in reading order, dropping empty ones', () => {
    const sections = handbookSections([entry(), entry({ id: 'f', section: 'your-school' })])
    expect(sections.map((s) => s.id)).toEqual(['getting-people-in', 'your-school'])
  })
})

describe('role badges (founder ruling: show everything, badged)', () => {
  it('badges an entry that is not yours with whose it is', () => {
    expect(badgesFor(entry({ personas: ['school_admin'] }), 'teacher')).toEqual([ROLE_BADGES.school_admin])
  })
  it('badges nothing on your own capabilities — you already know', () => {
    expect(badgesFor(entry({ personas: ['teacher', 'school_admin'] }), 'teacher')).toEqual([])
  })
  it('has a label for every persona it can be handed', () => {
    for (const p of Object.keys(ROLE_BADGES)) expect(ROLE_BADGES[p as keyof typeof ROLE_BADGES]).toBeTruthy()
  })
  it('reads the reader\'s persona off the roles the rest of the app gates on', () => {
    expect(viewerPersona('ssi_admin', 'teacher')).toBe('admin')
    expect(viewerPersona(null, 'govt_admin')).toBe('leader')
    expect(viewerPersona(null, 'school_admin')).toBe('school_admin')
    expect(viewerPersona(null, 'teacher')).toBe('teacher')
    // A tutor is a groupless teacher, not a separate role.
    expect(viewerPersona(null, 'tutor')).toBe('teacher')
    expect(viewerPersona(null, 'student')).toBe('learner')
    expect(viewerPersona(null, null)).toBe('learner')
  })
  it('knows which entries are the reader\'s own', () => {
    expect(isMine(entry({ personas: ['teacher'] }), 'teacher')).toBe(true)
    expect(isMine(entry({ personas: ['admin'] }), 'teacher')).toBe(false)
  })
})

describe('search', () => {
  const list = [entry(), entry({ id: 'f', title: 'Run your first class session', keywords: ['session'], what: 'Practice together.' })]
  it('returns everything for an empty query', () => {
    expect(searchHandbook('', list)).toHaveLength(2)
  })
  it('requires every word to appear somewhere', () => {
    expect(searchHandbook('teacher invite', list).map((e) => e.id)).toEqual(['e'])
    expect(searchHandbook('teacher nonsense', list)).toEqual([])
  })
  it('ranks a title hit above a body-only hit', () => {
    const hits = searchHandbook('session', list)
    expect(hits[0].id).toBe('f')
  })
})

describe('place links', () => {
  it('resolves a node place against the reader\'s own node', () => {
    expect(placeLink(entry({ place: { route: 'node-home' } }), 'abc')).toBe('/org/abc')
    expect(placeLink(entry({ place: { route: 'node-home' } }), '')).toBeNull()
  })
  it('resolves the flat schools views without a node', () => {
    expect(placeLink(entry({ place: { route: 'teachers' } }), '')).toBe('/schools/teachers')
  })
  it('has a target for every place any entry actually uses', () => {
    for (const e of handbookEntries()) {
      expect(PLACE_LINKS[e.place.route], e.place.route).toBeTypeOf('function')
    }
  })
})

// ONE PACK, TWO SURFACES (2026-09-10). The intelligence surface describes its
// capabilities with the same comment mechanism under data-intel, and the
// compiler stamps each entry with the surface its anchor belongs to. The
// schools Handbook page must show its own only — an SSi-internal capability
// under "Seeing how it is going" would be noise to a teacher — and the
// intelligence surface must be able to find its own from the same pack.
describe('one compiled pack carries two surfaces', () => {
  it('keeps the intelligence surface out of the schools handbook by default', () => {
    const schools = handbookEntries()
    expect(schools.length).toBeGreaterThan(0)
    expect(schools.every((e) => (e.surface ?? 'schools') === 'schools')).toBe(true)
    expect(schools.some((e) => e.place.route === 'intel')).toBe(false)
  })

  it('hands the intelligence surface its own entries, every one anchored there', () => {
    const intel = handbookEntries('intel')
    expect(intel.length).toBeGreaterThan(0)
    expect(intel.every((e) => e.surface === 'intel' && e.place.route === 'intel')).toBe(true)
  })
})
