/**
 * useBrainInventory — vertical-passage browser data.
 *
 * Returns every LEGO the learner has reached (gated by
 * course_enrollments.highest_completed_lego_id), in introduction order,
 * with practice-frequency (sum of fire_count across all pairings the
 * LEGO participates in). Brightness driver for the inventory tiles.
 *
 * The brain view (v3) is a script-like vertical passage — belt-grouped
 * sections of readable target+known tiles, scrollable, tap-to-drill-in
 * to the tombola. This composable is its data source.
 *
 * NEVER expose "lego/seed/round" to the user; the consumer renders
 * `targetText`, `knownText`, and a belt-coloured pip / index badge.
 */

import { ref, watch, inject, computed, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BELTS } from './useBeltProgress'

export interface InventoryLego {
  legoId: string
  /** 1-based introduction order across the course. */
  ordinal: number
  type: 'atom' | 'molecule'
  targetText: string
  knownText: string
  audioId: string
  beltIndex: number
  /** Sum of fire_count across all pairings this LEGO appears in. */
  fireCount: number
}

export interface InventoryBeltSection {
  beltIndex: number
  beltName: string
  beltColor: string
  legos: InventoryLego[]
}

export interface BrainInventoryData {
  courseCode: string
  languageName: string
  sections: InventoryBeltSection[]
  /** Number of introduced LEGOs (words/phrases the learner has met). */
  totalLegoCount: number
  /**
   * Total USE phrases across all introduced LEGOs. This is the headline
   * "things you can say" number — every USE phrase is a real combination
   * the methodology has graduated for spaced rep, not just a word.
   */
  totalSayableCount: number
  /** Max fireCount across all legos — for normalising brightness. */
  maxFireCount: number
}

function beltIndexForSeed(seedNumber: number): number {
  for (let i = BELTS.length - 1; i >= 0; i--) {
    if (seedNumber >= BELTS[i].seedsRequired) return i
  }
  return 0
}

function classifyType(legoType: unknown, targetText: string): 'atom' | 'molecule' {
  if (legoType === 'M') return 'molecule'
  if (legoType === 'A') return 'atom'
  const words = (targetText || '').trim().split(/\s+/).filter(Boolean)
  return words.length <= 1 ? 'atom' : 'molecule'
}

function seedFromLegoId(legoId: string): number | null {
  const m = /^S(\d{4})L\d+$/.exec(legoId)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

export interface UseBrainInventoryReturn {
  data: Ref<BrainInventoryData | null>
  isLoading: Ref<boolean>
  error: Ref<string | null>
}

export function useBrainInventory(
  courseCode: Ref<string | null>,
  learnerId: Ref<string | null>,
): UseBrainInventoryReturn {
  const supabaseRef = inject<{ value: SupabaseClient | null }>('supabase')

  const data = ref<BrainInventoryData | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  let activeFetch = 0

  function emptyResult(course: string, languageName: string): BrainInventoryData {
    return {
      courseCode: course,
      languageName,
      sections: [],
      totalLegoCount: 0,
      totalSayableCount: 0,
      maxFireCount: 0,
    }
  }

  async function fetchData(course: string, learner: string | null): Promise<void> {
    const supabase = supabaseRef?.value
    if (!supabase) {
      error.value = 'Supabase client not available (inject failed)'
      return
    }

    if (!learner || learner.startsWith('guest-')) {
      data.value = emptyResult(course, course)
      return
    }

    const myFetch = ++activeFetch
    isLoading.value = true
    error.value = null

    try {
      const { data: enrollmentRow, error: enrollErr } = await supabase
        .from('course_enrollments')
        .select('highest_completed_lego_id')
        .eq('learner_id', learner)
        .eq('course_id', course)
        .maybeSingle()

      if (enrollErr) throw new Error(`course_enrollments: ${enrollErr.message}`)
      if (myFetch !== activeFetch) return

      const { data: courseRow, error: courseErr } = await supabase
        .from('courses')
        .select('display_name')
        .eq('course_code', course)
        .maybeSingle()
      if (courseErr) {
        console.warn('[useBrainInventory] courses fetch failed:', courseErr.message)
      }
      if (myFetch !== activeFetch) return
      const languageName = courseRow?.display_name || course

      const highestLegoId = enrollmentRow?.highest_completed_lego_id as string | null
      const maxSeed = highestLegoId ? seedFromLegoId(highestLegoId) : null

      if (!enrollmentRow || !highestLegoId || maxSeed === null) {
        data.value = emptyResult(course, languageName)
        return
      }

      const [legoResult, pairingsResult, useCountResult] = await Promise.all([
        supabase
          .from('course_legos')
          .select('lego_id, seed_number, lego_index, type, target_text, known_text, target1_audio_id')
          .eq('course_code', course)
          .lte('seed_number', maxSeed)
          .order('seed_number', { ascending: true })
          .order('lego_index', { ascending: true }),
        supabase
          .from('learner_lego_pairings')
          .select('lego_a, lego_b, fire_count')
          .eq('learner_id', learner)
          .eq('course_code', course),
        // Count USE phrases attached to any introduced LEGO — this is
        // the headline "things you can say" number. By methodology
        // construction every USE phrase tied to an introduced LEGO is a
        // real, sayable combination.
        supabase
          .from('course_practice_phrases')
          .select('id', { count: 'exact', head: true })
          .eq('course_code', course)
          .eq('phrase_role', 'use')
          .lte('seed_number', maxSeed),
      ])

      if (legoResult.error) throw new Error(`course_legos: ${legoResult.error.message}`)
      if (myFetch !== activeFetch) return

      if (pairingsResult.error) {
        console.warn('[useBrainInventory] learner_lego_pairings fetch failed:', pairingsResult.error.message)
      }
      if (useCountResult.error) {
        console.warn('[useBrainInventory] course_practice_phrases count failed:', useCountResult.error.message)
      }

      // Sum fire_count per lego (a LEGO can appear as lego_a or lego_b).
      const fireByLego = new Map<string, number>()
      for (const row of pairingsResult.data || []) {
        const n = row.fire_count || 0
        fireByLego.set(row.lego_a, (fireByLego.get(row.lego_a) || 0) + n)
        fireByLego.set(row.lego_b, (fireByLego.get(row.lego_b) || 0) + n)
      }

      const allLegos: InventoryLego[] = (legoResult.data || []).map((row, i) => ({
        legoId: row.lego_id,
        ordinal: i + 1,
        type: classifyType(row.type, row.target_text || ''),
        targetText: row.target_text || '',
        knownText: row.known_text || '',
        audioId: row.target1_audio_id || '',
        beltIndex: beltIndexForSeed(row.seed_number),
        fireCount: fireByLego.get(row.lego_id) || 0,
      }))

      // Group by belt.
      const byBelt = new Map<number, InventoryLego[]>()
      for (const lego of allLegos) {
        const list = byBelt.get(lego.beltIndex) || []
        list.push(lego)
        byBelt.set(lego.beltIndex, list)
      }

      const sections: InventoryBeltSection[] = []
      for (let bi = 0; bi < BELTS.length; bi++) {
        const list = byBelt.get(bi)
        if (!list || list.length === 0) continue
        sections.push({
          beltIndex: bi,
          beltName: BELTS[bi].name,
          beltColor: BELTS[bi].color,
          legos: list,
        })
      }

      let maxFireCount = 0
      for (const lego of allLegos) {
        if (lego.fireCount > maxFireCount) maxFireCount = lego.fireCount
      }

      if (myFetch !== activeFetch) return
      data.value = {
        courseCode: course,
        languageName,
        sections,
        totalLegoCount: allLegos.length,
        totalSayableCount: useCountResult.count ?? 0,
        maxFireCount,
      }
    } catch (err) {
      if (myFetch !== activeFetch) return
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[useBrainInventory] fetch failed:', msg)
      error.value = msg
    } finally {
      if (myFetch === activeFetch) {
        isLoading.value = false
      }
    }
  }

  watch(
    [courseCode, learnerId],
    ([course, learner]) => {
      if (!course) {
        data.value = null
        error.value = null
        isLoading.value = false
        return
      }
      void fetchData(course, learner)
    },
    { immediate: true },
  )

  return { data, isLoading, error }
}
