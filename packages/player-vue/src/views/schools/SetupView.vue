<script setup lang="ts">
/**
 * SetupView — first-time school onboarding wizard.
 *
 * Four-step admin flow that lands at /schools/setup. Renders inside
 * SchoolsContainer (.schools-surface) so it picks up the 2026-05
 * design system (--schools-* tokens, .schools-card, .btn-play,
 * Arsenal display font).
 *
 * Persistence wiring:
 *   1. School         — UPDATE schools.school_name / region_code (live)
 *   2. Add staff      — share the teacher/admin invite link (live codes); bulk
 *                       email-invite endpoint TBD (not wired)
 *   3. Choose courses — local selection that filters Step 4's course list;
 *                       does NOT grant access (the course list itself comes
 *                       from the full catalogue/trial-lock model below)
 *   4. Create classes — useClassesData.createClass (live)
 *
 * Course sourcing: schools no longer hold per-course `entitlement_grants`
 * rows (superseded 2026-07-15, docs/schools/group-commercial-model.md
 * "Student entitlement — FINAL model") — a subscribed school gets the full
 * live catalogue, a trial school is locked to its one trial_course_code.
 * Steps 3/4 read from useSchoolCourseCatalogue, the SAME source
 * TeacherDashboard/CreateClassModal use, so this wizard can never show a
 * different (stale, entitlement_grants-based) course list than the rest of
 * the school's dashboard (2026-07-16 fix — the dropdown was empty because
 * it was the only surface still reading the superseded model).
 */
import { ref, computed, inject, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { useClassesData, type ClassInfo } from '@/composables/schools/useClassesData'
import { useSchoolCourseCatalogue, type CatalogueCourse } from '@/composables/schools/useSchoolCourseCatalogue'
import { useTeachersData } from '@/composables/schools/useTeachersData'
import { getLanguageName } from '@/composables/useI18n'
import { courseShortName } from '@ssi/core'
import InviteLinkField from '@/components/schools/shared/InviteLinkField.vue'

const router = useRouter()
const supabase = inject('supabase', ref(null)) as any
const { currentUser } = useSchoolContext()
const { activeSchool, currentSchool, fetchSchools } = useSchoolData()
const { classes, fetchClasses, createClass, error: classesError } = useClassesData()
const { availableCourses: effectiveCourseGrants, fetchCatalogue, loadSchoolPlatformState } = useSchoolCourseCatalogue()
const { teachers, fetchTeachers } = useTeachersData()

interface Step {
  n: 1 | 2 | 3 | 4
  title: string
  desc: string
}

const STEPS: Step[] = [
  { n: 1, title: 'Your school', desc: 'Name and region.' },
  { n: 2, title: 'Add staff', desc: 'Share your teacher invite link.' },
  { n: 3, title: 'Choose courses', desc: 'Pick which languages to use for classes.' },
  { n: 4, title: 'Create classes', desc: 'Set up your first classes.' },
]

const step = ref<1 | 2 | 3 | 4>(1)
const isVisible = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)

// ---------------------------------------------------------------
// Step 1 — School profile
// ---------------------------------------------------------------
const schoolName = ref('')
const schoolRegion = ref('')
const isSavingSchool = ref(false)

function hydrateSchoolForm() {
  const school = activeSchool.value || currentSchool.value
  schoolName.value = school?.school_name || currentUser.value?.school_name || ''
  schoolRegion.value = school?.region_code || currentUser.value?.region_code || ''
}

const isStep1Valid = computed(() => schoolName.value.trim().length > 0)

async function saveSchool(): Promise<boolean> {
  if (!isStep1Valid.value) {
    error.value = 'School name is required'
    return false
  }
  const school = activeSchool.value || currentSchool.value
  if (!school?.id) {
    error.value = 'No school context — try signing back in.'
    return false
  }
  isSavingSchool.value = true
  error.value = null
  try {
    // The org tables' authenticated UPDATE grant is revoked (see CLAUDE.md
    // RLS section) — a direct client `schools.update()` 403s here, which
    // blocked step 1 of the entire self-serve setup wizard (finding #2b/#5,
    // 2026-07-13 audit). Routed through a caller-scoped server endpoint.
    if (!supabase.value) throw new Error('Not signed in')
    const { data: { session } } = await supabase.value.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Not signed in')
    const res = await fetch('/api/school/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        school_name: schoolName.value.trim(),
        region_code: schoolRegion.value.trim() || undefined,
        // Typing the name here IS the confirmation — otherwise a leader who
        // completes the wizard is still shown the "Confirm your school's name"
        // first-run card afterwards, asking for something she has just done.
        name_confirmed: true,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error || 'Failed to save school')
    await fetchSchools()
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save school'
    return false
  } finally {
    isSavingSchool.value = false
  }
}

// ---------------------------------------------------------------
// Step 2 — Add staff (share the teacher invite link; bulk email-invite TBD)
// ---------------------------------------------------------------
const teacherJoinCode = computed(() => {
  const school = activeSchool.value || currentSchool.value
  return school?.teacher_join_code || ''
})

const adminJoinCode = computed(() => {
  const school = activeSchool.value || currentSchool.value
  return school?.admin_join_code || ''
})

// Same /redeem/:code door as every other invite in the app.
function inviteUrl(code: string): string {
  return `${window.location.origin}/redeem/${code}`
}

// Step 2 is always "valid" — staff invites are optional.

// ---------------------------------------------------------------
// Step 3 — Choose which available courses to use for classes
//          (a filter for Step 4 — does NOT grant access)
// ---------------------------------------------------------------
const selectedCourses = ref<Set<string>>(new Set())

function toggleCourse(code: string) {
  if (selectedCourses.value.has(code)) selectedCourses.value.delete(code)
  else selectedCourses.value.add(code)
  // Reactive copy so Vue picks up Set mutation
  selectedCourses.value = new Set(selectedCourses.value)
}

function courseDisplayName(grant: CatalogueCourse): string {
  if (grant.display_name && grant.display_name !== grant.course_code) {
    return grant.display_name
  }
  const match = grant.course_code.match(/^([a-z_]+?)_for_([a-z]+)/i)
  if (match) {
    const [, target, known] = match
    return `${getLanguageName(target.replace(/_.*$/, ''))} for ${getLanguageName(known)} speakers`
  }
  return grant.course_code
}

const isStep3Valid = computed(() => selectedCourses.value.size > 0 || effectiveCourseGrants.value.length === 0)

// ---------------------------------------------------------------
// Step 4 — Create classes
// ---------------------------------------------------------------
interface DraftClass {
  class_name: string
  course_code: string
  saved: boolean
  savedId?: string
  joinCode?: string
}

const draftClasses = ref<DraftClass[]>([
  { class_name: '', course_code: '', saved: false },
])

function addClassRow() {
  draftClasses.value.push({ class_name: '', course_code: '', saved: false })
}

function removeClassRow(index: number) {
  draftClasses.value.splice(index, 1)
}

const isStep4Valid = computed(() =>
  draftClasses.value.some(c => c.class_name.trim() && c.course_code) ||
  classes.value.length > 0,
)

const availableCoursesForClass = computed<CatalogueCourse[]>(() => {
  if (selectedCourses.value.size === 0) return effectiveCourseGrants.value
  return effectiveCourseGrants.value.filter(g => selectedCourses.value.has(g.course_code))
})

async function persistClasses(): Promise<boolean> {
  const school = activeSchool.value || currentSchool.value
  if (!school?.id) {
    error.value = 'No school context — try signing back in.'
    return false
  }
  error.value = null
  let allOk = true
  for (const draft of draftClasses.value) {
    if (draft.saved) continue
    if (!draft.class_name.trim() || !draft.course_code) continue
    const created: ClassInfo | null = await createClass({
      class_name: draft.class_name.trim(),
      course_code: draft.course_code,
      school_id: school.id,
    })
    if (created) {
      draft.saved = true
      draft.savedId = created.id
      draft.joinCode = created.student_join_code
    } else {
      allOk = false
      // useClassesData's createClass sets its OWN error ref on failure —
      // surface it here rather than silently staying on the step with no
      // visible feedback (finding #10, 2026-07-13 audit).
      error.value = classesError.value || `Failed to create class "${draft.class_name}"`
    }
  }
  return allOk
}

// ---------------------------------------------------------------
// Step navigation
// ---------------------------------------------------------------
const canAdvance = computed(() => {
  if (step.value === 1) return isStep1Valid.value && !isSavingSchool.value
  if (step.value === 3) return isStep3Valid.value
  if (step.value === 4) return isStep4Valid.value
  return true
})

async function handleContinue() {
  error.value = null
  successMessage.value = null
  if (step.value === 1) {
    const ok = await saveSchool()
    if (!ok) return
  }
  if (step.value === 4) {
    const ok = await persistClasses()
    if (!ok) return
    successMessage.value = 'Setup complete'
    router.push('/schools')
    return
  }
  step.value = (step.value + 1) as 1 | 2 | 3 | 4
}

function handleBack() {
  if (step.value === 1) return
  step.value = (step.value - 1) as 1 | 2 | 3 | 4
  error.value = null
}

async function jumpToStep(n: 1 | 2 | 3 | 4) {
  if (n === step.value) return
  if (n > step.value && step.value === 1) {
    const ok = await saveSchool()
    if (!ok) return
  }
  step.value = n
  error.value = null
}

async function handleSaveExit() {
  if (step.value === 1) {
    const ok = await saveSchool()
    if (!ok) return
  }
  if (step.value === 4) {
    await persistClasses()
  }
  router.push('/schools')
}

// ---------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------
watch(currentUser, async (user) => {
  if (!user) return
  await fetchSchools()
  hydrateSchoolForm()
  await loadSchoolPlatformState(supabase)
  if (user.school_id) {
    await Promise.all([
      fetchCatalogue(),
      fetchClasses(),
      fetchTeachers(user.school_id),
    ])
  }
}, { immediate: true })

watch([activeSchool, currentSchool], () => {
  hydrateSchoolForm()
})

onMounted(() => {
  setTimeout(() => { isVisible.value = true }, 50)
})
</script>

<template>
  <main class="setup-screen" :class="{ 'is-visible': isVisible }">
    <nav class="breadcrumb">
      <router-link to="/schools/settings">Settings</router-link>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">First-time setup</span>
    </nav>

    <header class="setup-header">
      <h1 class="arsenal page-title">Let's get your school set up.</h1>
      <p class="setup-lede">
        Four steps. About ten minutes. You can come back and finish any time —
        we'll keep your place.
      </p>
    </header>

    <div class="setup-layout">
      <aside class="schools-card step-rail">
        <button
          v-for="s in STEPS"
          :key="s.n"
          type="button"
          class="step-rail-item"
          :class="{
            'is-active': s.n === step,
            'is-done': s.n < step,
          }"
          @click="jumpToStep(s.n)"
        >
          <span class="step-rail-dot">
            <svg v-if="s.n < step" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <template v-else>{{ s.n }}</template>
          </span>
          <span class="step-rail-text">
            <span class="step-rail-title">{{ s.title }}</span>
            <span class="step-rail-desc">{{ s.desc }}</span>
          </span>
        </button>
      </aside>

      <div class="schools-card schools-card-pad step-panel">
        <!-- Step 1: School profile -->
        <section v-if="step === 1" class="step-section">
          <h2 class="arsenal step-title">Your school</h2>
          <div class="form-stack">
            <label class="field">
              <span class="field-label">School name</span>
              <input
                v-model="schoolName"
                type="text"
                class="field-input"
                placeholder="e.g. Ysgol Bro Banw"
                autocomplete="organization"
              />
            </label>
            <label class="field">
              <span class="field-label">Region</span>
              <input
                v-model="schoolRegion"
                type="text"
                class="field-input"
                placeholder="Region"
                autocomplete="address-level1"
              />
            </label>
          </div>
        </section>

        <!-- Step 2: Add staff -->
        <section v-else-if="step === 2" class="step-section">
          <h2 class="arsenal step-title">Add your teachers</h2>
          <p class="step-lede">
            Share this invite link however you reach your staff — Teams, WhatsApp,
            in person. Clicking it signs them straight in. Anyone can teach: the
            app does the teaching, so a teacher doesn't need to speak the language.
          </p>

          <div v-if="teacherJoinCode" class="join-code-callout">
            <InviteLinkField label="Teacher invite link" :url="inviteUrl(teacherJoinCode)" />
            <InviteLinkField v-if="adminJoinCode" label="Admin invite link" :url="inviteUrl(adminJoinCode)" />
          </div>
          <div v-else class="empty-state">
            Your invite links will appear here once your school is saved.
          </div>

          <div v-if="teachers.length > 0" class="existing-staff">
            <div class="schools-kicker">Already on the team</div>
            <ul class="existing-staff-list">
              <li v-for="t in teachers" :key="t.user_id">
                <span class="existing-staff-name">{{ t.display_name }}</span>
                <span class="existing-staff-meta">{{ t.class_count }} class{{ t.class_count === 1 ? '' : 'es' }}</span>
              </li>
            </ul>
          </div>
        </section>

        <!-- Step 3: Choose courses -->
        <section v-else-if="step === 3" class="step-section">
          <h2 class="arsenal step-title">Choose courses</h2>
          <p class="step-lede">
            Pick which of your school's available courses you'll use for classes.
            This just narrows the list you choose from in the next step — it doesn't
            change who has access.
          </p>

          <div v-if="effectiveCourseGrants.length === 0" class="empty-state">
            Your school doesn't have any courses available yet — get in touch with us
            and we'll sort it out. You can continue and add classes once courses are available.
          </div>

          <div v-else class="course-grid">
            <label
              v-for="grant in effectiveCourseGrants"
              :key="grant.course_code"
              class="course-tile"
              :class="{ 'is-selected': selectedCourses.has(grant.course_code) }"
            >
              <input
                type="checkbox"
                class="course-tile-check"
                :checked="selectedCourses.has(grant.course_code)"
                @change="toggleCourse(grant.course_code)"
              />
              <div class="course-tile-body">
                <div class="course-tile-name">{{ courseDisplayName(grant) }}</div>
                <div class="course-tile-meta">
                  <span class="course-tile-code">{{ grant.course_code }}</span>
                </div>
              </div>
            </label>
          </div>
        </section>

        <!-- Step 4: Create classes -->
        <section v-else-if="step === 4" class="step-section">
          <h2 class="arsenal step-title">Create classes</h2>
          <p class="step-lede">
            Name your first classes and pick a course for each. You can add
            students from each class page whenever you're ready.
          </p>

          <div v-if="classes.length > 0" class="existing-classes">
            <div class="schools-kicker">Existing classes</div>
            <table class="ssi-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Course</th>
                  <th>Students</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cls in classes" :key="cls.id">
                  <td class="ssi-table-strong">{{ cls.class_name }}</td>
                  <td>{{ courseShortName(cls.course_code) }}</td>
                  <td>{{ cls.student_count }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div v-if="availableCoursesForClass.length === 0" class="empty-state">
            No courses to choose from yet —
            <button type="button" class="empty-state-link" @click="jumpToStep(3)">go back to Choose courses</button>
            to pick which ones to use, or get in touch with us if your school has none available.
          </div>

          <div v-else class="class-draft-list">
            <div
              v-for="(draft, i) in draftClasses"
              :key="i"
              class="class-draft-row"
              :class="{ 'is-saved': draft.saved }"
            >
              <input
                v-model="draft.class_name"
                type="text"
                class="field-input field-input-flex"
                placeholder="Class name"
                :disabled="draft.saved"
              />
              <span class="select-wrap field-input-flex">
                <select
                  v-model="draft.course_code"
                  class="field-input field-select"
                  :disabled="draft.saved"
                >
                  <option value="" disabled>Choose course</option>
                  <option
                    v-for="g in availableCoursesForClass"
                    :key="g.course_code"
                    :value="g.course_code"
                  >
                    {{ courseDisplayName(g) }}
                  </option>
                </select>
              </span>
              <span v-if="draft.saved" class="class-draft-saved">Added&nbsp;✓</span>
              <button
                v-else
                type="button"
                class="icon-btn"
                aria-label="Remove class"
                @click="removeClassRow(i)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              </button>
            </div>
            <button type="button" class="btn-ghost btn-add" @click="addClassRow">
              + Add another class
            </button>
          </div>
        </section>

        <div v-if="error" class="setup-error" role="alert">{{ error }}</div>
        <div v-if="successMessage" class="setup-success">{{ successMessage }}</div>

        <footer class="step-nav">
          <button
            type="button"
            class="btn-ghost"
            :disabled="step === 1"
            @click="handleBack"
          >
            <span aria-hidden="true">&larr;</span> Back
          </button>
          <div class="step-nav-right">
            <button type="button" class="btn-ghost" @click="handleSaveExit">
              Save &amp; exit
            </button>
            <button
              type="button"
              class="btn-play"
              :disabled="!canAdvance"
              @click="handleContinue"
            >
              <template v-if="step < 4">Continue <span aria-hidden="true">&rarr;</span></template>
              <template v-else>Finish setup <span aria-hidden="true">&rarr;</span></template>
            </button>
          </div>
        </footer>
      </div>
    </div>
  </main>
</template>

<style scoped>
.setup-screen {
  padding: 22px 28px 32px;
  max-width: 1080px;
  margin: 0 auto;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 320ms ease-out, transform 320ms ease-out;
}

.setup-screen.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--schools-fg-3);
  margin-bottom: 12px;
}

.breadcrumb a {
  color: inherit;
  text-decoration: none;
  transition: color 160ms ease-out;
}

.breadcrumb a:hover {
  color: var(--schools-red);
}

.breadcrumb-sep {
  opacity: 0.4;
}

.breadcrumb-current {
  color: var(--schools-fg);
  font-weight: 500;
}

.setup-header {
  margin-bottom: 18px;
  max-width: 640px;
}

.page-title {
  font-size: clamp(28px, 3vw, 36px);
  line-height: 1.05;
  margin: 0 0 8px;
}

.setup-lede {
  font-size: 14.5px;
  color: var(--schools-fg-2);
  line-height: 1.55;
  margin: 0;
  max-width: 56ch;
}

.setup-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 18px;
  align-items: start;
}

.step-rail {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 70px;
}

.step-rail-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 6px;
  color: var(--schools-fg);
  font-family: var(--font-body);
  transition: background 120ms ease-out, color 120ms ease-out;
}

.step-rail-item:hover {
  background: var(--schools-bg);
}

.step-rail-item.is-active {
  background: var(--schools-bg);
}

.step-rail-dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex: none;
  background: rgba(15, 18, 18, 0.08);
  color: var(--schools-fg-3);
  transition: background 200ms ease-out, color 200ms ease-out;
}

.step-rail-item.is-active .step-rail-dot {
  background: var(--schools-red);
  color: #fff;
}

.step-rail-item.is-done .step-rail-dot {
  background: var(--schools-success);
  color: #fff;
}

.step-rail-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.step-rail-title {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--schools-fg);
  transition: color 200ms ease-out;
}

.step-rail-item.is-active .step-rail-title {
  color: var(--schools-red);
}

.step-rail-desc {
  font-size: 11.5px;
  color: var(--schools-fg-3);
  line-height: 1.4;
}

.step-panel {
  max-width: 760px;
  min-height: 420px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.step-section {
  flex: 1;
}

.step-title {
  font-size: 22px;
  margin: 0 0 14px;
}

.step-lede {
  font-size: 13.5px;
  color: var(--schools-fg-2);
  line-height: 1.55;
  margin: 0 0 18px;
  max-width: 52ch;
}

.step-hint {
  font-size: 12.5px;
  color: var(--schools-fg-3);
  margin: 12px 0 0;
}

.form-stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--schools-fg);
}

.field-input {
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--schools-border-strong);
  border-radius: 8px;
  background: #fff;
  color: var(--schools-fg);
  font-family: var(--font-body);
  transition: border-color 160ms ease-out, box-shadow 160ms ease-out;
}

.field-input::placeholder {
  color: var(--schools-fg-3);
}

.field-input:focus {
  outline: none;
  border-color: var(--schools-red);
  box-shadow: 0 0 0 3px rgba(219, 30, 23, 0.12);
}

.field-input:disabled {
  background: #fafaf6;
  color: var(--schools-fg-3);
  cursor: not-allowed;
}

.field-input-flex {
  flex: 1;
  min-width: 0;
}

.select-wrap {
  position: relative;
  display: flex;
}

.field-select {
  /* Inherits .field-input; real <select> semantics for free keyboard/screen-
     reader support — only the chrome is swapped for our own chevron. */
  appearance: none;
  width: 100%;
  padding-right: 34px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%232C2622' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  cursor: pointer;
}

.field-select:disabled {
  cursor: not-allowed;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23a8a29a' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
}

/* Step 2 — invites */

.join-code-callout {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 12px 14px;
  background: var(--schools-bg);
  border: 1px solid var(--schools-border);
  border-radius: 8px;
  margin-bottom: 16px;
}

.invite-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.invite-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--schools-border-strong);
  background: transparent;
  color: var(--schools-fg-3);
  cursor: pointer;
  transition: color 160ms ease-out, border-color 160ms ease-out, background 160ms ease-out;
}

.icon-btn:hover {
  color: var(--schools-red);
  border-color: var(--schools-red);
  background: #fff;
}

.btn-add {
  align-self: flex-start;
  margin-top: 4px;
  border-style: dashed;
}

.existing-staff {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid var(--schools-border);
}

.existing-staff-list {
  list-style: none;
  padding: 0;
  margin: 6px 0 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.existing-staff-list li {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 6px 0;
  font-size: 13.5px;
  color: var(--schools-fg);
}

.existing-staff-meta {
  font-size: 12px;
  color: var(--schools-fg-3);
}

/* Step 3 — courses */

.empty-state {
  padding: 18px 20px;
  background: var(--schools-bg);
  border: 1px dashed var(--schools-border-strong);
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--schools-fg-2);
  line-height: 1.5;
}

.empty-state-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-weight: 600;
  color: var(--schools-red);
  text-decoration: underline;
  cursor: pointer;
}

.empty-state-link:focus-visible {
  outline: 2px solid var(--schools-red);
  outline-offset: 2px;
  border-radius: 2px;
}

.course-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.course-tile {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: #fff;
  border: 1px solid var(--schools-border);
  border-radius: 8px;
  cursor: pointer;
  transition: background 160ms ease-out, border-color 160ms ease-out, box-shadow 160ms ease-out;
}

.course-tile:hover {
  border-color: var(--schools-red);
}

.course-tile.is-selected {
  background: var(--schools-pastel);
  border-color: var(--schools-red);
  box-shadow: 0 0 0 1px var(--schools-red);
}

.course-tile-check {
  margin-top: 2px;
  accent-color: var(--schools-red);
}

.course-tile-body {
  min-width: 0;
}

.course-tile-name {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--schools-fg);
  margin-bottom: 4px;
}

.course-tile-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--schools-fg-3);
}

.course-tile-code {
  font-family: var(--font-mono, ui-monospace, monospace);
}

.course-tile-source {
  padding: 2px 8px;
  border-radius: var(--schools-radius-pill);
  background: rgba(15, 18, 18, 0.06);
  font-size: 10.5px;
  font-weight: 500;
}

/* Step 4 — classes */

.existing-classes {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--schools-border);
}

.existing-classes .ssi-table {
  margin-top: 6px;
}

.class-draft-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.class-draft-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.class-draft-row.is-saved .field-input {
  background: rgba(31, 138, 91, 0.06);
  border-color: rgba(31, 138, 91, 0.3);
}

.class-draft-saved {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--schools-success);
  background: rgba(31, 138, 91, 0.1);
  padding: 6px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

/* Feedback */

.setup-error {
  margin-top: 16px;
  padding: 10px 14px;
  background: rgba(219, 30, 23, 0.06);
  border: 1px solid rgba(219, 30, 23, 0.25);
  border-radius: 8px;
  color: var(--schools-red-deep);
  font-size: 13px;
}

.setup-success {
  margin-top: 16px;
  padding: 10px 14px;
  background: rgba(31, 138, 91, 0.1);
  border: 1px solid rgba(31, 138, 91, 0.3);
  border-radius: 8px;
  color: var(--schools-success);
  font-size: 13px;
  font-weight: 600;
}

/* Footer nav */

.step-nav {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-top: 22px;
  padding-top: 16px;
  border-top: 1px solid var(--schools-border);
}

.step-nav-right {
  display: flex;
  gap: 8px;
}

/* Responsive */

@media (max-width: 960px) {
  .setup-screen {
    padding: 20px 16px 32px;
  }

  .setup-layout {
    grid-template-columns: 1fr;
  }

  .step-rail {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    gap: 4px;
  }

  .step-rail-item {
    flex: none;
    padding: 8px 10px;
  }

  .step-rail-desc {
    display: none;
  }

  .course-grid {
    grid-template-columns: 1fr;
  }

  .field-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .step-nav {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .step-nav-right {
    justify-content: space-between;
  }

  .invite-row,
  .class-draft-row {
    flex-wrap: wrap;
  }

  .invite-row .field-input,
  .class-draft-row .field-input {
    flex: 1 0 100%;
  }
}
</style>
