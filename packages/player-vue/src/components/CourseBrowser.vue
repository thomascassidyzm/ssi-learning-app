<script setup lang="ts">
import { ref, computed } from 'vue'
import {
  BELTS,
  getSeedFromLegoId,
  getSharedBeltProgress,
} from '@/composables/useBeltProgress'

const emit = defineEmits<{
  (e: 'start-seed', seedNumber: number): void
  (e: 'close'): void
}>()

// Belt progress from shared instance
const beltProgress = computed(() => getSharedBeltProgress())
const highestSeed = computed(() => {
  const bp = beltProgress.value
  if (!bp) return 0
  return getSeedFromLegoId(bp.highestLegoId.value) ?? 0
})

// Current view: 'belts' or 'seeds'
const currentView = ref<'belts' | 'seeds'>('belts')
const selectedBeltIndex = ref<number | null>(null)

// Belt data with progress
const beltData = computed(() => {
  return BELTS.map((belt, index) => {
    const nextBelt = BELTS[index + 1]
    const beltEnd = nextBelt ? nextBelt.seedsRequired - 1 : 668
    const beltStart = belt.seedsRequired === 0 ? 1 : belt.seedsRequired
    const seedCount = beltEnd - beltStart + 1

    // How many seeds completed in this belt
    const completedInBelt = Math.max(0, Math.min(highestSeed.value - beltStart + 1, seedCount))
    const progressPercent = seedCount > 0 ? Math.round((completedInBelt / seedCount) * 100) : 0

    const currentBeltIndex = beltProgress.value?.highestBeltIndex.value ?? 0
    const isCurrent = index === currentBeltIndex
    const isComplete = index < currentBeltIndex
    const isFuture = index > currentBeltIndex

    return {
      ...belt,
      index,
      beltStart,
      beltEnd,
      seedCount,
      completedInBelt,
      progressPercent,
      isCurrent,
      isComplete,
      isFuture,
    }
  })
})

// Seeds for selected belt
const selectedBelt = computed(() => {
  if (selectedBeltIndex.value === null) return null
  return beltData.value[selectedBeltIndex.value]
})

const seedsInBelt = computed(() => {
  const belt = selectedBelt.value
  if (!belt) return []
  const seeds = []
  for (let s = belt.beltStart; s <= belt.beltEnd; s++) {
    seeds.push({
      number: s,
      isCompleted: s <= highestSeed.value,
      isCurrent: s === highestSeed.value + 1,
    })
  }
  return seeds
})

const openBelt = (index: number) => {
  selectedBeltIndex.value = index
  currentView.value = 'seeds'
}

const goBack = () => {
  if (currentView.value === 'seeds') {
    currentView.value = 'belts'
    selectedBeltIndex.value = null
  } else {
    emit('close')
  }
}

const selectSeed = (seedNumber: number) => {
  emit('start-seed', seedNumber)
}
</script>

<template>
  <div class="course-browser">
    <!-- Header -->
    <div class="browser-header">
      <button class="back-btn" @click="goBack">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
      <h2 v-if="currentView === 'belts'">Course Browser</h2>
      <h2 v-else-if="selectedBelt">
        <span class="belt-dot" :style="{ background: selectedBelt.color }"></span>
        {{ selectedBelt.name }} Belt
      </h2>
    </div>

    <!-- Belt List -->
    <div v-if="currentView === 'belts'" class="belt-list">
      <button
        v-for="belt in beltData"
        :key="belt.index"
        class="belt-row"
        :class="{
          current: belt.isCurrent,
          complete: belt.isComplete,
          future: belt.isFuture,
        }"
        @click="openBelt(belt.index)"
      >
        <div class="belt-swatch" :style="{ background: belt.color }">
          <svg v-if="belt.isComplete" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div class="belt-info">
          <div class="belt-name">{{ belt.name }}</div>
          <div class="belt-range">Seeds {{ belt.beltStart }}&ndash;{{ belt.beltEnd }}</div>
        </div>
        <div class="belt-progress-area">
          <div class="belt-progress-bar">
            <div
              class="belt-progress-fill"
              :style="{ width: belt.progressPercent + '%', background: belt.color }"
            ></div>
          </div>
          <div class="belt-count">{{ belt.completedInBelt }}/{{ belt.seedCount }}</div>
        </div>
        <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </div>

    <!-- Seed Grid -->
    <div v-else-if="currentView === 'seeds'" class="seed-grid-container">
      <div class="seed-grid">
        <button
          v-for="seed in seedsInBelt"
          :key="seed.number"
          class="seed-cell"
          :class="{
            completed: seed.isCompleted,
            current: seed.isCurrent,
            future: !seed.isCompleted && !seed.isCurrent,
          }"
          @click="selectSeed(seed.number)"
        >
          <span class="seed-number">{{ seed.number }}</span>
          <svg v-if="seed.isCompleted" class="seed-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span v-if="seed.isCurrent" class="seed-pulse"></span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.course-browser {
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--bg-primary, #0a0a0f);
  color: #fff;
  padding-bottom: 100px; /* Space for bottom nav */
}

.browser-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  padding-top: calc(16px + env(safe-area-inset-top, 0px));
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.browser-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  text-transform: capitalize;
}

.belt-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.back-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  border: none;
  border-radius: 8px;
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
}

.back-btn svg {
  width: 20px;
  height: 20px;
}

/* Belt List */
.belt-list {
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.belt-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  color: #fff;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;
}

.belt-row:hover { background: rgba(255, 255, 255, 0.07); }

.belt-row.current {
  border-color: var(--belt-color, rgba(255, 255, 255, 0.15));
  box-shadow: 0 0 20px var(--belt-glow, rgba(255, 255, 255, 0.05));
}

.belt-row.future { opacity: 0.5; }

.belt-swatch {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.belt-swatch svg {
  width: 18px;
  height: 18px;
}

.belt-info {
  flex: 1;
  min-width: 0;
}

.belt-name {
  font-size: 15px;
  font-weight: 600;
  text-transform: capitalize;
}

.belt-range {
  font-size: 12px;
  color: #888;
  margin-top: 2px;
}

.belt-progress-area {
  width: 80px;
  flex-shrink: 0;
}

.belt-progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.belt-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s ease;
}

.belt-count {
  font-size: 11px;
  color: #777;
  text-align: right;
  margin-top: 4px;
}

.chevron {
  width: 16px;
  height: 16px;
  color: #555;
  flex-shrink: 0;
}

/* Seed Grid */
.seed-grid-container {
  padding: 16px;
}

.seed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 8px;
}

.seed-cell {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  color: #fff;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s ease;
}

.seed-cell:hover { background: rgba(255, 255, 255, 0.08); }

.seed-cell.completed {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.12);
}

.seed-cell.current {
  border-color: var(--belt-color, #c23a3a);
  box-shadow: 0 0 12px var(--belt-glow, rgba(194, 58, 58, 0.3));
}

.seed-cell.future {
  opacity: 0.35;
}

.seed-number {
  font-size: 14px;
  font-weight: 600;
}

.seed-check {
  width: 14px;
  height: 14px;
  color: #4ade80;
  position: absolute;
  top: 4px;
  right: 4px;
}

.seed-pulse {
  position: absolute;
  inset: -2px;
  border-radius: 12px;
  border: 2px solid var(--belt-color, #c23a3a);
  animation: pulse 2s ease-in-out infinite;
  pointer-events: none;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.04); }
}

/* Mist theme */
:root[data-theme="mist"] .course-browser {
  background: var(--bg-primary, #f7f3ec);
  color: #2c2520;
}

:root[data-theme="mist"] .belt-row {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.06);
  color: #2c2520;
}

:root[data-theme="mist"] .seed-cell {
  background: rgba(0, 0, 0, 0.03);
  border-color: rgba(0, 0, 0, 0.06);
  color: #2c2520;
}
</style>
