import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript } from './generateLearningScript'
import { toSimpleRounds } from './toSimpleRounds'

// Tom's ruling (2026-08-06): the player must NEVER screw up a course because
// some audio is missing — it plays what it HAS, skipping only the specific
// unplayable item. Never amputate a round, never cut off the rest of the
// course. The generator used to drop an audio-short LEGO before round numbers
// were assigned, so one gap slid every later round down by one (fra_for_eng
// from round 47, re-pairing the whole Fibonacci review schedule) and a partial
// import amputated the course (ara_lb_for_eng lost 776 of 1414 rounds).

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

const TOTAL_SEEDS = 12
const GAP_SEED = 6 // the mid-course LEGO whose audio is incomplete

type Overrides = Record<string, unknown>

/** One A-LEGO per seed, each with 5 build + 5 use phrases that all have audio. */
function makeCourse(gapOverrides: Overrides | null) {
  const legos: any[] = []
  const phrases: any[] = []
  const seeds: any[] = []
  for (let s = 1; s <= TOTAL_SEEDS; s++) {
    legos.push({
      seed_number: s,
      lego_index: 1,
      known_text: `word ${s}`,
      target_text: `wort ${s}`,
      target_text_roman: null,
      type: 'A',
      is_new: true,
      presentation_audio_id: `pres-${s}`,
      ...audio(`lego${s}`),
      ...(s === GAP_SEED && gapOverrides ? gapOverrides : {}),
    })
    seeds.push({
      seed_number: s,
      known_text: `sentence ${s}`,
      target_text: `satz ${s}`,
      target_text_roman: null,
      ...audio(`seed${s}`),
    })
    for (let p = 1; p <= 5; p++) {
      phrases.push({
        seed_number: s,
        lego_index: 1,
        known_text: `build ${s}.${p}`,
        target_text: `bau ${s}.${p}`,
        phrase_role: 'build',
        position: p,
        target_syllable_count: p,
        ...audio(`b${s}-${p}`),
      })
      phrases.push({
        seed_number: s,
        lego_index: 1,
        known_text: `use ${s}.${p}`,
        target_text: `nutz ${s}.${p}`,
        phrase_role: 'use',
        position: 100 + p,
        target_syllable_count: 6 + p,
        ...audio(`u${s}-${p}`),
      })
    }
  }
  return { course_legos: legos, course_practice_phrases: phrases, course_seeds: seeds }
}

/** Minimal chainable supabase-js stand-in; `head:true` yields the row count. */
function fakeSupabase(tables: Record<string, any[]>): SupabaseClient {
  const all: Record<string, any[]> = {
    course_audio: [],
    lego_introductions: [],
    listening_pod_sentences: [],
    ...tables,
  }
  return {
    from(table: string) {
      const rows = all[table] ?? []
      let headOnly = false
      const builder: any = {
        select(_c?: string, opts?: { count?: string; head?: boolean }) {
          headOnly = !!opts?.head
          return builder
        },
        then(resolve: (v: any) => any, reject?: (e: any) => any) {
          const value = headOnly
            ? { data: null, count: rows.length, error: null }
            : { data: rows, count: rows.length, error: null }
          return Promise.resolve(value).then(resolve, reject)
        },
      }
      for (const m of ['eq', 'in', 'order', 'range', 'limit', 'gte', 'lte', 'not', 'is']) {
        builder[m] = () => builder
      }
      return builder
    },
  } as unknown as SupabaseClient
}

const run = (gapOverrides: Overrides | null) =>
  generateLearningScript(fakeSupabase(makeCourse(gapOverrides)), 'tst_for_eng', 0, {
    enabled: false,
    offset: 90,
  })

const roundOf = (items: any[], legoKey: string) =>
  items.find((i) => i.legoKey === legoKey)?.roundNumber

describe('a LEGO short of one audio clip costs that item, not its round or the course', () => {
  it('keeps every round and every round NUMBER identical to the intact course', async () => {
    const intact = await run(null)
    // Second target voice missing — the real fra_for_eng S0015L01 shape.
    const gapped = await run({ target2_audio_id: null })

    const roundsOf = (r: { items: any[] }) => [...new Set(r.items.map((i) => i.roundNumber))].sort((a, b) => a - b)

    expect(roundsOf(gapped)).toEqual(roundsOf(intact))
    expect(gapped.roundCount).toBe(intact.roundCount)
    expect(gapped.mainLoopRoundCount).toBe(intact.mainLoopRoundCount)

    // Every round AFTER the gap keeps its number — the assertion that would
    // have caught the slide.
    for (let s = GAP_SEED; s <= TOTAL_SEEDS; s++) {
      const key = `S${String(s).padStart(4, '0')}L01`
      expect(roundOf(gapped.items, key)).toBe(roundOf(intact.items, key))
    }
  })

  it('omits only the unplayable item and keeps the rest of the round', async () => {
    const gapped = await run({ target2_audio_id: null })
    const gapKey = `S${String(GAP_SEED).padStart(4, '0')}L01`
    const gapItems = gapped.items.filter((i) => i.legoKey === gapKey && i.roundNumber === roundOf(gapped.items, gapKey))

    // The debut asks for production, so it needs all three clips — dropped.
    expect(gapItems.some((i) => i.type === 'debut')).toBe(false)
    // The intro only needs a prompt clip and the first target voice — kept.
    expect(gapItems.some((i) => i.type === 'intro')).toBe(true)
    // And the round still teaches: its build and use phrases all survive.
    expect(gapItems.filter((i) => i.type === 'build').length).toBeGreaterThanOrEqual(5)
  })

  it('a LEGO with NO audio at all still keeps its round number and its phrases', async () => {
    const intact = await run(null)
    const gapped = await run({
      known_audio_id: null,
      target1_audio_id: null,
      target2_audio_id: null,
      presentation_audio_id: null,
    })
    const gapKey = `S${String(GAP_SEED).padStart(4, '0')}L01`

    expect(gapped.roundCount).toBe(intact.roundCount)
    for (let s = GAP_SEED + 1; s <= TOTAL_SEEDS; s++) {
      const key = `S${String(s).padStart(4, '0')}L01`
      expect(roundOf(gapped.items, key)).toBe(roundOf(intact.items, key))
    }
    const gapItems = gapped.items.filter((i) => i.legoKey === gapKey)
    expect(gapItems.some((i) => i.type === 'intro' || i.type === 'debut')).toBe(false)
    expect(gapItems.filter((i) => i.type === 'build').length).toBeGreaterThanOrEqual(5)
  })

  it('later LEGOs still review the audio-short one — it stays in the schedule', async () => {
    const gapped = await run({ target2_audio_id: null })
    const gapKey = `S${String(GAP_SEED).padStart(4, '0')}L01`
    const gapRound = roundOf(gapped.items, gapKey)!
    const reviews = gapped.items.filter(
      (i) => i.type === 'spaced_rep' && i.legoKey === gapKey && i.roundNumber > gapRound,
    )
    expect(reviews.length).toBeGreaterThan(0)
  })

  it('a round left with nothing playable is dropped downstream, never stalls', async () => {
    // No phrases at all for the gap LEGO and no LEGO audio → zero playable items.
    const tables = makeCourse({
      known_audio_id: null,
      target1_audio_id: null,
      target2_audio_id: null,
      presentation_audio_id: null,
    })
    const gapLego = `S${String(GAP_SEED).padStart(4, '0')}L01`
    tables.course_practice_phrases = tables.course_practice_phrases.filter(
      (p: any) => p.seed_number !== GAP_SEED,
    )
    const { items } = await generateLearningScript(fakeSupabase(tables), 'tst_for_eng', 0, {
      enabled: false,
      offset: 90,
    })
    const rounds = toSimpleRounds(items)
    // One is_new LEGO per seed, so round number == seed number; the gap LEGO
    // now contributes no item of its own, so its round can only be found here.
    const gapRound = rounds.find((r) => r.roundNumber === GAP_SEED)

    // No empty Round object ever reaches the player…
    expect(rounds.every((r) => r.cycles.length > 0)).toBe(true)
    // …the gap LEGO contributes no cycle of its own…
    expect(gapRound?.cycles.some((c) => c.legoId === gapLego)).toBeFalsy()
    // …but its round still exists, carrying the reviews of earlier LEGOs it
    // was scheduled to run — play what you HAVE — and numbering is untouched.
    expect(gapRound).toBeDefined()
    expect(rounds.length).toBe(TOTAL_SEEDS)
    expect(rounds.map((r) => r.roundNumber)).toEqual(
      [...rounds.map((r) => r.roundNumber)].sort((a, b) => a - b),
    )
  })
})
