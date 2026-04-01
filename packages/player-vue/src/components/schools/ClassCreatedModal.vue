<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  classData: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'goToClass'])

const codeCopied = ref(false)

const courseNames: Record<string, string> = {
  'cym_for_eng': 'Welsh',
  'cym_for_eng_north': 'Welsh (Northern)',
  'cym_for_eng_south': 'Welsh (Southern)',
  'cym_n_for_eng': 'Welsh (Northern)',
  'cym_s_for_eng': 'Welsh (Southern)',
  'spa_for_eng': 'Spanish',
  'spa_for_eng_latam': 'Spanish (Latin Am.)',
  'eng_for_spa': 'English',
  'fra_for_eng': 'French',
  'deu_for_eng': 'German',
  'nld_for_eng': 'Dutch',
  'gle_for_eng': 'Irish',
  'jpn_for_eng': 'Japanese',
  'eng_for_jpn': 'English',
  'cmn_for_eng': 'Chinese',
  'ara_for_eng': 'Arabic',
  'kor_for_eng': 'Korean',
  'ita_for_eng': 'Italian',
  'por_for_eng': 'Portuguese',
  'bre_for_fre': 'Breton',
  'cor_for_eng': 'Cornish',
  'glv_for_eng': 'Manx',
  'eus_for_spa': 'Basque',
  'cat_for_spa': 'Catalan',
  'gla_for_eng': 'Scottish Gaelic',
  'rus_for_eng': 'Russian',
  'pol_for_eng': 'Polish'
}

function getCourseName(code: string): string {
  return courseNames[code] || code
}

async function copyJoinCode() {
  if (!props.classData?.student_join_code) return
  try {
    await navigator.clipboard.writeText(props.classData.student_join_code)
    codeCopied.value = true
    setTimeout(() => { codeCopied.value = false }, 2000)
  } catch {
    // Fallback for older browsers
    const el = document.createElement('textarea')
    el.value = props.classData.student_join_code
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    codeCopied.value = true
    setTimeout(() => { codeCopied.value = false }, 2000)
  }
}

function handleOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit('close')
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="isOpen && classData"
        class="modal-overlay"
        @click="handleOverlayClick"
        @keydown="handleKeydown"
      >
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="created-modal-title">
          <!-- Decorative header -->
          <div class="modal-decoration">
            <svg viewBox="0 0 200 20" class="celtic-pattern">
              <pattern id="celticWaveCreated" x="0" y="0" width="40" height="20" patternUnits="userSpaceOnUse">
                <path
                  d="M0 10 Q10 0, 20 10 T40 10"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  opacity="0.4"
                />
              </pattern>
              <rect width="200" height="20" fill="url(#celticWaveCreated)" />
            </svg>
          </div>

          <div class="modal-body">
            <!-- Success icon -->
            <div class="success-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>

            <h2 id="created-modal-title" class="modal-title">Class created!</h2>
            <p class="modal-subtitle">
              {{ classData.class_name }} &middot; {{ getCourseName(classData.course_code) }}
            </p>

            <!-- Join code display -->
            <div class="join-code-display">
              <span class="join-code">{{ classData.student_join_code }}</span>
              <button
                class="btn-copy"
                :class="{ copied: codeCopied }"
                @click="copyJoinCode"
              >
                <svg v-if="!codeCopied" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>{{ codeCopied ? 'Copied!' : 'Copy' }}</span>
              </button>
            </div>

            <div class="join-url">
              <span class="url-label">Share link:</span>
              <code class="url-code">ssi.app/join/{{ classData.student_join_code }}</code>
            </div>

            <p class="share-hint">Share this code with your students so they can join the class.</p>
          </div>

          <footer class="modal-footer">
            <button type="button" class="btn-secondary" @click="emit('close')">
              Done
            </button>
            <button type="button" class="btn-primary" @click="emit('goToClass')">
              Go to Class
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

.modal-body {
  padding: 32px 24px 24px;
  text-align: center;
}

.success-icon {
  width: 56px;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(74, 222, 128, 0.15);
  border: 2px solid var(--success, #4ade80);
  border-radius: 50%;
  margin: 0 auto 16px;
  color: var(--success, #4ade80);
}

.modal-title {
  font-family: 'Noto Sans JP', 'DM Sans', sans-serif;
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary, #ffffff);
  margin: 0 0 4px 0;
}

.modal-subtitle {
  font-size: 0.9375rem;
  color: var(--text-secondary, #b0b0b0);
  margin: 0 0 24px 0;
}

.join-code-display {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: var(--bg-secondary, #1a1a1a);
  border: 2px dashed var(--border-medium, rgba(255,255,255,0.15));
  border-radius: 12px;
  margin-bottom: 12px;
}

.join-code {
  flex: 1;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: 4px;
  color: var(--ssi-gold, #d4a853);
  text-align: left;
}

.btn-copy {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-medium, rgba(255,255,255,0.15));
  border-radius: 8px;
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.btn-copy:hover {
  background: var(--bg-elevated, #333333);
  border-color: var(--ssi-red, #c23a3a);
}

.btn-copy.copied {
  background: rgba(74, 222, 128, 0.15);
  border-color: var(--success, #4ade80);
  color: var(--success, #4ade80);
}

.join-url {
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  margin-bottom: 16px;
  font-size: 0.8125rem;
}

.url-label {
  color: var(--text-muted, #707070);
}

.url-code {
  padding: 4px 8px;
  background: var(--bg-secondary, #1a1a1a);
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: var(--text-secondary, #b0b0b0);
}

.share-hint {
  font-size: 0.8125rem;
  color: var(--text-muted, #707070);
  margin: 0;
  line-height: 1.5;
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 0 24px 24px;
}

.btn-secondary,
.btn-primary {
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

.btn-secondary {
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-medium, rgba(255,255,255,0.15));
  color: var(--text-primary, #ffffff);
}

.btn-secondary:hover {
  background: var(--bg-elevated, #333333);
  border-color: var(--ssi-red, #c23a3a);
}

.btn-primary {
  background: var(--ssi-red, #c23a3a);
  border: none;
  color: white;
}

.btn-primary:hover {
  background: var(--ssi-red-light, #e54545);
  transform: translateY(-2px);
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

@media (max-width: 768px) {
  .modal {
    margin: 16px;
  }

  .join-code {
    font-size: 1.25rem;
    letter-spacing: 2px;
  }

  .join-code-display {
    flex-direction: column;
    align-items: stretch;
    text-align: center;
  }

  .join-code {
    text-align: center;
  }

  .btn-copy {
    justify-content: center;
  }

  .btn-secondary,
  .btn-primary {
    min-height: 52px;
  }
}
</style>
