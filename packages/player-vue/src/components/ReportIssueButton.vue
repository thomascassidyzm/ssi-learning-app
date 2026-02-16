<template>
  <div class="report-issue">
    <!-- Report Button -->
    <button
      class="report-btn"
      :class="{ active: isOpen }"
      @click="toggleMenu"
      title="Report an issue with this audio"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
        <line x1="4" y1="22" x2="4" y2="15"/>
      </svg>
    </button>

    <!-- Feedback Menu -->
    <Transition name="slide-up">
      <div v-if="isOpen" class="feedback-menu">
        <div class="menu-header">
          <h3>Report an Issue</h3>
          <button class="close-btn" @click="isOpen = false">&times;</button>
        </div>

        <div class="menu-content">
          <p class="context-info">
            <span class="label">Current phrase:</span>
            <span class="text">{{ currentKnown }}</span>
          </p>

          <div class="feedback-types">
            <button
              v-for="type in feedbackTypes"
              :key="type.id"
              class="type-btn"
              :class="{ selected: selectedType === type.id }"
              @click="selectedType = type.id"
            >
              <span class="type-icon">{{ type.icon }}</span>
              <span class="type-label">{{ type.label }}</span>
            </button>
          </div>

          <textarea
            v-model="comment"
            class="comment-input"
            placeholder="Optional: Add more details..."
            rows="2"
          />

          <div class="submit-row">
            <button
              class="submit-btn"
              :disabled="!selectedType || isSubmitting"
              @click="submitFeedback"
            >
              {{ isSubmitting ? 'Sending...' : 'Submit' }}
            </button>
          </div>

          <Transition name="fade">
            <div v-if="submitStatus" class="status-message" :class="submitStatus">
              {{ submitMessage }}
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, inject } from 'vue'

const props = defineProps({
  courseCode: {
    type: String,
    required: true
  },
  currentItem: {
    type: Object,
    default: null
  },
  currentKnown: {
    type: String,
    default: ''
  },
  currentTarget: {
    type: String,
    default: ''
  },
  // QA mode from dashboard launch
  qaMode: {
    type: Boolean,
    default: false
  }
})

// Inject Supabase client and auth
const supabase = inject('supabase', null)
const auth = inject('auth', null)

const isOpen = ref(false)
const selectedType = ref(null)
const comment = ref('')
const isSubmitting = ref(false)
const submitStatus = ref(null)
const submitMessage = ref('')

const feedbackTypes = [
  { id: 'translation', icon: '🔤', label: 'Translation' },
  { id: 'audio_quality', icon: '🔊', label: 'Audio Quality' },
  { id: 'pronunciation', icon: '🗣️', label: 'Pronunciation' },
  { id: 'too_fast', icon: '⏩', label: 'Too Fast' },
  { id: 'confusing', icon: '❓', label: 'Confusing' },
  { id: 'other', icon: '💬', label: 'Other' }
]

function toggleMenu() {
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    // Reset state when opening
    selectedType.value = null
    comment.value = ''
    submitStatus.value = null
  }
}

async function submitFeedback() {
  if (!selectedType.value || isSubmitting.value) return

  isSubmitting.value = true
  submitStatus.value = null

  try {
    // Build session context from current item
    const sessionContext = {
      seed_id: props.currentItem?.seed?.seed_id || null,
      cycle_index: props.currentItem?.phrase?.id || null,
      lego_id: props.currentItem?.lego?.id || null,
      known_audio_uuid: props.currentItem?.phrase?.audioRefs?.known?.id || null,
      target1_audio_uuid: props.currentItem?.phrase?.audioRefs?.target?.voice1?.id || null,
      target2_audio_uuid: props.currentItem?.phrase?.audioRefs?.target?.voice2?.id || null,
      known_text: props.currentKnown,
      target_text: props.currentTarget,
      device: navigator.userAgent,
      app_version: '1.0.0',
      qa_mode: props.qaMode,
      timestamp: new Date().toISOString()
    }

    // Get the audio ID (we'll use target1 as primary, or known if not available)
    const audioId = sessionContext.target1_audio_uuid ||
                    sessionContext.known_audio_uuid ||
                    null

    // Get user ID - prefer authenticated learner, fall back to anonymous
    const userId = auth?.learnerId?.value || getUserId()

    // Write directly to Supabase content_feedback table
    if (supabase?.value) {
      const { error } = await supabase.value
        .from('content_feedback')
        .insert({
          audio_id: audioId,
          course_code: props.courseCode,
          feedback_type: selectedType.value,
          user_id: userId,
          comment: comment.value || null,
          session_context: sessionContext
        })

      if (error) {
        console.error('[ReportIssue] Supabase insert error:', error)
        throw new Error('Failed to submit')
      }

      // Also create sample_flags entry so it appears in Dashboard QA workflow
      if (audioId) {
        const flagNotes = `Learner flagged: ${selectedType.value}${comment.value ? ` - "${comment.value}"` : ''}`
        const { error: flagError } = await supabase.value
          .from('sample_flags')
          .upsert({
            audio_uuid: audioId,
            course_code: props.courseCode,
            status: 'needs_review',
            notes: flagNotes,
            flagged_by: 'learner',
            flagged_at: new Date().toISOString()
          }, {
            onConflict: 'audio_uuid,course_code'
          })

        if (flagError) {
          // Log but don't fail - content_feedback was saved successfully
          console.warn('[ReportIssue] Could not create sample_flags entry:', flagError)
        } else {
          console.log('[ReportIssue] Created sample_flags entry for QA review:', audioId)
        }
      }

      submitStatus.value = 'success'
      submitMessage.value = 'Thanks for your feedback!'
      // Auto-close after success
      setTimeout(() => {
        isOpen.value = false
      }, 1500)
    } else {
      // Fallback: log locally if Supabase not available
      console.warn('[ReportIssue] Supabase not available, feedback not saved:', {
        audioId,
        courseCode: props.courseCode,
        feedbackType: selectedType.value,
        userId,
        comment: comment.value,
        sessionContext
      })
      submitStatus.value = 'error'
      submitMessage.value = 'Not signed in. Feedback not saved.'
    }
  } catch (error) {
    console.error('Failed to submit feedback:', error)
    submitStatus.value = 'error'
    submitMessage.value = 'Failed to send. Try again later.'
  } finally {
    isSubmitting.value = false
  }
}

// Get or generate anonymous user ID
function getUserId() {
  let userId = localStorage.getItem('ssi_feedback_user_id')
  if (!userId) {
    userId = 'anon_' + Math.random().toString(36).substring(2, 15)
    localStorage.setItem('ssi_feedback_user_id', userId)
  }
  return userId
}
</script>

<style scoped>
.report-issue {
  position: relative;
}

.report-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.report-btn:hover,
.report-btn.active {
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.9);
  border-color: rgba(255, 255, 255, 0.3);
}

.report-btn svg {
  width: 20px;
  height: 20px;
}

.feedback-menu {
  position: absolute;
  bottom: 60px;
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  background: rgba(20, 20, 30, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 100;
}

.menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.menu-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.close-btn {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  width: 24px;
  height: 24px;
}

.close-btn:hover {
  color: rgba(255, 255, 255, 0.9);
}

.menu-content {
  padding: 16px;
}

.context-info {
  margin: 0 0 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.context-info .label {
  display: block;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 10px;
}

.context-info .text {
  display: block;
  color: rgba(255, 255, 255, 0.9);
  font-style: italic;
}

.feedback-types {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  transition: all 0.2s ease;
}

.type-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

.type-btn.selected {
  background: rgba(194, 58, 58, 0.2);
  border-color: rgba(194, 58, 58, 0.5);
  color: #fff;
}

.type-icon {
  font-size: 18px;
}

.type-label {
  font-size: 10px;
  text-align: center;
  line-height: 1.2;
}

.comment-input {
  width: 100%;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 13px;
  resize: none;
  margin-bottom: 12px;
}

.comment-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.comment-input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.3);
}

.submit-row {
  display: flex;
  justify-content: flex-end;
}

.submit-btn {
  padding: 8px 20px;
  background: linear-gradient(135deg, var(--ssi-red), var(--ssi-red-dark));
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.submit-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #d44444, #b33838);
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.status-message {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  text-align: center;
}

.status-message.success {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.status-message.error {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

/* Transitions */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.25s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
