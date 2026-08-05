/**
 * deepLinkTarget — the Popty Script Viewer "open this round" contract.
 *
 * The rule that matters: an unusable target must degrade to "no override"
 * (normal resume), never to an error and never to a wrong round.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseDeepLinkTarget,
  deepLinkAppliesTo,
  deepLinkForcesLearnerDefaults,
  resolveDeepLinkTarget,
  resolveCycleIndex,
  getDeepLinkTarget,
  __resetDeepLinkTargetForTests,
} from './deepLinkTarget'

const map = {
  rounds: [
    { r: 1, legoId: 'S0001L01' },
    { r: 2, legoId: 'S0001L02' },
    { r: 7, legoId: 'S0002L02' },
  ],
}

describe('parseDeepLinkTarget', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('returns null when there is no target at all', () => {
    expect(parseDeepLinkTarget('?course=deu_for_eng')).toBeNull()
    expect(parseDeepLinkTarget('')).toBeNull()
  })

  it('reads lego, round and 1-based cycle', () => {
    expect(parseDeepLinkTarget('?course=deu_for_eng&round=7&lego=S0002L02&cycle=3')).toEqual({
      courseCode: 'deu_for_eng',
      legoId: 'S0002L02',
      round: 7,
      cycleIndex: 2,
      cycleText: null,
    })
  })

  it('accepts round on its own', () => {
    expect(parseDeepLinkTarget('?round=7')).toEqual({
      courseCode: null,
      legoId: null,
      round: 7,
      cycleIndex: null,
      cycleText: null,
    })
  })

  it('uppercases the lego id', () => {
    expect(parseDeepLinkTarget('?lego=s0002l02')?.legoId).toBe('S0002L02')
  })

  it('drops a malformed lego but keeps a usable round', () => {
    expect(parseDeepLinkTarget('?round=7&lego=not-a-lego')).toEqual({
      courseCode: null,
      legoId: null,
      round: 7,
      cycleIndex: null,
      cycleText: null,
    })
  })

  it('returns null when the only anchor is malformed', () => {
    expect(parseDeepLinkTarget('?lego=not-a-lego')).toBeNull()
  })

  it('ignores junk round and cycle values rather than guessing', () => {
    expect(parseDeepLinkTarget('?round=0&lego=S0002L02')?.round).toBeNull()
    expect(parseDeepLinkTarget('?round=-3&lego=S0002L02')?.round).toBeNull()
    expect(parseDeepLinkTarget('?round=abc&lego=S0002L02')?.round).toBeNull()
    expect(parseDeepLinkTarget('?lego=S0002L02&cycle=0')?.cycleIndex).toBeNull()
    expect(parseDeepLinkTarget('?lego=S0002L02&cycle=x')?.cycleIndex).toBeNull()
  })
})

describe('resolveDeepLinkTarget', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('resolves via the lego id when it is in the map', () => {
    expect(resolveDeepLinkTarget({ courseCode: null, legoId: 'S0002L02', round: 999, cycleIndex: 2, cycleText: null }, map)).toEqual({
      legoId: 'S0002L02',
      cycleIndex: 2,
      via: 'lego',
      cycleText: null,
    })
  })

  it('prefers the lego id over a disagreeing round number', () => {
    const r = resolveDeepLinkTarget({ courseCode: null, legoId: 'S0001L02', round: 7, cycleIndex: null, cycleText: null }, map)
    expect(r).toEqual({ legoId: 'S0001L02', cycleIndex: 0, via: 'lego', cycleText: null })
  })

  it('falls back to the round number when the lego is not in this course', () => {
    const r = resolveDeepLinkTarget({ courseCode: null, legoId: 'S9999L99', round: 7, cycleIndex: null, cycleText: null }, map)
    expect(r).toEqual({ legoId: 'S0002L02', cycleIndex: 0, via: 'round', cycleText: null })
  })

  it('returns null when neither anchor resolves', () => {
    expect(resolveDeepLinkTarget({ courseCode: null, legoId: 'S9999L99', round: 4242, cycleIndex: null, cycleText: null }, map)).toBeNull()
  })

  it('returns null for a missing target or an empty map', () => {
    expect(resolveDeepLinkTarget(null, map)).toBeNull()
    expect(resolveDeepLinkTarget({ courseCode: null, legoId: 'S0002L02', round: null, cycleIndex: null, cycleText: null }, null)).toBeNull()
    expect(resolveDeepLinkTarget({ courseCode: null, legoId: 'S0002L02', round: null, cycleIndex: null, cycleText: null }, { rounds: [] })).toBeNull()
  })
})

describe('getDeepLinkTarget', () => {
  beforeEach(() => {
    __resetDeepLinkTargetForTests()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('captures the target once and keeps it after the URL is rewritten', () => {
    const original = window.location.search
    try {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: '?course=deu_for_eng&round=7&lego=S0002L02' },
        writable: true,
        configurable: true,
      })
      expect(getDeepLinkTarget()?.legoId).toBe('S0002L02')
      ;(window as any).location.search = '?course=deu_for_eng'
      expect(getDeepLinkTarget()?.legoId).toBe('S0002L02')
    } finally {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: original },
        writable: true,
        configurable: true,
      })
    }
  })

  it('honours an explicit search override without caching it', () => {
    expect(getDeepLinkTarget('?round=2')).toEqual({
      courseCode: null,
      legoId: null,
      round: 2,
      cycleIndex: null,
      cycleText: null,
    })
  })
})

describe('deepLinkAppliesTo', () => {
  const forGerman = parseDeepLinkTarget('?course=deu_for_eng&round=7&lego=S0002L02')

  it('applies to the course the link named', () => {
    expect(deepLinkAppliesTo(forGerman, 'deu_for_eng')).toBe(true)
  })

  it('does not follow the visitor into another course', () => {
    expect(deepLinkAppliesTo(forGerman, 'fra_for_eng')).toBe(false)
    expect(deepLinkAppliesTo(forGerman, null)).toBe(false)
  })

  it('a link naming no course applies wherever it lands', () => {
    expect(deepLinkAppliesTo(parseDeepLinkTarget('?round=7'), 'fra_for_eng')).toBe(true)
  })

  it('is false without a target', () => {
    expect(deepLinkAppliesTo(null, 'deu_for_eng')).toBe(false)
  })
})

describe('deepLinkForcesLearnerDefaults', () => {
  it('forces defaults for the course the link named', () => {
    const t = parseDeepLinkTarget('?course=deu_for_eng&round=7&lego=S0002L02')
    expect(deepLinkForcesLearnerDefaults(t, 'deu_for_eng')).toBe(true)
  })

  it('leaves a normal visit alone', () => {
    expect(deepLinkForcesLearnerDefaults(null, 'deu_for_eng')).toBe(false)
    expect(deepLinkForcesLearnerDefaults(parseDeepLinkTarget('?course=deu_for_eng'), 'deu_for_eng')).toBe(false)
  })

  it('does not force defaults in a course the link did not name', () => {
    const t = parseDeepLinkTarget('?course=deu_for_eng&round=7')
    expect(deepLinkForcesLearnerDefaults(t, 'fra_for_eng')).toBe(false)
  })
})

describe('resolveCycleIndex — identity beats ordinal', () => {
  // The real deu_for_eng round 11 (S0003L03) as the PLAYER enumerates it.
  // Popty's Script Viewer omits the bare-LEGO build at index 2 and orders the
  // USE phrases differently, which is what made a bare ordinal land one early.
  const round11 = [
    'how to speak as often as possible',
    'how to speak as often as possible',
    'How to speak as often as possible',
    'I want to learn how to speak as often as possible',
    "I'm trying to learn how to speak as often as possible",
    'I want to learn now how to speak as often as possible',
    'I want to learn with you how to speak as often as possible',
    "I'm trying to learn how to speak",
    'I want to learn now how to speak',
    'I want to learn with you how to speak',
    "I'm trying to learn German as often as possible",
    "I'm trying to learn German with you",
    'I want to learn now',
    'I want to speak German',
  ].map(text => ({ known: { text } }))

  it("lands on Tom's clicked row, not the one above it (the 2026-08-06 repro)", () => {
    // Popty showed "I want to speak German" at its index 12 and sent cycle=13.
    // The ordinal alone resolves to 12 — "I want to learn now", one early.
    expect(resolveCycleIndex(round11, { cycleIndex: 12, cycleText: null })).toBe(12)
    expect(round11[12].known.text).toBe('I want to learn now')
    // With the text anchor it lands on the row that was actually clicked.
    expect(resolveCycleIndex(round11, { cycleIndex: 12, cycleText: 'I want to speak German' })).toBe(13)
  })

  it('matches regardless of case and punctuation differences between the two sides', () => {
    expect(resolveCycleIndex(round11, { cycleIndex: 0, cycleText: 'how to speak, as often as possible!' })).toBe(0)
    expect(resolveCycleIndex(round11, { cycleIndex: 5, cycleText: "I'M TRYING TO LEARN GERMAN WITH YOU" })).toBe(11)
  })

  it('breaks a genuine duplicate tie toward the ordinal, never back to the top', () => {
    const dup = ['a', 'target', 'b', 'c', 'target'].map(text => ({ known: { text } }))
    expect(resolveCycleIndex(dup, { cycleIndex: 4, cycleText: 'target' })).toBe(4)
    expect(resolveCycleIndex(dup, { cycleIndex: 0, cycleText: 'target' })).toBe(1)
  })

  it('degrades to the ordinal when the text is absent, unmatched, or the round is empty', () => {
    expect(resolveCycleIndex(round11, { cycleIndex: 3, cycleText: null })).toBe(3)
    expect(resolveCycleIndex(round11, { cycleIndex: 3, cycleText: 'not in this round at all' })).toBe(3)
    expect(resolveCycleIndex([], { cycleIndex: 3, cycleText: 'anything' })).toBe(3)
    expect(resolveCycleIndex(null, { cycleIndex: 3, cycleText: 'anything' })).toBe(3)
  })

  it('never returns a negative index', () => {
    expect(resolveCycleIndex(round11, { cycleIndex: null, cycleText: null })).toBe(0)
    expect(resolveCycleIndex(round11, null)).toBe(0)
  })
})

describe('cycleText parsing', () => {
  it('carries the text off the URL and through the round-map resolver', () => {
    const t = parseDeepLinkTarget('?course=deu_for_eng&round=11&cycle=13&cycleText=I%20want%20to%20speak%20German')!
    expect(t.cycleText).toBe('I want to speak German')
    const r = resolveDeepLinkTarget(t, { rounds: [{ r: 11, legoId: 'S0003L03' }] })!
    expect(r.cycleText).toBe('I want to speak German')
    expect(r.cycleIndex).toBe(12)
  })

  it('is null when absent or blank, so old links behave exactly as before', () => {
    expect(parseDeepLinkTarget('?round=11&cycle=13')!.cycleText).toBeNull()
    expect(parseDeepLinkTarget('?round=11&cycle=13&cycleText=')!.cycleText).toBeNull()
    expect(parseDeepLinkTarget('?round=11&cycle=13&cycleText=%20%20')!.cycleText).toBeNull()
  })
})
