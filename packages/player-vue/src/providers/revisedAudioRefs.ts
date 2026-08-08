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
    return (next ?? row) as T
  })
}
