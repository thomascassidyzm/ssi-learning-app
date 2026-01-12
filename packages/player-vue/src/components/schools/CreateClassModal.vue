<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'create'])

// Form state
const className = ref('')
const courseCode = ref('')
const isSubmitting = ref(false)

// Available courses
const courses = [
  { code: 'cym_for_eng_north', name: 'Welsh (Northern)', flag: '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F' },
  { code: 'cym_for_eng_south', name: 'Welsh (Southern)', flag: '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC77\uDB40\uDC6C\uDB40\uDC73\uDB40\uDC7F' },
  { code: 'spa_for_eng', name: 'Spanish (European)', flag: '\uD83C\uDDEA\uD83C\uDDF8' },
  { code: 'spa_for_eng_latam', name: 'Spanish (Latin American)', flag: '\uD83C\uDDEA\uD83C\uDDF8' },
  { code: 'nld_for_eng', name: 'Dutch', flag: '\uD83C\uDDF3\uD83C\uDDF1' },
  { code: 'cor_for_eng', name: 'Cornish', flag: '\uD83C\uDFF4\uDB40\uDC67\uDB40\uDC62\uDB40\uDC65\uDB40\uDC6E\uDB40\uDC67\uDB40\uDC7F' },
  { code: 'glv_for_eng', name: 'Manx', flag: '\uD83C\uDDEE\uD83C\uDDF2' }
]

// Reset form when modal closes
watch(() => props.isOpen, (newVal) => {
  if (!newVal) {
    className.value = ''
    courseCode.value = ''
    isSubmitting.value = false
  }
})

const handleClose = () => {
  emit('close')
}

const handleOverlayClick = (e) => {
  if (e.target === e.currentTarget) {
    handleClose()
  }
}

const handleKeydown = (e) => {
  if (e.key === 'Escape') {
    handleClose()
  }
}

const handleSubmit = async () => {
  if (!className.value.trim() || !courseCode.value) {
    return
  }

  isSubmitting.value = true

  // Generate a join code (XXX-NNN format)
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // No I, O
  const generateCode = () => {
    let code = ''
    for (let i = 0; i < 3; i++) {
      code += letters[Math.floor(Math.random() * letters.length)]
    }
    code += '-'
    for (let i = 0; i < 3; i++) {
      code += Math.floor(Math.random() * 10)
    }
    return code
  }

  const newClass = {
    id: crypto.randomUUID(),
    class_name: className.value.trim(),
    course_code: courseCode.value,
    student_join_code: generateCode(),
    student_count: 0,
    current_seed: 1,
    sessions: 0,
    total_time: '0h',
    created_at: new Date().toISOString(),
    is_active: true
  }

  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300))

  emit('create', newClass)
  isSubmitting.value = false
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="isOpen"
        class="modal-overlay"
        @click="handleOverlayClick"
        @keydown="handleKeydown"
      >
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <!-- Celtic-inspired decorative header -->
          <div class="modal-decoration">
            <svg viewBox="0 0 200 20" class="celtic-pattern">
              <pattern id="celticWave" x="0" y="0" width="40" height="20" patternUnits="userSpaceOnUse">
                <path
                  d="M0 10 Q10 0, 20 10 T40 10"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  opacity="0.4"
                />
              </pattern>
              <rect width="200" height="20" fill="url(#celticWave)" />
            </svg>
          </div>

          <header class="modal-header">
            <h2 id="modal-title" class="modal-title">Create New Class</h2>
            <button class="modal-close" @click="handleClose" aria-label="Close modal">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </header>

          <form class="modal-body" @submit.prevent="handleSubmit">
            <div class="form-group">
              <label class="form-label" for="className">Class Name</label>
              <input
                id="className"
                v-model="className"
                type="text"
                class="form-input"
                placeholder="e.g., Year 7 Welsh"
                autocomplete="off"
                required
              />
              <p class="form-hint">Choose a name that helps you identify this class</p>
            </div>

            <div class="form-group">
              <label class="form-label" for="courseCode">Course / Language</label>
              <div class="select-wrapper">
                <select
                  id="courseCode"
                  v-model="courseCode"
                  class="form-select"
                  required
                >
                  <option value="" disabled>Select a course...</option>
                  <option v-for="course in courses" :key="course.code" :value="course.code">
                    {{ course.flag }} {{ course.name }}
                  </option>
                </select>
                <svg class="select-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            </div>

            <div class="info-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/>
                <path d="M12 8h.01"/>
              </svg>
              <p>A unique join code will be generated automatically. Students can use this code to join your class.</p>
            </div>
          </form>

          <footer class="modal-footer">
            <button type="button" class="btn-cancel" @click="handleClose">
              Cancel
            </button>
            <button
              type="submit"
              class="btn-create"
              :disabled="!className.trim() || !courseCode || isSubmitting"
              @click="handleSubmit"
            >
              <span v-if="isSubmitting" class="btn-spinner"></span>
              <span v-else>Create Class</span>
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 1000;
}

.modal {
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 20px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.5),
    0 0 1px rgba(255, 255, 255, 0.1);
}

.modal-decoration {
  height: 20px;
  background: linear-gradient(90deg, var(--ssi-red, #c23a3a), var(--ssi-gold, #d4a853));
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.celtic-pattern {
  width: 100%;
  height: 20px;
  color: rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 24px 0;
}

.modal-title {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0;
}

.modal-close {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary, #1a1a1a);
  border: none;
  border-radius: 50%;
  color: var(--text-secondary, #b0b0b0);
  cursor: pointer;
  transition: all 0.2s ease;
}

.modal-close:hover {
  background: var(--error, #ef4444);
  color: white;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary, #b0b0b0);
  margin-bottom: 8px;
}

.form-input,
.form-select {
  width: 100%;
  padding: 14px 16px;
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 12px;
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 0.9375rem;
  transition: all 0.2s ease;
  min-height: 48px;
}

.form-input::placeholder {
  color: var(--text-muted, #707070);
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--ssi-red, #c23a3a);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

.select-wrapper {
  position: relative;
}

.form-select {
  appearance: none;
  padding-right: 44px;
  cursor: pointer;
}

.select-arrow {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted, #707070);
  pointer-events: none;
}

.form-hint {
  font-size: 0.75rem;
  color: var(--text-muted, #707070);
  margin-top: 6px;
}

.info-box {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: rgba(194, 58, 58, 0.08);
  border: 1px solid rgba(194, 58, 58, 0.2);
  border-radius: 12px;
}

.info-box svg {
  flex-shrink: 0;
  color: var(--ssi-red, #c23a3a);
  margin-top: 2px;
}

.info-box p {
  font-size: 0.8125rem;
  color: var(--text-secondary, #b0b0b0);
  line-height: 1.5;
  margin: 0;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 0 24px 24px;
}

.btn-cancel,
.btn-create {
  flex: 1;
  padding: 14px 24px;
  border-radius: 12px;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  min-height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-cancel {
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-medium, rgba(255,255,255,0.15));
  color: var(--text-primary, #ffffff);
}

.btn-cancel:hover {
  background: var(--bg-elevated, #333333);
  border-color: var(--ssi-red, #c23a3a);
}

.btn-create {
  background: var(--ssi-red, #c23a3a);
  border: none;
  color: white;
}

.btn-create:hover:not(:disabled) {
  background: var(--ssi-red-light, #e54545);
  transform: translateY(-2px);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Modal transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s ease;
}

.modal-enter-active .modal,
.modal-leave-active .modal {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal,
.modal-leave-to .modal {
  transform: translateY(20px) scale(0.95);
}

/* Touch-friendly sizing */
@media (max-width: 768px) {
  .modal {
    margin: 16px;
  }

  .form-input,
  .form-select,
  .btn-cancel,
  .btn-create {
    min-height: 52px;
  }
}
</style>
