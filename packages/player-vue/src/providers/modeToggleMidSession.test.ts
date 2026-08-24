/**
 * FLIPPING THE MODE TOGGLE MID-SESSION CHANGES THE BEHAVIOUR NOW.
 *
 * Tom, 2026-08-09, reproduced live: started a course in EASY, confirmed the
 * doubling, flipped the toggle to FAST with no reload and no course switch —
 * and FAST kept playing Easy's doubled phrases. Doubling is baked into the
 * script at generation time, nothing reshaped the already-built queue on a
 * toggle, and the script cache is keyed on COURSE alone, so a reload
 * re-hydrated the very same Easy-doubled rounds.
 *
 * What this file pins:
 *   1. the pure reshape — Easy-built rounds reshaped to Fast are cycle-for-
 *      cycle identical to rounds GENERATED under Fast, and back again;
 *   2. the behaviour, not a config value: the number of back-to-back repeats
 *      of the same phrase goes 2 → 1 on the flip to Fast, and 1 → 2 back;
 *   3. the live engine: reshaping the queue mid-session replaces the FORWARD
 *      rounds while the round being played keeps its cycle cursor;
 *   4. the in-flight round: repeat copies still ahead of the cursor are
 *      identifiable, which is what the runtime skip gate drops on Easy→Fast.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE } from './generateLearningScript'
import { toSimpleRounds } from './toSimpleRounds'
import { reshapeRoundRepeats, isRepeatCopyCycle, stripRepeatCopies } from './reshapeRoundRepeats'
import { normalizeRepeatedCycleTypes } from '../composables/useAlgorithmConfig'
import { useSimplePlayer } from '../composables/useSimplePlayer'
import type { Round, Cycle } from '../playback/SimplePlayer'

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

const TOTAL_SEEDS = 12

function makeCourse() {
  const legos: any[] = []
  const phrases: any[] = []
  const seeds: any[] = []
  for (let s = 1; s <= TOTAL_SEEDS; s++) {
    legos.push({
      seed_number: s, lego_index: 1,
      known_text: `word ${s}`, target_text: `mot ${s}`, target_text_roman: null,
      type: 'A', is_new: true, presentation_audio_id: `pres-${s}`, ...audio(`lego${s}`),
    })
    seeds.push({
      seed_number: s, known_text: `sentence ${s}`, target_text: `phrase ${s}`,
      target_text_roman: null, ...audio(`seed${s}`),
    })
    for (let p = 1; p <= 5; p++) {
      phrases.push({
        seed_number: s, lego_index: 1,
        known_text: `i want the build ${s}.${p}`, target_text: `je veux mot ${s} b${p}`,
        phrase_role: 'build', position: p, target_syllable_count: null, ...audio(`b${s}-${p}`),
      })
    }
    for (let p = 1; p <= 6; p++) {
      phrases.push({
        seed_number: s, lego_index: 1,
        known_text: `i can see the use ${s}.${p}`, target_text: `je vois mot ${s} u${p}`,
        phrase_role: 'use', position: 100 + p, target_syllable_count: null, ...audio(`u${s}-${p}`),
      })
    }
  }
  return {
    course_legos: legos,
    course_practice_phrases: phrases,
    course_seeds: seeds,
    courses: [{ course_code: 'tst_for_eng', known_lang: 'eng', target_lang: 'fra' }],
  }
}

function fakeSupabase(tables: Record<string, any[]>): SupabaseClient {
  const all: Record<string, any[]> = {
    course_audio: [], lego_introductions: [], listening_pod_sentences: [], courses: [],
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
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
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

const TYPES = normalizeRepeatedCycleTypes(undefined)
const EASY_REPEAT = { count: 2, types: TYPES }
const FAST_REPEAT = { count: 1, types: TYPES }

/** A whole course walk under one mode's repeat config → SimplePlayer rounds. */
async function buildRounds(repeat: { count: number; types: ReadonlySet<string> }): Promise<Round[]> {
  const sb = fakeSupabase(makeCourse())
  const result = await generateLearningScript(
    sb, 'tst_for_eng', 0, { enabled: false, offset: 90 }, DEFAULT_SCRIPT_SHAPE, 1,
    { phraseRepeatCount: repeat.count, repeatedCycleTypes: [...repeat.types] },
  )
  return toSimpleRounds(result.items) as Round[]
}

/** The behavioural question, asked of the rounds themselves: how many times in
 *  a row does the same PRACTICE phrase play? Nothing here reads a config.
 *  Teaching cycles are excluded — an intro and its debut legitimately share
 *  the LEGO's own text, in both modes, and that is not a repeat. */
function maxConsecutiveSamePhrase(rounds: Round[]): number {
  let worst = 1
  for (const round of rounds) {
    const practice = round.cycles.filter(c => TYPES.has(c.type ?? ''))
    let run = 1
    for (let i = 1; i < practice.length; i++) {
      const same = practice[i].known.text === practice[i - 1].known.text
        && practice[i].target.text === practice[i - 1].target.text
      run = same ? run + 1 : 1
      if (run > worst) worst = run
    }
  }
  return worst
}

const shape = (rounds: Round[]) =>
  rounds.map(r => [r.roundNumber, r.cycles.map(c => `${c.type}:${c.known.text}→${c.target.text}`)])

describe('mode toggle mid-session — the reshape', () => {
  it('Easy rounds reshaped to Fast are identical to rounds GENERATED under Fast', async () => {
    const easyRounds = await buildRounds(EASY_REPEAT)
    const fastRounds = await buildRounds(FAST_REPEAT)

    expect(shape(easyRounds)).not.toEqual(shape(fastRounds))  // the repro premise

    const flipped = reshapeRoundRepeats(easyRounds, FAST_REPEAT)
    expect(shape(flipped)).toEqual(shape(fastRounds))
  })

  it('and back: Fast rounds reshaped to Easy match a real Easy walk', async () => {
    const easyRounds = await buildRounds(EASY_REPEAT)
    const fastRounds = await buildRounds(FAST_REPEAT)

    const flipped = reshapeRoundRepeats(fastRounds, EASY_REPEAT)
    expect(shape(flipped)).toEqual(shape(easyRounds))
  })

  it('the BEHAVIOUR changes, not just a config value: 2 back-to-back plays → 1', async () => {
    const easyRounds = await buildRounds(EASY_REPEAT)
    expect(maxConsecutiveSamePhrase(easyRounds)).toBe(2)

    const nowFast = reshapeRoundRepeats(easyRounds, FAST_REPEAT)
    expect(maxConsecutiveSamePhrase(nowFast)).toBe(1)

    const backToEasy = reshapeRoundRepeats(nowFast, EASY_REPEAT)
    expect(maxConsecutiveSamePhrase(backToEasy)).toBe(2)
  })

  it('never triples, however many times the toggle is flipped', async () => {
    let rounds = await buildRounds(EASY_REPEAT)
    for (let i = 0; i < 4; i++) {
      rounds = reshapeRoundRepeats(rounds, i % 2 === 0 ? FAST_REPEAT : EASY_REPEAT)
    }
    rounds = reshapeRoundRepeats(rounds, EASY_REPEAT)
    expect(maxConsecutiveSamePhrase(rounds)).toBe(2)
  })

  it('leaves the teaching cycles alone — the intro and the debut still play once', async () => {
    const rounds = reshapeRoundRepeats(await buildRounds(FAST_REPEAT), EASY_REPEAT)
    for (const round of rounds) {
      for (const type of ['intro', 'debut'] as const) {
        const ids = round.cycles.filter(c => c.type === type).map(c => c.id)
        expect(ids.filter(id => isRepeatCopyCycle({ id })).length).toBe(0)
      }
    }
  })

  it('never doubles a single-audio cycle (the drained seed-phase sandwich, pods, listening)', () => {
    const cycle = (over: Partial<Cycle>): Cycle => ({
      id: 'c', type: 'spaced_rep',
      known: { text: 'k', audioUrl: '' },
      target: { text: 't', voice1Url: '', voice2Url: '' },
      ...over,
    } as Cycle)
    const rounds = [{
      roundNumber: 1, legoId: 'S0001L01', seedId: 'S0001',
      cycles: [cycle({ id: 'sandwich', singleAudio: true }), cycle({ id: 'review' })],
    }] as Round[]
    const out = reshapeRoundRepeats(rounds, EASY_REPEAT)
    expect(out[0].cycles.map(c => c.id)).toEqual(['sandwich', 'review', 'review_x2'])
  })

  it('is a reference-equal no-op when the queue is already in the right shape', async () => {
    const fastRounds = await buildRounds(FAST_REPEAT)
    expect(reshapeRoundRepeats(fastRounds, FAST_REPEAT)).toBe(fastRounds)
  })

  it('identifies the copies the runtime gate drops mid-round on Easy→Fast', async () => {
    const easyRounds = await buildRounds(EASY_REPEAT)
    const cycles = easyRounds[3].cycles
    const copies = cycles.filter(isRepeatCopyCycle)
    expect(copies.length).toBeGreaterThan(0)
    expect(stripRepeatCopies(cycles).length).toBe(cycles.length - copies.length)
  })
})

// ── The live engine ────────────────────────────────────────────────────────
interface MockAudio { [k: string]: any }
function makeMockAudio(): MockAudio {
  return {
    src: '', playbackRate: 1, volume: 1, loop: false, paused: true, ended: false, error: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), setAttribute: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(),
  }
}

describe('mode toggle mid-session — the live queue', () => {
  beforeEach(() => { vi.stubGlobal('Audio', vi.fn(makeMockAudio)) })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reshapes the FORWARD rounds while the round being played keeps its cursor', async () => {
    const easyRounds = await buildRounds(EASY_REPEAT)
    const sp = useSimplePlayer()
    sp.initialize(easyRounds)
    sp.jumpToRound(2, 1)

    const playingBefore = sp.currentRound.value
    expect(maxConsecutiveSamePhrase([playingBefore!])).toBe(2)

    sp.reshapeQueue((rounds) => reshapeRoundRepeats(rounds, FAST_REPEAT))

    // The in-flight round is untouched (its cycleIndex would desync) — the
    // runtime skip gate covers it; every round AHEAD is now Fast-shaped.
    expect(sp.roundIndex.value).toBe(2)
    expect(sp.cycleIndex.value).toBe(1)
    expect(sp.currentRound.value?.cycles).toEqual(playingBefore?.cycles)

    // The splice replaces, never grows, the queue.
    expect(sp.roundCount.value).toBe(easyRounds.length)
  })

  it('every round after the current one stops doubling on the flip to Fast', async () => {
    const easyRounds = await buildRounds(EASY_REPEAT)
    const sp = useSimplePlayer()
    sp.initialize(easyRounds)
    sp.jumpToRound(1, 0)

    sp.reshapeQueue((rounds) => reshapeRoundRepeats(rounds, FAST_REPEAT))

    // Step forward into the next round and read what the display is bound to.
    sp.jumpToRound(2, 0)
    expect(maxConsecutiveSamePhrase([sp.currentRound.value!])).toBe(1)
    expect(sp.currentRound.value!.cycles.some(isRepeatCopyCycle)).toBe(false)
  })
})
