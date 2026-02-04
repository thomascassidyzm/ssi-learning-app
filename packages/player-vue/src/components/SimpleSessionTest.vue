<script setup lang="ts">
/**
 * SimpleSessionTest - Test the new simple session flow
 *
 * generateLearningScript() → toSimpleRounds() → SimplePlayer
 */

import { ref, onMounted, onUnmounted } from 'vue'
import { useSimpleSession } from '../composables/useSimpleSession'
import { useSimplePlayer } from '../composables/useSimplePlayer'
import { createClient } from '@supabase/supabase-js'

const props = defineProps<{
  courseCode?: string
}>()

const courseCode = props.courseCode || 'zho_for_eng'

// Create Supabase client
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || '',
  import.meta.env.VITE_SUPABASE_ANON_KEY || ''
)

// Session management
const session = useSimpleSession({ supabase, courseCode })

// Player
const player = useSimplePlayer()

// UI state
const isReady = ref(false)
const statusMessage = ref('Loading...')

// Initialize
onMounted(async () => {
  try {
    statusMessage.value = `Loading ${courseCode}...`

    // Load first 30 seeds worth of rounds
    const startIndex = await session.loadSession(1, 30)

    // Initialize player with rounds
    player.initialize(session.rounds.value)

    // Jump to resume position if applicable
    if (startIndex > 0) {
      player.jumpToRound(startIndex)
      statusMessage.value = `Resumed at round ${startIndex + 1}`
    } else {
      statusMessage.value = `Ready - ${session.totalRounds.value} rounds loaded`
    }

    isReady.value = true

    // Save position on round complete
    player.onRoundCompleted((round) => {
      session.savePosition(round.roundNumber + 1, round.legoId)
    })

  } catch (err) {
    statusMessage.value = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`
  }
})

// Cleanup
onUnmounted(() => {
  player.stop()
})

// Controls
function handlePlay() {
  if (player.isPlaying.value) {
    player.pause()
  } else {
    player.play()
  }
}

// NOTE: No skipCycle - a ROUND is the atomic learning unit

function handleSkipRound() {
  player.skipRound()
}

function handleReset() {
  session.clearPosition()
  player.jumpToRound(0)
}
</script>

<template>
  <div class="simple-session-test">
    <header class="header">
      <h1>Simple Session Test</h1>
      <p class="status">{{ statusMessage }}</p>
    </header>

    <div v-if="session.isLoading.value" class="loading">
      Loading...
    </div>

    <div v-else-if="session.error.value" class="error">
      {{ session.error.value }}
    </div>

    <div v-else-if="isReady" class="player-container">
      <!-- Current cycle info -->
      <div class="cycle-info">
        <div class="round-badge">
          Round {{ player.roundIndex.value + 1 }} / {{ session.totalRounds.value }}
        </div>
        <div class="phase-badge" :class="player.phase.value">
          {{ player.phase.value }}
        </div>
      </div>

      <!-- Text display -->
      <div class="text-display">
        <div class="known-text">{{ player.knownText.value || '—' }}</div>
        <div class="target-text" :class="{ visible: player.showTargetText.value }">
          {{ player.targetText.value || '—' }}
        </div>
      </div>

      <!-- Controls -->
      <div class="controls">
        <button @click="handlePlay" class="btn primary">
          {{ player.isPlaying.value ? 'Pause' : 'Play' }}
        </button>
        <button @click="handleSkipRound" class="btn">
          Skip Round
        </button>
        <button @click="handleReset" class="btn danger">
          Reset
        </button>
      </div>

      <!-- Progress -->
      <div class="progress">
        <div class="progress-bar">
          <div
            class="progress-fill"
            :style="{ width: player.progress.value.percent + '%' }"
          />
        </div>
        <div class="progress-text">
          {{ player.progress.value.round }} / {{ player.progress.value.total }}
        </div>
      </div>

      <!-- Stats -->
      <div class="stats">
        <div>Items: {{ session.totalItems.value }}</div>
        <div>With Audio: {{ session.itemsWithAudio.value }}</div>
        <div>Cycle: {{ player.cycleIndex.value + 1 }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.simple-session-test {
  max-width: 600px;
  margin: 0 auto;
  padding: 2rem;
  font-family: system-ui, sans-serif;
}

.header {
  text-align: center;
  margin-bottom: 2rem;
}

.header h1 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
}

.status {
  color: #666;
  font-size: 0.9rem;
}

.loading, .error {
  text-align: center;
  padding: 2rem;
}

.error {
  color: #dc3545;
}

.player-container {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.cycle-info {
  display: flex;
  gap: 1rem;
  justify-content: center;
}

.round-badge, .phase-badge {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
}

.round-badge {
  background: #e9ecef;
}

.phase-badge {
  background: #dee2e6;
}

.phase-badge.prompt { background: #cce5ff; }
.phase-badge.pause { background: #fff3cd; }
.phase-badge.voice1 { background: #d4edda; }
.phase-badge.voice2 { background: #c3e6cb; }

.text-display {
  text-align: center;
  padding: 2rem;
  background: #f8f9fa;
  border-radius: 8px;
}

.known-text {
  font-size: 1.5rem;
  margin-bottom: 1rem;
}

.target-text {
  font-size: 1.8rem;
  font-weight: 600;
  opacity: 0.3;
  transition: opacity 0.3s;
}

.target-text.visible {
  opacity: 1;
}

.controls {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  flex-wrap: wrap;
}

.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
  background: #e9ecef;
}

.btn:hover {
  background: #dee2e6;
}

.btn.primary {
  background: #007bff;
  color: white;
}

.btn.primary:hover {
  background: #0056b3;
}

.btn.danger {
  background: #dc3545;
  color: white;
}

.btn.danger:hover {
  background: #c82333;
}

.progress {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: #e9ecef;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #007bff;
  transition: width 0.3s;
}

.progress-text {
  font-size: 0.9rem;
  color: #666;
}

.stats {
  display: flex;
  gap: 1rem;
  justify-content: center;
  font-size: 0.8rem;
  color: #666;
}
</style>
