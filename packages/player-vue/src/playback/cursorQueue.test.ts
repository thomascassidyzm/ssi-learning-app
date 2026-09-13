import { describe, it, expect, vi } from 'vitest'
import { createCursorQueue } from './cursorQueue'

const P = { learnerId: 'L', courseId: 'C', idx: 3 }

describe('createCursorQueue', () => {
  it('writes a queued cursor on flush when nothing refuses it', async () => {
    const write = vi.fn(async () => {})
    const q = createCursorQueue({ write, refuse: () => false })
    q.queue(P)
    q.flush()
    expect(write).toHaveBeenCalledWith(P)
  })

  it('a cursor queued while refused never lands, even after the refusal lifts (#615 / #606 shape)', () => {
    // Viewing-as is ON while the cycle completes, OFF by the time the player
    // unmounts and flushes. Pre-fix LearningPlayer queued regardless and the
    // teardown flush PATCHed course_enrollments under the admin's learner.
    let viewingAs = true
    const write = vi.fn(async () => {})
    const q = createCursorQueue({ write, refuse: () => viewingAs })
    q.queue(P)
    expect(q.pending()).toBeNull()
    viewingAs = false
    q.flush()
    expect(write).not.toHaveBeenCalled()
  })

  it('a cursor queued in the clear is dropped if the flush is refused', () => {
    let refuse = false
    const write = vi.fn(async () => {})
    const q = createCursorQueue({ write, refuse: () => refuse })
    q.queue(P)
    refuse = true
    q.flush()
    expect(write).not.toHaveBeenCalled()
    expect(q.pending()).toBeNull()
  })

  it('throttles: one timer per window, latest cursor wins, cancel drops it', () => {
    vi.useFakeTimers()
    const write = vi.fn(async () => {})
    const q = createCursorQueue({ write, refuse: () => false, delayMs: 1000 })
    q.queue({ ...P, idx: 1 })
    q.queue({ ...P, idx: 2 })
    vi.advanceTimersByTime(999)
    expect(write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith({ ...P, idx: 2 })
    q.queue({ ...P, idx: 5 })
    q.cancel()
    vi.advanceTimersByTime(2000)
    expect(write).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
