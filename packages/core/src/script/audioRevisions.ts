/**
 * audioRevisions — the single source of truth for "which revision of this
 * audio clip should we be playing?", and the one place that turns an audio
 * id into a `/api/audio/...` URL.
 *
 * WHY THIS EXISTS
 * ---------------
 * Repaired audio is swapped IN PLACE at the same `course_audio.id`. The id
 * must not change: minting a new one CASCADEs into `lego_introductions` and
 * destroys authored intro scripts.
 *
 * But `/api/audio/:id` is served `Cache-Control: public, max-age=31536000,
 * immutable`, and the service worker runs CacheFirst over it. A device that
 * already played the damaged clip holds those bytes for a YEAR — a same-id
 * byte swap never reaches it.
 *
 * So the URL carries the revision: `/api/audio/<id>?v=<rev>`. The URL is the
 * cache key, which means `immutable` stays (and stays correct — a given
 * id+revision really never changes), and a repair simply produces a URL no
 * cache has ever seen. Fast path unchanged, repairs land immediately.
 *
 * WHY A REGISTRY RATHER THAN THREADING A MAP
 * ------------------------------------------
 * There are ~15 sites across core and player-vue that build an audio URL —
 * script generation, two round adapters, the listening overlay, the pod lap
 * scheduler, prefetch warmers, the cache's own fetcher. Threading a revision
 * map through every one of those signatures is a large, error-prone diff for
 * a value that is globally keyed anyway: audio ids are UUIDs, so a revision
 * means the same thing regardless of which payload it arrived on.
 *
 * Instead the backend payloads publish their revisions here once
 * (`setAudioRevisions`), and every URL builder reads through
 * `buildAudioUrl`. One call site each, no signature churn.
 *
 * BACKWARD COMPATIBILITY — the load-bearing rule
 * ---------------------------------------------
 * An unknown id emits the bare `/api/audio/<id>`, byte-identical to today.
 * That is not a fallback, it is the correct answer: revision 1 is the
 * original clip, its bare URL is what every existing cache already holds,
 * and re-fetching it would be pure churn. Only clips that have actually been
 * repaired (revision > 1) are published, so:
 *
 *   - old cached payloads (no revision field)      -> bare URL, cache hit
 *   - a route not yet widened to send revisions    -> bare URL, cache hit
 *   - a clip that has never been repaired          -> bare URL, cache hit
 *   - a clip repaired since the device last played -> ?v=2, cache miss, heals
 */

/** Audio id (UUID) -> the revision of its bytes we should be playing. */
const revisions = new Map<string, number>()

/**
 * Publish revisions from a backend payload.
 *
 * Merged monotonically (highest wins) rather than replaced: payloads arrive
 * piecemeal — cycles, infplay-cycles, the whole-course bundle — and a later
 * payload that happens not to mention a clip must not silently downgrade it
 * back to the pre-repair URL.
 *
 * Values that aren't finite numbers > 1 are ignored. Revision 1 is the
 * implicit default for everything, so recording it would only add entries
 * that produce a bare URL anyway.
 */
export function setAudioRevisions(
  map: Record<string, number> | null | undefined
): void {
  if (!map) return
  for (const id of Object.keys(map)) {
    const rev = map[id]
    if (typeof rev !== 'number' || !Number.isFinite(rev) || rev <= 1) continue
    const known = revisions.get(id)
    if (known === undefined || rev > known) revisions.set(id, rev)
  }
}

/**
 * The revision to play for `id`, or undefined when the clip has never been
 * repaired (or we simply haven't heard). Undefined and 1 are the same thing
 * to every consumer — both mean "the bare URL".
 */
export function getAudioRevision(id: string): number | undefined {
  return revisions.get(id)
}

/** Snapshot of every known repaired clip. Diagnostics and tests. */
export function getAudioRevisionMap(): Record<string, number> {
  return Object.fromEntries(revisions)
}

/** Drop all published revisions. Tests, and the `?reset=1` recovery path. */
export function clearAudioRevisions(): void {
  revisions.clear()
}

/**
 * Build the playable URL for an audio id.
 *
 * @param id     audio UUID — the `/api/audio/:id` path segment
 * @param query  optional extra query string WITHOUT a leading `?`
 *               (e.g. `courseId=deu_for_eng`). Several call sites already
 *               attach one; `v` is appended alongside it, not instead of it.
 *
 * Returns `''` for a falsy id, matching what the existing builders do — the
 * player treats an empty URL as "no audio for this slot".
 */
export function buildAudioUrl(
  id: string | null | undefined,
  query?: string
): string {
  if (!id) return ''
  const rev = revisions.get(id)
  const parts: string[] = []
  if (query) parts.push(query)
  // `v` goes last so the common no-extra-query URL reads `/api/audio/x?v=2`.
  if (rev !== undefined) parts.push(`v=${rev}`)
  return parts.length > 0
    ? `/api/audio/${id}?${parts.join('&')}`
    : `/api/audio/${id}`
}
