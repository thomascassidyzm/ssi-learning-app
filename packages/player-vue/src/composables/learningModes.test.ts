import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import {
  useAlgorithmConfig,
  resolveScriptShape,
  DEFAULT_FAST,
  DEFAULT_EASY,
  DEFAULT_LEARNING_MODE,
  MODE_CONFIG_KEY,
} from './useAlgorithmConfig'

// Easy / Fast learning modes (Aran's ruling 2026-08-06 — exactly two modes,
// Turbo deleted). The contract these tests hold:
//   - 'fast_mode' is read with a live fallback to 'normal_mode' so an old
//     bundle and a new bundle both work during the promotion window;
//   - Fast is provably unchanged: its scriptShape override is the identity
//     and its phrase-length preference is 'shortest' (today's behaviour);
//   - a mode's scriptShape layers over the GLOBAL script_shape row in exactly
//     one place, resolveScriptShape.

const GLOBAL_SHAPE = {
  spacedRepOffsets: [1, 2, 3, 5, 8],
  maxBuildPhrases: 7,
  useConsolidationCount: 2,
  maxSpacedRepPhrases: 12,
  n1PhraseCount: 3,
}

/** Minimal Supabase stub: one `algorithm_config` table read. */
const fakeSupabase = (rows: Array<{ key: string; config: any }>) =>
  ref({
    from: () => ({ select: async () => ({ data: rows, error: null }) }),
  })

const load = async (rows: Array<{ key: string; config: any }>) => {
  const api = useAlgorithmConfig(fakeSupabase(rows))
  // Bust the module-level 5-minute cache shared across instances.
  api.invalidateCache()
  await api.loadConfigs(true)
  return api
}

describe('learning modes — Easy / Fast', () => {
  it('defaults to fast, and the two modes map to their row keys', () => {
    expect(DEFAULT_LEARNING_MODE).toBe('fast')
    expect(MODE_CONFIG_KEY).toEqual({ easy: 'easy_mode', fast: 'fast_mode' })
  })

  it('Fast is provably unchanged: identity shape override, shortest phrases', () => {
    expect(DEFAULT_FAST.scriptShape).toEqual({})
    expect(DEFAULT_FAST.phraseLengthPreference).toBe('shortest')
    expect(resolveScriptShape(GLOBAL_SHAPE, DEFAULT_FAST)).toEqual(GLOBAL_SHAPE)
  })

  it('Easy differs by OVERRIDE, and only in the keys it names', () => {
    const easy = resolveScriptShape(GLOBAL_SHAPE, DEFAULT_EASY)
    // Named keys win…
    expect(easy.maxBuildPhrases).toBe(DEFAULT_EASY.scriptShape!.maxBuildPhrases)
    expect(easy.useConsolidationCount).toBe(DEFAULT_EASY.scriptShape!.useConsolidationCount)
    // …everything else falls through to the global row untouched.
    expect(easy.spacedRepOffsets).toBe(GLOBAL_SHAPE.spacedRepOffsets)
    expect(easy.maxSpacedRepPhrases).toBe(GLOBAL_SHAPE.maxSpacedRepPhrases)
  })

  it('resolveScriptShape is the identity when a mode carries no override', () => {
    expect(resolveScriptShape(GLOBAL_SHAPE, null)).toEqual(GLOBAL_SHAPE)
    expect(resolveScriptShape(GLOBAL_SHAPE, {})).toEqual(GLOBAL_SHAPE)
  })

  it('reads fast_mode when the DB has been promoted', async () => {
    const { fastConfig, modeConfig } = await load([
      { key: 'fast_mode', config: { min_pause_ms: 111 } },
      { key: 'normal_mode', config: { min_pause_ms: 999 } },
    ])
    expect(fastConfig.value.min_pause_ms).toBe(111)
    expect(modeConfig('fast').min_pause_ms).toBe(111)
  })

  it('falls back to normal_mode when fast_mode is not in the DB yet', async () => {
    // A new bundle against a DB that has not been promoted: the learner must
    // still get the tuned normal_mode curve, not the baked defaults.
    const { fastConfig } = await load([{ key: 'normal_mode', config: { min_pause_ms: 999 } }])
    expect(fastConfig.value.min_pause_ms).toBe(999)
  })

  it('never reads turbo_boost, even when the row is still in the table', async () => {
    const { fastConfig, easyConfig } = await load([
      { key: 'normal_mode', config: { min_pause_ms: 999 } },
      { key: 'turbo_boost', config: { min_pause_ms: 1, playback_speed: 1.25 } },
    ])
    expect(fastConfig.value.min_pause_ms).toBe(999)
    expect(fastConfig.value.playback_speed).toBe(1.0)
    expect(easyConfig.value.playback_speed).toBe(1.0)
  })

  it('field-merges a partial easy_mode row over the defaults', async () => {
    const { easyConfig } = await load([
      { key: 'easy_mode', config: { min_pause_ms: 1500, phraseLengthPreference: 'longest' } },
    ])
    expect(easyConfig.value.min_pause_ms).toBe(1500)
    expect(easyConfig.value.phraseLengthPreference).toBe('longest')
    // Untouched fields still come from DEFAULT_EASY.
    expect(easyConfig.value.pause_boot_ms).toBe(DEFAULT_EASY.pause_boot_ms)
  })

  it('an admin can layer a shape override onto a mode from the DB', async () => {
    const { modeConfig } = await load([
      { key: 'easy_mode', config: { scriptShape: { maxSpacedRepPhrases: 4 } } },
    ])
    const shape = resolveScriptShape(GLOBAL_SHAPE, modeConfig('easy'))
    expect(shape.maxSpacedRepPhrases).toBe(4)
    expect(shape.maxBuildPhrases).toBe(GLOBAL_SHAPE.maxBuildPhrases)
  })
})
