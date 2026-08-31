import { resolveResumeAnchor } from './resolveResumeAnchor'

/**
 * Thrown when we could not FIND OUT where the learner is — a round-map
 * fetch that failed, an infinite-play check that threw, anything that
 * left the question unanswered.
 *
 * This is the whole point of the type. `null` from resolveResumeStart
 * means "we asked and this learner genuinely has no position yet" —
 * a fresh learner, who correctly starts at round 1. A failure is NOT
 * that answer, and must never be flattened into it: doing so silently
 * dropped returning learners to round 1 whenever the round-map cache
 * missed on a bad connection (new device, reinstall, cleared storage).
 * Callers must let this propagate so the legacy loader takes over.
 */
export class ResumeResolutionError extends Error {
  readonly reason: unknown

  constructor(message: string, reason?: unknown) {
    super(message)
    this.name = 'ResumeResolutionError'
    this.reason = reason
  }
}

export interface RoundMapLike {
  rounds: Array<{ legoId: string }>
}

export interface ResumeStartDeps {
  /** The cursor — last_completed_lego_id, the primary position. */
  lastCompletedLegoId: string | null
  /** The legacy ceiling — highest_completed_lego_id, read-only fallback. */
  ceilingLegoId: string | null
  /** Derived end-of-course check; may throw. */
  hasReachedInfinitePlay: (legoId: string | null) => Promise<boolean>
  /** Round-map fetch (cache-first); genuinely fails on a cold cache + bad pipe. */
  fetchRoundMap: () => Promise<RoundMapLike>
  onCeilingFallback?: (cursorLegoId: string | null, anchorLegoId: string | null) => void
  onAnchorMissing?: (cursorLegoId: string) => void
}

/**
 * Resolve the LEGO id an instant-playback resume should start on.
 *
 * Returns a legoId when we found the learner's place, `null` ONLY when
 * we successfully established they have no resolvable place (fresh
 * learner → round 1). Throws `CourseEndNoNextLego` for infinite-play
 * hand-off, and `ResumeResolutionError` for any failure to answer.
 */
export async function resolveResumeStart(deps: ResumeStartDeps): Promise<string | null> {
  const { lastCompletedLegoId, ceilingLegoId } = deps
  try {
    // INF PLAY mode: skip instant-playback entirely and fall to the legacy
    // path, which emits the spaced-rep + random-USE rounds the mode is
    // designed around. Cursor-only model: infinite-play is DERIVED — no
    // is_new LEGO remains beyond the cursor (2026-07-04).
    if (await deps.hasReachedInfinitePlay(lastCompletedLegoId)) {
      throw new Error('CourseEndNoNextLego')
    }

    // The cursor is the primary position. If it can't be located in the
    // round-map — null on a fresh row, or stale/schema-drifted — fall back
    // to the legacy ceiling when one is populated, so a learner with a
    // null/unresolvable cursor but a real ceiling isn't dropped to R1
    // (2026-07-05: read-only fallback, never ratcheted or written back).
    // Only a learner with neither resolves fresh at R1.
    const map = await deps.fetchRoundMap()
    const findIndex = (legoId: string) => map.rounds.findIndex(r => r.legoId === legoId)
    const { legoId: anchor, viaCeiling } = resolveResumeAnchor(lastCompletedLegoId, ceilingLegoId, findIndex)
    if (viaCeiling) {
      deps.onCeilingFallback?.(lastCompletedLegoId, anchor)
    }
    if (!anchor) {
      if (lastCompletedLegoId) {
        deps.onAnchorMissing?.(lastCompletedLegoId)
      }
      return null
    }

    // anchor names the round the learner is ON (position, not completion),
    // so resume lands there directly — no "+1".
    return anchor
  } catch (err) {
    if ((err as Error)?.message === 'CourseEndNoNextLego') throw err
    if (err instanceof ResumeResolutionError) throw err
    throw new ResumeResolutionError(
      `Could not resolve resume position (cursor=${lastCompletedLegoId ?? 'null'}, ceiling=${ceilingLegoId ?? 'null'}): ${String((err as Error)?.message ?? err)}`,
      err,
    )
  }
}
