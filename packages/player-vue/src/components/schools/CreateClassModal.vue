<script setup>
import { ref, watch, computed, onMounted } from 'vue'
import { getSchoolsClient } from '@/composables/schools/client'
import { isDemoMode } from '@/composables/demo/demoMode'
import LanguageFlag from './shared/LanguageFlag.vue'

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  // Owned by the parent (it performs the async create). Keeps the button
  // disabled for the WHOLE in-flight write so a second tap can't queue a
  // duplicate class — the old local flag reset synchronously, before the
  // parent's Supabase insert had even started.
  submitting: {
    type: Boolean,
    default: false
  },
  // Optional override of the selectable courses. On a school's free TRIAL this
  // is the ONE signed-up language ([{ code, name, flag? }]); a paid school gets
  // the full list. null/empty = use the default catalogue.
  availableCourses: {
    type: Array,
    default: null
  },
  // Shown under a locked (single-course) picker, e.g. "Subscribe to teach more".
  lockedNote: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'create'])

// Form state
const className = ref('')
const courseCode = ref('')

// Full live+beta course catalogue, fetched from the same `courses` table the
// learner app's CourseSelector queries \u2014 a class can teach ANY of the ~74
// catalogue courses, not a hardcoded shortlist (docs/schools/group-commercial-model.md).
const catalogueCourses = ref([])
const isLoadingCatalogue = ref(false)
const catalogueError = ref('')

// Small fallback list for demo mode / offline, so the picker still works
// without a live Supabase catalogue query. Codes must exist in `courses` —
// the old cym_for_eng_north/south, spa_for_eng_latam and glv_for_eng entries
// matched no course row, so classes created from this fallback were born
// unplayable (2026-07-16).
const DEMO_COURSES = [
  { code: 'cym_n_for_eng', name: 'Welsh (Northern)' },
  { code: 'cym_s_for_eng', name: 'Welsh (Southern)' },
  { code: 'spa_for_eng', name: 'Spanish' },
  { code: 'nld_for_eng', name: 'Dutch' },
  { code: 'cor_for_eng', name: 'Cornish' }
]

async function fetchCatalogue() {
  if (isDemoMode.value) {
    catalogueCourses.value = DEMO_COURSES
    return
  }
  if (catalogueCourses.value.length || isLoadingCatalogue.value) return
  isLoadingCatalogue.value = true
  catalogueError.value = ''
  try {
    const client = getSchoolsClient()
    const { data, error } = await client
      .from('courses')
      .select('course_code, display_name')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')
    if (error) throw error
    catalogueCourses.value = (data || []).map((c) => ({ code: c.course_code, name: c.display_name || c.course_code }))
  } catch (err) {
    console.error('[CreateClassModal] Failed to load course catalogue:', err)
    catalogueError.value = 'Could not load the course catalogue.'
    catalogueCourses.value = DEMO_COURSES
  } finally {
    isLoadingCatalogue.value = false
  }
}

onMounted(fetchCatalogue)
watch(() => props.isOpen, (newVal) => {
  if (newVal) fetchCatalogue()
})

// The selectable list: a parent-supplied override (trial lock) or the full catalogue.
const courseList = computed(() =>
  (props.availableCourses && props.availableCourses.length) ? props.availableCourses : catalogueCourses.value
)
const courseLocked = computed(() => courseList.value.length === 1)

// Type-ahead filter over the catalogue \u2014 needed once the list is ~74 items.
const courseSearch = ref('')
const isCourseListOpen = ref(false)
const filteredCourses = computed(() => {
  const q = courseSearch.value.trim().toLowerCase()
  if (!q) return courseList.value
  return courseList.value.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q))
})
const selectedCourse = computed(() => courseList.value.find((c) => c.code === courseCode.value) || null)

function selectCourse(course) {
  courseCode.value = course.code
  courseSearch.value = ''
  isCourseListOpen.value = false
}

// Reset form when modal opens/closes. On open, preselect the only option when
// the list is locked to a single course (the trial language).
watch(() => props.isOpen, (newVal) => {
  courseSearch.value = ''
  isCourseListOpen.value = false
  if (newVal) {
    className.value = ''
    courseCode.value = courseLocked.value ? courseList.value[0].code : ''
  } else {
    className.value = ''
    courseCode.value = ''
  }
})

// The locked trial course can resolve AFTER the modal opens (school data loads
// async), so the isOpen watch above may run while the list is still the default
// (unlocked) and leave courseCode ''. Re-preselect whenever the list settles to
// a single locked course — otherwise the Create button stays permanently
// disabled even though the course is shown as locked.
watch(courseList, (list) => {
  if (props.isOpen && courseLocked.value && list.length) {
    courseCode.value = list[0].code
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

const handleSubmit = () => {
  if (!className.value.trim() || !courseCode.value) {
    return
  }
  // Re-entry guard: ignore taps while the parent's create is in flight.
  if (props.submitting) {
    return
  }
  emit('create', {
    class_name: className.value.trim(),
    course_code: courseCode.value,
  })
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
              <!-- Trial: locked to the one signed-up language. -->
              <template v-if="courseLocked">
                <p class="form-locked"><LanguageFlag :code="courseList[0].code" :size="18" /> {{ courseList[0].name }}</p>
                <p v-if="lockedNote" class="form-hint">{{ lockedNote }}</p>
              </template>
              <!-- Full catalogue (~74 courses): searchable type-ahead, not a plain <select>. -->
              <div v-else class="course-picker">
                <button
                  v-if="selectedCourse && !isCourseListOpen"
                  id="courseCode"
                  type="button"
                  class="course-picker-selected"
                  @click="isCourseListOpen = true"
                >
                  <LanguageFlag :code="selectedCourse.code" :size="18" />
                  <span>{{ selectedCourse.name }}</span>
                  <span class="course-picker-change">Change</span>
                </button>
                <input
                  v-else
                  id="courseCode"
                  v-model="courseSearch"
                  type="text"
                  class="form-input"
                  :placeholder="isLoadingCatalogue ? 'Loading courses…' : 'Search courses…'"
                  autocomplete="off"
                  :disabled="isLoadingCatalogue"
                  required
                  @focus="isCourseListOpen = true"
                  @blur="isCourseListOpen = false"
                />
                <ul v-if="isCourseListOpen" class="course-picker-list">
                  <li v-for="course in filteredCourses" :key="course.code">
                    <button type="button" class="course-picker-option" @mousedown.prevent="selectCourse(course)">
                      <LanguageFlag :code="course.code" :size="18" />
                      <span>{{ course.name }}</span>
                    </button>
                  </li>
                  <li v-if="filteredCourses.length === 0" class="course-picker-empty">
                    No courses match "{{ courseSearch }}"
                  </li>
                </ul>
                <p v-if="catalogueError" class="form-hint">{{ catalogueError }}</p>
              </div>
            </div>

            <div class="info-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/>
                <path d="M12 8h.01"/>
              </svg>
              <p>A unique invite link will be generated automatically. Students click it to join your class.</p>
            </div>
          </form>

          <footer class="modal-footer">
            <button type="button" class="btn-cancel" @click="handleClose">
              Cancel
            </button>
            <button
              type="submit"
              class="btn-create"
              :disabled="!className.trim() || !courseCode || submitting"
              @click="handleSubmit"
            >
              <span v-if="submitting" class="btn-spinner"></span>
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

.form-locked {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  font-weight: 600;
  color: var(--text-primary, #fff);
  display: flex;
  align-items: center;
  gap: 8px;
}

.course-picker {
  position: relative;
}

.course-picker-selected {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  background: var(--bg-secondary, #1a1a1a);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 12px;
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 0.9375rem;
  min-height: 48px;
  cursor: pointer;
  text-align: left;
}

.course-picker-selected span:first-of-type {
  flex: 1;
}

.course-picker-change {
  font-size: 0.75rem;
  color: var(--text-muted, #707070);
  font-weight: 500;
}

.course-picker-list {
  position: absolute;
  z-index: 10;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  margin: 0;
  padding: 6px;
  list-style: none;
  background: var(--bg-card, #242424);
  border: 1px solid var(--border-subtle, rgba(255,255,255,0.08));
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
}

.course-picker-option {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: none;
  border: none;
  border-radius: 8px;
  color: var(--text-primary, #ffffff);
  font-family: inherit;
  font-size: 0.875rem;
  text-align: left;
  cursor: pointer;
}

.course-picker-option:hover {
  background: var(--bg-secondary, #1a1a1a);
}

.course-picker-empty {
  padding: 10px 12px;
  color: var(--text-muted, #707070);
  font-size: 0.8125rem;
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
