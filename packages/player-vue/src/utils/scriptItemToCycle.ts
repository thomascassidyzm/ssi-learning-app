/**
 * scriptItemToCycle.ts - Bridge converter from ScriptItem to Cycle
 *
 * Allows gradual migration from existing generateLearningScript output
 * to new atomic Cycle format.
 */

import type { ScriptItem } from '../providers/CourseDataProvider'
import type { Cycle, CycleType } from '../types/Cycle'
import { computePauseDuration } from '../playback/computePauseDuration'
import { DEFAULT_FAST } from '../composables/useAlgorithmConfig'

/**
 * Map ScriptItem type to CycleType
 */
function mapScriptItemTypeToCycleType(type: ScriptItem['type']): CycleType {
  switch (type) {
    case 'intro':
    case 'component_intro':
      return 'intro'
    case 'component':
    case 'component_practice':
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

  // Pause: single helper sourced from algorithm_config (admin-tunable). At
  // cycle-bake time we don't have the live config in scope, so we use
  // DEFAULT_FAST as the fallback — the runtime override recomputes from the
  // live config when the cycle actually plays.
  const target1DurationMs = item.audioDurations ? item.audioDurations.target1 * 1000 : 0
  const target2DurationMs = item.audioDurations ? item.audioDurations.target2 * 1000 : 0
  const pauseDurationMs = computePauseDuration(target1DurationMs, target2DurationMs, DEFAULT_FAST)

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
