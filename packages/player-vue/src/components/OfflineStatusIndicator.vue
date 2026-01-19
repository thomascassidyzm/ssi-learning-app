<script setup lang="ts">
/**
 * OfflineStatusIndicator - Shows cache status and offline readiness
 *
 * Displays:
 * - Online/offline status
 * - Cached content amount
 * - Estimated offline minutes available
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useOfflineCache } from '../composables/useOfflineCache'

const props = defineProps<{
  courseId?: string
  compact?: boolean
}>()

const { cacheStats, isOnline, refreshCacheStats } = useOfflineCache()

// Refresh stats on mount
onMounted(async () => {
  await refreshCacheStats(props.courseId)
})

// Format bytes to human readable
const formattedSize = computed(() => {
  const bytes = cacheStats.value.totalBytes
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
})

// Offline readiness level
const readinessLevel = computed(() => {
  const minutes = cacheStats.value.estimatedMinutes
  if (minutes >= 60) return 'excellent'
  if (minutes >= 30) return 'good'
  if (minutes >= 10) return 'limited'
  return 'minimal'
})

const readinessLabel = computed(() => {
  switch (readinessLevel.value) {
    case 'excellent': return 'Excellent offline coverage'
    case 'good': return 'Good for offline'
    case 'limited': return 'Limited offline content'
    case 'minimal': return 'Minimal cache'
  }
})
</script>

<template>
  <div
    class="offline-status"
    :class="[
      { 'offline-status--compact': compact },
      { 'offline-status--offline': !isOnline }
    ]"
  >
    <!-- Online/Offline indicator -->
    <div class="status-indicator">
      <span class="status-dot" :class="isOnline ? 'status-dot--online' : 'status-dot--offline'"></span>
      <span class="status-label">{{ isOnline ? 'Online' : 'Offline' }}</span>
    </div>

    <!-- Cache stats (non-compact mode) -->
    <template v-if="!compact">
      <div v-if="cacheStats.audioCount > 0" class="cache-stats">
        <div class="stat">
          <span class="stat-value">{{ cacheStats.estimatedMinutes }}</span>
          <span class="stat-label">min cached</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ cacheStats.audioCount }}</span>
          <span class="stat-label">files</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ formattedSize }}</span>
          <span class="stat-label">storage</span>
        </div>
      </div>

      <div v-else class="cache-empty">
        No content cached yet
      </div>

      <!-- Readiness indicator -->
      <div v-if="cacheStats.audioCount > 0" class="readiness" :class="`readiness--${readinessLevel}`">
        <svg class="readiness-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path v-if="readinessLevel === 'excellent'" d="M20 6L9 17l-5-5"/>
          <path v-else-if="readinessLevel === 'good'" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
          <path v-else d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <span>{{ readinessLabel }}</span>
      </div>
    </template>

    <!-- Compact stats -->
    <template v-else-if="cacheStats.audioCount > 0">
      <span class="compact-stats">
        {{ cacheStats.estimatedMinutes }} min
      </span>
    </template>
  </div>
</template>

<style scoped>
.offline-status {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
}

.offline-status--compact {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
}

.offline-status--offline {
  border-color: rgba(255, 193, 7, 0.3);
  background: rgba(255, 193, 7, 0.05);
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot--online {
  background: #4caf50;
  box-shadow: 0 0 8px rgba(76, 175, 80, 0.5);
}

.status-dot--offline {
  background: #ffc107;
  box-shadow: 0 0 8px rgba(255, 193, 7, 0.5);
}

.status-label {
  color: var(--text-primary, #ffffff);
  font-size: 14px;
  font-weight: 500;
}

.cache-stats {
  display: flex;
  gap: 16px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stat-value {
  color: var(--text-primary, #ffffff);
  font-size: 18px;
  font-weight: 600;
}

.stat-label {
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.cache-empty {
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  font-size: 13px;
}

.readiness {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}

.readiness-icon {
  width: 16px;
  height: 16px;
}

.readiness--excellent {
  background: rgba(76, 175, 80, 0.1);
  color: #81c784;
}

.readiness--good {
  background: rgba(33, 150, 243, 0.1);
  color: #64b5f6;
}

.readiness--limited {
  background: rgba(255, 193, 7, 0.1);
  color: #ffd54f;
}

.readiness--minimal {
  background: rgba(255, 87, 34, 0.1);
  color: #ff8a65;
}

.compact-stats {
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  font-size: 12px;
}
</style>
