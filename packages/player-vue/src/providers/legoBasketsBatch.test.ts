import { describe, it, expect, beforeEach } from 'vitest'
import { CourseDataProvider } from './CourseDataProvider'
import { clearRevisedAudioRefs } from './revisedAudioRefs'

/**
 * The session bootstrap asks for the baskets of every seed in its inventory.
 * It used to ask one seed at a time — thirty `course_practice_phrases` reads
 * on the legacy 1..30 window, in the middle of the boot window. These pin the
 * collapse: one request for the lot, and the same baskets out of it.
 */

const UUID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`.slice(-36)

function phraseRow(seed: number, legoIndex: number, position: number) {
  return {
    seed_number: seed,
    lego_index: legoIndex,
    position,
    known_text: `known ${seed}-${legoIndex}-${position}`,
    target_text: `target ${seed}-${legoIndex}-${position}`,
    phrase_role: position === 1 ? 'build' : 'use',
    known_audio_id: UUID(1),
    target1_audio_id: UUID(2),
    target2_audio_id: UUID(3),
    target1_duration_ms: 1000 + position,
  }
}

/**
 * Supabase stub that records every `course_practice_phrases` query it is
 * handed, and answers from a fixed row set filtered by the `.in()` seed list.
 */
function phrasesStub(rows: any[]) {
  const calls: Array<{ seedNumbers: number[] | null; seedNumber: number | null }> = []
  const from = (table: string) => {
    if (table !== 'course_practice_phrases') {
      // course_audio (revised refs) — nothing revised in these fixtures.
      const other: any = { select: () => other, eq: () => other, gt: () => Promise.resolve({ data: [], error: null }) }
      return other
    }
    const call: { seedNumbers: number[] | null; seedNumber: number | null } = { seedNumbers: null, seedNumber: null }
    calls.push(call)
    const matching = () =>
      rows.filter((r) =>
        call.seedNumbers ? call.seedNumbers.includes(r.seed_number) : r.seed_number === call.seedNumber,
      )
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => {
        if (col === 'seed_number') call.seedNumber = val
        return chain
      },
      in: (col: string, vals: any[]) => {
        if (col === 'seed_number') call.seedNumbers = vals
        return chain
      },
      not: () => chain,
      order: () => chain,
      range: (from_: number, to: number) =>
        Promise.resolve({ data: matching().slice(from_, to + 1), error: null }),
      then: (resolve: any) => Promise.resolve({ data: matching(), error: null }).then(resolve),
    }
    return chain
  }
  return { stub: { from } as any, calls }
}

const makeProvider = (client: any) =>
  new CourseDataProvider({ supabaseClient: client, audioBaseUrl: '', courseId: 'ita_for_eng' })

describe('getLegoBasketsForSeeds', () => {
  beforeEach(() => clearRevisedAudioRefs())

  it('collapses a 30-seed inventory into ONE course_practice_phrases request', async () => {
    const rows = []
    for (let seed = 1; seed <= 30; seed++) {
      for (const legoIndex of [1, 2]) {
        rows.push(phraseRow(seed, legoIndex, 1), phraseRow(seed, legoIndex, 2))
      }
    }
    const { stub, calls } = phrasesStub(rows)
    const seedIds = Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(4, '0')}`)

    const baskets = await makeProvider(stub).getLegoBasketsForSeeds(seedIds)

    expect(calls.length).toBe(1)
    expect(calls[0].seedNumbers).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
    expect(baskets.size).toBe(60)
    expect(baskets.has('S0001L01')).toBe(true)
    expect(baskets.has('S0030L02')).toBe(true)
  })

  it('groups rows onto their own seed\'s legos, and keeps the within-lego order', async () => {
    const rows = [
      phraseRow(1, 1, 1), phraseRow(1, 1, 2),
      phraseRow(2, 1, 1), phraseRow(2, 3, 1),
    ]
    const baskets = await makeProvider(phrasesStub(rows).stub).getLegoBasketsForSeeds(['S0001', 'S0002'])

    // A lego_id carries its own seed_number, so seed 1's L01 can never
    // absorb seed 2's L01 — that is what makes one query safe.
    expect([...baskets.keys()].sort()).toEqual(['S0001L01', 'S0002L01', 'S0002L03'])
    // debut_phrases = BUILD first, topped up from USE; eternal = USE only.
    expect(baskets.get('S0001L01')!.debut_phrases.map((p) => p.phrase.known))
      .toEqual(['known 1-1-1', 'known 1-1-2'])
    expect(baskets.get('S0001L01')!.eternal_phrases.map((p) => p.phrase.known))
      .toEqual(['known 1-1-2'])
    expect(baskets.get('S0002L03')!.debut_phrases.map((p) => p.phrase.known))
      .toEqual(['known 2-3-1'])
  })

  it('is a no-op for an empty seed list, and survives an unparseable id', async () => {
    const { stub, calls } = phrasesStub([phraseRow(1, 1, 1)])
    expect((await makeProvider(stub).getLegoBasketsForSeeds([])).size).toBe(0)
    expect((await makeProvider(stub).getLegoBasketsForSeeds(['not-a-seed'])).size).toBe(0)
    expect(calls.length).toBe(0)
  })
})
