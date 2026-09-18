// The Handbook's data layer. The point of these tests is the two founder
// rulings of 2026-09-07: the page shows EVERY capability badged by role, and
// nothing on it is a hand-written list — every entry comes from the compiled
// pack, which the compiler will not emit unless the anchor is still live.
import { describe, it, expect } from 'vitest'
import {
  HANDBOOK_SECTIONS, HANDBOOK_MOMENTS, ROLE_BADGES, handbookEntries, handbookSections,
  handbookMoments, entriesOnPage, showMeOnPage, nextThree, stateFromHome,
  searchHandbook, viewerPersona, isMine, badgesFor, placeLink, PLACE_LINKS, clipsFor,
  type HandbookEntry,
} from './handbook'

const entry = (over: Partial<HandbookEntry> = {}): HandbookEntry => ({
  id: 'e', title: 'Bring your first teacher in', section: 'getting-people-in',
  personas: ['school_admin'], keywords: ['teacher', 'invite'],
  moment: 'setting-up',
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

describe('clipsFor — every clip that shows a capability (job #627)', () => {
  it('names the hand-linked walk first, then every walk that steps on the anchor, for the reader\'s persona only', () => {
    const e = entry({ anchor: 'verb-invite-person', walk: 'invite-first-person' })
    expect(clipsFor(e, 'leader')).toEqual(['invite-first-person', 'invite-first-teacher'])
    expect(clipsFor(e, 'school_admin')).toEqual(['invite-first-teacher'])
    expect(clipsFor(e, 'teacher')).toEqual([])
  })
  it('finds a clip for an entry with no walk: line when a walk passes through its anchor', () => {
    expect(clipsFor(entry({ anchor: 'invite-form-role', walk: null }), 'leader')).toEqual(['invite-first-person', 'invite-first-teacher'])
    expect(clipsFor(entry({ anchor: 'no-such-anchor', walk: null }), 'leader')).toEqual([])
  })
  it('a school admin has clips for the account card on their own home', () => {
    const ids = handbookEntries().filter((e) => e.personas.includes('school_admin')).flatMap((e) => clipsFor(e, 'school_admin'))
    expect(ids).toContain('install-the-app')
    expect(ids).toContain('set-your-password')
  })
})

// ---------------------------------------------------------------------------
// GROUPED BY MOMENT (job #5, 2026-09-16). Tom: "the whole list is a bit
// overwhelming" — 109 entries showed a teacher 49 and a school leader 80.
// ---------------------------------------------------------------------------
describe('moments', () => {
  it('gives every compiled entry exactly one moment the runtime knows', () => {
    const known = new Set(HANDBOOK_MOMENTS.map((m) => m.id))
    for (const e of handbookEntries()) {
      expect(e.moment, `${e.id} carries no moment`).toBeTruthy()
      expect(known.has(e.moment), `${e.id} carries unknown moment "${e.moment}"`).toBe(true)
    }
  })

  it('groups in frequency order, dropping empty ones', () => {
    const groups = handbookMoments([
      entry({ moment: 'something-wrong' }),
      entry({ id: 'f', moment: 'setting-up' }),
    ])
    expect(groups.map((g) => g.id)).toEqual(['setting-up', 'something-wrong'])
  })

  // Tom's cap, 2026-09-16: "the handful that matter — cap at ~6 for a teacher".
  // A teacher standing in front of a class should not be reading a list.
  it('keeps a teacher\'s "Every lesson" to six or fewer', () => {
    const mine = handbookEntries().filter((e) => isMine(e, 'teacher') && e.moment === 'every-lesson')
    expect(mine.length, mine.map((e) => e.id).join(', ')).toBeLessThanOrEqual(6)
  })
})

// ---------------------------------------------------------------------------
// THE PER-PAGE SHOW-ME LIST — membership is the compiler-derived anchor →
// route map, so a page offers the clips for the controls that are ON it.
// ---------------------------------------------------------------------------
describe('the page\'s own Show-me list', () => {
  it('REGRESSION: the Teachers page offers exactly the five clips it carried by hand', () => {
    const ids = showMeOnPage(['/schools/teachers'], 'school_admin', 'teachers')
    expect([...ids].sort()).toEqual([
      'add-teacher-by-name',
      'hand-a-teacher-access-code',
      'invite-a-teacher-to-your-school',
      'remove-a-teacher',
      'take-a-teacher-off-a-class',
    ])
  })

  it('takes only the reader\'s own capabilities', () => {
    const list = [
      entry({ id: 'mine', moment: 'every-lesson', personas: ['teacher'], routes: ['/schools/x'] }),
      entry({ id: 'theirs', moment: 'every-lesson', personas: ['school_admin'], routes: ['/schools/x'] }),
    ]
    expect(entriesOnPage(['/schools/x'], 'teacher', undefined, list).map((e) => e.id)).toEqual(['mine'])
  })

  it('orders by the page\'s own moment order, not alphabetically', () => {
    const list = [
      entry({ id: 'c', title: 'A', moment: 'something-wrong', routes: ['/p'] }),
      entry({ id: 'b', title: 'B', moment: 'every-lesson', routes: ['/p'] }),
      entry({ id: 'a', title: 'C', moment: 'setting-up', routes: ['/p'] }),
    ]
    expect(entriesOnPage(['/p'], 'school_admin', undefined, list).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('falls back to the authored place only for an anchor no routed view reaches', () => {
    const list = [entry({ id: 'orphan', routes: [], place: { route: 'teachers' } })]
    expect(entriesOnPage(['/schools/teachers'], 'school_admin', 'teachers', list).map((e) => e.id)).toEqual(['orphan'])
    expect(entriesOnPage(['/schools/teachers'], 'school_admin', 'students', list)).toEqual([])
  })

  it('reads a nested route as its own page and its parent\'s', () => {
    const list = [entry({ id: 'parent', routes: ['/schools'] })]
    expect(entriesOnPage(['/schools', '/schools/classes/:id'], 'school_admin', undefined, list)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// YOUR NEXT THREE — one state model, read twice. The signals are the ones the
// node home's Last Step banner and the noticing rules already evaluate.
// ---------------------------------------------------------------------------
describe('your next three', () => {
  it('lifts the same fields the Last Step banner and the noticing rules read', () => {
    const state = stateFromHome({
      node: { rollup: { learnerCount: 0, teacherCount: 2, classCount: 3 } },
      classPractice: { activeClasses7d: 0, inAppMinutes7d: 0 },
    })
    expect(state).toEqual({ learnerCount: 0, teacherCount: 2, classCount: 3, activeClasses7d: 0, inAppMinutes7d: 0 })
  })

  it('answers a school with no pupils with the way pupils get in', () => {
    // The signal names three anchors in preference order and takes the first
    // this reader actually has: a school admin gets the invite verb, a teacher
    // the class join link, which is theirs alone.
    expect(nextThree({ learnerCount: 0, teacherCount: 2, classCount: 3 }, 'school_admin').map((e) => e.anchor)[0])
      .toBe('verb-invite-student')
    expect(nextThree({ learnerCount: 0, teacherCount: 2, classCount: 3 }, 'teacher').map((e) => e.anchor)[0])
      .toBe('class-join-link')
  })

  it('answers a school that has pupils and no play this week with play as class', () => {
    const picked = nextThree({ learnerCount: 40, teacherCount: 2, classCount: 3, inAppMinutes7d: 0 }, 'teacher')
    // The dashboard's own class card went when the dashboard folded into My
    // Classes (job #999), so the play the reader is pointed at is the one on
    // the class page — the only Play as class a teacher now has.
    expect(picked[0].anchor).toBe('class-page-play')
  })

  it('falls back to the top of Every lesson when no signal applies', () => {
    const picked = nextThree({}, 'teacher')
    expect(picked).toHaveLength(3)
    for (const e of picked) expect(e.moment).toBe('every-lesson')
  })

  it('never offers a capability the reader does not have', () => {
    for (const persona of ['teacher', 'school_admin', 'leader'] as const) {
      for (const e of nextThree({ learnerCount: 0 }, persona)) expect(isMine(e, persona)).toBe(true)
    }
  })
})
