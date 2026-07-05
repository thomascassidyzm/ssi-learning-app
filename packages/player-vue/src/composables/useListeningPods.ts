/**
 * useListeningPods — fetch the Layer 2 listening pods for a course and
 * present them as a Spotify-style list of scenes the learner can play.
 *
 * One pod per course (`${courseCode}:pod-0`) split into scenes (each
 * scene is a complete dialogue beat). The Pods tab in ListeningOverlay
 * shows the scenes, tap a scene to teleprompter through its sentences.
 *
 * NEVER expose internal terms ("pod", "scene_number") to the user —
 * scenes get user-friendly titles ("Scene 1", "Scene 2" or the scene's
 * own title if present in the data).
 */

import { ref, watch, inject, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { splitRowUnits } from './podSentenceSplit'
import { buildFusionGroups, type FusionGroup } from '@ssi/core/pods'

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
  }>
  /** First sentence's global_order — used for ordering. */
  globalOrder: number
}

export interface PodScene {
  /** Local scene number within the pod (1, 2, 3, ...). */
  sceneNumber: number
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
}

export function useListeningPods(
  courseCode: Ref<string | null>,
): UseListeningPodsReturn {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  const scenes = ref<PodScene[]>([])
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

    try {
      // Pod id convention: `${courseCode}:pod-0`. Fetch every sentence in
      // global order, group by scene_number client-side.
      const podId = `${course}:pod-0`
      const { data, error: fetchErr } = await supabase
        .from('listening_pod_sentences')
        .select('id, scene_number, sentence_number, global_order, speaker, target_text, known_text, target_audio_id, known_audio_id, explainer_audio_id, sentence_audio_ids, sentence_known_audio_ids, atom_map_fine, window_known_map, takeg_audio_ids')
        .eq('pod_id', podId)
        .order('global_order', { ascending: true })

      if (fetchErr) throw new Error(`listening_pod_sentences: ${fetchErr.message}`)
      if (myFetch !== activeFetch) return

      // Per-sentence DISPLAY text must come from each split clip's OWN stored text
      // (authoritative + language-agnostic). The Latin boundary regex in
      // splitRowUnits can't split CJK/Indic/Thai targets (Japanese 。/no-spaces,
      // Thai no punctuation), so without this every split card would show the whole
      // turn. Batch-load every split clip's text for this pod (chunked to keep the
      // PostgREST `in()` URL short).
      const clipIds = new Set<string>()
      for (const row of data || []) {
        for (const id of (row.sentence_audio_ids || [])) if (id) clipIds.add(id)
        for (const id of (row.sentence_known_audio_ids || [])) if (id) clipIds.add(id)
      }
      const textById = new Map<string, string>()
      const idArr = Array.from(clipIds)
      for (let i = 0; i < idArr.length; i += 150) {
        const { data: clips } = await supabase
          .from('course_audio')
          .select('id, text')
          .in('id', idArr.slice(i, i + 150))
        // Record EVERY returned id (even empty text) — textById doubles as the
        // existence oracle splitRowUnits uses to drop stale split slices.
        for (const c of clips || []) textById.set(c.id, c.text || '')
      }
      if (myFetch !== activeFetch) return

      // Bucket by scene_number. A multi-sentence TURN row that's been split
      // (sentence_audio_ids set, one clip per sentence) becomes one PodSentence
      // PER SENTENCE — the unit is the sentence (Tom 2026-06-16). Otherwise the
      // row is one PodSentence as before. The split itself lives in the shared
      // splitRowUnits helper so the overlay + the main-flow scheduler never drift.
      const buckets = new Map<number, PodSentence[]>()
      // Running ordinal on the SCHEDULER's flatten (splitRowUnits WITHOUT the
      // textById oracle — the scheduler doesn't apply it, and the two doors'
      // derived maturity must count the same sequence). Rows arrive in
      // global_order, which is the scheduler's fetch order too.
      let podOrdinal = 1
      for (const row of data || []) {
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
            podOrdinal: podOrdinal + Math.min(u.index, bareCount - 1),
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
          title,
          turns: mergeTurns(sentences),
          sentenceCount: sentences.length,
          speakers: castKeys.map((key) => ({
            name: displayName.get(key) || key,
            colorIndex: colorOf.get(key) ?? 0,
          })),
        })
      }

      if (myFetch !== activeFetch) return
      scenes.value = sceneList
    } catch (err) {
      if (myFetch !== activeFetch) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useListeningPods] fetch failed:', msg)
      error.value = msg
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
        error.value = null
        isLoading.value = false
        return
      }
      void fetchData(course)
    },
    { immediate: true },
  )

  return { scenes, isLoading, error }
}
