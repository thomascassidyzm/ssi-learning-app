<script setup lang="ts">
/**
 * TesterFeedback - Floating bug report widget for testers and admins
 *
 * Visible only to users with platform_role 'tester' or 'ssi_admin'.
 * Submits feedback directly to the tester_feedback Supabase table.
 */
import { ref, computed, inject } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'

const { isTester, isSsiAdmin } = useUserRole()
const showWidget = computed(() => isTester.value || isSsiAdmin.value)

const router = useRouter()
const route = useRoute()
const supabase = inject<{ value: any }>('supabase')

// --- Draggable FAB ---
const fabX = ref<number | null>(null) // null = use CSS default position
const fabY = ref<number | null>(null)
const isDragging = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const dragStartPosX = ref(0)
const dragStartPosY = ref(0)
const hasMoved = ref(false)
const DRAG_THRESHOLD = 5

const fabStyle = computed(() => {
  if (fabX.value === null || fabY.value === null) return {}
  return {
    left: `${fabX.value}px`,
    top: `${fabY.value}px`,
    bottom: 'auto',
    right: 'auto',
  }
})

function onFabPointerDown(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button:not(.feedback-fab)')) return
  hasMoved.value = false
  isDragging.value = false
  dragStartX.value = e.clientX
  dragStartY.value = e.clientY

  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  dragStartPosX.value = rect.left
  dragStartPosY.value = rect.top

  if (fabX.value === null) {
    fabX.value = rect.left
    fabY.value = rect.top
  }

  document.addEventListener('pointermove', onFabPointerMove)
  document.addEventListener('pointerup', onFabPointerUp)
}

function onFabPointerMove(e: PointerEvent) {
  const dx = e.clientX - dragStartX.value
  const dy = e.clientY - dragStartY.value
  if (!hasMoved.value && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return
  hasMoved.value = true
  isDragging.value = true

  const newX = dragStartPosX.value + dx
  const newY = dragStartPosY.value + dy
  const maxX = window.innerWidth - 48
  const maxY = window.innerHeight - 48
  fabX.value = Math.max(0, Math.min(newX, maxX))
  fabY.value = Math.max(0, Math.min(newY, maxY))
}

function onFabPointerUp() {
  document.removeEventListener('pointermove', onFabPointerMove)
  document.removeEventListener('pointerup', onFabPointerUp)
  requestAnimationFrame(() => { isDragging.value = false })
}
const auth = inject<any>('auth')

// @ts-ignore - __BUILD_NUMBER__ is defined by Vite
const BUILD_VERSION = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

// Panel state
const isPanelOpen = ref(false)
const isSubmitting = ref(false)
const showConfirmation = ref(false)

// Form state
const feedbackTypes = ['Bug', 'Suggestion', 'Security', 'UX'] as const
type FeedbackType = typeof feedbackTypes[number]

const selectedType = ref<FeedbackType>('Bug')
const title = ref('')
const description = ref('')

// Screenshot state
const screenshotFile = ref<File | null>(null)
const screenshotPreview = ref<string | null>(null)
const screenshotError = ref<string | null>(null)
const isUploading = ref(false)

const currentRoute = computed(() => router.currentRoute.value.fullPath)
const screenSize = ref(`${window.innerWidth}x${window.innerHeight}`)
const deviceInfo = computed(() => ({
  userAgent: navigator.userAgent,
  screen: screenSize.value,
}))

function openPanel() {
  screenSize.value = `${window.innerWidth}x${window.innerHeight}`
  isPanelOpen.value = true
}

function closePanel() {
  isPanelOpen.value = false
  resetForm()
}

function resetForm() {
  selectedType.value = 'Bug'
  title.value = ''
  description.value = ''
  removeScreenshot()
}

function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // Reset input so the same file can be re-selected after removal
  input.value = ''

  if (file.size > MAX_FILE_SIZE) {
    screenshotError.value = 'Image must be under 5MB'
    return
  }

  screenshotError.value = null
  screenshotFile.value = file

  // Create thumbnail preview
  const reader = new FileReader()
  reader.onload = (e) => {
    screenshotPreview.value = e.target?.result as string
  }
  reader.readAsDataURL(file)
}

function removeScreenshot() {
  screenshotFile.value = null
  screenshotPreview.value = null
  screenshotError.value = null
}

async function uploadScreenshot(): Promise<string | null> {
  if (!screenshotFile.value || !supabase?.value) return null

  isUploading.value = true
  try {
    const ext = screenshotFile.value.name.split('.').pop() || 'png'
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`

    const { data, error } = await supabase.value.storage
      .from('feedback-screenshots')
      .upload(fileName, screenshotFile.value, { contentType: screenshotFile.value.type })

    if (error) {
      console.error('[TesterFeedback] Upload error:', error.message)
      return null
    }

    if (data) {
      const { data: urlData } = supabase.value.storage
        .from('feedback-screenshots')
        .getPublicUrl(fileName)
      return urlData?.publicUrl ?? null
    }

    return null
  } catch (err) {
    console.error('[TesterFeedback] Upload failed:', err)
    return null
  } finally {
    isUploading.value = false
  }
}

async function submitFeedback() {
  if (!title.value.trim() || !supabase?.value) return

  isSubmitting.value = true
  try {
    // Upload screenshot first (if any) — failure is non-blocking
    const screenshotUrl = await uploadScreenshot()

    const { error } = await supabase.value.from('tester_feedback').insert({
      user_id: auth?.userId?.value ?? null,
      display_name: auth?.learner?.value?.display_name ?? null,
      feedback_type: selectedType.value.toLowerCase(),
      title: title.value.trim(),
      description: description.value.trim() || null,
      screenshot_url: screenshotUrl,
      route: currentRoute.value,
      device_info: deviceInfo.value,
      build_version: BUILD_VERSION,
    })

    if (error) {
      console.error('[TesterFeedback] Submit error:', error.message)
      return
    }

    // Show confirmation
    showConfirmation.value = true
    setTimeout(() => {
      showConfirmation.value = false
      closePanel()
    }, 1800)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <template v-if="showWidget">
    <!-- Floating button -->
    <button
      v-if="!isPanelOpen"
      class="feedback-fab"
      :class="{ dragging: isDragging }"
      :style="fabStyle"
      aria-label="Report feedback"
      @pointerdown="onFabPointerDown"
      @click="!hasMoved && openPanel()"
      @dragstart.prevent
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2l1.88 1.88" />
        <path d="M14.12 3.88L16 2" />
        <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
        <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
        <path d="M12 20v2" />
        <path d="M6 13H2" />
        <path d="M22 13h-4" />
        <path d="M14 7.13v-1" />
        <path d="M10 7.13v-1" />
      </svg>
    </button>

    <!-- Backdrop -->
    <Transition name="fade">
      <div v-if="isPanelOpen" class="feedback-backdrop" @click="closePanel" />
    </Transition>

    <!-- Panel -->
    <Transition name="slide-panel">
      <div v-if="isPanelOpen" class="feedback-panel">
        <!-- Confirmation overlay -->
        <div v-if="showConfirmation" class="feedback-confirmation">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2d9cdb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <p>Thanks! We'll look into this.</p>
        </div>

        <!-- Form -->
        <template v-else>
          <div class="feedback-header">
            <h3>Send Feedback</h3>
            <button class="feedback-close" aria-label="Close" @click="closePanel">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div class="feedback-body">
            <!-- Type pills -->
            <div class="feedback-type-group">
              <button
                v-for="ft in feedbackTypes"
                :key="ft"
                class="feedback-type-pill"
                :class="{ active: selectedType === ft }"
                @click="selectedType = ft"
              >
                {{ ft }}
              </button>
            </div>

            <!-- Title -->
            <input
              v-model="title"
              type="text"
              class="feedback-input"
              placeholder="What happened?"
              maxlength="200"
              autofocus
            />

            <!-- Description -->
            <textarea
              v-model="description"
              class="feedback-textarea"
              placeholder="Any extra detail... (optional)"
              rows="3"
              maxlength="2000"
            />

            <!-- Screenshot upload -->
            <div class="feedback-screenshot-zone">
              <template v-if="screenshotPreview">
                <div class="feedback-screenshot-preview">
                  <img :src="screenshotPreview" alt="Screenshot preview" />
                  <button
                    class="feedback-screenshot-remove"
                    aria-label="Remove screenshot"
                    @click="removeScreenshot"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </template>
              <template v-else>
                <label class="feedback-screenshot-label">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    class="feedback-screenshot-input"
                    @change="onFileSelected"
                  />
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>Attach screenshot</span>
                </label>
              </template>
              <p v-if="screenshotError" class="feedback-screenshot-error">{{ screenshotError }}</p>
            </div>

            <!-- Auto-captured info -->
            <div class="feedback-meta">
              <span class="feedback-chip">{{ currentRoute }}</span>
              <span class="feedback-chip">v{{ BUILD_VERSION }}</span>
              <span class="feedback-chip">{{ screenSize }}</span>
            </div>
          </div>

          <div class="feedback-footer">
            <button
              class="feedback-submit"
              :disabled="!title.trim() || isSubmitting"
              @click="submitFeedback"
            >
              {{ isSubmitting ? (isUploading ? 'Uploading...' : 'Sending...') : 'Submit' }}
            </button>
          </div>
        </template>
      </div>
    </Transition>
  </template>
</template>

<style scoped>
/* Floating action button — draggable */
.feedback-fab {
  position: fixed;
  bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  right: 24px;
  z-index: 9998;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: #2d9cdb;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  box-shadow: 0 2px 12px rgba(45, 156, 219, 0.4);
  transition: box-shadow 0.2s ease;
  touch-action: none;
  user-select: none;
  opacity: 0.75;
}

.feedback-fab:hover {
  opacity: 1;
}

.feedback-fab.dragging {
  cursor: grabbing;
  box-shadow: 0 6px 24px rgba(45, 156, 219, 0.6);
  opacity: 1;
}

.feedback-fab:active:not(.dragging) {
  transform: scale(0.96);
}

/* Backdrop */
.feedback-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
}

/* Panel */
.feedback-panel {
  position: fixed;
  z-index: 10000;
  background: var(--color-surface, #1a1a2e);
  border: 1px solid var(--color-border, #2a2a4a);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Mobile: bottom sheet */
@media (max-width: 640px) {
  .feedback-panel {
    bottom: 0;
    left: 0;
    right: 0;
    border-radius: 16px 16px 0 0;
    max-height: 85vh;
  }
}

/* Desktop: right side panel */
@media (min-width: 641px) {
  .feedback-panel {
    bottom: 24px;
    right: 24px;
    width: 380px;
    border-radius: 14px;
    max-height: 520px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
}

/* Header */
.feedback-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--color-border, #2a2a4a);
}

.feedback-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text, #e0e0e0);
}

.feedback-close {
  background: none;
  border: none;
  color: var(--color-text-muted, #888);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease;
}

.feedback-close:hover {
  color: var(--color-text, #e0e0e0);
}

/* Body */
.feedback-body {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

/* Type pills */
.feedback-type-group {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.feedback-type-pill {
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid var(--color-border, #2a2a4a);
  background: transparent;
  color: var(--color-text-muted, #888);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.feedback-type-pill:hover {
  border-color: #2d9cdb;
  color: var(--color-text, #e0e0e0);
}

.feedback-type-pill.active {
  background: rgba(45, 156, 219, 0.15);
  border-color: #2d9cdb;
  color: #2d9cdb;
  font-weight: 500;
}

/* Inputs */
.feedback-input,
.feedback-textarea {
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border, #2a2a4a);
  background: var(--color-bg, #0e0e1a);
  color: var(--color-text, #e0e0e0);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}

.feedback-input:focus,
.feedback-textarea:focus {
  border-color: #2d9cdb;
}

.feedback-input::placeholder,
.feedback-textarea::placeholder {
  color: var(--color-text-muted, #666);
}

.feedback-textarea {
  resize: vertical;
  min-height: 60px;
}

/* Screenshot upload */
.feedback-screenshot-zone {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.feedback-screenshot-label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  border: 1.5px dashed var(--color-border, #2a2a4a);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-muted, #888);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.feedback-screenshot-label:hover {
  border-color: #2d9cdb;
  color: var(--color-text, #e0e0e0);
  background: rgba(45, 156, 219, 0.05);
}

.feedback-screenshot-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.feedback-screenshot-preview {
  position: relative;
  display: inline-flex;
  align-self: flex-start;
}

.feedback-screenshot-preview img {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--color-border, #2a2a4a);
}

.feedback-screenshot-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: #e04040;
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s ease;
}

.feedback-screenshot-remove:hover {
  background: #c03030;
}

.feedback-screenshot-error {
  margin: 0;
  font-size: 12px;
  color: #e04040;
}

/* Meta chips */
.feedback-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.feedback-chip {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-muted, #666);
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Footer */
.feedback-footer {
  padding: 12px 20px 16px;
  border-top: 1px solid var(--color-border, #2a2a4a);
}

.feedback-submit {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  border: none;
  background: #2d9cdb;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease;
}

.feedback-submit:hover:not(:disabled) {
  background: #2489c4;
}

.feedback-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Confirmation */
.feedback-confirmation {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 20px;
  text-align: center;
}

.feedback-confirmation p {
  margin: 0;
  color: var(--color-text, #e0e0e0);
  font-size: 15px;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Mobile: slide up from bottom */
@media (max-width: 640px) {
  .slide-panel-enter-active,
  .slide-panel-leave-active {
    transition: transform 0.3s ease;
  }
  .slide-panel-enter-from,
  .slide-panel-leave-to {
    transform: translateY(100%);
  }
}

/* Desktop: slide in from right */
@media (min-width: 641px) {
  .slide-panel-enter-active,
  .slide-panel-leave-active {
    transition: transform 0.25s ease, opacity 0.25s ease;
  }
  .slide-panel-enter-from,
  .slide-panel-leave-to {
    transform: translateX(20px);
    opacity: 0;
  }
}
</style>
