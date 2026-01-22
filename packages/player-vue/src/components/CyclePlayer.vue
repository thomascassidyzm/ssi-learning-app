<template>
  <div class="cycle-player">
    <div v-if="state.error" class="error">
      {{ state.error }}
    </div>

    <div class="text-display">
      <div class="known-text">
        {{ cycle.known.text }}
      </div>

      <div
        v-if="showTargetText"
        class="target-text"
      >
        {{ cycle.target.text }}
      </div>
    </div>

    <div class="phase-indicator">
      Phase: {{ state.phase }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, onMounted } from 'vue'
import { useCyclePlayback } from '../composables/useCyclePlayback'
import type { Cycle } from '../types/Cycle'

interface Props {
  cycle: Cycle
  audioCache: Map<string, { id: string; blob: Blob }>
}

interface Emits {
  (e: 'cycle-complete'): void
  (e: 'cycle-error', error: string): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { state, playCycle, stop } = useCyclePlayback()

/**
 * Target text is only visible during VOICE_2 phase.
 * This forces learners to recall from audio, not read.
 */
const showTargetText = computed(() => {
  return state.value.phase === 'VOICE_2'
})

/**
 * Gets audio blob from cache by ID.
 */
async function getAudioBlob(audioId: string): Promise<Blob | null> {
  const cached = props.audioCache.get(audioId)
  return cached ? cached.blob : null
}

/**
 * Starts cycle playback on mount.
 */
onMounted(async () => {
  try {
    await playCycle(props.cycle, getAudioBlob)
    emit('cycle-complete')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    emit('cycle-error', message)
  }
})

/**
 * Watch for cycle changes and restart playback.
 */
watch(() => props.cycle, async (newCycle) => {
  stop()
  try {
    await playCycle(newCycle, getAudioBlob)
    emit('cycle-complete')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    emit('cycle-error', message)
  }
})
</script>

<style scoped>
.cycle-player {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 2rem;
  max-width: 600px;
  margin: 0 auto;
}

.error {
  padding: 1rem;
  background: #fee;
  border: 1px solid #c33;
  border-radius: 4px;
  color: #c33;
}

.text-display {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 2rem;
  background: #f5f5f5;
  border-radius: 8px;
  min-height: 150px;
}

.known-text {
  font-size: 1.25rem;
  color: #333;
  font-weight: 500;
}

.target-text {
  font-size: 1.5rem;
  color: #0066cc;
  font-weight: 600;
  animation: fadeIn 0.3s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.phase-indicator {
  padding: 0.5rem 1rem;
  background: #e0e0e0;
  border-radius: 4px;
  text-align: center;
  font-family: monospace;
  font-size: 0.875rem;
  color: #666;
}
</style>
