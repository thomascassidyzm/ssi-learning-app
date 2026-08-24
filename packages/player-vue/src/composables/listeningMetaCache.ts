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
import { resolveServedPod } from './servedPod'
import {
  getRevisedAudioRefs,
  stampRowAudioRefs,
  applyAudioRef,
  bareAudioId,
} from '../providers/revisedAudioRefs'

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

/**
 * The entry key is the course code and NOTHING else.
 *
 * It used to carry a hand-maintained `META_VERSION` prefix ('v2', 'v3') that
 * an author had to remember to bump whenever a content repair landed, which
 * orphaned every older entry. That constant was forgotten twice — the v2 bump
 * (2026-07-22) called itself a placeholder "pending structural updated_at-based
 * invalidation", and it was forgotten again until v3 on 2026-08-24, by which
 * point devices had been serving the pre-repair Pod 1 split arrays for hours
 * (founder report: "the new Scene 15 is playing the old Scene 15 clips in the
 * app right now"). Twice wrong means the schema is wrong, not the operator.
 *
 * Freshness is now decided by the vintage stored INSIDE the entry —
 * `contentStamp` / `audioStamp`, compared against the live `courses` stamps the
 * app already fetches on every online boot (refreshListeningMetaIfStale). The
 * stamps are DB-trigger-maintained, so any learner-visible content write moves
 * them with no human in the loop. Verified live 2026-08-24: for ita/fra/spa,
 * `courses.content_stamp` equals `max(listening_pod_sentences.updated_at)` to
 * the microsecond, so a pod repair moves the stamp by itself.
 *
 * The key deliberately cannot BE the stamp: offline the app does not know the
 * live stamp, and an offline learner with a slightly-old snapshot is a working
 * app while an offline learner with no snapshot is a broken one.
 */
const idbKey = (courseCode: string): string => courseCode

/** Legacy hand-versioned keys ('v2:ita_for_eng', 'v3:ita_for_eng') still on
 *  devices in the wild — v3 shipped to production on 2026-08-24. Matched so
 *  they can be migrated onto the bare key rather than silently abandoned. */
const LEGACY_KEY = /^v\d+:(.+)$/

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
  /** Set when a live stamp comparison found this entry out of date and the
   *  background refresh has not landed yet; cleared by a successful fetch.
   *
   *  It is PERSISTED on purpose. The refresh used to be in-memory and
   *  fire-and-forget, which meant it healed only on a boot where the network
   *  was good — and a device with a good network never needs the snapshot in
   *  the first place. The device that actually serves stale rows is the one on
   *  a stalled connection (`isOfflineish`), where the same stall kills the
   *  refresh, so nothing was ever remembered and nothing ever healed. Writing
   *  the mark down means the staleness survives the reload and the retry
   *  happens on every subsequent boot until it succeeds. */
  stale?: {
    since: number
    liveContentStamp?: string
    liveAudioStamp?: string
  }
  /** listening_pod_sentences rows for the pod this course SERVES (see
   *  servedPod), in global_order. Empty array = the course genuinely has no
   *  pod (a valid, downloaded state) — entry ABSENT means "never downloaded". */
  podRows: CachedPodRow[]
  /** The serving slug `podRows` was fetched from — `pod-1` or `pod-0`. Pods
   *  went 1-based on 2026-08-22, so the slug is no longer a constant and the
   *  snapshot has to remember its own. Read back by servedPod's offline lane,
   *  which is how a learner who downloaded Croatian at `pod-1` resolves it
   *  offline with no round-trip. Absent on entries written before the flip →
   *  those are `pod-0` snapshots by definition. */
  podSlug?: string
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

/**
 * Adopt a legacy hand-versioned entry ('v3:<course>') onto the bare key.
 *
 * Devices in the wild hold v3 entries right now (shipped to production
 * 2026-08-24) and older v2 ones. Dropping them would leave a learner who is
 * offline at the moment of upgrade with NO snapshot and no way to re-download
 * — a regression. So the entry MOVES instead, carrying its own `contentStamp`
 * with it, and the stamp comparison then decides whether it is fresh. That is
 * the whole point of keying on vintage rather than on a version prefix: a
 * migrated entry needs no special handling, it just gets judged.
 *
 * Newest-by-`cachedAt` wins if several keys exist. Every legacy key is deleted
 * either way, so this runs once per device and then costs nothing.
 */
const migrateLegacyEntry = async (
  db: IDBPDatabase,
  courseCode: string,
): Promise<CachedListeningMeta | null> => {
  const keys = (await db.getAllKeys(META_STORE)) as IDBValidKey[]
  const legacy = keys.filter(
    (k) => typeof k === 'string' && LEGACY_KEY.exec(k)?.[1] === courseCode,
  ) as string[]
  if (legacy.length === 0) return null

  let best: CachedListeningMeta | null = null
  for (const key of legacy) {
    const entry = (await db.get(META_STORE, key)) as CachedListeningMeta | undefined
    if (entry && (!best || (entry.cachedAt ?? 0) > (best.cachedAt ?? 0))) best = entry
    await db.delete(META_STORE, key)
  }
  if (!best) return null

  // `courseCode` on a hand-written test fixture can disagree with its key —
  // the bare key is authoritative from here on.
  const adopted: CachedListeningMeta = { ...best, courseCode }
  await db.put(META_STORE, JSON.parse(JSON.stringify(adopted)), idbKey(courseCode))
  console.log('[ListeningMeta] migrated legacy versioned entry for', courseCode,
    `(${legacy.join(', ')} → bare key, vintage ${adopted.contentStamp ?? 'pre-stamp'})`)
  return adopted
}

export const getCachedListeningMeta = async (
  courseCode: string,
): Promise<CachedListeningMeta | null> => {
  try {
    const db = await metaDb()
    const data = (await db.get(META_STORE, idbKey(courseCode))) as CachedListeningMeta | undefined
    if (data) {
      // A bare-key entry wins outright, but any legacy key left beside it is
      // dead weight — clear it so the scan stays cheap.
      void migrateLegacyEntryCleanup(db, courseCode)
      return data
    }
    return await migrateLegacyEntry(db, courseCode)
  } catch (err) {
    console.warn('[ListeningMeta] read failed:', (err as any)?.message, err)
    return null
  }
}

/** Delete legacy keys once a bare-key entry already exists. Never throws. */
const migrateLegacyEntryCleanup = async (
  db: IDBPDatabase,
  courseCode: string,
): Promise<void> => {
  try {
    const keys = (await db.getAllKeys(META_STORE)) as IDBValidKey[]
    for (const k of keys) {
      if (typeof k === 'string' && LEGACY_KEY.exec(k)?.[1] === courseCode) {
        await db.delete(META_STORE, k)
      }
    }
  } catch { /* cache hygiene must never break playback */ }
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
 * pod path queries the exact id of the pod the course SERVES, and servedPod
 * will only ever serve `pod-1` or `pod-0` — so a pod parked on any other slug
 * (`pod-0-unrecorded`, `pod-0-gated-2026-08-06`) reads as "no pods yet" (the
 * Welsh pods were gated this way on 2026-08-06 — Aran and Catrin have not
 * recorded them). Without this, a
 * learner who downloaded the pod for offline use would keep replaying the
 * withdrawn snapshot forever, because the offline lane never re-checks.
 *
 * Deliberately keyed on "server says zero", not on a course allow-list: it
 * needs no maintenance, and it reverses itself the moment the recordings land
 * and the pod returns to a serving slug.
 */
export const clearCachedListeningPodRows = async (courseCode: string): Promise<void> => {
  try {
    const existing = await getCachedListeningMeta(courseCode)
    if (!existing || existing.podRows.length === 0) return
    // Drop podSlug with the rows: the snapshot no longer describes any pod,
    // so it must not keep asserting one to servedPod's offline lane.
    await setCachedListeningMeta({ ...existing, podRows: [], clipTexts: {}, podSlug: undefined })
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
    const { podId, slug: podSlug } = await resolveServedPod(client, courseCode)
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
      podSlug,
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
  const alreadyMarked = !!cached.stale
  // A-86: a clip repair moves audio_stamp and not necessarily content_stamp.
  // Without this arm, a downloaded snapshot keeps pointing at the pre-repair
  // ref forever — the offline half of the stale-clip bug. An entry with no
  // audioStamp predates this field, so it refreshes once and heals itself.
  const audioMoved = !!liveAudioStamp && cached.audioStamp !== liveAudioStamp
  if (!contentMoved && !audioMoved) {
    // Stamps agree but a previous mark never cleared — the refresh that set it
    // must have landed some other way (or the DB moved back). Clear it so the
    // fallback logging does not cry wolf forever.
    if (alreadyMarked) await setCachedListeningMeta({ ...cached, stale: undefined })
    return false
  }

  console.log('[ListeningMeta]',
    contentMoved
      ? `content stamp moved (${cached.contentStamp ?? 'pre-stamp'} → ${liveStamp})`
      : `audio stamp moved (${cached.audioStamp ?? 'pre-stamp'} → ${liveAudioStamp})`,
    '— refreshing bundle')

  // Write the mark FIRST, and await it. The refresh below is fire-and-forget
  // by design (it must never block play), so if the device's connection dies
  // mid-refresh the only record that this snapshot is out of date would
  // otherwise die with it — which is exactly what happened to the Pod 1
  // repair. Persisted, the retry happens on every boot until one succeeds, and
  // any reader that falls back to this snapshot can say out loud that it is
  // serving known-stale rows.
  await setCachedListeningMeta({
    ...cached,
    stale: {
      since: cached.stale?.since ?? Date.now(),
      liveContentStamp: liveStamp ?? undefined,
      liveAudioStamp: liveAudioStamp ?? undefined,
    },
  })
  void fetchAndCacheListeningMeta(client, courseCode)
  return true
}

/**
 * Is the snapshot for this course known to be out of date? True only when a
 * live stamp comparison already said so and the refresh has not landed —
 * never a guess. Readers use it to log a stale fallback rather than to refuse
 * one: a stale snapshot still beats a blank screen for an offline learner.
 */
export const isCachedListeningMetaStale = async (courseCode: string): Promise<boolean> => {
  try {
    return !!(await getCachedListeningMeta(courseCode))?.stale
  } catch {
    return false
  }
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
