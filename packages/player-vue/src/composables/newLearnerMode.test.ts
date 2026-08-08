import { describe, it, expect } from 'vitest'
import {
  resolveNewLearnerMode,
  hasPlayHistory,
  NEW_LEARNER_DEFAULT_MODE,
} from './newLearnerMode'

/** A learner with nothing: fresh install, never played, never chose. */
const freshLearner = {
  progressResolved: true,
  hasChosenMode: false,
  highestCompletedLegoId: null,
  lastCompletedLegoId: null,
  highestCompletedRoundIndex: null,
  completedRounds: 0,
}

describe('new-learner mode default (Aran 2026-08-06)', () => {
  it('hands a learner with no play history Easy', () => {
    expect(resolveNewLearnerMode(freshLearner)).toBe('easy')
    expect(NEW_LEARNER_DEFAULT_MODE).toBe('easy')
  })

  it('decides NOTHING until the progress read has resolved', () => {
    // The critical case: an existing learner whose progress is still loading
    // looks identical to a brand-new one. Deciding here would silently slow
    // down someone mid-course, which is precisely what the ruling forbids.
    expect(resolveNewLearnerMode({ ...freshLearner, progressResolved: false })).toBeNull()
  })

  it('leaves an existing learner alone, on every trace of play', () => {
    const traces = [
      { highestCompletedLegoId: 'S0042L03' },
      { lastCompletedLegoId: 'S0007L01' },
      { highestCompletedRoundIndex: 0 },   // round 0 is real play, not "absent"
      { completedRounds: 1 },
    ]
    for (const trace of traces) {
      expect(resolveNewLearnerMode({ ...freshLearner, ...trace })).toBeNull()
    }
  })

  it('never overrides a mode the learner chose themselves', () => {
    // True even for a learner with no history at all — an explicit choice
    // outranks the default forever, in both directions.
    expect(resolveNewLearnerMode({ ...freshLearner, hasChosenMode: true })).toBeNull()
  })

  it('treats round index 0 as history but a missing index as none', () => {
    expect(hasPlayHistory({ ...freshLearner, highestCompletedRoundIndex: 0 })).toBe(true)
    expect(hasPlayHistory({ ...freshLearner, highestCompletedRoundIndex: null })).toBe(false)
    expect(hasPlayHistory({ ...freshLearner, highestCompletedRoundIndex: undefined })).toBe(false)
  })

  it('returns null rather than fast for the leave-alone cases', () => {
    // The caller must never WRITE a mode it did not decide — clobbering with
    // 'fast' would stamp over a choice still arriving from the learner row.
    expect(resolveNewLearnerMode({ ...freshLearner, hasChosenMode: true })).not.toBe('fast')
  })
})
