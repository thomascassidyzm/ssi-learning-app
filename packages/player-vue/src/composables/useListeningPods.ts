/**
 * useListeningPods — fetch the Layer 2 listening pods for a course and
 * present them as a Spotify-style list of scenes the learner can play.
 *
 * The served pod, split into scenes (each scene is a complete dialogue
 * beat), followed by any EXTRA Listening Mode slot the course has (servedPod
 * rule 6, job #354: the Italian method pod sits alongside Pod 1, never
 * replacing it). WHICH pods is resolved per course by servedPod's
 * `resolveListeningPods` — pods went 1-based on 2026-08-22, so hrv serves
 * `pod-1` while ~68 older courses serve `pod-0`; main flow reads only the
 * served pod and never this list.
 *
 * The Pods tab in ListeningOverlay shows the scenes, tap a scene to
 * teleprompter through its sentences. Scenes from different pods are told
 * apart by `sceneKey` (pod-qualified); `sceneNumber` stays local to its pod.
 *
 * NEVER expose internal terms ("pod", "scene_number") to the user —
 * scenes get user-friendly titles ("Scene 1", "Scene 2" or the scene's
 * own title if present in the data).
 */

import { ref, watch, inject, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { splitRowUnits } from './podSentenceSplit'
import { baseSlate, continuationsByBranch, type SlateRow, type PodContinuation } from './podSlate'
import { getCachedListeningMeta, retryListeningReadOrThrow, clearCachedListeningPodRows, POD_CLIP_COLUMNS, readClipTimings, type CachedPodRow } from './listeningMetaCache'
import { resolveListeningPods } from './servedPod'
import { buildFusionGroups, type FusionGroup } from '@ssi/core/pods'
import { getRevisedAudioRefs, stampRowAudioRefs, bareAudioId } from '../providers/revisedAudioRefs'
import { isOfflineish } from '../config/networkGate'

export interface PodSentence {
  id: string
  speaker: string
  targetText: string
  knownText: string
  targetAudioId: string | null
  knownAudioId: string | null
  /** Tom-voiced chunk breakdown — present only where the sentence carries
   *  first-encounter material (upstream discipline). Null = play the
   *  translation instead in any explainer slot. */
  explainerAudioId: string | null
  globalOrder: number
  /** Fusion-drill groups anchored on this sentence (agent-authored fine
   *  seams + Take G slices) — null where the course has no fine data or it
   *  doesn't align with this turn (Drill then falls back to plain t·k·t·t). */
  fusionGroups: FusionGroup[] | null
  /** True when a glued group anchored on an EARLIER sentence covers this one
   *  — Drill skips this row (its material plays inside the anchor row). */
  fusionContinuation: boolean
  /** 1-based position in the MAIN-FLOW scheduler's flattened pod ordering
   *  (flattenPodRows without the text oracle) — the ordinal the pod-lap
   *  ratchet staggers intake by. Lets Listening Mode derive a sentence's
   *  main-flow maturity floor: completed = max(0, completed_pod_rounds −
   *  ordinal + 1). */
  podOrdinal: number
  /** Word timings of the TARGET clip, as stored (the #407 contract shape or
   *  the Azure word_boundaries shape) — the Immersion tracker's raw material
   *  (playback/breathGroups.ts normalises it). Null for clips without
   *  timings, which render exactly as before. */
  wordTimings: unknown | null
}

/**
 * A turn is one or more consecutive same-speaker sentences merged into a
 * single visual + audio unit. This is what the teleprompter renders as a
 * row — without merging, two-sentence turns ("Hi! How are you?") become
 * two rows with an unnatural inter-phrase pause between them, which
 * reads as if a different speaker is interjecting.
 */
export interface PodTurn {
  id: string
  speaker: string
  /** Clean display name — the speaker label minus any time/place
   *  annotation ("Barista (3 pm)" → "Barista"). */
  speakerName: string
  /** Palette index from the pod-wide conversation colouring — same
   *  character keeps the same colour across every scene; two characters
   *  who share a scene never share a colour (4-colour-map principle,
   *  mirroring the voice-casting colouring in Popty). */
  colorIndex: number
  /** Concatenated target text of all sentences in this turn (space-joined). */
  targetText: string
  /** Concatenated translation. */
  knownText: string
  /** Audio IDs to play in sequence (one per sentence). */
  audioIds: string[]
  /** Per-sentence detail, aligned 1:1 with the merged texts — drives the
   *  stage-pattern playback modes (target/translation/explainer per
   *  sentence) and the interleaved gloss display. */
  sentences: Array<{
    id: string
    targetText: string
    knownText: string
    targetAudioId: string | null
    knownAudioId: string | null
    explainerAudioId: string | null
    fusionGroups: FusionGroup[] | null
    fusionContinuation: boolean
    podOrdinal: number
    /** Raw word timings of the target clip (see PodSentence.wordTimings). */
    wordTimings: unknown | null
  }>
  /** First sentence's global_order — used for ordering. */
  globalOrder: number
}

export interface PodScene {
  /** Local scene number within ITS pod (1, 2, 3, ...). Not unique across
   *  pods — use `sceneKey` for identity. */
  sceneNumber: number
  /** Unique across every pod the course lists: `<podSlug>:<sceneNumber>`. */
  sceneKey: string
  /** `listening_pods.id` of the pod this scene belongs to. */
  podId: string
  /** 0 for the served pod, 1+ for extra slots, in list order. */
  podIndex: number
  /** The pod's own `listening_pods.title` — the group heading when the
   *  course lists more than one pod. Null when the row carried none. */
  podTitle: string | null
  /** Display title for the scene — derived from first sentence's speaker. */
  title: string
  /** Speaker-grouped turns. Each turn = one or more consecutive
   *  same-speaker sentences rendered as a single row. */
  turns: PodTurn[]
  /** Total sentence count across all turns (used for the scene-card subline). */
  sentenceCount: number
  /** Cast of this scene in order of first line — for the scene-card dots. */
  speakers: Array<{ name: string; colorIndex: number }>
}

/**
 * Speaker palette — mid-tone, warm-theme-friendly colours that read as
 * text on white cards and as dots on the warm-grey canvas. The colouring
 * below guarantees scene-mates get different indices; the palette only
 * wraps if a single pod genuinely needs more than 6 colours (the
 * voice-casting proof never needed more than 4).
 */
export const SPEAKER_PALETTE = [
  '#B5552D', // terracotta
  '#2E7D6B', // teal
  '#5B5EA6', // indigo
  '#A8731E', // ochre
  '#9C4D7E', // plum
  '#3F7CAC', // slate blue
]

export interface UseListeningPodsReturn {
  scenes: Ref<PodScene[]>
  isLoading: Ref<boolean>
  error: Ref<string | null>
  /**
   * The pod's continuations, indexed by branch point (`podSlate.branchKey`).
   * Empty for a pod with none, which is every pod today. The CAPABILITY to
   * serve a recovery in the moment; the policy for when it fires is not here.
   */
  continuations: Ref<Map<string, Array<PodContinuation<SlateRow>>>>
}

export function useListeningPods(
  courseCode: Ref<string | null>,
): UseListeningPodsReturn {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  const scenes = ref<PodScene[]>([])
  /**
   * The pod's continuations, indexed by the branch point they attach to
   * (`podSlate.branchKey(scene, sentence)`). THE CAPABILITY, NOT THE POLICY:
   * a recovery is servable at the coordinate it belongs to, in the moment the
   * learner is in trouble. WHEN one fires is Tom's call and is not decided here.
   * Empty for every pod that carries no continuation, which is all of them today.
   */
  const continuationIndex = ref<Map<string, Array<PodContinuation<SlateRow>>>>(new Map())
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  let activeFetch = 0

  async function fetchData(course: string): Promise<void> {
    const supabase = supabaseRef?.value
    if (!supabase) {
      error.value = 'Supabase client not available (inject failed)'
      return
    }

    const myFetch = ++activeFetch
    isLoading.value = true
    error.value = null

    /** One pod's rows, in list order (served pod first). */
    type LoadedPod = { podId: string; slug: string; title: string | null; rows: any[] }
    type Loaded = { pods: LoadedPod[]; textById: Map<string, string>; timingsById: Map<string, unknown> }

    // Offline fallback: rows + split-clip texts from the metadata persisted
    // by the deliberate offline download. Null when never downloaded.
    const loadFromCache = async (): Promise<Loaded | null> => {
      const cached = await getCachedListeningMeta(course)
      if (!cached) return null
      // Serve it anyway — a known-stale snapshot still beats a blank overlay
      // for an offline learner — but say so, because this is the exact seat
      // the 2026-08-24 Pod 1 split-array staleness was served from and it was
      // silent at the time. The stamp lane retries the refresh every boot.
      if (cached.stale) {
        console.warn('[useListeningPods] serving a snapshot marked STALE since',
          new Date(cached.stale.since).toISOString(),
          `(cached ${cached.contentStamp ?? 'pre-stamp'} → live ${cached.stale.liveContentStamp ?? '?'})`)
      }
      const pods: LoadedPod[] = [
        {
          podId: `${course}:${cached.podSlug ?? 'pod-0'}`,
          slug: cached.podSlug ?? 'pod-0',
          title: cached.podTitle ?? null,
          rows: cached.podRows,
        },
        // Extra slots (rule 6) — absent on snapshots older than the slot.
        ...(cached.extraPods || []).map((e) => ({
          podId: `${course}:${e.slug}`,
          slug: e.slug,
          title: e.title,
          rows: (e.podRows || []) as CachedPodRow[],
        })),
      ]
      return {
        pods,
        textById: new Map(Object.entries(cached.clipTexts)),
        // Absent on snapshots written before the tracker existed → no
        // timings offline until the next refresh, i.e. the pre-tracker render.
        timingsById: new Map(Object.entries(cached.clipTimings || {})),
      }
    }

    // Live fetch. Throws on any query error (offline, RLS, transient) so the
    // caller can fall back to the offline cache.
    const loadFromNetwork = async (): Promise<Loaded> => {
      // Pod id convention: `${courseCode}:${slug}`, slugs resolved per course
      // (servedPod rule 1 for the served pod, rule 6 for the extra slots).
      // Fetch every sentence of every listed pod in global order, group by
      // scene_number client-side, per pod.
      const listed = await resolveListeningPods(supabase, course)
      // A-86: stamp per-clip versioned refs (`<uuid>.v<N>`) here, at the walk,
      // before any id becomes an `/api/audio/…` URL or an IndexedDB cache key.
      // Both caches key on the ref string, so a bare uuid for a repaired clip
      // is a permanent stale-audio bug on that device. Empty map on error by
      // design — a missed suffix costs one stale clip, a throw costs the scene.
      const revisedRefs = await getRevisedAudioRefs(supabase, course)
      const pods: LoadedPod[] = []
      for (const pod of listed) {
        const { data, error: fetchErr } = await supabase
          .from('listening_pod_sentences')
          .select('id, scene_number, sentence_number, global_order, speaker, target_text, known_text, target_audio_id, known_audio_id, explainer_audio_id, sentence_audio_ids, sentence_known_audio_ids, atom_map_fine, window_known_map, takeg_audio_ids, variant_key, attach_sentence_number')
          .eq('pod_id', pod.podId)
          .order('global_order', { ascending: true })
        if (fetchErr) throw new Error(`listening_pod_sentences: ${fetchErr.message}`)
        pods.push({ podId: pod.podId, slug: pod.slug, title: pod.title, rows: stampRowAudioRefs(revisedRefs, data || []) })
      }
      const rows = pods.flatMap((p) => p.rows)

      // Per-sentence DISPLAY text must come from each split clip's OWN stored text
      // (authoritative + language-agnostic). The Latin boundary regex in
      // splitRowUnits can't split CJK/Indic/Thai targets (Japanese 。/no-spaces,
      // Thai no punctuation), so without this every split card would show the whole
      // turn. Batch-load every split clip's text for this pod (chunked to keep the
      // PostgREST `in()` URL short).
      const clipIds = new Set<string>()
      // Whole-turn target clips ride the same read for their WORD TIMINGS
      // (the Immersion tracker, job #408). They never enter textById's
      // existence oracle — splitRowUnits only consults it for split ids.
      const turnClipIds = new Set<string>()
      for (const row of rows) {
        for (const id of (row.sentence_audio_ids || [])) if (id) clipIds.add(id)
        for (const id of (row.sentence_known_audio_ids || [])) if (id) clipIds.add(id)
        if (row.target_audio_id) turnClipIds.add(row.target_audio_id)
      }
      // The ids now carry `.vN` but course_audio is keyed by the BARE uuid, so
      // query bare and key the result by the stamped ref — textById is looked
      // up with the same (stamped) id that rides on the row.
      const textById = new Map<string, string>()
      const timingsById = new Map<string, unknown>()
      const stampedByBare = new Map(Array.from(clipIds).map((ref) => [bareAudioId(ref), ref]))
      const turnStampedByBare = new Map(Array.from(turnClipIds).map((ref) => [bareAudioId(ref), ref]))
      const idArr = Array.from(new Set([...stampedByBare.keys(), ...turnStampedByBare.keys()]))
      for (let i = 0; i < idArr.length; i += 150) {
        const { data: clips, error: clipErr } = await supabase
          .from('course_audio')
          .select(POD_CLIP_COLUMNS)
          .in('id', idArr.slice(i, i + 150))
        if (clipErr) throw new Error(`split-clip texts: ${clipErr.message}`)
        for (const c of clips || []) {
          // Record EVERY returned split id (even empty text) — textById doubles
          // as the existence oracle splitRowUnits uses to drop stale split slices.
          const splitRef = stampedByBare.get(c.id)
          if (splitRef) textById.set(splitRef, c.text || '')
          const timings = readClipTimings(c)
          if (timings) {
            for (const ref of [splitRef, turnStampedByBare.get(c.id)]) if (ref) timingsById.set(ref, timings)
          }
        }
      }
      return { pods, textById, timingsById }
    }

    try {
      let loaded: Loaded | null = null
      // `isOfflineish`, not `navigator.onLine === false`: the browser reports
      // online on a connection too weak to complete anything, and on that
      // signal we used to run a RETRYING live read before ever looking at the
      // cache — the slowest possible way to reach content we already had.
      // Now an observed stall counts as offline for this decision too.
      // (Tom 2026-08-15: "play what you have".)
      const offlineNow = isOfflineish()
      // Offline: cache first (no doomed fetch, no error noise). Online (or
      // cache miss): live fetch, falling back to cache when the fetch fails
      // mid-air (connection dropped after onLine reported true).
      // True only when `loaded` came from the live read, so an empty result is
      // the server's answer rather than an empty cache entry.
      let fromNetwork = false
      if (offlineNow) loaded = await loadFromCache()
      if (!loaded) {
        try {
          // Retry before falling back to the offline snapshot — the
          // highest-risk moment for a transient failure is right after a
          // forced sign-in reload (auth/network still settling), which is
          // exactly when a silent fallback to a stale, unbounded-age
          // snapshot serves the wrong vintage of pod audio/text
          // (2026-07-21 forum report). See retryListeningRead's doc comment.
          loaded = await retryListeningReadOrThrow(loadFromNetwork)
          fromNetwork = true
        } catch (netErr) {
          loaded = await loadFromCache()
          if (!loaded) throw netErr
          console.warn('[useListeningPods] live fetch failed — using offline metadata cache:', netErr)
        }
      }
      const { pods: loadedPods, textById, timingsById } = loaded
      if (myFetch !== activeFetch) return

      // The course has no pod live. Bin any offline snapshot so the withdrawn
      // pod can't keep playing from IndexedDB next time the learner is offline.
      if (fromNetwork && loadedPods.every((p) => p.rows.length === 0)) {
        await clearCachedListeningPodRows(course)
      }

      // Scenes are built PER POD (colouring, ordinals and scene numbers are
      // all pod-local), then concatenated in list order: served pod first.
      const sceneList: PodScene[] = []
      const mergedContinuations = new Map<string, Array<PodContinuation<SlateRow>>>()
      loadedPods.forEach((pod, podIndex) => {
        const built = buildPodScenes(pod.rows, textById, timingsById, {
          podId: pod.podId,
          podSlug: pod.slug,
          podIndex,
          podTitle: pod.title,
        })
        sceneList.push(...built.scenes)
        // Branch keys are pod-local (`scene:sentence`); the served pod keeps
        // the bare key its main-flow reader uses, extras are prefixed.
        for (const [key, list] of built.continuations) {
          mergedContinuations.set(podIndex === 0 ? key : `${pod.slug}/${key}`, list)
        }
      })

      if (myFetch !== activeFetch) return
      continuationIndex.value = mergedContinuations
      scenes.value = sceneList
    } catch (err) {
      if (myFetch !== activeFetch) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useListeningPods] fetch failed:', msg)
      // Offline with no downloaded metadata: a clear human state, never the
      // raw TypeError (Tom's airplane-mode test, 2026-07-09).
      // Honest failure: we are offline-ish AND the cache is empty, so there
      // genuinely is nothing to play. That message, never a raw TypeError —
      // and never for the case where content IS cached.
      error.value = isOfflineish()
        ? "Dialogues aren't downloaded yet — connect once and download for offline to bring them along."
        : msg
    } finally {
      if (myFetch === activeFetch) {
        isLoading.value = false
      }
    }
  }

  watch(
    courseCode,
    (course) => {
      if (!course) {
        scenes.value = []
        continuationIndex.value = new Map()
        error.value = null
        isLoading.value = false
        return
      }
      void fetchData(course)
    },
    { immediate: true },
  )

  return { scenes, isLoading, error, continuations: continuationIndex }
}

/**
 * ONE pod's rows → its ordered scene list + its continuation index. Pure of
 * Vue state so the served pod and each extra slot are built by the same code
 * and can never drift. `podOrdinal` is the MAIN-FLOW scheduler's ordinal and
 * only means anything for the served pod (podIndex 0): an extra slot's
 * sentences carry 0, so the drill's derived maturity floor never credits the
 * main-flow ratchet against a pod main flow has not played.
 */
function buildPodScenes(
  data: any[],
  textById: Map<string, string>,
  timingsById: Map<string, unknown>,
  pod: { podId: string; podSlug: string; podIndex: number; podTitle: string | null },
): { scenes: PodScene[]; continuations: Map<string, Array<PodContinuation<SlateRow>>> } {
  {

      // Bucket by scene_number. A multi-sentence TURN row that's been split
      // (sentence_audio_ids set, one clip per sentence) becomes one PodSentence
      // PER SENTENCE — the unit is the sentence (Tom 2026-06-16). Otherwise the
      // row is one PodSentence as before. The split itself lives in the shared
      // splitRowUnits helper so the overlay + the main-flow scheduler never drift.
      // A pod's WALK is its base rows. A row carrying variant_key is a
      // CONTINUATION attached to a coordinate — a second thing that can happen
      // where the learner is in trouble — and it must never take a position in
      // the scene list, or a learner who never branches would walk lines that
      // are not CORE's. Indexed separately below so it stays reachable AT its
      // branch point. Tom, 2026-09-04: "A RECOVERY ATTACHES, IT DOES NOT APPEND."
      const walkRows = baseSlate(data || [])
      const continuations = continuationsByBranch(data || [])

      const buckets = new Map<number, PodSentence[]>()
      // Running ordinal on the SCHEDULER's flatten (splitRowUnits WITHOUT the
      // textById oracle — the scheduler doesn't apply it, and the two doors'
      // derived maturity must count the same sequence). Rows arrive in
      // global_order, which is the scheduler's fetch order too.
      let podOrdinal = 1
      for (const row of walkRows) {
        const list = buckets.get(row.scene_number) || []
        const bareCount = splitRowUnits(row).length
        const units = splitRowUnits(row, textById)

        // Fusion drill payload (Aran's pairwise gradual-fusion ladder): the
        // turn's agent-authored fine seams resolved into per-sentence groups.
        // Null wherever the authored data doesn't line up with this turn —
        // Drill then falls back to the plain per-sentence t·k·t·t.
        const fusionGroups = Array.isArray(row.atom_map_fine) && row.atom_map_fine.length
          ? buildFusionGroups({
              turnTargetText: row.target_text || '',
              fineMap: row.atom_map_fine,
              windowKnownMap: row.window_known_map || null,
              takegAudioIds: row.takeg_audio_ids || null,
              rows: units.map((u) => ({
                targetAudioId: u.targetAudioId,
                knownAudioId: u.knownAudioId,
                targetText: u.targetText,
                knownText: u.knownText,
              })),
            })
          : null

        for (const u of units) {
          // Groups anchor on their FIRST covered row; a glued group's later
          // rows are continuations the drill skips.
          const anchored = fusionGroups?.filter((g) => g.rowFirst === u.index) || null
          const continuation = !!fusionGroups?.some((g) => g.rowFirst < u.index && g.rowLast >= u.index)
          list.push({
            id: u.isSplit ? `${row.id}:s${u.index}` : row.id,
            speaker: row.speaker || '',
            targetText: u.targetText,
            knownText: u.knownText,
            targetAudioId: u.targetAudioId,
            // per-sentence English clip when the known side was split; null (gloss
            // text still shows, trans slot drops) when it wasn't (count mismatch).
            knownAudioId: u.knownAudioId,
            // The Tom-voiced explainer is per-TURN; a split sentence has none.
            explainerAudioId: u.isSplit ? null : (row.explainer_audio_id || null),
            globalOrder: row.global_order + u.index * 0.001,
            fusionGroups: anchored && anchored.length ? anchored : null,
            fusionContinuation: continuation,
            podOrdinal: pod.podIndex === 0 ? podOrdinal + Math.min(u.index, bareCount - 1) : 0,
            wordTimings: (u.targetAudioId && timingsById.get(u.targetAudioId)) || null,
          })
        }
        podOrdinal += bareCount
        buckets.set(row.scene_number, list)
      }

      // Speaker tags sometimes vary subtly between rows ("Vicino (08:00)"
      // vs "Vicino" — time annotation only on first speaker entrance).
      // Strip the time annotation for grouping so consecutive same-named
      // speakers merge even when only one row carries the time tag.
      const cleanSpeakerName = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, '').trim()
      const speakerKey = (s: string) => cleanSpeakerName(s).toLowerCase()

      // ── Conversation colouring (4-colour-map principle) ─────────────
      // Mirrors the voice-casting colouring in Popty: build the pod-wide
      // "shares a scene" graph and greedy-colour speakers in order of
      // first appearance. A character keeps ONE colour across the whole
      // pod; two characters who converse never share a colour. Greedy on
      // first-appearance order is exactly the algorithm the voice proof
      // ran — it never needed more than 4 colours on real pods.
      const speakerOrder: string[] = []
      const displayName = new Map<string, string>()
      const adjacency = new Map<string, Set<string>>()
      for (const sceneSentences of buckets.values()) {
        const cast = new Set<string>()
        for (const s of sceneSentences) {
          const key = speakerKey(s.speaker)
          if (!key) continue
          cast.add(key)
          if (!displayName.has(key)) {
            displayName.set(key, cleanSpeakerName(s.speaker))
            speakerOrder.push(key)
          }
        }
        for (const a of cast) {
          let set = adjacency.get(a)
          if (!set) { set = new Set(); adjacency.set(a, set) }
          for (const b of cast) if (b !== a) set.add(b)
        }
      }
      const colorOf = new Map<string, number>()
      for (const key of speakerOrder) {
        const taken = new Set<number>()
        for (const n of adjacency.get(key) ?? []) {
          const c = colorOf.get(n)
          if (c !== undefined) taken.add(c)
        }
        let c = 0
        while (taken.has(c)) c++
        colorOf.set(key, c)
      }

      /**
       * The UNIT is the SENTENCE (Tom 2026-06-16): each sentence is its own
       * turn — its own card and its own treatment cycle. A multi-sentence
       * speaker turn (the old merged paragraph) was too big a unit; consecutive
       * same-speaker sentences now render as separate cards, each labelled with
       * the speaker. (Stages 1+ already played per-sentence; this aligns the
       * display + advance unit with that.)
       */
      const mergeTurns = (sentences: PodSentence[]): PodTurn[] =>
        sentences.map((s) => {
          const key = speakerKey(s.speaker)
          return {
            id: `${s.id}-turn`,
            speaker: s.speaker,
            speakerName: displayName.get(key) || cleanSpeakerName(s.speaker),
            colorIndex: colorOf.get(key) ?? 0,
            targetText: s.targetText,
            knownText: s.knownText,
            audioIds: s.targetAudioId ? [s.targetAudioId] : [],
            sentences: [
              {
                id: s.id,
                targetText: s.targetText,
                knownText: s.knownText,
                targetAudioId: s.targetAudioId,
                knownAudioId: s.knownAudioId,
                explainerAudioId: s.explainerAudioId,
                fusionGroups: s.fusionGroups,
                fusionContinuation: s.fusionContinuation,
                podOrdinal: s.podOrdinal,
                wordTimings: s.wordTimings ?? null,
              },
            ],
            globalOrder: s.globalOrder,
          }
        })

      // Build the ordered scene list. Each scene's title comes from the
      // first sentence's speaker tag (often includes a time/place hint
      // like "Vicino (08:00)"), with a "Scene N · " prefix.
      const sceneList: PodScene[] = []
      const sceneNums = Array.from(buckets.keys()).sort((a, b) => a - b)
      for (const sceneNumber of sceneNums) {
        const sentences = buckets.get(sceneNumber)!
        const firstSpeaker = sentences[0]?.speaker || ''
        // Speaker tags sometimes carry a time annotation in parens —
        // pull that out as a more atmospheric scene title.
        const timeMatch = /\(([^)]+)\)/.exec(firstSpeaker)
        const title = timeMatch
          ? `Scene ${sceneNumber} · ${timeMatch[1]}`
          : `Scene ${sceneNumber}`
        // Scene cast in order of first line — drives the scene-card dots.
        const castKeys: string[] = []
        for (const s of sentences) {
          const key = speakerKey(s.speaker)
          if (key && !castKeys.includes(key)) castKeys.push(key)
        }
        sceneList.push({
          sceneNumber,
          sceneKey: `${pod.podSlug}:${sceneNumber}`,
          podId: pod.podId,
          podIndex: pod.podIndex,
          podTitle: pod.podTitle,
          title,
          turns: mergeTurns(sentences),
          sentenceCount: sentences.length,
          speakers: castKeys.map((key) => ({
            name: displayName.get(key) || key,
            colorIndex: colorOf.get(key) ?? 0,
          })),
        })
      }

      return { scenes: sceneList, continuations }
  }
}
