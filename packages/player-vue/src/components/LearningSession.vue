<template>
  <div class="learning-session">
    <div v-if="!isReady" class="loading-state">
      <div v-if="validation && !validation.ready">
        Missing audio: {{ validation.missing.join(', ') }}
      </div>
      <div v-else>Loading session...</div>
    </div>

    <div v-else-if="sessionComplete" class="session-complete">
      <h2>Session Complete!</h2>
      <p>You practiced {{ totalCycles }} cycles.</p>
      <button @click="handleRestart">Start Over</button>
    </div>

    <div v-else class="active-session">
      <div class="session-header">
        <div class="progress">
          {{ currentIndex + 1 }} / {{ totalCycles }}
          <span class="progress-percent">({{ progressPercent }}%)</span>
        </div>
        <div class="controls">
          <button @click="handleSkip">Skip</button>
          <button @click="handleStop">Stop</button>
        </div>
      </div>

      <CyclePlayer
        v-if="currentCycle"
        :key="currentCycle.id"
        :cycle="currentCycle"
        :audio-cache="audioCache"
        @cycle-complete="handleCycleComplete"
        @cycle-error="handleCycleError"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useSessionManager } from '../composables/useSessionManager'
import { validateSession } from '../utils/validateCycle'
import { scriptItemsToCycles } from '../utils/scriptItemToCycle'
import CyclePlayer from './CyclePlayer.vue'
import type { Cycle, ValidationResult } from '../types/Cycle'
import type { ScriptItem } from '../providers/CourseDataProvider'

interface Props {
  scriptItems: ScriptItem[]
  audioCache: Map<string, { id: string; blob: Blob }>
}

interface Emits {
  (e: 'session-complete'): void
  (e: 'cycle-started', legoId: string): void
  (e: 'cycle-complete', cycle: Cycle): void
  (e: 'session-stopped'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// Convert ScriptItems to Cycles using bridge
const cycles = computed(() => scriptItemsToCycles(props.scriptItems))

// Session manager for queue progression
const manager = useSessionManager({ cycles: cycles.value })

// Validation state
const validation = ref<ValidationResult | null>(null)
const isReady = ref(false)

// Current cycle
const currentCycle = computed(() => manager.getCurrentCycle())
const currentIndex = computed(() => manager.currentIndex.value)
const totalCycles = computed(() => manager.cycles.value.length)
const progressPercent = computed(() => manager.progressPercent.value)
const sessionComplete = computed(() => manager.isComplete.value)

/**
 * Validate session on mount
 */
onMounted(async () => {
  // Get all audio IDs from cycles
  const audioIds = new Set<string>()
  for (const cycle of cycles.value) {
    audioIds.add(cycle.known.audioId)
    audioIds.add(cycle.target.voice1AudioId)
    audioIds.add(cycle.target.voice2AudioId)
  }

  // Check which audio IDs are in cache
  const cachedAudio = Array.from(audioIds)
    .filter(id => props.audioCache.has(id))
    .map(id => ({
      id,
      durationMs: 2000, // Placeholder - actual duration from cache if needed
      checksum: '' // Not used for validation
    }))

  validation.value = validateSession(cycles.value, cachedAudio)
  isReady.value = validation.value.ready
})

/**
 * Handle cycle completion
 */
function handleCycleComplete(): void {
  const cycle = currentCycle.value
  if (!cycle) return

  // Emit cycle-complete event for belt/network updates
  emit('cycle-complete', cycle)

  // Advance to next cycle
  manager.markCycleComplete()

  // If not at end, emit cycle-started for next
  const nextCycle = manager.getCurrentCycle()
  if (nextCycle) {
    emit('cycle-started', nextCycle.legoId)
  } else {
    emit('session-complete')
  }
}

/**
 * Handle cycle error
 */
function handleCycleError(error: string): void {
  console.error('[LearningSession] Cycle error:', error)
  // For now, skip to next on error
  manager.skipToNext()
}

/**
 * Skip current cycle
 */
function handleSkip(): void {
  manager.skipToNext()
  const nextCycle = manager.getCurrentCycle()
  if (nextCycle) {
    emit('cycle-started', nextCycle.legoId)
  }
}

/**
 * Stop session
 */
function handleStop(): void {
  emit('session-stopped')
}

/**
 * Restart session
 */
function handleRestart(): void {
  manager.reset()
  const firstCycle = manager.getCurrentCycle()
  if (firstCycle) {
    emit('cycle-started', firstCycle.legoId)
  }
}

/**
 * Jump to specific cycle index
 * Exposed for network node clicks or manual navigation
 */
function jumpTo(index: number): void {
  manager.jumpTo(index)
  const cycle = manager.getCurrentCycle()
  if (cycle) {
    emit('cycle-started', cycle.legoId)
  }
}

// Expose jumpTo for parent component
defineExpose({ jumpTo })
</script>

<style scoped>
.learning-session {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.loading-state,
.session-complete {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  padding: 2rem;
}

.active-session {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.session-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
}

.progress {
  font-size: 0.9rem;
  opacity: 0.8;
}

.progress-percent {
  margin-left: 0.5rem;
  font-weight: bold;
}

.controls {
  display: flex;
  gap: 0.5rem;
}

button {
  padding: 0.5rem 1rem;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 4px;
  color: white;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
