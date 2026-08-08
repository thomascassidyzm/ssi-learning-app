/**
 * Pure helpers that turn a rate-policy `RoundPlan` (adaptation v2, workstream
 * C — WP-3, `docs/adaptation/adaptation-v2-build-spec.md` §4.2/§4.4) into
 * concrete play-time actions on SimplePlayer's EXISTING overrides surface —
 * no script regeneration, mirrors the `turboOmit` cull mechanism verbatim
 * (`SimplePlayer.shouldSkipCycle` / `appendRounds`).
 *
 * Both functions are pure and side-effect-free — the caller (LearningPlayer's
 * `handleRoundBoundary`) decides whether to apply their output at all (shadow
 * mode never does).
 */

import type { RoundPlan } from '@ssi/core'
import type { Round, Cycle } from './SimplePlayer'

/**
 * Cycle ids to skip so THIS round's actual BUILD / USE / spaced-rep counts
 * match `plan.buildCount` / `plan.consolidateCount` / `plan.spacedRepCap`.
 *
 * Every lever's ceiling equals its scripted default EXCEPT consolidateCount
 * (see `ratePolicy.ts`'s `DEFAULT_RATE_POLICY_BOUNDS`: buildCount and
 * spacedRepCap both have ceiling === scripted, consolidateCount's ceiling is
 * above its scripted default) — so culling the (N+1)-th-and-later cycle of
 * each type is a COMPLETE and correct realisation for buildCount/
 * spacedRepCap: they can only ever be trimmed, never raised past what's
 * already scripted. consolidateCount can only be trimmed the same way here;
 * a RAISE beyond what's already scripted can't be realised by culling — that
 * surplus is spent via `plan.insertBreather` (`assembleBreatherRound` below),
 * never by inventing extra cycles inside this round.
 */
export function computeAdaptOmitCycleIds(round: Round, plan: RoundPlan): Set<string> {
  const omit = new Set<string>()
  let buildSeen = 0
  let useSeen = 0
  let spacedRepSeen = 0

  for (const cycle of round.cycles) {
    if (cycle.type === 'build') {
      buildSeen++
      if (buildSeen > plan.buildCount) omit.add(cycle.id)
    } else if (cycle.type === 'use') {
      useSeen++
      if (useSeen > plan.consolidateCount) omit.add(cycle.id)
    } else if (cycle.type === 'spaced_rep') {
      spacedRepSeen++
      if (spacedRepSeen > plan.spacedRepCap) omit.add(cycle.id)
    }
  }

  return omit
}

/** Bounds a breather round to roughly "a normal round's spaced-rep + consolidate section" (§4.4 PROPOSED). */
const BREATHER_MAX_CYCLES = 12

/**
 * A LEGO reads as "already mastered" for breather purposes when its pause
 * multiplier is at or below the mastery ladder's 'confident' rung (0.85) —
 * see `MASTERY_MULTIPLIER` in `useAdaptationEngine.ts`. Reusing the existing
 * ladder read (rather than inventing a second mastery threshold) keeps this
 * consistent with what the pause lever already treats as "settled".
 */
const BREATHER_MASTERY_MULTIPLIER_CEILING = 0.85

/**
 * Assemble a no-new-LEGO breather round (§4.4) from cycles that already
 * exist in already-loaded rounds — no new content, no fetch. Walks rounds
 * already loaded UP TO AND INCLUDING `uptoRoundIndexInclusive`, collecting
 * USE-type cycles belonging to LEGOs the mastery ladder already reads as
 * confident/mastered (one per LEGO, oldest-loaded first), capped at
 * `BREATHER_MAX_CYCLES`.
 *
 * Returns null when nothing is eligible yet (early session — there simply
 * isn't a mastered inventory to draw from) so the caller just skips the
 * insertion rather than forcing an empty round onto the queue.
 *
 * The returned Round has a fractional `roundNumber` (`anchorRound.roundNumber
 * - 0.5`) so `SimplePlayer.appendRounds` — which sorts and dedupes purely by
 * roundNumber — inserts it immediately BEFORE the anchor (the next debut),
 * exactly where §4.4 wants the breather.
 */
export function assembleBreatherRound(
  loadedRounds: Round[],
  uptoRoundIndexInclusive: number,
  anchorRound: Round,
  getPauseMultiplier: (legoId: string) => number,
): Round | null {
  const cycles: Cycle[] = []
  const seenLegoIds = new Set<string>()

  for (let i = 0; i <= uptoRoundIndexInclusive && cycles.length < BREATHER_MAX_CYCLES; i++) {
    const round = loadedRounds[i]
    if (!round?.cycles) continue
    for (const cycle of round.cycles) {
      if (cycles.length >= BREATHER_MAX_CYCLES) break
      if (cycle.type !== 'use' || !cycle.legoId) continue
      if (seenLegoIds.has(cycle.legoId)) continue
      if (getPauseMultiplier(cycle.legoId) > BREATHER_MASTERY_MULTIPLIER_CEILING) continue
      seenLegoIds.add(cycle.legoId)
      // Clone with a fresh id (repeat play, same audio/content refs) — the
      // original cycle object/round is never mutated.
      cycles.push({ ...cycle, id: `${cycle.id}:breather:${anchorRound.roundNumber}` })
    }
  }

  if (cycles.length === 0) return null

  return {
    roundNumber: anchorRound.roundNumber - 0.5,
    legoId: `${anchorRound.legoId}:breather`,
    seedId: anchorRound.seedId,
    cycles,
  }
}
