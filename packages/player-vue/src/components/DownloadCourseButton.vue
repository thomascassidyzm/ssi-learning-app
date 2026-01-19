<script setup lang="ts">
/**
 * DownloadCourseButton - Explicit download for offline use (paid users)
 *
 * Features:
 * - Entitlement check before download
 * - Progress indicator during download
 * - Pause/resume/cancel controls
 * - Shows cache stats when complete
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useOfflineCache } from '../composables/useOfflineCache'
import { useEntitlement, PAID_DOWNLOAD_HOURS } from '../composables/useEntitlement'

const props = defineProps<{
  courseId: string
  courseName?: string
}>()

const emit = defineEmits<{
  (e: 'downloadComplete'): void
  (e: 'downloadError', error: Error): void
}>()

// Composables
const {
  downloadCourse,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  downloadProgress,
  isDownloading,
  downloadPercent,
  refreshCacheStats,
  cacheStats,
  isOfflineReady,
} = useOfflineCache()

const { entitlement, checkEntitlement, canDownload, maxDownloadHours } = useEntitlement()

// Local state
const isChecking = ref(true)
const hasError = ref(false)
const errorMessage = ref('')
const isOffline = ref(false)

// Computed
const showDownloadButton = computed(() => {
  return canDownload.value && !isDownloading.value && !isOffline.value
})

const showProgress = computed(() => {
  return isDownloading.value
})

const downloadState = computed(() => {
  return downloadProgress.value.state
})

const isPaused = computed(() => {
  return downloadProgress.value.state === 'paused'
})

const isComplete = computed(() => {
  return downloadProgress.value.state === 'complete'
})

// Methods
async function startDownload() {
  hasError.value = false
  errorMessage.value = ''

  try {
    // Re-check entitlement before download
    await checkEntitlement(props.courseId)

    if (!canDownload.value) {
      hasError.value = true
      errorMessage.value = 'Upgrade to download for offline use'
      return
    }

    await downloadCourse(props.courseId, maxDownloadHours.value)
    emit('downloadComplete')
  } catch (error) {
    hasError.value = true
    errorMessage.value = (error as Error).message
    emit('downloadError', error as Error)
  }
}

function handlePauseResume() {
  if (isPaused.value) {
    resumeDownload()
  } else {
    pauseDownload()
  }
}

function handleCancel() {
  cancelDownload()
}

// Check entitlement and cache status on mount
onMounted(async () => {
  isChecking.value = true

  try {
    await checkEntitlement(props.courseId)
    await refreshCacheStats(props.courseId)
    isOffline.value = await isOfflineReady(props.courseId, 30) // 30 minutes minimum
  } catch (error) {
    console.error('[DownloadCourseButton] Init error:', error)
  } finally {
    isChecking.value = false
  }
})

// Watch for course changes
watch(() => props.courseId, async (newCourseId) => {
  if (newCourseId) {
    isChecking.value = true
    await checkEntitlement(newCourseId)
    await refreshCacheStats(newCourseId)
    isOffline.value = await isOfflineReady(newCourseId, 30)
    isChecking.value = false
  }
})
</script>

<template>
  <div class="download-course-button">
    <!-- Loading state -->
    <div v-if="isChecking" class="download-loading">
      <span class="loading-spinner"></span>
      <span>Checking...</span>
    </div>

    <!-- Already downloaded -->
    <div v-else-if="isOffline && !isDownloading" class="download-complete">
      <svg class="icon-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      <span>Available offline</span>
      <span class="cache-size">{{ Math.round(cacheStats.estimatedMinutes) }} min cached</span>
    </div>

    <!-- Download button (paid users) -->
    <button
      v-else-if="showDownloadButton"
      class="download-btn"
      @click="startDownload"
    >
      <svg class="icon-download" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>Download for offline</span>
      <span class="download-size">{{ maxDownloadHours }}h of content</span>
    </button>

    <!-- Not entitled (free users) -->
    <div v-else-if="!canDownload && !isDownloading" class="download-locked">
      <svg class="icon-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>
      <span>Upgrade to download</span>
      <span class="download-hint">Free users get auto-prefetch during learning</span>
    </div>

    <!-- Download progress -->
    <div v-if="showProgress" class="download-progress">
      <div class="progress-header">
        <span class="progress-label">
          {{ isPaused ? 'Paused' : 'Downloading...' }}
        </span>
        <span class="progress-percent">{{ downloadPercent }}%</span>
      </div>

      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: `${downloadPercent}%` }"></div>
      </div>

      <div class="progress-details">
        <span>{{ downloadProgress.downloaded }} / {{ downloadProgress.total }} files</span>
      </div>

      <div class="progress-actions">
        <button class="action-btn" @click="handlePauseResume">
          {{ isPaused ? 'Resume' : 'Pause' }}
        </button>
        <button class="action-btn action-cancel" @click="handleCancel">
          Cancel
        </button>
      </div>
    </div>

    <!-- Error state -->
    <div v-if="hasError" class="download-error">
      <span>{{ errorMessage }}</span>
    </div>
  </div>
</template>

<style scoped>
.download-course-button {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.download-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  font-size: 14px;
}

.loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent, #c23a3a);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.download-complete {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(76, 175, 80, 0.1);
  border: 1px solid rgba(76, 175, 80, 0.2);
  border-radius: 8px;
  color: #81c784;
  font-size: 14px;
}

.download-complete .cache-size {
  margin-left: auto;
  color: rgba(129, 199, 132, 0.7);
  font-size: 12px;
}

.icon-check {
  width: 18px;
  height: 18px;
  stroke: #81c784;
}

.download-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--accent, #c23a3a);
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.download-btn:hover {
  background: var(--accent-light, #d44545);
  transform: translateY(-1px);
}

.download-btn:active {
  transform: translateY(0);
}

.icon-download {
  width: 18px;
  height: 18px;
}

.download-size {
  margin-left: auto;
  opacity: 0.8;
  font-size: 12px;
}

.download-locked {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  color: var(--text-secondary, rgba(255, 255, 255, 0.7));
  font-size: 14px;
}

.icon-lock {
  width: 18px;
  height: 18px;
  opacity: 0.5;
}

.download-hint {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.6;
}

.download-progress {
  padding: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.progress-label {
  color: var(--text-primary, #ffffff);
  font-size: 14px;
  font-weight: 500;
}

.progress-percent {
  color: var(--accent, #c23a3a);
  font-size: 14px;
  font-weight: 600;
}

.progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent, #c23a3a);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-details {
  margin-top: 8px;
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
  font-size: 12px;
}

.progress-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.action-btn {
  flex: 1;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--text-primary, #ffffff);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.action-cancel {
  color: var(--text-muted, rgba(255, 255, 255, 0.4));
}

.action-cancel:hover {
  color: #ef5350;
  border-color: rgba(239, 83, 80, 0.3);
}

.download-error {
  padding: 8px 12px;
  background: rgba(239, 83, 80, 0.1);
  border: 1px solid rgba(239, 83, 80, 0.2);
  border-radius: 6px;
  color: #ef5350;
  font-size: 13px;
}
</style>
