<script setup>
import { ref, computed, watch } from 'vue'

// Reusable in-app confirmation for destructive schools-hierarchy deletes
// (class / school / group self-serve delete) — replaces browser
// confirm()/prompt(), which can't show impact counts or block on a typed
// match. Structure/styling follows CreateClassModal.vue so delete flows
// look like the same product as create flows.
const props = defineProps({
  isOpen: { type: Boolean, default: false },
  title: { type: String, required: true },
  // The name the caller must type back exactly when requireTypedConfirm is true.
  targetName: { type: String, required: true },
  // Human-readable impact lines, e.g. "4 students", "12 sessions recorded".
  impactLines: { type: Array, default: () => [] },
  // Real recorded activity beneath this node — escalate to type-the-name.
  requireTypedConfirm: { type: Boolean, default: false },
  submitting: { type: Boolean, default: false },
  error: { type: String, default: '' },
  // Verb on the danger button — e.g. "Purge" for the demo-org purge flow.
  confirmLabel: { type: String, default: 'Delete' },
})

const emit = defineEmits(['close', 'confirm'])

const typedName = ref('')

watch(() => props.isOpen, (open) => {
  if (open) typedName.value = ''
})

const canConfirm = computed(() =>
  !props.submitting && (!props.requireTypedConfirm || typedName.value.trim() === props.targetName)
)

function handleClose() {
  if (props.submitting) return
  emit('close')
}

function handleOverlayClick(e) {
  if (e.target === e.currentTarget) handleClose()
}

function handleConfirm() {
  if (!canConfirm.value) return
  emit('confirm', typedName.value.trim())
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="modal-overlay" @click="handleOverlayClick" @keydown.escape="handleClose">
        <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-modal-title">
          <div class="modal-decoration" />

          <header class="modal-header">
            <h2 id="delete-modal-title" class="modal-title">{{ title }}</h2>
            <button class="modal-close" type="button" @click="handleClose" aria-label="Cancel">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </header>

          <div class="modal-body">
            <p class="delete-target">"{{ targetName }}"</p>

            <ul v-if="impactLines.length" class="impact-list">
              <li v-for="line in impactLines" :key="line">{{ line }}</li>
            </ul>

            <div class="warning-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <p>This cannot be undone.</p>
            </div>

            <div v-if="requireTypedConfirm" class="form-group">
              <label class="form-label" for="confirmName">Type the name exactly to confirm</label>
              <input
                id="confirmName"
                v-model="typedName"
                type="text"
                class="form-input"
                :placeholder="targetName"
                autocomplete="off"
                @keydown.enter="handleConfirm"
              />
            </div>

            <p v-if="error" class="error-text" role="alert">{{ error }}</p>
          </div>

          <footer class="modal-footer">
            <button type="button" class="btn-cancel" :disabled="submitting" @click="handleClose">Cancel</button>
            <button type="button" class="btn-delete" :disabled="!canConfirm" @click="handleConfirm">
              <span v-if="submitting" class="btn-spinner"></span>
              <span v-else>{{ confirmLabel }}</span>
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
  max-width: 460px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.1);
}

.modal-decoration {
  height: 6px;
  background: var(--ssi-red, #c23a3a);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 24px 0;
}

.modal-title {
  font-family: 'Noto Sans JP', 'Noto Sans', sans-serif;
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
  background: var(--ssi-red, #c23a3a);
  color: white;
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
}

.delete-target {
  font-weight: 600;
  color: var(--text-primary, #ffffff);
  margin: 0 0 12px;
}

.impact-list {
  margin: 0 0 16px;
  padding-left: 20px;
  color: var(--text-secondary, #b0b0b0);
  font-size: 0.875rem;
  line-height: 1.6;
}

.warning-box {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  background: rgba(194, 58, 58, 0.08);
  border: 1px solid rgba(194, 58, 58, 0.2);
  border-radius: 12px;
  margin-bottom: 16px;
}

.warning-box svg {
  flex-shrink: 0;
  color: var(--ssi-red, #c23a3a);
  margin-top: 2px;
}

.warning-box p {
  font-size: 0.8125rem;
  color: var(--text-secondary, #b0b0b0);
  line-height: 1.5;
  margin: 0;
  font-weight: 600;
}

.form-group {
  margin-bottom: 4px;
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary, #b0b0b0);
  margin-bottom: 8px;
}

.form-input {
  width: 100%;
  padding: 14px 16px;
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 12px;
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 0.9375rem;
  min-height: 48px;
}

.form-input:focus {
  outline: none;
  border-color: var(--ssi-red, #c23a3a);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

.error-text {
  margin: 12px 0 0;
  font-size: 0.8125rem;
  color: var(--ssi-red-light, #e54545);
}

.modal-footer {
  display: flex;
  gap: 12px;
  padding: 0 24px 24px;
}

.btn-cancel,
.btn-delete {
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

.btn-cancel:hover:not(:disabled) {
  background: var(--bg-elevated, #333333);
}

.btn-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-delete {
  background: var(--ssi-red, #c23a3a);
  border: none;
  color: white;
}

.btn-delete:hover:not(:disabled) {
  background: var(--ssi-red-light, #e54545);
  transform: translateY(-2px);
}

.btn-delete:disabled {
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
  .modal { margin: 16px; }
  .form-input, .btn-cancel, .btn-delete { min-height: 52px; }
}
</style>
