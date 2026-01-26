<template>
  <div class="session-test-page">
    <div class="header">
      <h1>LearningSession Test</h1>
      <p>Full session with network, belt, and controls</p>
    </div>

    <div v-if="error" class="error">
      {{ error }}
    </div>

    <div v-else-if="loading" class="loading">
      Loading course data...
    </div>

    <div v-else class="session-container">
      <div class="visualization">
        <div class="belt-display">
          <div class="belt-info">
            <span class="belt-name">{{ beltName }}</span>
            <span class="seeds-completed">{{ seedsCompleted }} seeds</span>
          </div>
          <div class="belt-bar" :style="{ backgroundColor: beltColor }">
            <div class="belt-progress" :style="{ width: beltProgressPercent + '%' }"></div>
          </div>
        </div>
      </div>

      <LearningSession
        :script-items="scriptItems"
        :audio-cache="audioCache"
        @session-complete="handleSessionComplete"
        @cycle-started="handleCycleStarted"
        @cycle-complete="handleCycleComplete"
        @session-stopped="handleSessionStopped"
      />

      <div class="event-log">
        <h3>Event Log</h3>
        <div class="log-entries">
          <div
            v-for="(event, i) in eventLog"
            :key="i"
            class="log-entry"
          >
            {{ event }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import LearningSession from '../components/LearningSession.vue'
import { CourseDataProvider } from '../providers/CourseDataProvider'
// TODO: generateLearningScript is deprecated and returns empty data
// This test page needs to be migrated to use SessionController or useSessionPlayback
// import { generateLearningScript } from '../providers/CourseDataProvider'
import type { ScriptItem } from '../providers/CourseDataProvider'
import type { Cycle } from '../types/Cycle'

const loading = ref(true)
const error = ref<string | null>(null)
const scriptItems = ref<ScriptItem[]>([])
const audioCache = ref<Map<string, { id: string; blob: Blob }>>(new Map())
const eventLog = ref<string[]>([])
const seedsCompleted = ref(0)

// Belt progression (simplified)
const beltLevels = [
  { name: 'White', color: '#FFFFFF', threshold: 0 },
  { name: 'Yellow', color: '#FFD700', threshold: 8 },
  { name: 'Orange', color: '#FF8C00', threshold: 20 },
  { name: 'Green', color: '#00FF00', threshold: 40 }
]

const currentBelt = computed(() => {
  for (let i = beltLevels.length - 1; i >= 0; i--) {
    if (seedsCompleted.value >= beltLevels[i].threshold) {
      return beltLevels[i]
    }
  }
  return beltLevels[0]
})

const nextBelt = computed(() => {
  const currentIndex = beltLevels.findIndex(b => b.name === currentBelt.value.name)
  return currentIndex < beltLevels.length - 1 ? beltLevels[currentIndex + 1] : null
})

const beltName = computed(() => currentBelt.value.name)
const beltColor = computed(() => currentBelt.value.color)

const beltProgressPercent = computed(() => {
  if (!nextBelt.value) return 100
  const current = currentBelt.value.threshold
  const next = nextBelt.value.threshold
  const progress = seedsCompleted.value
  return Math.min(100, ((progress - current) / (next - current)) * 100)
})

/**
 * Load course data and generate script
 */
onMounted(async () => {
  try {
    const provider = new CourseDataProvider({
      audioBaseUrl: 'https://ssi-course-audio.s3.eu-west-2.amazonaws.com',
      courseId: 'demo'
    })

    // TODO: generateLearningScript is deprecated and returns empty data
    // This test page needs to be migrated to use SessionController or useSessionPlayback
    // For now, throw an error to indicate migration is needed
    console.warn('[SessionTestPage] generateLearningScript is deprecated - this test page needs migration to SessionController')
    throw new Error('SessionTestPage needs migration: generateLearningScript is deprecated. Use SessionController or useSessionPlayback instead.')

    /* Original deprecated code:
    const result = await generateLearningScript(
      undefined, // No Supabase client - demo mode
      provider.getCourseId(),
      1, // Start seed
      10 // Number of seeds
    )

    if (!result.rounds || result.rounds.length === 0) {
      throw new Error('No rounds generated')
    }
    */
    const result = { rounds: [], allItems: [] } // Placeholder to satisfy TypeScript

    // Flatten rounds into script items
    const items = result.rounds.flatMap(round => round.items)
    scriptItems.value = items

    logEvent(`Loaded ${items.length} script items from ${result.rounds.length} rounds`)

    // Create audio cache with placeholder blobs
    // In real app, these would be fetched from S3
    const cache = new Map<string, { id: string; blob: Blob }>()

    for (const item of items) {
      // Create placeholder audio blobs (silent)
      const silentBlob = new Blob([new Uint8Array(1000)], { type: 'audio/mpeg' })

      cache.set(item.audioRefs.known.id, { id: item.audioRefs.known.id, blob: silentBlob })
      cache.set(item.audioRefs.target.voice1.id, { id: item.audioRefs.target.voice1.id, blob: silentBlob })
      cache.set(item.audioRefs.target.voice2.id, { id: item.audioRefs.target.voice2.id, blob: silentBlob })
    }

    audioCache.value = cache
    logEvent(`Created audio cache with ${cache.size} blobs`)

    loading.value = false
  } catch (err) {
    console.error('[SessionTestPage] Load error:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load'
    loading.value = false
  }
})

function logEvent(message: string) {
  const timestamp = new Date().toLocaleTimeString()
  eventLog.value.push(`[${timestamp}] ${message}`)
  // Keep last 20 events
  if (eventLog.value.length > 20) {
    eventLog.value.shift()
  }
}

function handleSessionComplete() {
  logEvent('Session complete!')
}

function handleCycleStarted(legoId: string) {
  logEvent(`Cycle started: ${legoId}`)
}

function handleCycleComplete(cycle: Cycle) {
  logEvent(`Cycle complete: ${cycle.legoId} (${cycle.type})`)

  // Update belt on debut cycles
  if (cycle.type === 'debut') {
    seedsCompleted.value++
    logEvent(`Seeds completed: ${seedsCompleted.value}`)
  }
}

function handleSessionStopped() {
  logEvent('Session stopped by user')
}
</script>

<style scoped>
.session-test-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a1a;
  color: white;
}

.header {
  padding: 1rem;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.header h1 {
  margin: 0;
  font-size: 1.5rem;
}

.header p {
  margin: 0.5rem 0 0;
  opacity: 0.7;
  font-size: 0.9rem;
}

.error,
.loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
}

.error {
  color: #ff4444;
}

.session-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.visualization {
  padding: 1rem;
  background: rgba(0, 0, 0, 0.2);
}

.belt-display {
  max-width: 600px;
  margin: 0 auto;
}

.belt-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

.belt-name {
  font-weight: bold;
}

.seeds-completed {
  opacity: 0.7;
}

.belt-bar {
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.1);
}

.belt-progress {
  height: 100%;
  background: rgba(255, 255, 255, 0.3);
  transition: width 0.3s;
}

.event-log {
  padding: 1rem;
  background: rgba(0, 0, 0, 0.3);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  max-height: 200px;
  overflow: hidden;
}

.event-log h3 {
  margin: 0 0 0.5rem;
  font-size: 1rem;
}

.log-entries {
  max-height: 140px;
  overflow-y: auto;
  font-family: monospace;
  font-size: 0.8rem;
}

.log-entry {
  padding: 0.25rem 0;
  opacity: 0.8;
}

.log-entry:last-child {
  opacity: 1;
  font-weight: bold;
}
</style>
