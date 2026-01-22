<template>
  <div class="cycle-test-page">
    <h1>Cycle Player Test</h1>

    <div v-if="loading" class="status">
      Loading audio...
    </div>

    <div v-else-if="!isReady" class="error">
      Audio not ready. Missing: {{ validationResult?.missing.join(', ') }}
    </div>

    <div v-else class="player-container">
      <CyclePlayer
        :cycle="testCycle"
        :audio-cache="audioCache"
        @cycle-complete="onCycleComplete"
        @cycle-error="onCycleError"
      />

      <div v-if="completionMessage" class="completion-message">
        {{ completionMessage }}
      </div>

      <button @click="restart" class="restart-button">
        Restart Cycle
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import CyclePlayer from '../components/CyclePlayer.vue'
import { validateCycle } from '../utils/validateCycle'
import type { Cycle, ValidationResult } from '../types/Cycle'

const loading = ref(true)
const isReady = ref(false)
const validationResult = ref<ValidationResult | null>(null)
const completionMessage = ref('')
const cycleKey = ref(0)

// Test cycle with mock data
const testCycle = ref<Cycle>({
  id: 'test-cycle-1',
  seedId: 'S0001',
  legoId: 'S0001L01',
  type: 'debut',
  known: {
    text: 'I want to learn',
    audioId: 'audio-known-1',
    durationMs: 2000
  },
  target: {
    text: 'Quiero aprender',
    voice1AudioId: 'audio-target1-1',
    voice1DurationMs: 1800,
    voice2AudioId: 'audio-target2-1',
    voice2DurationMs: 1900
  },
  pauseDurationMs: 3000
})

// Audio cache with mock audio blobs
const audioCache = ref<Map<string, { id: string; blob: Blob }>>(new Map())

/**
 * Generates a silent audio blob for testing.
 * Duration is approximate based on sample rate.
 */
function generateSilentAudio(durationMs: number): Blob {
  const sampleRate = 44100
  const numSamples = Math.floor((durationMs / 1000) * sampleRate)
  const numChannels = 1
  const bitsPerSample = 16

  const blockAlign = numChannels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const dataSize = numSamples * blockAlign

  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // WAV header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // audio format (PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // Silent audio data (all zeros)

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}

/**
 * Loads mock audio into cache.
 */
async function loadAudio() {
  loading.value = true

  try {
    // Generate mock audio blobs
    const knownBlob = generateSilentAudio(testCycle.value.known.durationMs)
    const target1Blob = generateSilentAudio(testCycle.value.target.voice1DurationMs)
    const target2Blob = generateSilentAudio(testCycle.value.target.voice2DurationMs)

    // Populate cache
    audioCache.value.set(testCycle.value.known.audioId, {
      id: testCycle.value.known.audioId,
      blob: knownBlob
    })
    audioCache.value.set(testCycle.value.target.voice1AudioId, {
      id: testCycle.value.target.voice1AudioId,
      blob: target1Blob
    })
    audioCache.value.set(testCycle.value.target.voice2AudioId, {
      id: testCycle.value.target.voice2AudioId,
      blob: target2Blob
    })

    // Build cache for validation (without blob)
    const cacheForValidation = new Map()
    audioCache.value.forEach((value, key) => {
      cacheForValidation.set(key, {
        id: value.id,
        durationMs: 2000,
        checksum: 'mock'
      })
    })

    // Validate cycle
    validationResult.value = validateCycle(testCycle.value, cacheForValidation)
    isReady.value = validationResult.value.ready
  } finally {
    loading.value = false
  }
}

function onCycleComplete() {
  completionMessage.value = '✓ Cycle completed successfully!'
}

function onCycleError(error: string) {
  completionMessage.value = `✗ Error: ${error}`
}

function restart() {
  completionMessage.value = ''
  cycleKey.value++

  // Force re-mount by updating cycle reference
  testCycle.value = { ...testCycle.value }
}

onMounted(() => {
  loadAudio()
})
</script>

<style scoped>
.cycle-test-page {
  padding: 2rem;
  max-width: 800px;
  margin: 0 auto;
  font-family: system-ui, -apple-system, sans-serif;
}

h1 {
  margin-bottom: 2rem;
  color: #333;
}

.status,
.error {
  padding: 1rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.status {
  background: #e3f2fd;
  color: #1976d2;
}

.error {
  background: #ffebee;
  color: #c62828;
}

.player-container {
  margin-top: 2rem;
}

.completion-message {
  margin-top: 1.5rem;
  padding: 1rem;
  border-radius: 8px;
  background: #f5f5f5;
  text-align: center;
  font-weight: 500;
}

.restart-button {
  margin-top: 1rem;
  padding: 0.75rem 1.5rem;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  width: 100%;
  transition: background 0.2s;
}

.restart-button:hover {
  background: #1565c0;
}

.restart-button:active {
  background: #0d47a1;
}
</style>
