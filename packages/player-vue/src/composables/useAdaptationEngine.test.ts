import { describe, it, expect } from 'vitest'
import { ref, nextTick } from 'vue'
import { createEvidenceAggregator } from '@ssi/core'
import { useAdaptationEngine } from './useAdaptationEngine'

// A long quiet stretch (faint drift) then a sharp upward break = a developing
// struggle on a "higher = harder" metric — same shape as
// localDifficulty.test.ts's `struggling()` fixture.
const STRUGGLING_VALUES = [...Array.from({ length: 16 }, (_, x) => 2.5 + 0.01 * x), 2.9, 3.6, 4.6, 6.0]

describe('useAdaptationEngine — planRound criticality wiring (2026-07-16 shadow verdict, "criticality inversion")', () => {
  it('a seed-1 LEGO struggling in review phase is NOT deferred — its ordinal must reach the criticality guard', () => {
    const aggregator = createEvidenceAggregator()
    const seed1LegoId = 'S0001L01'
    STRUGGLING_VALUES.forEach((value, i) => {
      aggregator.record({
        unitId: seed1LegoId,
        unitKind: 'lego',
        source: 'latency',
        value,
        weight: 1,
        occurredAtMs: i * 12_000,
      })
    })

    const engine = useAdaptationEngine({
      supabase: null,
      learnerId: null,
      courseCode: 'test_course',
      aggregator,
    })

    // The round about to play is a MUCH later LEGO (ordinal 200 of 400) — the
    // seed-1 unit above is only present as a review-phase evidence read, not
    // the round's own LEGO.
    const roundInput = { roundLegoId: 'S0200L01', roundLegoOrdinal: 200, courseLegoCount: 400, manualOverrideActive: false }

    const first = engine.planRound(roundInput)
    // Sanity: the fixture itself really does read as struggling.
    const seed1Read = first.difficulty.find((d) => d.unitId === seed1LegoId)
    expect(seed1Read?.state).toBe('struggling')

    // hysteresisReads defaults to 2 — a second confirming read is what
    // would move a budget lever if (bug) seed1's ordinal were missing from
    // unitOrdinals, reading isCritical() as false.
    const second = engine.planRound(roundInput)

    // Pre-fix: seed-1 fell through as "unknown ordinal -> not critical", so
    // its struggle deferred buildCount/spacedRepCap toward the floor. Post-
    // fix: ordinal 1 of 400 is inside the 15% frontload cutoff (ceil(400*0.15)
    // = 60) -> critical -> the structural enforcement in ratePolicy.ts must
    // keep the round-budget levers at their scripted defaults.
    expect(second.plan.buildCount).toBe(7)
    expect(second.plan.spacedRepCap).toBe(12)
  })

  it('the same struggling unit, if genuinely non-critical (late ordinal), DOES defer — contrast case proving the guard still works', () => {
    const aggregator = createEvidenceAggregator()
    const lateLegoId = 'S0300L02'
    STRUGGLING_VALUES.forEach((value, i) => {
      aggregator.record({
        unitId: lateLegoId,
        unitKind: 'lego',
        source: 'latency',
        value,
        weight: 1,
        occurredAtMs: i * 12_000,
      })
    })

    const engine = useAdaptationEngine({
      supabase: null,
      learnerId: null,
      courseCode: 'test_course',
      aggregator,
    })

    const roundInput = { roundLegoId: 'S0500L01', roundLegoOrdinal: 500, courseLegoCount: 1000, manualOverrideActive: false }
    engine.planRound(roundInput)
    const { plan } = engine.planRound(roundInput)

    // ordinal 300 of 1000, cutoff = ceil(1000*0.15) = 150 -> genuinely non-critical
    expect(plan.buildCount).toBeLessThan(7)
    expect(plan.spacedRepCap).toBeLessThan(12)
  })
})

describe('useAdaptationEngine — reactive supabase/learnerId (2026-07-16 shadow verdict, "persistence silently broken")', () => {
  it('flush() re-reads a Ref learnerId live, so a value that resolves AFTER construction is not lost forever', async () => {
    const learnerId = ref<string | null>(null) // unresolved at construction — the real cold-start race
    const upserted: unknown[] = []
    const fakeSupabase = {
      schema() {
        return {
          from() {
            return {
              select() {
                return { eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }
              },
              upsert(payload: unknown[]) {
                upserted.push(...payload)
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
    }

    const engine = useAdaptationEngine({
      supabase: ref(fakeSupabase as never),
      learnerId,
      courseCode: 'test_course',
    })
    await engine.initialize()

    // Auth resolves AFTER construction — the documented race.
    learnerId.value = '11111111-1111-1111-1111-111111111111'

    engine.recordCycle('S0001L01', 1500, 3)
    for (let i = 0; i < 9; i++) engine.recordCycle('S0001L01', 1500, 3) // FLUSH_EVERY_N_CYCLES = 10
    await engine.flush()

    expect(upserted.length).toBeGreaterThan(0)
    expect((upserted[0] as { learner_id: string }).learner_id).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('hydrates mastery state once the learnerId resolves, even though initialize() was already called pre-resolution', async () => {
    const learnerId = ref<string | null>(null)
    const loadedFor: string[] = []
    const fakeSupabase = {
      schema() {
        return {
          from() {
            return {
              select() {
                return {
                  eq(_col: string, val: string) {
                    loadedFor.push(val)
                    return { eq: () => Promise.resolve({ data: [], error: null }) }
                  },
                }
              },
              upsert() {
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
    }

    const engine = useAdaptationEngine({
      supabase: ref(fakeSupabase as never),
      learnerId,
      courseCode: 'test_course',
    })
    await engine.initialize() // pre-resolution: learnerId.value is still null, so this is a no-op

    expect(loadedFor).toEqual([])

    learnerId.value = '22222222-2222-2222-2222-222222222222'
    await nextTick() // flush the watch() callback
    await Promise.resolve() // let its async initialize() call settle past its first await

    expect(loadedFor).toEqual(['22222222-2222-2222-2222-222222222222'])
  })
})
