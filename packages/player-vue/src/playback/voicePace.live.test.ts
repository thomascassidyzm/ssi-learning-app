// @vitest-environment node
/**
 * LIVE acceptance for per-voice pace (plate S-345) — the REAL database, the
 * REAL server-side reader, the REAL baking function, no mocks.
 *
 * Gated: runs only with VOICE_PACE_LIVE=1 and the service key in the
 * environment.
 *
 *   VITE_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… VOICE_PACE_LIVE=1 \
 *     pnpm exec vitest run --root packages/player-vue src/playback/voicePace.live.test.ts
 *
 * It walks the whole read path: `public.course_voice_pace()` on the live DB →
 * `fetchCourseVoicePace` (the exact function the bundle route calls) → the
 * `CourseVoicePace` shape → `computeCycleSpeed`, the function that bakes
 * `cycle.playbackSpeed` onto every cycle a learner hears.
 *
 * Recorded run, 2026-09-07 (see the report for the before/after/restored
 * mutation evidence, which this file deliberately does NOT perform — a test
 * suite must not write to the live voices table).
 *
 *   spa_for_eng  target1 azure_es-ES-ElviraNeural  0.985  measured  -> 0.81 Easy
 *   spa_for_eng  target2 azure_es-ES-AlvaroNeural  1.000  measured  -> 0.80 Easy
 *   deu_at_for_eng target1 azure_de-AT-IngridNeural  null  NOT IN VOICES -> 0.80 Easy
 */
import { describe, it, expect } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { fetchCourseVoicePace } from '../../../../api/_utils/courseVoicePace'
import { computeCycleSpeed, explainCycleSpeed } from '../providers/toSimpleRounds'

const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const LIVE = process.env.VOICE_PACE_LIVE === '1' && !!url && !!key

describe.skipIf(!LIVE)('per-voice pace, live', () => {
  const supabase = LIVE ? createClient(url, key) : (null as never)

  it('a MEASURED voice: the player bakes that voice\'s number', async () => {
    const pace = await fetchCourseVoicePace(supabase, 'spa_for_eng', 20_000)
    expect(pace.unavailable).toBeUndefined()

    const t1 = pace.roles.target1!.primary
    console.log('[live] spa_for_eng target1:', JSON.stringify(t1))
    expect(t1.measured).toBe(true)
    expect(t1.effectivePaceRatio).toBeGreaterThan(0)

    const cfg = { globalSpeed: 1.0, nativeSpeed: true, mode: 'easy' as const, voicePace: pace }
    const speed = computeCycleSpeed(1, cfg, 'target1')
    // 0.8 / ratio, rounded to the 2dp the cycle bakes.
    const expected = Math.round((0.8 / Number(t1.effectivePaceRatio)) * 100) / 100
    console.log('[live] baked target1 speed (Easy):', speed, 'expected', expected)
    expect(speed).toBe(expected)
    // …and it is NOT the belt ladder's answer for seed 1.
    expect(speed).not.toBe(0.8)
    // …and it is the same at seed 400.
    expect(computeCycleSpeed(400, cfg, 'target1')).toBe(speed)
  }, 60_000)

  it('an UNMEASURED voice: the target pace, uncorrected, and it says so', async () => {
    const pace = await fetchCourseVoicePace(supabase, 'deu_at_for_eng', 20_000)
    const t1 = pace.roles.target1!.primary
    console.log('[live] deu_at_for_eng target1:', JSON.stringify(t1))
    expect(t1.measured).toBe(false)
    expect(t1.effectivePaceRatio).toBeNull()

    const cfg = { globalSpeed: 1.0, nativeSpeed: true, mode: 'easy' as const, voicePace: pace }
    expect(computeCycleSpeed(1, cfg, 'target1')).toBe(0.8)
    expect(computeCycleSpeed(1, { ...cfg, mode: 'fast' }, 'target1')).toBe(0.9)

    const e = explainCycleSpeed(cfg, 'target1')
    console.log('[live] explain:', JSON.stringify(e))
    expect(e.measured).toBe(false)
    expect(e.voiceId).toBe(t1.voiceId)
    expect(e.reason).toMatch(/no measured pace/)
  }, 60_000)

  it('the casting/rendering disagreement this is keyed to avoid is real', async () => {
    // deu_at_for_eng target2 is cast as a human voice in courses.voice_config
    // while its clips were rendered by an Azure voice. Keying pace off the
    // config would correct for a voice the learner never hears.
    const { data } = await supabase
      .from('courses')
      .select('voice_config')
      .eq('course_code', 'deu_at_for_eng')
      .maybeSingle()
    const cast = (data as { voice_config?: { voices?: Record<string, { voiceId?: string }> } } | null)
      ?.voice_config?.voices?.target2?.voiceId
    const pace = await fetchCourseVoicePace(supabase, 'deu_at_for_eng', 20_000)
    const rendered = pace.roles.target2!.primary
    console.log('[live] deu_at_for_eng target2 — cast:', cast, '| rendered:', rendered.voiceId, `(${rendered.clips} clips)`)
    expect(cast).toBeTruthy()
    expect(rendered.voiceId).not.toBe(cast)
  }, 60_000)
})
