/**
 * deepLinkTarget — the Popty Script Viewer "open this round" contract.
 *
 * The rule that matters: an unusable target must degrade to "no override"
 * (normal resume), never to an error and never to a wrong round.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseDeepLinkTarget,
  resolveDeepLinkTarget,
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
      legoId: 'S0002L02',
      round: 7,
      cycleIndex: 2,
    })
  })

  it('accepts round on its own', () => {
    expect(parseDeepLinkTarget('?round=7')).toEqual({ legoId: null, round: 7, cycleIndex: null })
  })

  it('uppercases the lego id', () => {
    expect(parseDeepLinkTarget('?lego=s0002l02')?.legoId).toBe('S0002L02')
  })

  it('drops a malformed lego but keeps a usable round', () => {
    expect(parseDeepLinkTarget('?round=7&lego=not-a-lego')).toEqual({
      legoId: null,
      round: 7,
      cycleIndex: null,
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
    expect(resolveDeepLinkTarget({ legoId: 'S0002L02', round: 999, cycleIndex: 2 }, map)).toEqual({
      legoId: 'S0002L02',
      cycleIndex: 2,
      via: 'lego',
    })
  })

  it('prefers the lego id over a disagreeing round number', () => {
    const r = resolveDeepLinkTarget({ legoId: 'S0001L02', round: 7, cycleIndex: null }, map)
    expect(r).toEqual({ legoId: 'S0001L02', cycleIndex: 0, via: 'lego' })
  })

  it('falls back to the round number when the lego is not in this course', () => {
    const r = resolveDeepLinkTarget({ legoId: 'S9999L99', round: 7, cycleIndex: null }, map)
    expect(r).toEqual({ legoId: 'S0002L02', cycleIndex: 0, via: 'round' })
  })

  it('returns null when neither anchor resolves', () => {
    expect(resolveDeepLinkTarget({ legoId: 'S9999L99', round: 4242, cycleIndex: null }, map)).toBeNull()
  })

  it('returns null for a missing target or an empty map', () => {
    expect(resolveDeepLinkTarget(null, map)).toBeNull()
    expect(resolveDeepLinkTarget({ legoId: 'S0002L02', round: null, cycleIndex: null }, null)).toBeNull()
    expect(resolveDeepLinkTarget({ legoId: 'S0002L02', round: null, cycleIndex: null }, { rounds: [] })).toBeNull()
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
    expect(getDeepLinkTarget('?round=2')).toEqual({ legoId: null, round: 2, cycleIndex: null })
  })
})
