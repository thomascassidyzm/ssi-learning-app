/**
 * Listening metadata offline cache.
 *
 * The Listening overlay (Dialogues/Core), the main-flow pod-lap scheduler and
 * the L1 scheduler all read their STRUCTURE (pod sentence rows, Core seed
 * list, bookends, fine-known clip map, LEGO catalogue) live from Supabase.
 * The deliberate offline download caches the AUDIO, but those metadata
 * queries still hit the network — so in airplane mode the overlay showed
 * "listening_pod_sentences: TypeError: Load failed" and Core spun on a dead
 * fetch despite every clip being in IndexedDB.
 *
 * This module persists that metadata to IndexedDB during the deliberate
 * offline download (same one-entry-per-course pattern as the script cache in
 * useScriptCache) and serves it back when the app is offline or a live query
 * fails. It is also the single source for the listening bundle's audio-id
 * set — the ids are derived from the very rows we persist, so metadata and
 * audio can't drift apart.
 */

import { openDB, deleteDB, type IDBPDatabase } from 'idb'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getRevisedAudioRefs,
  stampRowAudioRefs,
  applyAudioRef,
  bareAudioId,
} from '../providers/revisedAudioRefs'

// Bump to invalidate — part of the key, old entries orphan and re-download.
// v2 (2026-07-22): devices cached before the 2026-03 ita gloss corrections were
// still serving stale glosses ("come" → "to come"); manual bump pending
// structural updated_at-based invalidation.
const META_VERSION = 'v2'
const META_DB_NAME = 'ssi-listening-meta'
const META_STORE = 'meta'

let metaDbPromise: Promise<IDBPDatabase> | null = null
const metaDb = (): Promise<IDBPDatabase> => {
  if (!metaDbPromise) {
    const open = () => openDB(META_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
      },
    })
    metaDbPromise = (async () => {
      let db = await open()
      // Self-heal a storeless DB (interrupted upgrade) — same guard as the
      // script cache.
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.close()
        await deleteDB(META_DB_NAME)
        db = await open()
      }
      return db
    })()
  }
  return metaDbPromise
}

const idbKey = (courseCode: string): string => `${META_VERSION}:${courseCode}`

/** Raw listening_pod_sentences row — the UNION of the column sets the
 *  Listening overlay and the pod-lap scheduler select, so one cached copy
 *  serves both readers. */
export interface CachedPodRow {
  id: string
  scene_number: number
  sentence_number: number | null
  global_order: number
  speaker: string | null
  target_text: string
  known_text: string
  target_audio_id: string | null
  known_audio_id: string | null
  explainer_audio_id: string | null
  glue_to_next: boolean
  atom_map?: unknown[] | null
  sentence_audio_ids?: string[] | null
  sentence_known_audio_ids?: string[] | null
  atom_map_fine?: unknown[] | null
  window_known_map?: unknown[] | null
  takeg_audio_ids?: Array<string | null> | null
}

/** course_seeds row — superset of the Core tab's and the L1 scheduler's
 *  column sets. */
export interface CachedCoreSeed {
  seed_number: number
  known_text: string
  target_text: string
  target_text_roman: string | null
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
}

export interface CachedBookend {
  role: string
  text: string
  id: string
  duration_ms?: number
}

export interface CachedListeningMeta {
  courseCode: string
  cachedAt: number
  /** courses.content_stamp at fetch time — the content vintage this entry was
   *  built from. Trigger-maintained in the DB (any learner-visible content
   *  write moves it), compared on online boot by refreshListeningMetaIfStale.
   *  Absent on entries written before the stamp existed → treated as stale
   *  once (which retroactively heals every pre-stamp device). */
  contentStamp?: string
  /** courses.audio_stamp at fetch time — the AUDIO vintage. A-86: a clip
   *  repair moves audio_stamp and NOT necessarily content_stamp, so the
   *  content lane alone would leave a downloaded snapshot pointing at the
   *  pre-repair ref forever. Absent → pre-stamp entry, refreshed once. */
  audioStamp?: string
  /** listening_pod_sentences rows for `${course}:pod-0`, in global_order.
   *  Empty array = the course genuinely has no pod (a valid, downloaded
   *  state) — entry ABSENT means "never downloaded". */
  podRows: CachedPodRow[]
  /** course_audio id → text for the split-clip ids referenced by podRows —
   *  the overlay's per-sentence display-text oracle (splitRowUnits). */
  clipTexts: Record<string, string>
  /** bookend_listen_intro / bookend_listen_outro rows. */
  bookends: CachedBookend[]
  /** pod_fine_known clips: text_normalized → clip id (fusion-rung knowns). */
  fineKnowns: Record<string, string>
  /** Every seed in the course (Core tab + L1 scheduler). */
  coreSeeds: CachedCoreSeed[]
  /** course_legos (seed_number, lego_index) catalogue — L1 ordinals. */
  legoCatalogue: Array<{ seed_number: number; lego_index: number }>
}

export const getCachedListeningMeta = async (
  courseCode: string,
): Promise<CachedListeningMeta | null> => {
  try {
    const db = await metaDb()
    const data = (await db.get(META_STORE, idbKey(courseCode))) as CachedListeningMeta | undefined
    return data ?? null
  } catch (err) {
    console.warn('[ListeningMeta] read failed:', (err as any)?.message, err)
    return null
  }
}

const setCachedListeningMeta = async (meta: CachedListeningMeta): Promise<void> => {
  try {
    // Round-trip to plain data — IndexedDB structured-clone rejects Vue
    // proxies (same guard as setCachedScript).
    const plain = JSON.parse(JSON.stringify(meta)) as CachedListeningMeta
    const db = await metaDb()
    await db.put(META_STORE, plain, idbKey(meta.courseCode))
    console.log('[ListeningMeta] saved to IndexedDB:', meta.courseCode,
      `(${meta.podRows.length} pod rows, ${meta.coreSeeds.length} seeds)`)
  } catch (err) {
    console.warn('[ListeningMeta] write failed:', (err as any)?.message, err)
  }
}

/**
 * Drop the cached pod rows for a course, keeping the rest of its entry
 * (coreSeeds, legoCatalogue, bookends) intact.
 *
 * Called when a LIVE read reports the course has no pod sentences at all.
 * That is how unreleased Layer 2 content is held back: every learner-facing
 * pod path queries the exact id `<course>:pod-0`, so a pod parked on any other
 * slug reads as "no pods yet" (the Welsh pods were gated this way on
 * 2026-08-06 — Aran and Catrin have not recorded them). Without this, a
 * learner who downloaded the pod for offline use would keep replaying the
 * withdrawn snapshot forever, because the offline lane never re-checks.
 *
 * Deliberately keyed on "server says zero", not on a course allow-list: it
 * needs no maintenance, and it reverses itself the moment the recordings land
 * and the pod returns to its `pod-0` slug.
 */
export const clearCachedListeningPodRows = async (courseCode: string): Promise<void> => {
  try {
    const existing = await getCachedListeningMeta(courseCode)
    if (!existing || existing.podRows.length === 0) return
    await setCachedListeningMeta({ ...existing, podRows: [], clipTexts: {} })
    console.log('[ListeningMeta] dropped', existing.podRows.length,
      'stale offline pod rows for', courseCode, '— course reports no pods live')
  } catch (err) {
    // Never let cache hygiene break playback.
    console.warn('[ListeningMeta] pod-row clear failed:', (err as any)?.message, err)
  }
}

/** Column list for the pod-row union select — keep in sync with CachedPodRow. */
const POD_ROW_COLUMNS =
  'id, scene_number, sentence_number, global_order, speaker, target_text, known_text, ' +
  'target_audio_id, known_audio_id, explainer_audio_id, glue_to_next, atom_map, ' +
  'sentence_audio_ids, sentence_known_audio_ids, atom_map_fine, window_known_map, takeg_audio_ids'

const PAGE = 1000

/**
 * Fetch every piece of listening metadata for the course and persist it as
 * one cache entry. Called from the deliberate offline download. Returns the
 * fresh meta, or null on any fetch failure (nothing partially written — the
 * entry is all-or-nothing so "entry present" always means "fully usable").
 *
 * Retries a few times on transient failure before giving up — this call
 * chains 6+ network round-trips, run right as the user is about to go
 * offline (the worst possible moment for a transient blip), and previously
 * had zero retry: one flaky request silently dropped the entire Core/
 * Listening bundle from the offline download while it still reported
 * "complete" (2026-07-21 flight report).
 */
export const fetchAndCacheListeningMeta = async (
  client: SupabaseClient,
  courseCode: string,
  attempts = 3,
): Promise<CachedListeningMeta | null> => {
  for (let attempt = 1; attempt < attempts; attempt++) {
    const meta = await fetchAndCacheListeningMetaOnce(client, courseCode)
    if (meta) return meta
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
  }
  return fetchAndCacheListeningMetaOnce(client, courseCode)
}

/**
 * Retry a live listening-metadata read before falling back to the (possibly
 * stale, unbounded-age, course-only-keyed) offline snapshot. Shared by every
 * runtime reader (podLapScheduler, layer1Scheduler, useListeningPods) — they
 * previously fell back on the FIRST failure with zero retry, and the highest-
 * risk moment for a transient failure is right after a forced sign-in reload
 * (auth/network still settling), which is exactly when the stale-snapshot
 * fallback is most likely to silently serve wrong-vintage audio/text
 * (2026-07-21 forum report). Mirrors fetchAndCacheListeningMeta's own retry.
 */
export const retryListeningRead = async <T>(
  fn: () => Promise<T>,
  isOk: (result: T) => boolean,
  attempts = 3,
): Promise<T> => {
  let result = await fn()
  for (let attempt = 1; attempt < attempts && !isOk(result); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
    result = await fn()
  }
  return result
}

/** Retry variant for readers that signal failure by THROWING (useListeningPods'
 *  loadFromNetwork) rather than returning a Supabase {error} result. */
export const retryListeningReadOrThrow = async <T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> => {
  for (let attempt = 1; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
    }
  }
  return fn()
}

const fetchAndCacheListeningMetaOnce = async (
  client: SupabaseClient,
  courseCode: string,
): Promise<CachedListeningMeta | null> => {
  try {
    const podId = `${courseCode}:pod-0`
    const [podsResult, bookendsResult, stampResult] = await Promise.all([
      client
        .from('listening_pod_sentences')
        .select(POD_ROW_COLUMNS)
        .eq('pod_id', podId)
        .order('global_order', { ascending: true }),
      client
        .from('course_audio')
        .select('role, text, id, duration_ms')
        .eq('course_code', courseCode)
        .in('role', ['bookend_listen_intro', 'bookend_listen_outro']),
      client
        .from('courses')
        .select('content_stamp, audio_stamp')
        .eq('course_code', courseCode)
        .maybeSingle(),
    ])
    if (podsResult.error) throw new Error(`listening_pod_sentences: ${podsResult.error.message}`)
    if (bookendsResult.error) throw new Error(`bookends: ${bookendsResult.error.message}`)
    // A-86: this snapshot is the OFFLINE source of truth for the listening
    // lane, so it must be written with per-clip versioned refs (`<uuid>.v<N>`)
    // already applied. The schedulers stamp what they fetch, but offline the
    // revised-ref lookup cannot run and would fall back to an empty map — so
    // an unstamped snapshot means an offline learner plays the pre-repair clip
    // for as long as the snapshot lives. Stamping here, while online, is the
    // only place that can be fixed.
    const revisedRefs = await getRevisedAudioRefs(client, courseCode)
    const podRows = stampRowAudioRefs(
      revisedRefs,
      (podsResult.data || []) as unknown as CachedPodRow[],
    )

    // Split-clip display texts (the overlay's per-sentence oracle) — chunked
    // to keep the PostgREST in() URL short, mirroring useListeningPods.
    const clipIds = new Set<string>()
    for (const row of podRows) {
      for (const id of row.sentence_audio_ids || []) if (id) clipIds.add(id)
      for (const id of row.sentence_known_audio_ids || []) if (id) clipIds.add(id)
    }
    // clipIds now carry `.vN`, but course_audio is keyed by the BARE uuid — so
    // query bare and key the result by the stamped ref the overlay will look up.
    const clipTexts: Record<string, string> = {}
    const idArr = Array.from(clipIds)
    const stampedByBare = new Map(idArr.map((ref) => [bareAudioId(ref), ref]))
    const bareArr = Array.from(stampedByBare.keys())
    for (let i = 0; i < bareArr.length; i += 150) {
      const { data: clips, error: clipErr } = await client
        .from('course_audio')
        .select('id, text')
        .in('id', bareArr.slice(i, i + 150))
      if (clipErr) throw new Error(`split-clip texts: ${clipErr.message}`)
      for (const c of clips || []) clipTexts[stampedByBare.get(c.id) ?? c.id] = c.text || ''
    }

    // Fine-known clips (fusion-rung glosses) — paged under PostgREST's cap.
    const fineKnowns: Record<string, string> = {}
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('course_audio')
        .select('id, text_normalized')
        .eq('course_code', courseCode)
        .eq('role', 'pod_fine_known')
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`fine-knowns: ${error.message}`)
      for (const r of data || []) fineKnowns[r.text_normalized] = applyAudioRef(revisedRefs, r.id)!
      if (!data || data.length < PAGE) break
    }

    // Every seed, paginated — a single .limit() silently truncates on big
    // courses (banked lesson).
    const coreSeeds: CachedCoreSeed[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('course_seeds')
        .select('seed_number, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id')
        .eq('course_code', courseCode)
        .order('seed_number', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw new Error(`course_seeds: ${error.message}`)
      for (const r of stampRowAudioRefs(revisedRefs, data || [])) coreSeeds.push(r as CachedCoreSeed)
      if (!data || data.length < PAGE) break
    }

    // LEGO catalogue for L1 ordinals — 10000 sits under the server max-rows
    // and comfortably above any real course (mirrors useLayer1Scheduler).
    const { data: catalogue, error: catErr } = await client
      .from('course_legos')
      .select('seed_number, lego_index')
      .eq('course_code', courseCode)
      .order('seed_number', { ascending: true })
      .order('lego_index', { ascending: true })
      .limit(10000)
    if (catErr) throw new Error(`course_legos: ${catErr.message}`)

    // Stamp is best-effort: a failed stamp read must not drop the whole
    // bundle — the entry just lands stamp-less and refreshes next online boot.
    const stampRow = stampResult.data as
      | { content_stamp?: string; audio_stamp?: string }
      | null
    const contentStamp = stampRow?.content_stamp ?? undefined
    const audioStamp = stampRow?.audio_stamp ?? undefined

    const meta: CachedListeningMeta = {
      courseCode,
      cachedAt: Date.now(),
      contentStamp,
      audioStamp,
      podRows,
      clipTexts,
      bookends: stampRowAudioRefs(revisedRefs, (bookendsResult.data || []) as CachedBookend[]),
      fineKnowns,
      coreSeeds,
      legoCatalogue: (catalogue || []) as Array<{ seed_number: number; lego_index: number }>,
    }
    await setCachedListeningMeta(meta)
    return meta
  } catch (err) {
    console.warn('[ListeningMeta] fetch failed (nothing cached):', (err as any)?.message ?? err)
    return null
  }
}

/**
 * Structural freshness: if a cached listening bundle exists and its content
 * vintage differs from the course's live content_stamp, refetch the whole
 * bundle in the background. Called on online boot (checkContentVersion) with
 * the stamp it already fetched — no extra request. Never blocks play, never
 * touches anything when offline (the caller only has a stamp when the courses
 * query succeeded), and a failed refresh keeps the old entry (stale beats
 * empty) and retries next boot because the old stamp survives.
 *
 * Scope: refreshes METADATA (text, glosses, structure, audio-id references) —
 * the stale class that persisted for months. It does not re-run the audio
 * download: a re-recorded clip's new id streams (and caches) on first online
 * play, and wholesale audio regeneration still rides the content_version
 * full-clear lane in checkContentVersion.
 *
 * Returns true if a refresh was started.
 */
export const refreshListeningMetaIfStale = async (
  client: SupabaseClient,
  courseCode: string,
  liveStamp: string | null | undefined,
  liveAudioStamp?: string | null,
): Promise<boolean> => {
  if (!liveStamp && !liveAudioStamp) return false
  const cached = await getCachedListeningMeta(courseCode)
  if (!cached) return false // never downloaded — nothing to keep fresh

  const contentMoved = !!liveStamp && cached.contentStamp !== liveStamp
  // A-86: a clip repair moves audio_stamp and not necessarily content_stamp.
  // Without this arm, a downloaded snapshot keeps pointing at the pre-repair
  // ref forever — the offline half of the stale-clip bug. An entry with no
  // audioStamp predates this field, so it refreshes once and heals itself.
  const audioMoved = !!liveAudioStamp && cached.audioStamp !== liveAudioStamp
  if (!contentMoved && !audioMoved) return false

  console.log('[ListeningMeta]',
    contentMoved
      ? `content stamp moved (${cached.contentStamp ?? 'pre-stamp'} → ${liveStamp})`
      : `audio stamp moved (${cached.audioStamp ?? 'pre-stamp'} → ${liveAudioStamp})`,
    '— refreshing bundle')
  void fetchAndCacheListeningMeta(client, courseCode)
  return true
}

/**
 * Every audio id the listening metadata references — the listening slice of
 * the offline audio bundle. Derived from the same rows we persist, so the
 * cached metadata can never point at un-downloaded audio: Core seed
 * sentences, pod turns (incl. per-sentence split clips, explainers, Take-G
 * fusion slices), fine-known gloss clips, and the listen bookends.
 */
export const collectListeningMetaAudioIds = (meta: CachedListeningMeta): string[] => {
  const ids = new Set<string>()
  const add = (id?: string | null) => { if (id) ids.add(id) }
  for (const s of meta.coreSeeds) {
    add(s.known_audio_id); add(s.target1_audio_id); add(s.target2_audio_id)
  }
  for (const row of meta.podRows) {
    add(row.target_audio_id); add(row.known_audio_id); add(row.explainer_audio_id)
    for (const id of row.sentence_audio_ids || []) add(id)
    for (const id of row.sentence_known_audio_ids || []) add(id)
    for (const id of row.takeg_audio_ids || []) add(id)
  }
  for (const b of meta.bookends) add(b.id)
  for (const id of Object.values(meta.fineKnowns)) add(id)
  return [...ids]
}
