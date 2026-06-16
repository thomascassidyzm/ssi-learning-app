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
    /** listening_pod_sentences.id — lets the admin audit walk resolve the
     *  per-atom Stage-0 clips for this sentence. */
    id: string
    targetText: string
    knownText: string
    targetAudioId: string | null
    knownAudioId: string | null
    explainerAudioId: string | null
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
        .select('id, scene_number, sentence_number, global_order, speaker, target_text, known_text, target_audio_id, known_audio_id, explainer_audio_id')
        .eq('pod_id', podId)
        .order('global_order', { ascending: true })

      if (fetchErr) throw new Error(`listening_pod_sentences: ${fetchErr.message}`)
      if (myFetch !== activeFetch) return

      // Bucket by scene_number.
      const buckets = new Map<number, PodSentence[]>()
      for (const row of data || []) {
        const list = buckets.get(row.scene_number) || []
        list.push({
          id: row.id,
          speaker: row.speaker || '',
          targetText: row.target_text || '',
          knownText: row.known_text || '',
          targetAudioId: row.target_audio_id || null,
          knownAudioId: row.known_audio_id || null,
          explainerAudioId: row.explainer_audio_id || null,
          globalOrder: row.global_order,
        })
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
