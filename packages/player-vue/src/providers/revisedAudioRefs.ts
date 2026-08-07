/**
 * revisedAudioRefs — the client-side twin of `api/_utils/audioAccess.ts`'s
 * `fetchRevisedAudioRefs` / `stampRowAudioRefs`.
 *
 * WHY THIS EXISTS. Per-clip versioned audio refs (`<uuid>.v<N>`) are stamped
 * onto content rows by the SERVER routes — `/api/courses/:code/cycles` and
 * `/infplay-cycles`. But the player does not get all of its content from those
 * routes: `generateLearningScript` walks `course_legos` /
 * `course_practice_phrases` / `course_seeds` / `listening_pod_sentences` /
 * `course_audio` DIRECTLY over Supabase, and its output is what the script
 * cache stores and what the returning-learner cache fast path
 * (`LearningPlayer.vue`, "CACHE FAST PATH") hydrates SimplePlayer from —
 * pre-empting the /cycles bootstrap entirely.
 *
 * An unstamped (bare-uuid) ref for a REVISED clip is a permanent stale-audio
 * bug, because both downstream caches key on the ref string:
 *   - IndexedDB `ssi-audio-cache-v2` keys by audio id, so the pre-repair blob
 *     is returned for the bare uuid forever;
 *   - the browser HTTP cache keys by URL, and `/api/audio/:id` sets
 *     `Cache-Control: public, max-age=31536000, immutable`.
 * Dropping the script cache on an `audio_stamp` move does NOT fix this: the
 * regenerated walk produces bare uuids again. The suffix has to be applied at
 * the walk, which is what this module does.
 *
 * Same shape as the server helper deliberately: fetch only the clips in this
 * course that have actually been revised (a handful out of millions), then
 * rewrite just those ids on the fetched rows. Everything unrevised keeps its
 * bare uuid, its URL and its cached bytes.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The denormalised audio-id columns the script walk reads. Mirrors
 * `AUDIO_ID_COLUMNS` in `api/_utils/audioAccess.ts`; `id` is here as well
 * because the walk also reads `course_audio` rows directly (listen bookends,
 * presentation backfill) where the clip's own primary key IS the ref.
 */
const AUDIO_ID_COLUMNS = [
  'id',
  'known_audio_id',
  'target1_audio_id',
  'target2_audio_id',
  'presentation_audio_id',
  'target_audio_id',
  'explainer_audio_id',
  'intro_audio_id',
  'outro_audio_id',
  'audio_uuid',
] as const

/**
 * Audio-id columns holding an ARRAY of ids. `listening_pod_sentences` splits a
 * silence-split turn into per-sentence clips here, and those ids become the
 * per-sentence `target_audio_id` / `known_audio_id` downstream — so leaving
 * them bare would defeat the stamping of the row they came from.
 */
const AUDIO_ID_ARRAY_COLUMNS = [
  'sentence_audio_ids',
  'sentence_known_audio_ids',
] as const

/** Build `<uuid>.v<N>`; revision 1 (or absent) stays a bare uuid. */
export function buildAudioRef(id: string, revision: number | null | undefined): string {
  return revision && revision > 1 ? `${id}.v${revision}` : id
}

/**
 * Build the id → versioned-ref map for one course.
 *
 * Returns an empty map on any error: a missed suffix costs one learner one
 * stale clip, whereas failing here would cost them the whole script walk.
 */
export async function fetchRevisedAudioRefs(
  supabase: SupabaseClient | null | undefined,
  courseCode: string,
): Promise<Map<string, string>> {
  const refs = new Map<string, string>()
  if (!supabase || !courseCode) return refs
  try {
    const { data, error } = await supabase
      .from('course_audio')
      .select('id, audio_revision')
      .eq('course_code', courseCode)
      .gt('audio_revision', 1)
    if (error || !data) return refs
    for (const row of data as Array<{ id: string; audio_revision: number | null }>) {
      if (row?.id) refs.set(row.id, buildAudioRef(row.id, row.audio_revision))
    }
  } catch {
    return refs
  }
  return refs
}

/**
 * Strip a `.vN` suffix back to the bare uuid.
 *
 * Needed wherever a stamped ref has to go back to the DATABASE — `course_audio`
 * is keyed by the bare uuid, so an `.in('id', …)` filter built from stamped
 * refs matches nothing. Mirrors `parseAudioRef` on the server.
 */
export function bareAudioId(ref: string): string {
  return ref.replace(/\.v\d+$/, '')
}

/** Apply a revised-ref map to one audio id, leaving unrevised ids untouched. */
export function applyAudioRef(
  refs: Map<string, string>,
  audioId: string | null | undefined,
): string | null {
  if (!audioId) return audioId ?? null
  return refs.get(audioId) ?? audioId
}

/**
 * Stamp revised refs onto the audio-id columns of fetched content rows.
 *
 * Returns fresh objects; the input rows are not mutated. A no-op (and no copy)
 * when the course has no revised clips, which is the overwhelming common case.
 */
export function stampRowAudioRefs<T>(refs: Map<string, string>, rows: T[]): T[] {
  if (refs.size === 0) return rows
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row
    const src = row as Record<string, unknown>
    let next: Record<string, unknown> | null = null
    for (const col of AUDIO_ID_COLUMNS) {
      const current = src[col]
      if (typeof current !== 'string') continue
      const stamped = refs.get(current)
      if (!stamped) continue
      if (!next) next = { ...src }
      next[col] = stamped
    }
    for (const col of AUDIO_ID_ARRAY_COLUMNS) {
      const current = src[col]
      if (!Array.isArray(current)) continue
      if (!current.some((id) => typeof id === 'string' && refs.has(id))) continue
      if (!next) next = { ...src }
      next[col] = current.map((id) => (typeof id === 'string' ? refs.get(id) ?? id : id))
    }
    return (next ?? row) as T
  })
}

// ── Shared per-course map ───────────────────────────────────────────────────
//
// Several lanes walk Supabase for audio ids independently — the script walk,
// the pod lap scheduler, the Layer-1 scheduler, the listening overlay, the
// pronunciation overlay, CourseDataProvider. Each needs the same tiny map, and
// each fetching its own copy would multiply a per-session query by the number
// of lanes for no benefit. One in-flight promise per course, shared.
//
// An EMPTY result is deliberately not memoised. Empty means either "this
// course has no revised clips" or "the fetch failed" — the two are
// indistinguishable by design (see fetchRevisedAudioRefs), and caching the
// failure would strand a whole session on bare refs after one transient error.
// Re-querying a handful of rows is cheap; being stuck stale is not.
const revisedRefsByCourse = new Map<string, Promise<Map<string, string>>>()

/**
 * Get the revised-ref map for a course, shared across lanes.
 *
 * Same contract as `fetchRevisedAudioRefs`: never throws, returns an empty map
 * when there is nothing to stamp or the lookup failed.
 */
export function getRevisedAudioRefs(
  supabase: SupabaseClient | null | undefined,
  courseCode: string,
): Promise<Map<string, string>> {
  if (!supabase || !courseCode) return Promise.resolve(new Map())
  const inFlight = revisedRefsByCourse.get(courseCode)
  if (inFlight) return inFlight
  const pending = fetchRevisedAudioRefs(supabase, courseCode).then((refs) => {
    if (refs.size === 0) revisedRefsByCourse.delete(courseCode)
    return refs
  })
  revisedRefsByCourse.set(courseCode, pending)
  return pending
}

/** Drop the shared map — after a content swap, or for test isolation. */
export function clearRevisedAudioRefs(courseCode?: string): void {
  if (courseCode) revisedRefsByCourse.delete(courseCode)
  else revisedRefsByCourse.clear()
}
