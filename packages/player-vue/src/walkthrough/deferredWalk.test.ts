/**
 * The deferred walk handshake (job #302): a tap on the Handbook defers a
 * walk; the first Show-me surface whose persona × place × kind offers it
 * claims and starts it; a non-matching mount leaves it waiting; a forgotten
 * tap expires. Never-auto-play holds because only deferWalk, itself only
 * called from a tap, ever puts anything in the queue.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  deferWalk, claimDeferredWalk, clearDeferredWalk, useWalkthrough, walkById, DEFERRED_WALK_TTL_MS,
} from './useWalkthrough'
import pack from './pack.json'

// A walk on a place with no node kind, so claiming it needs persona and place
// only. The class walks moved to the class node home in job #999 and carry a
// kind, which is a different handshake — this test is about the queue.
const walk = (pack as any).walks.find((w: any) => w.place.route === 'classes')
const { activeWalk, stopWalk } = useWalkthrough()

describe('deferred walk', () => {
  beforeEach(() => { clearDeferredWalk(); stopWalk() })
  afterEach(() => { vi.useRealTimers() })

  it('refuses an id the pack does not carry', () => {
    expect(deferWalk('no-such-walk')).toBe(false)
    expect(claimDeferredWalk('teacher', 'classes')).toBe(false)
  })

  it('waits through a mount that does not offer it, then starts on the one that does', () => {
    expect(walkById(walk.id)).toBeTruthy()
    expect(deferWalk(walk.id)).toBe(true)
    expect(claimDeferredWalk('teacher', 'node-home', 'school')).toBe(false)
    expect(activeWalk.value).toBeNull()
    expect(claimDeferredWalk(walk.personas[0], walk.place.route)).toBe(true)
    expect(activeWalk.value?.id).toBe(walk.id)
    stopWalk()
    expect(claimDeferredWalk(walk.personas[0], walk.place.route)).toBe(false)
  })

  it('holds several candidates and starts the one the destination offers (job #627)', () => {
    // The two invite walks: org/group nodes run one, a school runs the other.
    expect(deferWalk(['invite-first-person', 'invite-first-teacher'])).toBe(true)
    expect(claimDeferredWalk('leader', 'node-home', 'school')).toBe(true)
    expect(activeWalk.value?.id).toBe('invite-first-teacher')
    stopWalk()
    expect(deferWalk(['invite-first-person', 'invite-first-teacher'])).toBe(true)
    expect(claimDeferredWalk('leader', 'node-home', 'group')).toBe(true)
    expect(activeWalk.value?.id).toBe('invite-first-person')
    stopWalk()
    expect(deferWalk(['no-such-walk'])).toBe(false)
    expect(deferWalk(['no-such-walk', walk.id])).toBe(true)
  })

  it('forgets a tap older than the TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T10:00:00Z'))
    deferWalk(walk.id)
    vi.setSystemTime(new Date(Date.parse('2026-09-12T10:00:00Z') + DEFERRED_WALK_TTL_MS + 1))
    expect(claimDeferredWalk(walk.personas[0], walk.place.route)).toBe(false)
    expect(activeWalk.value).toBeNull()
  })
})
