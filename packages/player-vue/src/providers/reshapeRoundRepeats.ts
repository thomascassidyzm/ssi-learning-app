/**
 * reshapeRoundRepeats — re-apply the ACTIVE mode's phrase-repeat rule to rounds
 * that were built under a DIFFERENT mode.
 *
 * Why this exists (Tom, 2026-08-09, reproduced live): start a course in EASY,
 * confirm the doubling, then flip the toggle to FAST mid-session — and FAST
 * kept playing Easy's doubled phrases. Doubling is baked into the script at
 * generation time (`repeatPhraseCycles` on the walk, `repeatRoundCycles` on the
 * instant path), and nothing re-shaped the already-built queue on a toggle, so
 * the learner heard the OLD mode until a fresh build happened. Worse, the
 * script cache is keyed on course alone, so even a reload re-hydrated the
 * Easy-doubled rounds — the "it lands on the next build" promise never landed.
 *
 * The fix is a pure, cheap pass over Round[]: strip every repeat COPY (the
 * `_x2` ids both generators stamp), then re-double under the new mode's config.
 * No queries, no regeneration — a toggle can run it on the live forward queue
 * and on a cache hydration alike.
 *
 * What it does NOT reshape: the phrase-length cap, the BUILD-phrase filter and
 * the review syllable filter. Those DROP items at generation time, so they
 * cannot be restored without a walk — they still land on the next full build,
 * exactly as before. Repetition is the one lever that is purely additive, and
 * it is the one Tom sees.
 */

import type { Round, Cycle } from '../playback/SimplePlayer'
import { MAX_PHRASE_REPEAT_COUNT, type RepeatPhraseCyclesOptions } from './repeatPhraseCycles'

/** The suffix both repeat generators stamp on a copy's id (`<id>_x2`). */
const REPEAT_COPY_SUFFIX = /_x\d+$/

/** True for a cycle that is a repeat COPY rather than the original play. */
export const isRepeatCopyCycle = (cycle: { id?: string }): boolean =>
  typeof cycle?.id === 'string' && REPEAT_COPY_SUFFIX.test(cycle.id)

/** Drop every repeat copy, leaving one play of each cycle. */
export const stripRepeatCopies = <C extends { id?: string }>(cycles: C[]): C[] =>
  cycles.filter((c) => !isRepeatCopyCycle(c))

/**
 * Reshape ONE round's cycles to `options`. Returns the SAME array reference
 * when nothing changes, so callers can cheaply skip a no-op queue swap.
 */
export function reshapeCycleRepeats(cycles: Cycle[], options: RepeatPhraseCyclesOptions): Cycle[] {
  const count = Math.min(Math.floor(options.count), MAX_PHRASE_REPEAT_COUNT)
  const base = stripRepeatCopies(cycles)

  if (!Number.isFinite(count) || count <= 1) {
    return base.length === cycles.length ? cycles : base
  }

  const out: Cycle[] = []
  for (const cycle of base) {
    out.push(cycle)
    if (!options.types.has(cycle.type ?? '')) continue
    // singleAudio marks the at-most-one-track cycles: the drained seed-phase
    // sandwich, pods, listening and bookends. The sandwich is already several
    // hearings of one sentence, so repeating it would breach Tom's
    // never-more-than-twice rule — structural, never a setting.
    if (cycle.singleAudio) continue
    for (let n = 2; n <= count; n++) {
      out.push({ ...cycle, ...(cycle.id ? { id: `${cycle.id}_x${n}` } : {}) })
    }
  }
  return out.length === cycles.length ? cycles : out
}

/**
 * Reshape a whole queue. Returns the SAME array reference when every round is
 * already in the requested shape.
 */
export function reshapeRoundRepeats(rounds: Round[], options: RepeatPhraseCyclesOptions): Round[] {
  let changed = false
  const out = rounds.map((round) => {
    const cycles = reshapeCycleRepeats(round.cycles ?? [], options)
    if (cycles === round.cycles) return round
    changed = true
    return { ...round, cycles }
  })
  return changed ? out : rounds
}
