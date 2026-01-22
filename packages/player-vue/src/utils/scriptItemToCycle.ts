/**
 * scriptItemToCycle.ts - Bridge converter from ScriptItem to Cycle
 *
 * Allows gradual migration from existing generateLearningScript output
 * to new atomic Cycle format.
 */

import type { ScriptItem } from '../providers/CourseDataProvider'
import type { Cycle, CycleType } from '../types/Cycle'

/**
 * Map ScriptItem type to CycleType
 */
function mapScriptItemTypeToCycleType(type: ScriptItem['type']): CycleType {
  switch (type) {
    case 'intro':
      return 'intro'
    case 'component':
      return 'practice' // Components are practice of individual words
    case 'debut':
    case 'debut_phrase':
      return 'debut'
    case 'spaced_rep':
      return 'review'
    case 'consolidation':
      return 'practice'
    default:
      return 'practice'
  }
}

/**
 * Convert ScriptItem to Cycle format
 *
 * Maps existing generateLearningScript output to atomic Cycle structure.
 * Allows incremental migration without breaking existing LearningPlayer.
 */
export function scriptItemToCycle(item: ScriptItem): Cycle {
  const cycleType = mapScriptItemTypeToCycleType(item.type)

  // Calculate pause duration from target audio (2x target1 duration)
  const target1DurationMs = item.audioDurations
    ? item.audioDurations.target1 * 1000
    : 2000
  const pauseDurationMs = target1DurationMs * 2

  return {
    id: `${item.legoId}-${item.type}-${item.roundNumber}`,
    seedId: item.seedId,
    legoId: item.legoId,
    type: cycleType,
    known: {
      text: item.knownText,
      audioId: item.audioRefs.known.id,
      durationMs: item.audioDurations ? item.audioDurations.source * 1000 : 2000
    },
    target: {
      text: item.targetText,
      voice1AudioId: item.audioRefs.target.voice1.id,
      voice1DurationMs: target1DurationMs,
      voice2AudioId: item.audioRefs.target.voice2.id,
      voice2DurationMs: item.audioDurations
        ? item.audioDurations.target2 * 1000
        : 2000
    },
    pauseDurationMs
  }
}

/**
 * Convert array of ScriptItems to Cycles
 */
export function scriptItemsToCycles(items: ScriptItem[]): Cycle[] {
  return items.map(scriptItemToCycle)
}
