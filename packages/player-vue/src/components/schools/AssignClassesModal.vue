<script setup lang="ts">
// AssignClassesModal — "which classes does this teacher take?", the
// people-first counterpart to ClassDetail's Teachers rail.
//
// ONE control for assign AND reassign: every class in the school is a
// checkbox, the ones the teacher already teaches are pre-ticked, and confirm
// applies the diff. Moving a teacher from 6B to 7A is one untick, one tick,
// one Save. Structure/styling follows ConfirmDeleteModal.vue so this reads as
// the same product.
import { ref, computed, watch } from 'vue'
import type { AssignableClass, AssignmentOutcome } from '@/composables/schools/assignTeacherClasses'

const props = defineProps<{
  isOpen: boolean
  teacherName: string
  classes: AssignableClass[]
  loading?: boolean
  /** Why the class list couldn't be loaded — an empty list and a broken list must never look alike. */
  loadError?: string
  submitting?: boolean
  /** Per-class result of the last Save; failures stay on screen. */
  outcomes?: AssignmentOutcome[]
  summary?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm', tickedClassIds: string[]): void
}>()

const ticked = ref<string[]>([])

function resetTicks() {
  ticked.value = props.classes.filter(c => c.isMember).map(c => c.id)
}

// Re-seed on open AND whenever the class list changes underneath (a refetch
// after a partial save must leave the boxes showing what is actually true).
watch(() => props.isOpen, open => { if (open) resetTicks() }, { immediate: true })
watch(() => props.classes, () => { if (props.isOpen) resetTicks() })

const currentIds = computed(() => props.classes.filter(c => c.isMember).map(c => c.id))

const changeCount = computed(() => {
  const current = new Set(currentIds.value)
  const next = new Set(ticked.value)
  let n = 0
  for (const id of next) if (!current.has(id)) n++
  for (const id of current) if (!next.has(id)) n++
  return n
})

const failures = computed(() => (props.outcomes ?? []).filter(o => !o.ok))

function toggle(classId: string) {
  if (props.submitting) return
  const i = ticked.value.indexOf(classId)
  if (i === -1) ticked.value.push(classId)
  else ticked.value.splice(i, 1)
}

function handleClose() {
  if (props.submitting) return
  emit('close')
}

function handleOverlayClick(e: MouseEvent) {
  if (e.target === e.currentTarget) handleClose()
}

function handleConfirm() {
  if (props.submitting || changeCount.value === 0) return
  emit('confirm', [...ticked.value])
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="modal-overlay" data-walk="assign-classes-modal" @click="handleOverlayClick" @keydown.escape="handleClose">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="assign-modal-title">
          <header class="modal-header">
            <h2 id="assign-modal-title" class="modal-title">Assign {{ teacherName }} to classes</h2>
            <button class="modal-close" type="button" aria-label="Cancel" @click="handleClose">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>

          <div class="modal-body">
            <p class="modal-lede">
              Tick every class {{ teacherName }} should teach. Unticking a class they teach now takes
              them off it — so a move is one change here, not two.
            </p>

            <p v-if="loadError" class="error-text" role="alert">{{ loadError }}</p>
            <p v-else-if="loading" class="modal-note">Loading your classes…</p>
            <p v-else-if="!classes.length" class="modal-note">
              No classes in this school yet. Create a class first, then come back and staff it.
            </p>

            <ul v-else class="class-list" data-walk="assign-classes-list">
              <li v-for="c in classes" :key="c.id" class="class-row">
                <label class="class-label">
                  <input
                    type="checkbox"
                    :checked="ticked.includes(c.id)"
                    :disabled="submitting"
                    @change="toggle(c.id)"
                  />
                  <span class="class-name">{{ c.class_name }}</span>
                  <span v-if="!c.hasActiveTeacher" class="class-tag">no teacher yet — they'd lead it</span>
                  <span v-else-if="!c.isMember" class="class-tag class-tag-quiet">joins as co-teacher</span>
                </label>
              </li>
            </ul>

            <div v-if="summary" class="result-block" role="status">
              <p class="result-summary" :class="{ 'has-failures': failures.length }">{{ summary }}</p>
              <ul v-if="failures.length" class="failure-list">
                <li v-for="f in failures" :key="f.classId + f.action" class="failure-row">
                  <strong>{{ f.className }}</strong>
                  — could not {{ f.action === 'add' ? 'add' : 'remove' }} {{ teacherName }}:
                  <span class="failure-reason">{{ f.error }}</span>
                </li>
              </ul>
            </div>
          </div>

          <footer class="modal-footer">
            <button type="button" class="btn-cancel" :disabled="submitting" @click="handleClose">
              {{ summary && !failures.length ? 'Done' : 'Cancel' }}
            </button>
            <button
              type="button"
              class="btn-save"
              data-walk="assign-classes-save"
              :disabled="submitting || changeCount === 0"
              @click="handleConfirm"
            >
              {{ submitting ? 'Saving…' : (changeCount ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'}` : 'Save') }}
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
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 1000;
}

.modal {
  background: var(--schools-surface, #fff);
  border-radius: 14px;
  width: 100%;
  max-width: 520px;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22);
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 20px 12px;
  border-bottom: 1px solid var(--schools-border, #e5e1db);
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  color: var(--schools-fg-2, #666);
  cursor: pointer;
  padding: 4px;
  line-height: 0;
}

.modal-body {
  padding: 16px 20px;
  overflow-y: auto;
}

.modal-lede {
  font-size: 13px;
  color: var(--schools-fg-2, #555);
  line-height: 1.5;
  margin: 0 0 12px;
}

.modal-note {
  font-size: 13px;
  color: var(--schools-fg-2, #555);
}

.class-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.class-row + .class-row { border-top: 1px solid var(--schools-border, #eee); }

.class-label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 4px;
  cursor: pointer;
  font-size: 14px;
}

.class-name { font-weight: 600; }

.class-tag {
  font-size: 11.5px;
  color: #7a5418;
  background: #fdf6df;
  border-radius: 4px;
  padding: 2px 6px;
}

.class-tag-quiet {
  color: var(--schools-fg-2, #666);
  background: var(--schools-bg-2, #f2efea);
}

.result-block { margin-top: 14px; }

.result-summary {
  font-size: 13px;
  margin: 0 0 6px;
  color: var(--schools-success, #1f7a44);
}

.result-summary.has-failures { color: var(--schools-red-deep, #a3130d); }

.failure-list {
  list-style: none;
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--schools-red, #db1e17);
  background: #fdeceb;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.failure-row {
  font-size: 12.5px;
  color: var(--schools-red-deep, #a3130d);
  line-height: 1.45;
}

.failure-reason { font-style: italic; }

.error-text {
  font-size: 13px;
  color: var(--schools-red-deep, #a3130d);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--schools-border, #e5e1db);
}

.btn-cancel,
.btn-save {
  font: inherit;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
}

.btn-cancel {
  background: none;
  border: 1px solid var(--schools-border, #d8d3cc);
  color: var(--schools-fg-2, #555);
}

.btn-save {
  background: var(--schools-accent, #1c3666);
  border: 1px solid var(--schools-accent, #1c3666);
  color: #fff;
  font-weight: 600;
}

.btn-save:disabled,
.btn-cancel:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-enter-active, .modal-leave-active { transition: opacity 0.18s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
