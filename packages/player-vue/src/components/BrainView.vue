<script setup lang="ts">
/**
 * BrainView.vue - Pre-computed Network Visualization for Progress Screen
 *
 * Shows the learner's growing neural network using pre-computed positions.
 * Slider controls how many LEGOs are visible (50/100/200/400/All).
 *
 * Future: Will animate a fast-forward replay of how the brain grew.
 */

import { ref, computed, inject, onMounted, watch } from 'vue'
import ConstellationNetworkView from './ConstellationNetworkView.vue'
import { usePrebuiltNetwork, type ExternalConnection } from '../composables/usePrebuiltNetwork'
import { useLegoNetwork } from '../composables/useLegoNetwork'
import { generateLearningScript } from '../providers/CourseDataProvider'

// ============================================================================
// PROPS & EMITS
// ============================================================================

const props = defineProps({
  course: {
    type: Object,
    default: null
  },
  beltLevel: {
    type: String,
    default: 'white'
  }
})

const emit = defineEmits(['close'])

// ============================================================================
// INJECTIONS
// ============================================================================

const supabase = inject('supabase', { value: null })
const courseDataProvider = inject('courseDataProvider', { value: null })

// ============================================================================
// STATE
// ============================================================================

const isLoading = ref(true)
const error = ref<string | null>(null)

// Pre-built network composable
const prebuiltNetwork = usePrebuiltNetwork()

// Network data from database (for connections)
const { loadNetworkData } = useLegoNetwork(supabase as any)

// All rounds loaded from script
const allRounds = ref<any[]>([])

// Slider state
const sliderValue = ref(100)
const sliderMax = computed(() => allRounds.value.length || 100)

// Container ref for sizing
const containerRef = ref<HTMLElement | null>(null)
const canvasSize = ref({ width: 800, height: 800 })

// ============================================================================
// COMPUTED
// ============================================================================

// Belt-colored accent
const beltColors: Record<string, string> = {
  white: '#9ca3af',
  yellow: '#fbbf24',
  orange: '#f97316',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  brown: '#a87848',
  black: '#d4a853',
}

const accentColor = computed(() => beltColors[props.beltLevel] || beltColors.white)

// Nodes to show based on slider
const visibleCount = computed(() => Math.min(sliderValue.value, allRounds.value.length))

// ============================================================================
// METHODS
// ============================================================================

/**
 * Update network visibility when slider changes
 */
function updateVisibility(count: number) {
  if (!allRounds.value.length) return

  // Reveal nodes up to the slider value
  prebuiltNetwork.revealedNodeIds.value = new Set()
  for (let i = 0; i < count && i < allRounds.value.length; i++) {
    const legoId = allRounds.value[i]?.legoId
    if (legoId) {
      prebuiltNetwork.revealedNodeIds.value.add(legoId)
    }
  }

  // Set hero to last revealed node
  if (count > 0 && allRounds.value[count - 1]?.legoId) {
    prebuiltNetwork.heroNodeId.value = allRounds.value[count - 1].legoId
    prebuiltNetwork.updatePanOffset()
  }
}

/**
 * Load all data and pre-calculate network
 */
async function loadData() {
  if (!props.course?.course_code || !courseDataProvider.value) {
    error.value = 'Course not configured'
    isLoading.value = false
    return
  }

  isLoading.value = true
  error.value = null

  try {
    console.log('[BrainView] Loading data for', props.course.course_code)

    // Load connections from database (for accurate edge data)
    const networkData = await loadNetworkData(props.course.course_code)
    const connections: ExternalConnection[] = networkData?.connections || []

    console.log(`[BrainView] Loaded ${connections.length} connections from database`)

    // Load learning script (all rounds up to reasonable max)
    const MAX_ROUNDS = 1000
    const { rounds } = await generateLearningScript(
      courseDataProvider.value,
      MAX_ROUNDS,
      0
    )

    allRounds.value = rounds
    console.log(`[BrainView] Loaded ${rounds.length} rounds from script`)

    // Update canvas size based on container
    if (containerRef.value) {
      const rect = containerRef.value.getBoundingClientRect()
      canvasSize.value = {
        width: Math.max(800, rect.width),
        height: Math.max(800, rect.height)
      }
    }

    // Pre-calculate all positions
    prebuiltNetwork.loadFromRounds(rounds, canvasSize.value, connections)

    // Set center for panning
    prebuiltNetwork.setCenter(canvasSize.value.width / 2, canvasSize.value.height / 2)

    // Initial visibility
    updateVisibility(sliderValue.value)

    console.log(`[BrainView] Network ready: ${prebuiltNetwork.nodes.value.length} nodes pre-calculated`)

  } catch (err) {
    console.error('[BrainView] Error loading data:', err)
    error.value = err instanceof Error ? err.message : 'Failed to load network'
  } finally {
    isLoading.value = false
  }
}

// ============================================================================
// WATCHERS
// ============================================================================

watch(sliderValue, (newVal) => {
  updateVisibility(newVal)
})

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="brain-view" ref="containerRef">
    <!-- Close button -->
    <button class="close-btn" @click="emit('close')" title="Close">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
    </button>

    <!-- LEGO count badge -->
    <div class="lego-count-badge" :style="{ borderColor: accentColor }">
      {{ visibleCount }} LEGOs
    </div>

    <!-- Loading state -->
    <div v-if="isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>Loading neural network...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="error-state">
      <p>{{ error }}</p>
      <button @click="loadData">Retry</button>
    </div>

    <!-- Network visualization -->
    <ConstellationNetworkView
      v-else
      :nodes="prebuiltNetwork.visibleNodes.value"
      :edges="prebuiltNetwork.visibleEdges.value"
      :hero-node-id="prebuiltNetwork.heroNodeId.value"
      :current-path="prebuiltNetwork.currentPath.value"
      :pan-transform="prebuiltNetwork.networkTransform.value"
      :show-path-labels="false"
    />

    <!-- Stage slider panel -->
    <div v-if="!isLoading && !error && allRounds.length > 0" class="stage-slider-panel">
      <div class="stage-header">
        <span class="stage-label">Network Stage</span>
        <span class="stage-count" :style="{ color: accentColor }">
          {{ visibleCount }} / {{ sliderMax }} LEGOs
        </span>
      </div>

      <div class="stage-slider-row">
        <input
          type="range"
          class="stage-slider"
          :min="10"
          :max="sliderMax"
          :step="10"
          v-model.number="sliderValue"
          :style="{ '--accent-color': accentColor }"
        />
      </div>

      <div class="stage-presets">
        <button
          v-for="preset in [50, 100, 200, 400]"
          :key="preset"
          class="preset-btn"
          :class="{ active: sliderValue === preset }"
          :style="sliderValue === preset ? { backgroundColor: accentColor + '30', borderColor: accentColor } : {}"
          @click="sliderValue = Math.min(preset, sliderMax)"
          :disabled="preset > sliderMax"
        >
          {{ preset }}
        </button>
        <button
          class="preset-btn"
          :class="{ active: sliderValue === sliderMax }"
          :style="sliderValue === sliderMax ? { backgroundColor: accentColor + '30', borderColor: accentColor } : {}"
          @click="sliderValue = sliderMax"
        >
          All
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.brain-view {
  position: fixed;
  inset: 0;
  background: linear-gradient(180deg, #0a0a0f 0%, #0f0f18 50%, #12121a 100%);
  z-index: 100;
  overflow: hidden;
}

.close-btn {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 20;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(10, 10, 15, 0.8);
  backdrop-filter: blur(10px);
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.close-btn svg {
  width: 20px;
  height: 20px;
}

.lego-count-badge {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 20;
  padding: 8px 16px;
  background: rgba(10, 10, 15, 0.8);
  backdrop-filter: blur(10px);
  border: 1px solid;
  border-radius: 20px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 0.875rem;
  font-weight: 500;
}

.loading-state,
.error-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  gap: 1rem;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: rgba(255, 255, 255, 0.5);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state button {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  color: white;
  cursor: pointer;
}

/* Stage Slider Panel */
.stage-slider-panel {
  position: absolute;
  bottom: calc(100px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: rgba(10, 10, 15, 0.9);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 16px 24px;
  min-width: 300px;
}

.stage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.stage-label {
  color: rgba(255, 255, 255, 0.6);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stage-count {
  font-size: 0.875rem;
  font-weight: 600;
}

.stage-slider-row {
  margin-bottom: 12px;
}

.stage-slider {
  width: 100%;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  cursor: pointer;
}

.stage-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  background: var(--accent-color, #fbbf24);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 10px var(--accent-color, #fbbf24);
}

.stage-slider::-moz-range-thumb {
  width: 18px;
  height: 18px;
  background: var(--accent-color, #fbbf24);
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 0 10px var(--accent-color, #fbbf24);
}

.stage-presets {
  display: flex;
  gap: 8px;
  justify-content: center;
}

.preset-btn {
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.preset-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.preset-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.preset-btn.active {
  color: white;
  font-weight: 600;
}

/* Mobile adjustments */
@media (max-width: 480px) {
  .stage-slider-panel {
    min-width: unset;
    width: calc(100% - 32px);
    max-width: 320px;
    padding: 12px 16px;
  }

  .preset-btn {
    padding: 4px 10px;
    font-size: 0.7rem;
  }
}
</style>
