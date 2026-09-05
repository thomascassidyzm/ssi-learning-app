/**
 * Verdict logic of the pod-delivery detector. The detector's job is to go RED
 * on the silence that looks like a working course, so every case here is one
 * of the real shapes found in the 2026-09-05 census.
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs module, no declaration file
import { classifyCourse, lapsOwedFor, isTestLearner } from './pod-delivery-detector.mjs'

describe('classifyCourse', () => {
  it('goes RED when active learners have no live pod to serve (cym_n shape)', () => {
    expect(classifyCourse({ activeLearners: 1, lapsOwed: 18, delivered: 0, servedPodStatus: 'held-only' }))
      .toBe('RED no-servable-pod')
    expect(classifyCourse({ activeLearners: 1, lapsOwed: 0, delivered: 0, servedPodStatus: 'none' }))
      .toBe('RED no-servable-pod')
  })

  it('goes RED on zero delivery despite owed work (Beuno shape)', () => {
    expect(classifyCourse({ activeLearners: 1, lapsOwed: 1, delivered: 0, servedPodStatus: 'live' }))
      .toBe('RED zero-delivery')
  })

  it('goes AMBER when delivery is under half of owed', () => {
    expect(classifyCourse({ activeLearners: 3, lapsOwed: 6, delivered: 2, servedPodStatus: 'live' }))
      .toBe('AMBER under-delivery')
  })

  it('stays GREEN when delivery keeps pace, or nothing was owed yet', () => {
    expect(classifyCourse({ activeLearners: 3, lapsOwed: 10, delivered: 6, servedPodStatus: 'live' }))
      .toBe('GREEN')
    expect(classifyCourse({ activeLearners: 1, lapsOwed: 0, delivered: 0, servedPodStatus: 'live' }))
      .toBe('GREEN')
    // No learners at all → nothing to police, whatever the pod status.
    expect(classifyCourse({ activeLearners: 0, lapsOwed: 0, delivered: 0, servedPodStatus: 'none' }))
      .toBe('GREEN')
  })

  it('one owed lap and one delivered is GREEN, not amber (owed 1 has no half)', () => {
    expect(classifyCourse({ activeLearners: 1, lapsOwed: 1, delivered: 1, servedPodStatus: 'live' }))
      .toBe('GREEN')
  })
})

describe('lapsOwedFor', () => {
  it('counts work done, not position: 14 rounds at interval 5 owes 2 laps', () => {
    expect(lapsOwedFor(14)).toBe(2)
    expect(lapsOwedFor(4)).toBe(0)
    expect(lapsOwedFor(5)).toBe(1)
  })
  it('never negative, never divides by zero', () => {
    expect(lapsOwedFor(-3)).toBe(0)
    expect(lapsOwedFor(7, 0)).toBe(7)
  })
})

describe('isTestLearner', () => {
  it('excludes demo/internal/e2e accounts and unknown ids', () => {
    expect(isTestLearner(undefined)).toBe(true)
    expect(isTestLearner({ is_demo: true, display_name: 'x' })).toBe(true)
    expect(isTestLearner({ is_internal: true, display_name: 'x' })).toBe(true)
    expect(isTestLearner({ display_name: 'e2e-region-tier-actor-4' })).toBe(true)
  })
  it('keeps real learners', () => {
    expect(isTestLearner({ display_name: 'beunollyn', is_demo: false, is_internal: false })).toBe(false)
  })
})
