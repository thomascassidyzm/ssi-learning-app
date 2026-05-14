/**
 * useTombolaContexts — for a focused LEGO, return the [left | LEGO | right]
 * triples derived from every USE phrase that contains the LEGO.
 *
 * The methodology guarantees USE phrases are constructed only from LEGOs
 * available at debut time, so we don't need a learner-side reachability
 * filter — every USE phrase tied to a LEGO is a real "you can say this"
 * combination.
 *
 * Slicing rule: find the LEGO's target text inside the phrase's target
 * text; everything before it is `left`, everything after is `right`. One
 * side may be empty (the LEGO is phrase-boundary on that side) but never
 * both — that wouldn't be a phrase, it would be the LEGO standalone.
 *
 * CJK-aware: we do whitespace-tolerant match for character languages.
 */

import { ref, watch, inject, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface TombolaContext {
  /** Composite id for v-for keying: phraseId + legoId. */
  id: string
  /** Text before the LEGO in the phrase. Empty string = LEGO is phrase-initial. */
  left: string
  /** Text of the LEGO itself — included for completeness; UI fixes the centre. */
  lego: string
  /** Text after the LEGO in the phrase. Empty string = LEGO is phrase-final. */
  right: string
  /** Audio id for the whole phrase. */
  audioId: string
  /** For ordering (frequency-first), if a `frequency_score` column exists. */
  frequency?: number
}

export interface UseTombolaContextsReturn {
  contexts: Ref<TombolaContext[]>
  isLoading: Ref<boolean>
  error: Ref<string | null>
}

const CJK_RE = /[　-鿿가-힯＀-￯]/

function normalise(text: string, isCJK: boolean): string {
  let s = text.trim()
  if (isCJK) s = s.replace(/\s+/g, '')
  return s.toLowerCase()
}

/**
 * Slice `phraseText` at the occurrence of `legoText`. Returns [left, right]
 * or null if the LEGO text isn't found in the phrase.
 *
 * For CJK languages, both sides are whitespace-stripped before matching;
 * for alphabetic languages we keep word-boundary tolerance via a simple
 * indexOf on the lowercased + trimmed strings.
 */
function sliceAtLego(phraseText: string, legoText: string): { left: string; right: string } | null {
  if (!phraseText || !legoText) return null
  const isCJK = CJK_RE.test(phraseText) || CJK_RE.test(legoText)

  if (isCJK) {
    const p = normalise(phraseText, true)
    const l = normalise(legoText, true)
    const i = p.indexOf(l)
    if (i === -1) return null
    return { left: p.slice(0, i), right: p.slice(i + l.length) }
  }

  // Alphabetic: case-insensitive substring with a word-boundary preference.
  const pLower = phraseText.toLowerCase()
  const lLower = legoText.toLowerCase()
  const i = pLower.indexOf(lLower)
  if (i === -1) return null
  // Preserve original case from the source phrase.
  return {
    left: phraseText.slice(0, i).trim(),
    right: phraseText.slice(i + legoText.length).trim(),
  }
}

export function useTombolaContexts(
  courseCode: Ref<string | null>,
  legoId: Ref<string | null>,
): UseTombolaContextsReturn {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  const contexts = ref<TombolaContext[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  let activeFetch = 0

  async function fetchData(course: string, lego: string): Promise<void> {
    const supabase = supabaseRef?.value
    if (!supabase) {
      error.value = 'Supabase client not available (inject failed)'
      return
    }

    const myFetch = ++activeFetch
    isLoading.value = true
    error.value = null

    try {
      // Fetch the LEGO's own text first — we need it to slice the phrases.
      const { data: legoRow, error: legoErr } = await supabase
        .from('course_legos')
        .select('target_text')
        .eq('course_code', course)
        .eq('lego_id', lego)
        .maybeSingle()

      if (legoErr) throw new Error(`course_legos: ${legoErr.message}`)
      if (myFetch !== activeFetch) return

      const legoText = legoRow?.target_text || ''
      if (!legoText) {
        contexts.value = []
        return
      }

      // Parse seed_number + lego_index from the lego_id (SXXXXLYY) so we
      // can fetch the practice phrases scoped to this LEGO.
      const m = /^S(\d{4})L(\d+)$/.exec(lego)
      if (!m) {
        contexts.value = []
        return
      }
      const seedNumber = parseInt(m[1], 10)
      const legoIndex = parseInt(m[2], 10)

      // USE phrases tied to this LEGO live in course_practice_phrases
      // scoped by (course_code, seed_number, lego_index). The LEGO's BUILD
      // phrases also live here — Tom's framing was USE-specifically, but
      // the data path is the same; BUILD vs USE is distinguishable via
      // phrase_role if we want to filter later.
      const { data: phraseRows, error: phraseErr } = await supabase
        .from('course_practice_phrases')
        .select('id, target_text, target1_audio_id, phrase_role, position')
        .eq('course_code', course)
        .eq('seed_number', seedNumber)
        .eq('lego_index', legoIndex)
        .eq('phrase_role', 'use')
        .order('position', { ascending: true })

      if (phraseErr) throw new Error(`course_practice_phrases: ${phraseErr.message}`)
      if (myFetch !== activeFetch) return

      const result: TombolaContext[] = []
      for (const row of phraseRows || []) {
        const phraseText: string = row.target_text || ''
        if (!phraseText) continue
        const sliced = sliceAtLego(phraseText, legoText)
        if (!sliced) continue
        // Skip phrases where BOTH sides are empty — that would just be the
        // LEGO standalone, not a combination worth showing in the tombola.
        if (!sliced.left && !sliced.right) continue
        result.push({
          id: `${row.id}-${lego}`,
          left: sliced.left,
          lego: legoText,
          right: sliced.right,
          audioId: row.target1_audio_id || '',
        })
      }

      if (myFetch !== activeFetch) return
      contexts.value = result
    } catch (err) {
      if (myFetch !== activeFetch) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useTombolaContexts] fetch failed:', msg)
      error.value = msg
    } finally {
      if (myFetch === activeFetch) {
        isLoading.value = false
      }
    }
  }

  watch(
    [courseCode, legoId],
    ([course, lego]) => {
      if (!course || !lego) {
        contexts.value = []
        error.value = null
        isLoading.value = false
        return
      }
      void fetchData(course, lego)
    },
    { immediate: true },
  )

  return { contexts, isLoading, error }
}
