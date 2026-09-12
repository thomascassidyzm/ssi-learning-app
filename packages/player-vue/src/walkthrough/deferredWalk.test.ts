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

const walk = (pack as any).walks.find((w: any) => w.place.route === 'class-detail')
const { activeWalk, stopWalk } = useWalkthrough()

describe('deferred walk', () => {
  beforeEach(() => { clearDeferredWalk(); stopWalk() })
  afterEach(() => { vi.useRealTimers() })

  it('refuses an id the pack does not carry', () => {
    expect(deferWalk('no-such-walk')).toBe(false)
    expect(claimDeferredWalk('teacher', 'class-detail')).toBe(false)
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

  it('forgets a tap older than the TTL', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-12T10:00:00Z'))
    deferWalk(walk.id)
    vi.setSystemTime(new Date(Date.parse('2026-09-12T10:00:00Z') + DEFERRED_WALK_TTL_MS + 1))
    expect(claimDeferredWalk(walk.personas[0], walk.place.route)).toBe(false)
    expect(activeWalk.value).toBeNull()
  })
})
