/**
 * "The PODS are all always available in the listening mode section"
 * (Tom, 2026-09-06 — the second half of the top-of-the-ladder ruling).
 *
 * A pod sentence that has completed the ladder stops being emitted into pod
 * laps (usePodLapScheduler, podCohortHasCompleted). It must NOT stop being
 * listed and playable in the Pods tab — that would delete content the learner
 * has spent attention on, which is the worst outcome the ruling could produce.
 *
 * The guarantee is structural: the Pods-tab data path lists what the COURSE
 * HAS, and never reads what the LEARNER HAS DONE. There is no progress term in
 * it at all — no ratchet, no exposure counter, no maturity floor — so there is
 * nothing that could gate a completed sentence out. This test pins that
 * absence, because an absence is exactly the kind of thing a later change
 * quietly fills in.
 *
 * (The drill RUNG in ListeningOverlay does read a maturity floor, but it only
 * chooses which rung to serve and is clamped at the top of its ladder — see
 * packages/core/src/pods/fusionDrill.ts rungStepsForGroup and its
 * "a beyond-depth rung stays there" test. It never gates visibility or
 * playability.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAW = readFileSync(join(HERE, 'useListeningPods.ts'), 'utf8')
/** Comments are stripped: the file DOCUMENTS the drill's derived maturity
 *  floor (it hands the drill the podOrdinal it needs), and prose about a
 *  thing is not a use of it. Only executable text is policed here. */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the Pods tab is always available (Tom 2026-09-06)', () => {
  it('the Pods-tab data path reads no learner-progress state at all', () => {
    // Any of these appearing means a progress term entered the listing path —
    // the moment that happens, a completed sentence can be gated out of the
    // learner's world. If one is genuinely needed, prove it cannot filter.
    for (const progressTerm of [
      'completed_pod_rounds',
      'learner_pod_state',
      'PodStateStore',
      'exposures',
      'seed_progress',
      'lego_progress',
    ]) {
      expect(SOURCE).not.toContain(progressTerm)
    }
  })

  it('nothing in the listing path filters sentences or scenes by maturity', () => {
    // The pod ordinal is carried THROUGH for the drill rung; it must never be
    // compared against anything here (a `>`/`<`/`>=` on it would be a gate).
    expect(SOURCE).toContain('podOrdinal')
    expect(SOURCE).not.toMatch(/podOrdinal\s*[<>]/)
    expect(SOURCE).not.toMatch(/[<>]=?\s*podOrdinal/)
  })
})
