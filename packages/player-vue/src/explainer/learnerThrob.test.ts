import { describe, it, expect, beforeEach } from 'vitest'
import { shouldThrob, markSeen, LEARNER_EXPLAINER_SEEN_KEY } from './learnerThrob'

const VIEWER = 'user-1'

describe('learnerThrob', () => {
  beforeEach(() => localStorage.removeItem(LEARNER_EXPLAINER_SEEN_KEY))

  it('throbs on first visit', () => {
    expect(shouldThrob(VIEWER, 'how-this-works')).toBe(true)
    expect(shouldThrob(VIEWER, 'why-this-works')).toBe(true)
  })

  it('stops throbbing once the section has been opened, and stays stopped', () => {
    markSeen(VIEWER, 'how-this-works')
    expect(shouldThrob(VIEWER, 'how-this-works')).toBe(false)
  })

  it('the two sections have independent seen-state', () => {
    markSeen(VIEWER, 'how-this-works')
    expect(shouldThrob(VIEWER, 'why-this-works')).toBe(true)
    markSeen(VIEWER, 'why-this-works')
    expect(shouldThrob(VIEWER, 'how-this-works')).toBe(false)
    expect(shouldThrob(VIEWER, 'why-this-works')).toBe(false)
  })

  // A-159 — the Library's own section keeps its own state: opening the profile
  // sections must not silently disarm the Library's dot, or vice versa.
  it('the Library section throbs independently of the profile ones', () => {
    markSeen(VIEWER, 'how-this-works')
    markSeen(VIEWER, 'why-this-works')
    expect(shouldThrob(VIEWER, 'library-how-this-works')).toBe(true)
    markSeen(VIEWER, 'library-how-this-works')
    expect(shouldThrob(VIEWER, 'library-how-this-works')).toBe(false)
  })

  it('seen state is per viewer', () => {
    markSeen(VIEWER, 'how-this-works')
    expect(shouldThrob('user-2', 'how-this-works')).toBe(true)
  })

  it('anon is just another viewer id, so a device with no account still settles', () => {
    expect(shouldThrob('anon', 'why-this-works')).toBe(true)
    markSeen('anon', 'why-this-works')
    expect(shouldThrob('anon', 'why-this-works')).toBe(false)
  })

  it('survives corrupt storage', () => {
    localStorage.setItem(LEARNER_EXPLAINER_SEEN_KEY, 'not-json')
    expect(shouldThrob(VIEWER, 'how-this-works')).toBe(true)
    markSeen(VIEWER, 'how-this-works')
    expect(shouldThrob(VIEWER, 'how-this-works')).toBe(false)
  })

  it('prunes entries older than 180 days on write', () => {
    const stale = Date.now() - 200 * 86400000
    localStorage.setItem(
      LEARNER_EXPLAINER_SEEN_KEY,
      JSON.stringify({ 'old:how-this-works': { seenAt: stale } }),
    )
    markSeen(VIEWER, 'why-this-works')
    const map = JSON.parse(localStorage.getItem(LEARNER_EXPLAINER_SEEN_KEY) || '{}')
    expect(Object.keys(map)).toEqual([`${VIEWER}:why-this-works`])
  })

  it('writes only one key, so the map never sprawls across storage', () => {
    markSeen(VIEWER, 'how-this-works')
    markSeen(VIEWER, 'why-this-works')
    const ours = Object.keys(localStorage).filter((k) => k.includes('learner-explainer'))
    expect(ours).toEqual([LEARNER_EXPLAINER_SEEN_KEY])
  })
})
