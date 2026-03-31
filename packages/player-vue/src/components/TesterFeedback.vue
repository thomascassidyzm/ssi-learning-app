<script setup lang="ts">
/**
 * TesterFeedback - Floating bug report widget for testers and admins
 *
 * Visible only to users with platform_role 'tester' or 'ssi_admin'.
 * Submits feedback directly to the tester_feedback Supabase table.
 */
import { ref, computed, inject } from 'vue'
import { useRouter } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'

const { isTester, isSsiAdmin } = useUserRole()
const showWidget = computed(() => isTester.value || isSsiAdmin.value)

const router = useRouter()
const supabase = inject<{ value: any }>('supabase')
const auth = inject<any>('auth')

// @ts-ignore - __BUILD_NUMBER__ is defined by Vite
const BUILD_VERSION = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev'

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

const currentRoute = computed(() => router.currentRoute.value.fullPath)
const screenSize = computed(() => `${window.screen.width}x${window.screen.height}`)
const deviceInfo = computed(() => ({
  userAgent: navigator.userAgent,
  screen: screenSize.value,
}))

function openPanel() {
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
}

async function submitFeedback() {
  if (!title.value.trim() || !supabase?.value) return

  isSubmitting.value = true
  try {
    const { error } = await supabase.value.from('tester_feedback').insert({
      user_id: auth?.userId?.value ?? null,
      display_name: auth?.learner?.value?.display_name ?? null,
      feedback_type: selectedType.value.toLowerCase(),
      title: title.value.trim(),
      description: description.value.trim() || null,
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
      aria-label="Report feedback"
      @click="openPanel"
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
              {{ isSubmitting ? 'Sending...' : 'Submit' }}
            </button>
          </div>
        </template>
      </div>
    </Transition>
  </template>
</template>

<style scoped>
/* Floating action button */
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
  cursor: pointer;
  box-shadow: 0 2px 12px rgba(45, 156, 219, 0.4);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.feedback-fab:hover {
  transform: scale(1.08);
  box-shadow: 0 4px 18px rgba(45, 156, 219, 0.55);
}

.feedback-fab:active {
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
