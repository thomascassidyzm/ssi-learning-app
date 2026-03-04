<template>
  <div class="report-issue">
    <button
      class="flag-btn"
      :class="{ flagged: isFlagged, submitting: isSubmitting }"
      :disabled="isSubmitting"
      @click="flagPhrase"
      title="Flag this phrase for review"
    >
      <svg viewBox="0 0 24 24" :fill="isFlagged ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
        <line x1="4" y1="22" x2="4" y2="15"/>
      </svg>
    </button>
  </div>
</template>

<script setup>
import { ref, inject, watch } from 'vue'

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
  qaMode: {
    type: Boolean,
    default: false
  }
})

const supabase = inject('supabase', null)
const auth = inject('auth', null)

const isFlagged = ref(false)
const isSubmitting = ref(false)

// Reset flag state when current item changes
watch(() => props.currentItem, () => {
  isFlagged.value = false
})

async function flagPhrase() {
  if (isSubmitting.value || isFlagged.value) return

  isSubmitting.value = true

  try {
    const sessionContext = {
      seed_id: props.currentItem?.seed?.seed_id || null,
      cycle_index: props.currentItem?.phrase?.id || null,
      lego_id: props.currentItem?.lego?.id || null,
      known_text: props.currentKnown,
      target_text: props.currentTarget,
      qa_mode: props.qaMode,
      timestamp: new Date().toISOString()
    }

    const audioId = props.currentItem?.phrase?.audioRefs?.target?.voice1?.id ||
                    props.currentItem?.phrase?.audioRefs?.known?.id ||
                    null

    const userId = auth?.learnerId?.value || getUserId()

    if (supabase?.value) {
      const { error } = await supabase.value
        .from('content_feedback')
        .insert({
          audio_id: audioId,
          course_code: props.courseCode,
          feedback_type: 'flagged',
          user_id: userId,
          session_context: sessionContext
        })

      if (error) {
        console.error('[Flag] Supabase insert error:', error)
        return
      }

      // Also create sample_flags entry for Dashboard QA workflow
      if (audioId) {
        const { error: flagError } = await supabase.value
          .from('sample_flags')
          .upsert({
            audio_uuid: audioId,
            course_code: props.courseCode,
            status: 'needs_review',
            notes: 'Learner flagged for review',
            flagged_by: 'learner',
            flagged_at: new Date().toISOString()
          }, {
            onConflict: 'audio_uuid,course_code'
          })

        if (flagError) {
          console.warn('[Flag] Could not create sample_flags entry:', flagError)
        }
      }

      isFlagged.value = true
    } else {
      console.warn('[Flag] Supabase not available, flag not saved')
    }
  } catch (error) {
    console.error('[Flag] Failed to flag phrase:', error)
  } finally {
    isSubmitting.value = false
  }
}

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

.flag-btn {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.flag-btn:active:not(:disabled) {
  transform: scale(0.9);
}

.flag-btn svg {
  width: 20px;
  height: 20px;
}

.flag-btn.flagged {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
}

.flag-btn.submitting {
  opacity: 0.5;
  cursor: wait;
}
</style>
