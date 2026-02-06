/**
 * validateLearningScript - Validates the output of generateLearningScript
 *
 * Two levels of validation for the active playback pipeline:
 *   generateLearningScript → toSimpleRounds → SimplePlayer
 *
 * Level A: Cycle Integrity (per ScriptItem)
 *   Every ScriptItem must have matched text + audio IDs.
 *
 * Level B: Round Integrity (group of ScriptItems sharing a roundNumber)
 *   The sequence of cycle types within a round must follow the correct structure:
 *   INTRO → DEBUT → BUILD(s) → SPACED_REP(s) → USE(s)
 *
 * No external dependencies. Pure validation logic.
 */

import type { ScriptItem } from './generateLearningScript'

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface CycleValidationError {
  cycleId: string
  legoKey: string
  type: ScriptItem['type']
  field: string
  message: string
  severity: 'error' | 'warning'
}

export interface RoundValidationResult {
  roundNumber: number
  legoKey: string
  valid: boolean
  structure: {
    hasIntro: boolean
    hasDebut: boolean
    buildCount: number
    spacedRepCount: number
    consolidateCount: number
    totalCycles: number
  }
  errors: CycleValidationError[]
  warnings: CycleValidationError[]
}

export interface ScriptValidationReport {
  valid: boolean
  totalRounds: number
  validRounds: number
  invalidRounds: number
  totalCycles: number
  cyclesWithErrors: number
  cyclesWithWarnings: number
  rounds: RoundValidationResult[]
  summary: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeError(
  item: ScriptItem,
  field: string,
  message: string,
  severity: 'error' | 'warning'
): CycleValidationError {
  return {
    cycleId: item.uuid,
    legoKey: item.legoKey,
    type: item.type,
    field,
    message,
    severity,
  }
}

function isNonEmpty(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

// ---------------------------------------------------------------------------
// Level A: Cycle Integrity
// ---------------------------------------------------------------------------

/**
 * Validate a single ScriptItem for data completeness.
 *
 * Returns an array of errors/warnings. An empty array means the item is valid.
 */
export function validateScriptItem(item: ScriptItem): CycleValidationError[] {
  const results: CycleValidationError[] = []

  // -- Text fields (required for all types) --

  if (!isNonEmpty(item.knownText)) {
    results.push(makeError(item, 'knownText', 'knownText is empty or missing', 'error'))
  }

  if (!isNonEmpty(item.targetText)) {
    results.push(makeError(item, 'targetText', 'targetText is empty or missing', 'error'))
  }

  // -- Audio fields --

  if (item.type === 'intro') {
    // Intro requires presentationAudioId instead of knownAudioId
    if (!isNonEmpty(item.presentationAudioId)) {
      results.push(makeError(item, 'presentationAudioId', 'intro cycle missing presentationAudioId', 'error'))
    }
    if (!isNonEmpty(item.target1Id)) {
      results.push(makeError(item, 'target1Id', 'intro cycle missing target1Id', 'error'))
    }
    if (!isNonEmpty(item.target2Id)) {
      results.push(makeError(item, 'target2Id', 'intro cycle missing target2Id (second voice)', 'warning'))
    }
  } else {
    // debut, build, spaced_rep, use — all require knownAudioId + target IDs
    if (!isNonEmpty(item.knownAudioId)) {
      results.push(makeError(item, 'knownAudioId', `${item.type} cycle missing knownAudioId (known audio)`, 'error'))
    }
    if (!isNonEmpty(item.target1Id)) {
      results.push(makeError(item, 'target1Id', `${item.type} cycle missing target1Id`, 'error'))
    }
    if (!isNonEmpty(item.target2Id)) {
      results.push(makeError(item, 'target2Id', `${item.type} cycle missing target2Id (second voice)`, 'warning'))
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Level B: Round Integrity
// ---------------------------------------------------------------------------

/** Expected type ordering within a round. */
const TYPE_ORDER: ScriptItem['type'][] = ['intro', 'debut', 'build', 'spaced_rep', 'use']

function typeOrderIndex(type: ScriptItem['type']): number {
  const idx = TYPE_ORDER.indexOf(type)
  return idx === -1 ? TYPE_ORDER.length : idx
}

/**
 * Validate the structure of a single round (all ScriptItems sharing the same roundNumber).
 */
export function validateRoundStructure(
  roundNumber: number,
  items: ScriptItem[]
): RoundValidationResult {
  const errors: CycleValidationError[] = []
  const warnings: CycleValidationError[] = []

  // Collect per-item validation results
  for (const item of items) {
    for (const issue of validateScriptItem(item)) {
      if (issue.severity === 'error') {
        errors.push(issue)
      } else {
        warnings.push(issue)
      }
    }
  }

  // Determine primary legoKey from intro or first item
  const introItem = items.find(i => i.type === 'intro')
  const debutItem = items.find(i => i.type === 'debut')
  const primaryLegoKey = introItem?.legoKey || items[0]?.legoKey || ''

  // Classify items by type
  const intros = items.filter(i => i.type === 'intro')
  const debuts = items.filter(i => i.type === 'debut')
  const builds = items.filter(i => i.type === 'build')
  const spacedReps = items.filter(i => i.type === 'spaced_rep')
  const uses = items.filter(i => i.type === 'use')

  const structure = {
    hasIntro: intros.length > 0,
    hasDebut: debuts.length > 0,
    buildCount: builds.length,
    spacedRepCount: spacedReps.length,
    consolidateCount: uses.length,
    totalCycles: items.length,
  }

  // -- Structural checks --

  // 1. Intro must exist
  if (!structure.hasIntro) {
    errors.push({
      cycleId: items[0]?.uuid || '',
      legoKey: primaryLegoKey,
      type: 'intro',
      field: 'structure',
      message: `Round ${roundNumber} is missing an intro cycle`,
      severity: 'error',
    })
  }

  // 2. Debut must exist
  if (!structure.hasDebut) {
    errors.push({
      cycleId: items[0]?.uuid || '',
      legoKey: primaryLegoKey,
      type: 'debut',
      field: 'structure',
      message: `Round ${roundNumber} is missing a debut cycle`,
      severity: 'error',
    })
  }

  // 3. Intro must be first
  if (items.length > 0 && items[0].type !== 'intro') {
    errors.push({
      cycleId: items[0].uuid,
      legoKey: items[0].legoKey,
      type: items[0].type,
      field: 'structure',
      message: `Round ${roundNumber} does not start with an intro cycle (starts with ${items[0].type})`,
      severity: 'error',
    })
  }

  // 4. Debut must be second
  if (items.length > 1 && items[1].type !== 'debut') {
    errors.push({
      cycleId: items[1]?.uuid || '',
      legoKey: items[1]?.legoKey || primaryLegoKey,
      type: items[1]?.type || 'debut',
      field: 'structure',
      message: `Round ${roundNumber} second cycle should be debut (found ${items[1]?.type})`,
      severity: 'error',
    })
  }

  // 5. Type ordering: after intro+debut, the remaining items should not go backwards
  //    (build before spaced_rep before use)
  for (let i = 2; i < items.length - 1; i++) {
    const current = items[i]
    const next = items[i + 1]
    if (typeOrderIndex(current.type) > typeOrderIndex(next.type)) {
      warnings.push({
        cycleId: next.uuid,
        legoKey: next.legoKey,
        type: next.type,
        field: 'structure',
        message: `Round ${roundNumber} has ${next.type} after ${current.type} (unexpected order)`,
        severity: 'warning',
      })
    }
  }

  // 6. At least 1 build cycle expected
  if (builds.length === 0) {
    warnings.push({
      cycleId: introItem?.uuid || items[0]?.uuid || '',
      legoKey: primaryLegoKey,
      type: 'build',
      field: 'structure',
      message: `Round ${roundNumber} has no build cycles`,
      severity: 'warning',
    })
  }

  // 7. USE/consolidate cycles should close the round
  if (uses.length === 0) {
    warnings.push({
      cycleId: introItem?.uuid || items[0]?.uuid || '',
      legoKey: primaryLegoKey,
      type: 'use',
      field: 'structure',
      message: `Round ${roundNumber} has no consolidation (use) cycles`,
      severity: 'warning',
    })
  }

  // 8. Intro and debut must share the same knownText and targetText (same LEGO)
  if (introItem && debutItem) {
    if (introItem.knownText !== debutItem.knownText) {
      errors.push({
        cycleId: debutItem.uuid,
        legoKey: debutItem.legoKey,
        type: 'debut',
        field: 'knownText',
        message: `Round ${roundNumber} intro/debut knownText mismatch: "${introItem.knownText}" vs "${debutItem.knownText}"`,
        severity: 'error',
      })
    }
    if (introItem.targetText !== debutItem.targetText) {
      errors.push({
        cycleId: debutItem.uuid,
        legoKey: debutItem.legoKey,
        type: 'debut',
        field: 'targetText',
        message: `Round ${roundNumber} intro/debut targetText mismatch: "${introItem.targetText}" vs "${debutItem.targetText}"`,
        severity: 'error',
      })
    }
  }

  // 9. Intro and debut must share the same legoKey
  if (introItem && debutItem && introItem.legoKey !== debutItem.legoKey) {
    errors.push({
      cycleId: debutItem.uuid,
      legoKey: debutItem.legoKey,
      type: 'debut',
      field: 'legoKey',
      message: `Round ${roundNumber} intro/debut legoKey mismatch: "${introItem.legoKey}" vs "${debutItem.legoKey}"`,
      severity: 'error',
    })
  }

  const valid = errors.length === 0

  return {
    roundNumber,
    legoKey: primaryLegoKey,
    valid,
    structure,
    errors,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Full script validation
// ---------------------------------------------------------------------------

/**
 * Validate an entire learning script (the output of generateLearningScript).
 *
 * Groups items by roundNumber, validates each item individually and each
 * round structurally, then produces summary stats and a human-readable
 * summary string.
 */
export function validateLearningScript(items: ScriptItem[]): ScriptValidationReport {
  // Group items by roundNumber
  const byRound = new Map<number, ScriptItem[]>()
  for (const item of items) {
    if (!byRound.has(item.roundNumber)) {
      byRound.set(item.roundNumber, [])
    }
    byRound.get(item.roundNumber)!.push(item)
  }

  // Validate each round
  const roundNumbers = Array.from(byRound.keys()).sort((a, b) => a - b)
  const roundResults: RoundValidationResult[] = []

  for (const roundNum of roundNumbers) {
    const roundItems = byRound.get(roundNum)!
    roundResults.push(validateRoundStructure(roundNum, roundItems))
  }

  // Aggregate stats
  const totalRounds = roundResults.length
  const validRounds = roundResults.filter(r => r.valid).length
  const invalidRounds = totalRounds - validRounds

  const totalCycles = items.length

  // Count unique cycles with errors/warnings across all rounds
  const cycleIdsWithErrors = new Set<string>()
  const cycleIdsWithWarnings = new Set<string>()
  for (const round of roundResults) {
    for (const err of round.errors) {
      cycleIdsWithErrors.add(err.cycleId)
    }
    for (const warn of round.warnings) {
      cycleIdsWithWarnings.add(warn.cycleId)
    }
  }

  const cyclesWithErrors = cycleIdsWithErrors.size
  const cyclesWithWarnings = cycleIdsWithWarnings.size

  const valid = invalidRounds === 0

  // Build human-readable summary
  const summaryParts: string[] = []

  if (valid) {
    summaryParts.push(`All ${totalRounds} rounds valid (${totalCycles} cycles total).`)
  } else {
    summaryParts.push(
      `${invalidRounds} of ${totalRounds} rounds have errors (${totalCycles} cycles total).`
    )
  }

  if (cyclesWithErrors > 0) {
    summaryParts.push(`${cyclesWithErrors} cycle(s) with errors.`)
  }

  if (cyclesWithWarnings > 0) {
    summaryParts.push(`${cyclesWithWarnings} cycle(s) with warnings.`)
  }

  // Detail the first few invalid rounds for quick diagnosis
  const invalidRoundResults = roundResults.filter(r => !r.valid)
  if (invalidRoundResults.length > 0) {
    const sample = invalidRoundResults.slice(0, 3)
    for (const r of sample) {
      const errorMessages = r.errors.map(e => e.message).join('; ')
      summaryParts.push(`  Round ${r.roundNumber} (${r.legoKey}): ${errorMessages}`)
    }
    if (invalidRoundResults.length > 3) {
      summaryParts.push(`  ...and ${invalidRoundResults.length - 3} more invalid round(s).`)
    }
  }

  return {
    valid,
    totalRounds,
    validRounds,
    invalidRounds,
    totalCycles,
    cyclesWithErrors,
    cyclesWithWarnings,
    rounds: roundResults,
    summary: summaryParts.join(' '),
  }
}
