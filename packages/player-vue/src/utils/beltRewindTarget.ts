import { seedOfLegoId } from './resolveResumeAnchor'

export interface BeltLike { name: string; seedsRequired: number }
export interface RewindTarget { roundIndex: number; legoId: string; beltName: string }

/**
 * Where a long-absence rewind may land: the FIRST round of the belt the
 * learner currently holds, and never anywhere before it.
 *
 * Tom's ruling (2026-09-12): the 60-day belt rewind stays, but it must never
 * send a learner back further than the start of the belt they are at. A
 * learner past Yellow rewinds to the start of Yellow, or whichever belt they
 * hold, never to White. The old code stored the round BEFORE the belt's first
 * round so that a "+1" resume would land on it; that left a cursor, and the
 * belt badge read from it, in the previous belt — a Yellow learner's cursor
 * sat on White's last LEGO (the Spanish belt-regression report, 2026-09-08).
 *
 * Returns null when there is nothing to do: no belt start in these rounds,
 * or the learner is already at or before their belt's first round.
 */
export function beltRewindTarget(
  cursorLegoId: string | null,
  rounds: ReadonlyArray<{ legoId?: string | null } | null | undefined>,
  belts: ReadonlyArray<BeltLike>,
): RewindTarget | null {
  const seed = seedOfLegoId(cursorLegoId)
  if (seed === null) return null
  let beltIdx = 0
  for (let i = belts.length - 1; i >= 0; i--) {
    if (seed >= belts[i].seedsRequired) { beltIdx = i; break }
  }
  const beltStartSeed = Math.max(belts[beltIdx].seedsRequired, 1)
  // Nearest >= match: the belt's first LEGO is the first round at or above
  // its threshold seed, which is rarely exactly on it.
  const startIdx = rounds.findIndex((r) => {
    const s = seedOfLegoId(r?.legoId ?? null)
    return s !== null && s >= beltStartSeed
  })
  if (startIdx < 0) return null
  const cursorIdx = rounds.findIndex((r) => r?.legoId === cursorLegoId)
  if (cursorIdx >= 0 && cursorIdx <= startIdx) return null
  const legoId = rounds[startIdx]?.legoId
  if (!legoId) return null
  return { roundIndex: startIdx, legoId, beltName: belts[beltIdx].name }
}
