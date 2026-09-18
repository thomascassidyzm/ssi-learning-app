import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateLearningScript } from './generateLearningScript'
import { toSimpleRounds } from './toSimpleRounds'

// mintonman's SECOND Basque report (2026-09-17): "only the basque is spoken
// (with English displayed); the layout is just like for a regular exercise, but
// missing the four-state exercise progress bar completely; and the basque words
// begin to appear card by card but then the app moves on to the next exercise."
//
// The drained seed-phase review (offset >= 144) is authored as a FOUR-clip
// comprehensible-input sandwich: target -> known -> target -> target (Tom +
// Aran, 2026-07-14). All four sub-cycles carry the SAME seed sentence on both
// sides, because all four display it — so the generator's consecutive-duplicate
// pass, and then the A-64 cap, read them as one prompt repeated four times and
// threw three of them away, INCLUDING the only English clip. Verified in the
// live telemetry of one Basque learner: one `audio_play` at role target1 per
// seed review, never a `known`, with the cycle counter stepping by four.
//
// The sandwich has no mic pause and asks for no production, so it is outside
// A-64's scope exactly as the listening cups and pod plays are.

const audio = (n: string) => ({
  known_audio_id: `${n}-k`,
  target1_audio_id: `${n}-t1`,
  target2_audio_id: `${n}-t2`,
  target1_duration_ms: 1000,
  target2_duration_ms: 1000,
})

// One A-LEGO per seed. Needs to run past offset 144 for a seed-phase review.
const TOTAL_SEEDS = 150

function makeCourse() {
  const legos: any[] = []
  const phrases: any[] = []
  const seeds: any[] = []
  for (let s = 1; s <= TOTAL_SEEDS; s++) {
    legos.push({
      seed_number: s, lego_index: 1,
      known_text: `word ${s}`, target_text: `wort ${s}`, target_text_roman: null,
      type: 'A', is_new: true, presentation_audio_id: `pres-${s}`, ...audio(`lego${s}`),
    })
    seeds.push({
      seed_number: s,
      known_text: `sentence ${s}`, target_text: `satz ${s}`, target_text_roman: null,
      ...audio(`seed${s}`),
    })
    for (let p = 1; p <= 5; p++) {
      phrases.push({ seed_number: s, lego_index: 1, known_text: `build ${s}.${p}`, target_text: `bau ${s}.${p}`, phrase_role: 'build', position: p, target_syllable_count: p, ...audio(`b${s}-${p}`) })
      phrases.push({ seed_number: s, lego_index: 1, known_text: `use ${s}.${p}`, target_text: `nutz ${s}.${p}`, phrase_role: 'use', position: 100 + p, target_syllable_count: 6 + p, ...audio(`u${s}-${p}`) })
    }
  }
  return { course_legos: legos, course_practice_phrases: phrases, course_seeds: seeds }
}

function fakeSupabase(tables: Record<string, any[]>): SupabaseClient {
  const all: Record<string, any[]> = {
    course_audio: [], lego_introductions: [], listening_pod_sentences: [], ...tables,
  }
  return {
    from(table: string) {
      const rows = all[table] ?? []
      let headOnly = false
      const builder: any = {
        select(_c?: string, opts?: { count?: string; head?: boolean }) { headOnly = !!opts?.head; return builder },
        then(resolve: (v: any) => any, reject?: (e: any) => any) {
          const value = headOnly ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null }
          return Promise.resolve(value).then(resolve, reject)
        },
      }
      for (const m of ['eq', 'in', 'order', 'range', 'limit', 'gte', 'lte', 'not', 'is']) builder[m] = () => builder
      return builder
    },
  } as unknown as SupabaseClient
}

const script = async () =>
  generateLearningScript(fakeSupabase(makeCourse()), 'tst_for_eng', 0, { enabled: false, offset: 90 })

describe('the drained seed sandwich reaches the learner whole', () => {
  it('emits four sub-cycles per seed review, one of them the English clip', async () => {
    const { items } = await script()
    const sandwiches = items.filter((i: any) => i.type === 'spaced_rep' && i.reviewItemKind === 'seed')
    expect(sandwiches.length).toBeGreaterThan(0)

    const byReview = new Map<string, any[]>()
    for (const i of sandwiches) {
      const key = `${i.roundNumber}:${i.legoKey}`
      if (!byReview.has(key)) byReview.set(key, [])
      byReview.get(key)!.push(i)
    }
    for (const [key, subs] of byReview) {
      expect(subs.length, `${key} lost sub-cycles`).toBe(4)
      // Exactly one known-audio slot: the English sentence the learner hears
      // between the Basque plays. Its absence IS "only the basque is spoken".
      expect(subs.filter(s => s.knownAudioId).length, `${key} lost its English clip`).toBe(1)
      expect(subs.filter(s => s.target1Id).length).toBe(3)
    }
  })

  it('the four sub-cycles stay contiguous and in t-k-t-t order after the A-64 cap', async () => {
    const { items } = await script()
    const firstKey = items.find((i: any) => i.type === 'spaced_rep' && i.reviewItemKind === 'seed')
    expect(firstKey).toBeTruthy()
    const key = `${firstKey!.roundNumber}:${firstKey!.legoKey}`
    const round = items.filter((i: any) => i.roundNumber === firstKey!.roundNumber)
    const idx = round
      .map((i: any, n: number) => ({ i, n }))
      .filter(({ i }) => i.type === 'spaced_rep' && i.reviewItemKind === 'seed' && `${i.roundNumber}:${i.legoKey}` === key)
      .map(({ n }) => n)
    expect(idx.length).toBe(4)
    expect(idx[3] - idx[0], 'sandwich was split by re-interleaving').toBe(3)
    const roles = idx.map(n => (round[n].knownAudioId ? 'k' : 't'))
    expect(roles.join('')).toBe('tktt')
  })

  it('every sandwich sub-cycle holds its assembled tiles before advancing', async () => {
    const { items } = await script()
    const rounds = toSimpleRounds(items)
    const subs = rounds.flatMap(r => r.cycles).filter((c: any) => c.seedSandwich)
    expect(subs.length).toBeGreaterThan(0)
    for (const c of subs) {
      // pauseDuration 0 is correct — there is no mic stage here, which is why
      // the four-state phase strip is (rightly) absent. But voice2 carries no
      // audio, so without a linger the tiles start assembling and are snatched
      // away in the same frame: "begin to appear card by card but then the app
      // moves on".
      expect(c.pauseDuration).toBe(0)
      expect(c.lingerMs ?? 0).toBeGreaterThanOrEqual(1200)
    }
  })
})
