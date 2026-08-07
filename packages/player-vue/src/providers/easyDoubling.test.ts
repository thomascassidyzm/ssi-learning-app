/**
 * EASY MODE PLAYS EVERY PRACTICE PHRASE TWICE (Tom, 2026-08-07).
 *
 *   "in EASY mode, double up every phrase, every BLD, every USE, every REVIEW,
 *    every CONSOLIDATE … we do NOT ever want to repeat exactly the same phrase
 *    more than 2x - a phrase repeated 3x would drive people nuts, but doubled
 *    up is perfect"
 *
 * and, on whether the teaching cycles are doubled too: "of course not - the
 * intro LEGO and not the LEGO alone".
 *
 * What this file pins:
 *   1. the pure pass — pairs, never triples, and leaves intro/debut/seed-phase
 *      reviews alone;
 *   2. end to end through the generator — every BUILD / REVIEW / USE cycle
 *      appears exactly twice consecutively, intro and debut exactly once, and
 *      nothing anywhere appears three times in a row;
 *   3. FAST IS BYTE-IDENTICAL to a run with the feature absent entirely.
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript, DEFAULT_SCRIPT_SHAPE, scriptItemIdentity, type ScriptItem } from './generateLearningScript'
import { doublePhraseCycles, isDoubledCycle } from './doublePhraseCycles'
import { toSimpleRounds } from './toSimpleRounds'
import { cyclePromptIdentity } from '../playback/capConsecutiveRepeats'

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

const TOTAL_SEEDS = 14

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

/** `easy === undefined` OMITS the options argument entirely. */
const run = (easy?: Parameters<typeof generateLearningScript>[6]) => {
  const sb = fakeSupabase(makeCourse())
  const args = [sb, 'tst_for_eng', 0, { enabled: false, offset: 90 }, DEFAULT_SCRIPT_SHAPE, 1] as const
  return easy === undefined
    ? generateLearningScript(...args)
    : generateLearningScript(...args, easy)
}

const item = (over: Partial<ScriptItem> & Pick<ScriptItem, 'type'>): ScriptItem => ({
  uuid: over.uuid ?? `u-${over.type}-${over.cycleNum ?? 1}`,
  cycleNum: 1, roundNumber: 1, seedId: 'S0001', legoKey: 'S0001L01',
  seedCode: 'S0001', legoCode: '01', knownText: 'k', targetText: 't', isNew: true,
  ...over,
} as ScriptItem)

describe('1. the doubling pass itself', () => {
  it('doubles the four practice types and nothing else', () => {
    expect(isDoubledCycle(item({ type: 'build' }))).toBe(true)
    expect(isDoubledCycle(item({ type: 'spaced_rep' }))).toBe(true)
    expect(isDoubledCycle(item({ type: 'use' }))).toBe(true)
    expect(isDoubledCycle(item({ type: 'intro' }))).toBe(false)
    expect(isDoubledCycle(item({ type: 'debut' }))).toBe(false)
    expect(isDoubledCycle(item({ type: 'listening' }))).toBe(false)
    expect(isDoubledCycle(item({ type: 'pod' }))).toBe(false)
    expect(isDoubledCycle(item({ type: 'component_intro' }))).toBe(false)
    expect(isDoubledCycle(item({ type: 'component_practice' }))).toBe(false)
    expect(isDoubledCycle(item({ type: 'listen_intro' }))).toBe(false)
    expect(isDoubledCycle(item({ type: 'listen_outro' }))).toBe(false)
  })

  it('leaves the SEED-PHASE production sandwich alone — doubling it would be 4x', () => {
    expect(isDoubledCycle(item({ type: 'spaced_rep', reviewItemKind: 'seed' }))).toBe(false)
  })

  it('pairs each practice cycle, gives the copy its own uuid, and renumbers cycles', () => {
    const out = doublePhraseCycles([
      item({ type: 'intro', uuid: 'i1' }),
      item({ type: 'debut', uuid: 'd1' }),
      item({ type: 'build', uuid: 'b1' }),
      item({ type: 'use', uuid: 'u1' }),
    ])
    expect(out.map(i => i.uuid)).toEqual(['i1', 'd1', 'b1', 'b1_x2', 'u1', 'u1_x2'])
    expect(out.map(i => i.cycleNum)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('restarts cycle numbering at every round boundary', () => {
    const out = doublePhraseCycles([
      item({ type: 'build', uuid: 'b1', roundNumber: 1 }),
      item({ type: 'build', uuid: 'b2', roundNumber: 2 }),
    ])
    expect(out.map(i => [i.roundNumber, i.cycleNum])).toEqual([[1, 1], [1, 2], [2, 1], [2, 2]])
  })
})

describe('2. end to end — an Easy script', () => {
  const easy = { doublePhraseCycles: true }

  it('plays every BUILD, REVIEW and CONSOLIDATE cycle exactly twice, back to back', async () => {
    const { items } = await run(easy)
    const practice = items.filter(i => ['build', 'spaced_rep', 'use'].includes(i.type) && i.reviewItemKind !== 'seed')
    expect(practice.length).toBeGreaterThan(0)

    // Walk each round and check the pairing directly: a practice item is
    // always immediately followed by its twin.
    const byRound = new Map<number, ScriptItem[]>()
    for (const i of items) {
      const list = byRound.get(i.roundNumber) ?? []
      list.push(i)
      byRound.set(i.roundNumber, list)
    }
    for (const round of byRound.values()) {
      for (let i = 0; i < round.length; i++) {
        const current = round[i]
        if (!['build', 'spaced_rep', 'use'].includes(current.type)) continue
        if (current.reviewItemKind === 'seed') continue
        if (current.uuid.endsWith('_x2')) continue // this IS a twin
        const twin = round[i + 1]
        expect(twin, `no twin after ${current.uuid}`).toBeDefined()
        expect(twin.uuid).toBe(`${current.uuid}_x2`)
        expect(scriptItemIdentity(twin)).toBe(scriptItemIdentity(current))
      }
    }
  })

  it('plays INTRO and the bare LEGO debut exactly once', async () => {
    const { items } = await run(easy)
    const intros = items.filter(i => i.type === 'intro')
    const debuts = items.filter(i => i.type === 'debut')
    expect(intros.length).toBeGreaterThan(0)
    expect(debuts.length).toBeGreaterThan(0)
    for (const teaching of [...intros, ...debuts]) {
      expect(teaching.uuid.endsWith('_x2')).toBe(false)
    }
    // One intro and one debut per round, never two.
    for (const kind of ['intro', 'debut'] as const) {
      const perRound = new Map<number, number>()
      for (const i of items.filter(x => x.type === kind)) {
        perRound.set(i.roundNumber, (perRound.get(i.roundNumber) ?? 0) + 1)
      }
      for (const count of perRound.values()) expect(count).toBe(1)
    }
  })

  it('never plays the same prompt three times in a row, anywhere', async () => {
    const { items } = await run(easy)
    let run3 = 0
    for (let i = 2; i < items.length; i++) {
      const a = scriptItemIdentity(items[i - 2])
      const b = scriptItemIdentity(items[i - 1])
      const c = scriptItemIdentity(items[i])
      if (a === b && b === c) run3++
    }
    expect(run3).toBe(0)
  })

  it('roughly doubles the cycle count without changing the round count', async () => {
    const plain = await run()
    const doubled = await run(easy)
    expect(doubled.roundCount).toBe(plain.roundCount)
    expect(doubled.cycleCount).toBeGreaterThan(plain.cycleCount * 1.7)
    expect(doubled.cycleCount).toBeLessThanOrEqual(plain.cycleCount * 2)
  })
})

describe('3. the pairs survive the round adapter, which is what the player receives', () => {
  it('toSimpleRounds keeps every twin adjacent and never lets a prompt run three deep', async () => {
    const { items } = await run({ doublePhraseCycles: true })
    const rounds = toSimpleRounds(items)
    let pairs = 0
    for (const round of rounds) {
      for (let i = 0; i < round.cycles.length; i++) {
        const id = (c: any) => cyclePromptIdentity(c)
        if (i >= 2 && id(round.cycles[i]) === id(round.cycles[i - 1]) && id(round.cycles[i]) === id(round.cycles[i - 2])) {
          throw new Error(`three in a row in round ${round.roundNumber}: ${id(round.cycles[i])}`)
        }
        if (i >= 1 && id(round.cycles[i]) === id(round.cycles[i - 1])) pairs++
      }
    }
    expect(pairs).toBeGreaterThan(0)
  })
})

describe('4. FAST IS PROVABLY UNCHANGED', () => {
  it('an options object with every lever off is byte-identical to omitting it', async () => {
    const omitted = await run()
    const fast = await run({
      doublePhraseCycles: false,
      filterBuildPhrases: true,
      reviewMaxKnownSyllables: 0,
    })
    expect(JSON.stringify(fast.items)).toBe(JSON.stringify(omitted.items))
    expect(fast.cycleCount).toBe(omitted.cycleCount)
    expect(fast.roundCount).toBe(omitted.roundCount)
    expect(fast.mainLoopRoundCount).toBe(omitted.mainLoopRoundCount)
    expect(fast.syllableCapApplied).toBe(false)
  })

  it('an empty options object is byte-identical too', async () => {
    const omitted = await run()
    expect(JSON.stringify((await run({})).items)).toBe(JSON.stringify(omitted.items))
  })
})
