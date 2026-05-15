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
  /** Concatenated target text of all sentences in this turn (space-joined). */
  targetText: string
  /** Concatenated translation. */
  knownText: string
  /** Audio IDs to play in sequence (one per sentence). */
  audioIds: string[]
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
}

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
        .select('id, scene_number, sentence_number, global_order, speaker, target_text, known_text, target_audio_id, known_audio_id')
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
          globalOrder: row.global_order,
        })
        buckets.set(row.scene_number, list)
      }

      // Speaker tags sometimes vary subtly between rows ("Vicino (08:00)"
      // vs "Vicino" — time annotation only on first speaker entrance).
      // Strip the time annotation for grouping so consecutive same-named
      // speakers merge even when only one row carries the time tag.
      const speakerKey = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, '').trim().toLowerCase()

      /**
       * Merge consecutive same-speaker sentences into turns. The first
       * sentence's globalOrder becomes the turn's order. The turn's id is
       * derived from the first sentence's id + sentence count so it stays
       * stable on re-render.
       */
      const mergeTurns = (sentences: PodSentence[]): PodTurn[] => {
        const turns: PodTurn[] = []
        for (const s of sentences) {
          const last = turns[turns.length - 1]
          if (last && speakerKey(last.speaker) === speakerKey(s.speaker)) {
            last.targetText = `${last.targetText} ${s.targetText}`.trim()
            last.knownText = `${last.knownText} ${s.knownText}`.trim()
            if (s.targetAudioId) last.audioIds.push(s.targetAudioId)
          } else {
            turns.push({
              id: `${s.id}-turn`,
              speaker: s.speaker,
              targetText: s.targetText,
              knownText: s.knownText,
              audioIds: s.targetAudioId ? [s.targetAudioId] : [],
              globalOrder: s.globalOrder,
            })
          }
        }
        return turns
      }

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
        sceneList.push({
          sceneNumber,
          title,
          turns: mergeTurns(sentences),
          sentenceCount: sentences.length,
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
