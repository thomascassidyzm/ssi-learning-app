/**
 * usePodStage0.ts — load a pod's sentences and resolve each atom to its DB clips,
 * so the Stage-0 ladder (stage0Sequence.ts) can be played in the app.
 *
 * Data sources (all already persisted by tools/persist-stage0-pod0.cjs in Popty):
 *   - listening_pod_sentences  : atom_map (ordered atoms), target_audio_id (whole
 *                                take), known_audio_id (translation), text fields.
 *   - pod_legos                : lego_key → explainer_audio_id (the merged
 *                                "<target> means <gloss>" clip).
 *   - course_audio (role=pod_explainer): the "[atom] <target>" target-slice clips,
 *                                resolved by exact text match.
 *
 * Resolution is course-wide (two small queries) then joined in memory, so picking
 * any sentence is O(1). No DB manifest is needed — the ladder is reconstructed
 * from rows.
 */
import { inject, ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvedAtom, SentenceClips } from './stage0Sequence'

interface AtomMapEntry {
  lego_key: string
  kind: 'atom' | 'passthrough' | 'note'
  gloss: string
  target_surface: string
  target_start_ms: number | null
  target_end_ms: number | null
}

interface PodSentenceRow {
  id: string
  global_order: number
  speaker: string | null
  target_text: string
  known_text: string
  target_audio_id: string | null
  known_audio_id: string | null
  explainer_audio_id: string | null
  glue_to_next: boolean
  atom_map: AtomMapEntry[] | null
}

/** Whole-sentence audio + flags the main Stages 1-9 preview needs. */
export interface SentenceMainAudio {
  targetAudioId: string | null
  knownAudioId: string | null
  explainerAudioId: string | null
  glueToNext: boolean
}

/** A sentence plus its resolution status, for the picker UI. */
export interface Stage0Sentence {
  id: string
  globalOrder: number
  speaker: string | null
  targetText: string
  knownText: string
  atomCount: number
  /** atoms whose target clip resolved (i.e. playable in the chunked/pairs tiers) */
  resolvedCount: number
  /** every atom has a target clip — the ideal demo sentence */
  fullyResolved: boolean
}

const TARGET_PREFIX = '[atom] '

export function usePodStage0(courseCode: Ref<string>) {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  const sentences = ref<Stage0Sentence[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // in-memory join tables (per course)
  let rowById = new Map<string, PodSentenceRow>()
  let meansGlossByLego = new Map<string, string>() // lego_key → explainer_audio_id
  let targetClipBySurface = new Map<string, string>() // target_surface → course_audio.id

  const load = async (): Promise<void> => {
    const supabase = supabaseRef?.value
    if (!supabase) {
      error.value = 'Supabase client not available (inject failed)'
      return
    }
    const course = courseCode.value
    if (!course) {
      error.value = 'No course code'
      return
    }
    isLoading.value = true
    error.value = null
    try {
      const [sentRes, legoRes, audioRes] = await Promise.all([
        supabase
          .from('listening_pod_sentences')
          .select(
            'id, global_order, speaker, target_text, known_text, target_audio_id, known_audio_id, explainer_audio_id, glue_to_next, atom_map',
          )
          .like('id', `${course}:pod-0:%`)
          .order('global_order', { ascending: true }),
        supabase
          .from('pod_legos')
          .select('lego_key, explainer_audio_id')
          .eq('course_code', course),
        supabase
          .from('course_audio')
          .select('id, text')
          .eq('course_code', course)
          .eq('role', 'pod_explainer')
          .like('text', `${TARGET_PREFIX}%`),
      ])

      if (sentRes.error) throw new Error(`sentences: ${sentRes.error.message}`)
      if (legoRes.error) throw new Error(`pod_legos: ${legoRes.error.message}`)
      if (audioRes.error) throw new Error(`course_audio: ${audioRes.error.message}`)

      rowById = new Map((sentRes.data as PodSentenceRow[]).map((r) => [r.id, r]))

      meansGlossByLego = new Map()
      for (const l of legoRes.data as Array<{ lego_key: string; explainer_audio_id: string | null }>) {
        if (l.explainer_audio_id) meansGlossByLego.set(l.lego_key, l.explainer_audio_id)
      }

      targetClipBySurface = new Map()
      for (const a of audioRes.data as Array<{ id: string; text: string }>) {
        const surface = a.text.slice(TARGET_PREFIX.length)
        // first writer wins (clips are 1:1 per distinct target surface)
        if (!targetClipBySurface.has(surface)) targetClipBySurface.set(surface, a.id)
      }

      sentences.value = (sentRes.data as PodSentenceRow[])
        .filter((r) => Array.isArray(r.atom_map) && r.atom_map.some((e) => e.kind === 'atom'))
        .map((r) => {
          const atoms = (r.atom_map || []).filter((e) => e.kind === 'atom')
          const resolved = atoms.filter((e) => targetClipBySurface.has(e.target_surface)).length
          return {
            id: r.id,
            globalOrder: r.global_order,
            speaker: r.speaker,
            targetText: r.target_text,
            knownText: r.known_text,
            atomCount: atoms.length,
            resolvedCount: resolved,
            fullyResolved: atoms.length > 0 && resolved === atoms.length,
          }
        })
    } catch (e: any) {
      error.value = e?.message || String(e)
      sentences.value = []
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Resolve a sentence to the atoms + clips the sequencer plays. Includes ALL
   * atom_map entries (atom + passthrough) in order; passthrough atoms keep their
   * target clip when one exists (it usually doesn't — they're skipped cleanly by
   * the sequencer). Returns null if the sentence wasn't loaded.
   */
  const resolveSentence = (
    sentenceId: string,
  ): { atoms: ResolvedAtom[]; clips: SentenceClips } | null => {
    const row = rowById.get(sentenceId)
    if (!row) return null
    const atoms: ResolvedAtom[] = (row.atom_map || [])
      .filter((e) => e.kind === 'atom' || e.kind === 'passthrough')
      .map((e) => ({
        targetSurface: e.target_surface,
        gloss: e.gloss,
        targetClipId: targetClipBySurface.get(e.target_surface) ?? null,
        meansGlossClipId: meansGlossByLego.get(e.lego_key) ?? null,
      }))
    const clips: SentenceClips = {
      wholeTakeId: row.target_audio_id,
      translationId: row.known_audio_id,
      targetText: row.target_text,
      knownText: row.known_text,
    }
    return { atoms, clips }
  }

  /** Whole-sentence audio for the main Stages 1-9 preview. Null if not loaded. */
  const mainAudioFor = (sentenceId: string): SentenceMainAudio | null => {
    const row = rowById.get(sentenceId)
    if (!row) return null
    return {
      targetAudioId: row.target_audio_id,
      knownAudioId: row.known_audio_id,
      explainerAudioId: row.explainer_audio_id,
      glueToNext: !!row.glue_to_next,
    }
  }

  return { sentences, isLoading, error, load, resolveSentence, mainAudioFor }
}
