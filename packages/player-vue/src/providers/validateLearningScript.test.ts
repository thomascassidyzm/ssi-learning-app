import { describe, it, expect } from 'vitest'
import {
  validateScriptItem,
  validateRoundStructure,
  validateLearningScript,
} from './validateLearningScript'
import type { ScriptItem } from './generateLearningScript'

// ---------------------------------------------------------------------------
// Helper: create a valid ScriptItem with sensible defaults
// ---------------------------------------------------------------------------

let counter = 0

function makeItem(overrides: Partial<ScriptItem> = {}): ScriptItem {
  counter++
  const type = overrides.type ?? 'build'
  const base: ScriptItem = {
    uuid: `item-${counter}`,
    cycleNum: counter,
    roundNumber: 1,
    seedId: 'S0001',
    legoKey: 'S0001L01',
    seedCode: 'S0001',
    legoCode: '01',
    type,
    knownText: 'I want',
    targetText: 'Quiero',
    knownAudioId: type === 'intro' ? undefined : 'audio-source-1',
    presentationAudioId: type === 'intro' ? 'audio-pres-1' : undefined,
    target1Id: 'audio-t1-1',
    target2Id: 'audio-t2-1',
    target1DurationMs: 1500,
    target2DurationMs: 1600,

    isNew: true,
  }
  return { ...base, ...overrides }
}

/**
 * Build a complete valid round: intro + debut + builds + use.
 * All items share the same roundNumber, legoKey, knownText, targetText.
 */
function makeValidRound(
  roundNumber: number,
  legoKey = 'S0001L01',
  knownText = 'I want',
  targetText = 'Quiero'
): ScriptItem[] {
  const shared = { roundNumber, legoKey, knownText, targetText }
  return [
    makeItem({ ...shared, type: 'intro', presentationAudioId: 'audio-pres-1', knownAudioId: undefined }),
    makeItem({ ...shared, type: 'debut', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
    makeItem({ ...shared, type: 'build', knownAudioId: 'audio-source-1', presentationAudioId: undefined, knownText: 'I want to learn', targetText: 'Quiero aprender' }),
    makeItem({ ...shared, type: 'build', knownAudioId: 'audio-source-1', presentationAudioId: undefined, knownText: 'I want more', targetText: 'Quiero mas' }),
    makeItem({ ...shared, type: 'use', knownAudioId: 'audio-source-1', presentationAudioId: undefined, knownText: 'I want food', targetText: 'Quiero comida' }),
  ]
}

// ---------------------------------------------------------------------------
// Level A: validateScriptItem
// ---------------------------------------------------------------------------

describe('validateScriptItem', () => {
  // 1. Complete intro item with all audio -> no errors
  it('returns no errors for a complete intro item with all audio', () => {
    const item = makeItem({
      type: 'intro',
      presentationAudioId: 'audio-pres-1',
      knownAudioId: undefined,
      target1Id: 'audio-t1-1',
      target2Id: 'audio-t2-1',
    })
    const results = validateScriptItem(item)
    expect(results).toEqual([])
  })

  // 2. Complete debut item with all audio -> no errors
  it('returns no errors for a complete debut item with all audio', () => {
    const item = makeItem({
      type: 'debut',
      knownAudioId: 'audio-source-1',
      target1Id: 'audio-t1-1',
      target2Id: 'audio-t2-1',
    })
    const results = validateScriptItem(item)
    expect(results).toEqual([])
  })

  // 3. Complete build item with all audio -> no errors
  it('returns no errors for a complete build item with all audio', () => {
    const item = makeItem({
      type: 'build',
      knownAudioId: 'audio-source-1',
      target1Id: 'audio-t1-1',
      target2Id: 'audio-t2-1',
    })
    const results = validateScriptItem(item)
    expect(results).toEqual([])
  })

  // 4. Missing knownText -> error
  it('returns an error when knownText is empty', () => {
    const item = makeItem({ knownText: '' })
    const results = validateScriptItem(item)
    const knownTextErrors = results.filter(r => r.field === 'knownText' && r.severity === 'error')
    expect(knownTextErrors).toHaveLength(1)
    expect(knownTextErrors[0].message).toContain('knownText')
  })

  // 5. Missing targetText -> error
  it('returns an error when targetText is empty', () => {
    const item = makeItem({ targetText: '' })
    const results = validateScriptItem(item)
    const targetTextErrors = results.filter(r => r.field === 'targetText' && r.severity === 'error')
    expect(targetTextErrors).toHaveLength(1)
    expect(targetTextErrors[0].message).toContain('targetText')
  })

  // 6. Intro missing presentationAudioId -> error
  it('returns an error when intro is missing presentationAudioId', () => {
    const item = makeItem({
      type: 'intro',
      presentationAudioId: undefined,
      target1Id: 'audio-t1-1',
      target2Id: 'audio-t2-1',
    })
    const results = validateScriptItem(item)
    const presErrors = results.filter(r => r.field === 'presentationAudioId' && r.severity === 'error')
    expect(presErrors).toHaveLength(1)
    expect(presErrors[0].message).toContain('presentationAudioId')
  })

  // 7. Intro missing target1Id -> error
  it('returns an error when intro is missing target1Id', () => {
    const item = makeItem({
      type: 'intro',
      presentationAudioId: 'audio-pres-1',
      target1Id: undefined,
      target2Id: 'audio-t2-1',
    })
    const results = validateScriptItem(item)
    const t1Errors = results.filter(r => r.field === 'target1Id' && r.severity === 'error')
    expect(t1Errors).toHaveLength(1)
  })

  // 8. Intro missing target2Id -> warning (not error)
  it('returns a warning (not error) when intro is missing target2Id', () => {
    const item = makeItem({
      type: 'intro',
      presentationAudioId: 'audio-pres-1',
      target1Id: 'audio-t1-1',
      target2Id: undefined,
    })
    const results = validateScriptItem(item)
    const t2Warnings = results.filter(r => r.field === 'target2Id' && r.severity === 'warning')
    const t2Errors = results.filter(r => r.field === 'target2Id' && r.severity === 'error')
    expect(t2Warnings).toHaveLength(1)
    expect(t2Errors).toHaveLength(0)
  })

  // 9. Debut missing knownAudioId -> error
  it('returns an error when debut is missing knownAudioId', () => {
    const item = makeItem({
      type: 'debut',
      knownAudioId: undefined,
      target1Id: 'audio-t1-1',
      target2Id: 'audio-t2-1',
    })
    const results = validateScriptItem(item)
    const srcErrors = results.filter(r => r.field === 'knownAudioId' && r.severity === 'error')
    expect(srcErrors).toHaveLength(1)
    expect(srcErrors[0].message).toContain('knownAudioId')
  })

  // 10. Debut missing target1Id -> error
  it('returns an error when debut is missing target1Id', () => {
    const item = makeItem({
      type: 'debut',
      knownAudioId: 'audio-source-1',
      target1Id: undefined,
      target2Id: 'audio-t2-1',
    })
    const results = validateScriptItem(item)
    const t1Errors = results.filter(r => r.field === 'target1Id' && r.severity === 'error')
    expect(t1Errors).toHaveLength(1)
  })

  // 11. Debut missing target2Id -> warning (not error)
  it('returns a warning (not error) when debut is missing target2Id', () => {
    const item = makeItem({
      type: 'debut',
      knownAudioId: 'audio-source-1',
      target1Id: 'audio-t1-1',
      target2Id: undefined,
    })
    const results = validateScriptItem(item)
    const t2Warnings = results.filter(r => r.field === 'target2Id' && r.severity === 'warning')
    const t2Errors = results.filter(r => r.field === 'target2Id' && r.severity === 'error')
    expect(t2Warnings).toHaveLength(1)
    expect(t2Errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Level B: validateRoundStructure
// ---------------------------------------------------------------------------

describe('validateRoundStructure', () => {
  // 12. Complete round (intro + debut + builds + use) -> valid
  it('returns valid for a complete round with intro, debut, builds, and use', () => {
    const items = makeValidRound(1)
    const result = validateRoundStructure(1, items)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.structure.hasIntro).toBe(true)
    expect(result.structure.hasDebut).toBe(true)
    expect(result.structure.buildCount).toBeGreaterThan(0)
    expect(result.structure.consolidateCount).toBeGreaterThan(0)
  })

  // 13. Round missing intro -> error
  it('returns an error when the round is missing an intro', () => {
    const items = makeValidRound(1)
    const withoutIntro = items.filter(i => i.type !== 'intro')
    const result = validateRoundStructure(1, withoutIntro)
    expect(result.valid).toBe(false)
    const structErrors = result.errors.filter(e => e.field === 'structure' && e.message.includes('missing an intro'))
    expect(structErrors.length).toBeGreaterThanOrEqual(1)
  })

  // 14. Round missing debut -> error
  it('returns an error when the round is missing a debut', () => {
    const items = makeValidRound(1)
    const withoutDebut = items.filter(i => i.type !== 'debut')
    const result = validateRoundStructure(1, withoutDebut)
    expect(result.valid).toBe(false)
    const structErrors = result.errors.filter(e => e.field === 'structure' && e.message.includes('missing a debut'))
    expect(structErrors.length).toBeGreaterThanOrEqual(1)
  })

  // 15. Round starting with debut instead of intro -> error
  it('returns an error when the round starts with debut instead of intro', () => {
    const items = makeValidRound(1)
    // Swap intro and debut so debut comes first
    const reordered = [items[1], items[0], ...items.slice(2)]
    const result = validateRoundStructure(1, reordered)
    expect(result.valid).toBe(false)
    const startErrors = result.errors.filter(e =>
      e.field === 'structure' && e.message.includes('does not start with an intro')
    )
    expect(startErrors.length).toBeGreaterThanOrEqual(1)
  })

  // 16. Intro/debut knownText mismatch -> error
  it('returns an error when intro and debut have different knownText', () => {
    const items = makeValidRound(1)
    // Change the debut's knownText to create a mismatch
    items[1] = makeItem({
      ...items[1],
      type: 'debut',
      knownText: 'Something different',
      knownAudioId: 'audio-source-1',
      presentationAudioId: undefined,
    })
    const result = validateRoundStructure(1, items)
    expect(result.valid).toBe(false)
    const mismatchErrors = result.errors.filter(e =>
      e.field === 'knownText' && e.message.includes('mismatch')
    )
    expect(mismatchErrors).toHaveLength(1)
  })

  // 17. Intro/debut targetText mismatch -> error
  it('returns an error when intro and debut have different targetText', () => {
    const items = makeValidRound(1)
    items[1] = makeItem({
      ...items[1],
      type: 'debut',
      targetText: 'Algo diferente',
      knownAudioId: 'audio-source-1',
      presentationAudioId: undefined,
    })
    const result = validateRoundStructure(1, items)
    expect(result.valid).toBe(false)
    const mismatchErrors = result.errors.filter(e =>
      e.field === 'targetText' && e.message.includes('mismatch')
    )
    expect(mismatchErrors).toHaveLength(1)
  })

  // 18. Intro/debut legoKey mismatch -> error
  it('returns an error when intro and debut have different legoKey', () => {
    const items = makeValidRound(1)
    items[1] = makeItem({
      ...items[1],
      type: 'debut',
      legoKey: 'S0002L01',
      knownAudioId: 'audio-source-1',
      presentationAudioId: undefined,
    })
    const result = validateRoundStructure(1, items)
    expect(result.valid).toBe(false)
    const mismatchErrors = result.errors.filter(e =>
      e.field === 'legoKey' && e.message.includes('mismatch')
    )
    expect(mismatchErrors).toHaveLength(1)
  })

  // 19. Round with no build cycles -> warning
  it('returns a warning when the round has no build cycles', () => {
    const items = [
      makeItem({ roundNumber: 1, type: 'intro', presentationAudioId: 'audio-pres-1', knownAudioId: undefined }),
      makeItem({ roundNumber: 1, type: 'debut', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
      makeItem({ roundNumber: 1, type: 'use', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
    ]
    const result = validateRoundStructure(1, items)
    // Should still be valid (warnings don't make it invalid)
    expect(result.valid).toBe(true)
    const buildWarnings = result.warnings.filter(w =>
      w.field === 'structure' && w.message.includes('no build cycles')
    )
    expect(buildWarnings).toHaveLength(1)
  })

  // 20. Round with no consolidation cycles -> warning
  it('returns a warning when the round has no consolidation (use) cycles', () => {
    const items = [
      makeItem({ roundNumber: 1, type: 'intro', presentationAudioId: 'audio-pres-1', knownAudioId: undefined }),
      makeItem({ roundNumber: 1, type: 'debut', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
      makeItem({ roundNumber: 1, type: 'build', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
    ]
    const result = validateRoundStructure(1, items)
    expect(result.valid).toBe(true)
    const useWarnings = result.warnings.filter(w =>
      w.field === 'structure' && w.message.includes('no consolidation')
    )
    expect(useWarnings).toHaveLength(1)
  })

  // 21. Out-of-order types (use before build) -> warning
  it('returns a warning when cycle types are out of order (use before build)', () => {
    const items = [
      makeItem({ roundNumber: 1, type: 'intro', presentationAudioId: 'audio-pres-1', knownAudioId: undefined }),
      makeItem({ roundNumber: 1, type: 'debut', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
      makeItem({ roundNumber: 1, type: 'use', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
      makeItem({ roundNumber: 1, type: 'build', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
    ]
    const result = validateRoundStructure(1, items)
    // Out-of-order is a warning, not an error, so round can still be valid
    expect(result.valid).toBe(true)
    const orderWarnings = result.warnings.filter(w =>
      w.field === 'structure' && w.message.includes('unexpected order')
    )
    expect(orderWarnings.length).toBeGreaterThanOrEqual(1)
  })
})

// ---------------------------------------------------------------------------
// Full script: validateLearningScript
// ---------------------------------------------------------------------------

describe('validateLearningScript', () => {
  // 22. Multiple valid rounds -> valid report
  it('returns a valid report for multiple valid rounds', () => {
    const round1 = makeValidRound(1, 'S0001L01', 'I want', 'Quiero')
    const round2 = makeValidRound(2, 'S0002L01', 'I need', 'Necesito')
    const allItems = [...round1, ...round2]

    const report = validateLearningScript(allItems)
    expect(report.valid).toBe(true)
    expect(report.totalRounds).toBe(2)
    expect(report.validRounds).toBe(2)
    expect(report.invalidRounds).toBe(0)
    expect(report.totalCycles).toBe(allItems.length)
    expect(report.cyclesWithErrors).toBe(0)
  })

  // 23. Mix of valid and invalid rounds -> invalid report with correct counts
  it('returns an invalid report with correct counts for mixed rounds', () => {
    const validRound = makeValidRound(1, 'S0001L01', 'I want', 'Quiero')
    // Invalid round: missing intro
    const invalidRound = [
      makeItem({ roundNumber: 2, legoKey: 'S0002L01', type: 'debut', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
      makeItem({ roundNumber: 2, legoKey: 'S0002L01', type: 'build', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
    ]
    const allItems = [...validRound, ...invalidRound]

    const report = validateLearningScript(allItems)
    expect(report.valid).toBe(false)
    expect(report.totalRounds).toBe(2)
    expect(report.validRounds).toBe(1)
    expect(report.invalidRounds).toBe(1)
  })

  // 24. Summary includes details of first invalid rounds
  it('includes details of first invalid rounds in summary', () => {
    const invalidRound1 = [
      makeItem({ roundNumber: 1, legoKey: 'S0001L01', type: 'debut', knownAudioId: 'audio-source-1', presentationAudioId: undefined }),
    ]
    const invalidRound2 = [
      makeItem({ roundNumber: 2, legoKey: 'S0002L01', type: 'debut', knownAudioId: 'audio-source-2', presentationAudioId: undefined }),
    ]
    const allItems = [...invalidRound1, ...invalidRound2]

    const report = validateLearningScript(allItems)
    expect(report.valid).toBe(false)
    expect(report.summary).toContain('Round 1')
    expect(report.summary).toContain('Round 2')
    expect(report.summary).toContain('S0001L01')
    expect(report.summary).toContain('S0002L01')
  })

  // 25. Empty items -> valid (0 rounds)
  it('returns a valid report with 0 rounds for empty input', () => {
    const report = validateLearningScript([])
    expect(report.valid).toBe(true)
    expect(report.totalRounds).toBe(0)
    expect(report.validRounds).toBe(0)
    expect(report.invalidRounds).toBe(0)
    expect(report.totalCycles).toBe(0)
    expect(report.cyclesWithErrors).toBe(0)
    expect(report.cyclesWithWarnings).toBe(0)
    expect(report.rounds).toEqual([])
  })
})
