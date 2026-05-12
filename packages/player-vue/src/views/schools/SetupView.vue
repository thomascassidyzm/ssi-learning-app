<script setup lang="ts">
/**
 * SetupView — first-time school onboarding wizard.
 *
 * Four-step admin flow that lands at /schools/setup. Ports Aran Jones's
 * 2026-05-12 design pass into the live schools surface. Renders inside
 * SchoolsContainer so it picks up schools-tokens.css + TopNav + auth.
 *
 * Persistence wiring:
 *   1. School         — UPDATE schools.school_name / region_code (live)
 *   2. Invite staff   — client-side only; bulk-invite endpoint TBD (TODO)
 *   3. Grant courses  — read-only selection over existing entitlement grants
 *                       (TODO: grant-write goes through admin tooling)
 *   4. Create classes — useClassesData.createClass (live)
 */
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { useClassesData, type ClassInfo } from '@/composables/schools/useClassesData'
import { useCourseAccess, type CourseGrant } from '@/composables/schools/useCourseAccess'
import { useTeachersData } from '@/composables/schools/useTeachersData'
import { getSchoolsClient } from '@/composables/schools/client'
import { getLanguageName } from '@/composables/useI18n'

const router = useRouter()
const { currentUser } = useSchoolContext()
const { activeSchool, currentSchool, fetchSchools } = useSchoolData()
const { classes, fetchClasses, createClass } = useClassesData()
const { courseGrants, fetchCourseAccess } = useCourseAccess()
const { teachers, fetchTeachers } = useTeachersData()

interface Step {
  n: 1 | 2 | 3 | 4
  title: string
  desc: string
}

const STEPS: Step[] = [
  { n: 1, title: 'Your school', desc: 'Name, region, contact email.' },
  { n: 2, title: 'Invite staff', desc: 'Add teachers and admins.' },
  { n: 3, title: 'Grant courses', desc: 'Pick which languages students can learn.' },
  { n: 4, title: 'Create classes', desc: 'Group students, generate join codes.' },
]

const step = ref<1 | 2 | 3 | 4>(1)
const isVisible = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)

// ---------------------------------------------------------------
// Step 1 — School profile
// ---------------------------------------------------------------
const schoolName = ref('')
const schoolCity = ref('')
const schoolRegion = ref('')
const adminEmail = ref('')
const isSavingSchool = ref(false)

function hydrateSchoolForm() {
  const school = activeSchool.value || currentSchool.value
  schoolName.value = school?.school_name || currentUser.value?.school_name || ''
  schoolRegion.value = school?.region_code || currentUser.value?.region_code || ''
  adminEmail.value = adminEmail.value || ''
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
    const client = getSchoolsClient()
    const updates: Record<string, unknown> = {
      school_name: schoolName.value.trim(),
    }
    if (schoolRegion.value.trim()) {
      updates.region_code = schoolRegion.value.trim()
    }
    const { error: updateError } = await client
      .from('schools')
      .update(updates)
      .eq('id', school.id)
    if (updateError) throw updateError
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
// Step 2 — Invite staff (client-side state until bulk-invite ships)
// ---------------------------------------------------------------
interface PendingInvite {
  email: string
  role: 'teacher' | 'admin'
}

const invites = ref<PendingInvite[]>([
  { email: '', role: 'teacher' },
  { email: '', role: 'teacher' },
  { email: '', role: 'teacher' },
])

function addInviteRow() {
  invites.value.push({ email: '', role: 'teacher' })
}

function removeInviteRow(index: number) {
  invites.value.splice(index, 1)
}

const validInvites = computed(() =>
  invites.value.filter(i => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim())),
)

const teacherJoinCode = computed(() => {
  const school = activeSchool.value || currentSchool.value
  return school?.teacher_join_code || ''
})

const adminJoinCode = computed(() => {
  const school = activeSchool.value || currentSchool.value
  return school?.admin_join_code || ''
})

// Step 2 is always "valid" — staff invites are optional.

// ---------------------------------------------------------------
// Step 3 — Course selection (read-only over existing grants)
// ---------------------------------------------------------------
const selectedCourses = ref<Set<string>>(new Set())

function toggleCourse(code: string) {
  if (selectedCourses.value.has(code)) selectedCourses.value.delete(code)
  else selectedCourses.value.add(code)
  // Reactive copy so Vue picks up Set mutation
  selectedCourses.value = new Set(selectedCourses.value)
}

function courseDisplayName(grant: CourseGrant): string {
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

const isStep3Valid = computed(() => selectedCourses.value.size > 0 || courseGrants.value.length === 0)

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

const availableCoursesForClass = computed<CourseGrant[]>(() => {
  if (selectedCourses.value.size === 0) return courseGrants.value
  return courseGrants.value.filter(g => selectedCourses.value.has(g.course_code))
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
  if (user.school_id) {
    await Promise.all([
      fetchCourseAccess(user.school_id),
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
  <div class="setup-view" :class="{ 'is-visible': isVisible }">
    <nav class="breadcrumb">
      <router-link to="/schools/settings">Settings</router-link>
      <span class="breadcrumb-sep">/</span>
      <span class="breadcrumb-current">First-time setup</span>
    </nav>

    <header class="setup-header">
      <h1 class="arsenal">Let's get your school set up.</h1>
      <p class="setup-lede">
        Four steps. About ten minutes. You can come back and finish any time —
        we'll keep your place.
      </p>
    </header>

    <div class="setup-grid">
      <FrostCard variant="panel" class="step-rail">
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
      </FrostCard>

      <FrostCard variant="panel" class="step-panel">
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
            <div class="field-row">
              <label class="field">
                <span class="field-label">City</span>
                <input
                  v-model="schoolCity"
                  type="text"
                  class="field-input"
                  placeholder="City"
                  autocomplete="address-level2"
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
            <label class="field">
              <span class="field-label">Admin email</span>
              <input
                v-model="adminEmail"
                type="email"
                class="field-input"
                placeholder="admin@yourschool.org"
                autocomplete="email"
              />
            </label>
          </div>
        </section>

        <!-- Step 2: Invite staff -->
        <section v-else-if="step === 2" class="step-section">
          <h2 class="arsenal step-title">Invite teachers</h2>
          <p class="step-lede">
            Add staff by email — we'll send them a join link.
            You can do this now or skip and add them later.
          </p>

          <div v-if="teacherJoinCode" class="join-code-callout">
            <div class="join-code-label">Or share your school's teacher join code</div>
            <div class="join-code-row">
              <code class="join-code">{{ teacherJoinCode }}</code>
              <span v-if="adminJoinCode" class="join-code-admin">
                Admin code <code class="join-code-inline">{{ adminJoinCode }}</code>
              </span>
            </div>
          </div>

          <div class="invite-list">
            <div
              v-for="(invite, i) in invites"
              :key="i"
              class="invite-row"
            >
              <input
                v-model="invite.email"
                type="email"
                class="field-input field-input-flex"
                :placeholder="i === 0 ? 'teacher@yourschool.org' : 'colleague@yourschool.org'"
                autocomplete="off"
              />
              <select v-model="invite.role" class="field-select">
                <option value="teacher">Teacher</option>
                <option value="admin">Admin</option>
              </select>
              <button
                type="button"
                class="icon-btn"
                aria-label="Remove invite"
                @click="removeInviteRow(i)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="6" y1="18" x2="18" y2="6" />
                </svg>
              </button>
            </div>
            <button type="button" class="ghost-btn ghost-btn-add" @click="addInviteRow">
              + Add another
            </button>
          </div>

          <p v-if="validInvites.length > 0" class="step-hint">
            {{ validInvites.length }} email{{ validInvites.length === 1 ? '' : 's' }} ready —
            invitations will go out when bulk-invite is wired up.
          </p>

          <div v-if="teachers.length > 0" class="existing-staff">
            <div class="existing-staff-label">Already on the team</div>
            <ul class="existing-staff-list">
              <li v-for="t in teachers" :key="t.user_id">
                <span class="existing-staff-name">{{ t.display_name }}</span>
                <span class="existing-staff-meta">{{ t.class_count }} class{{ t.class_count === 1 ? '' : 'es' }}</span>
              </li>
            </ul>
          </div>
        </section>

        <!-- Step 3: Grant courses -->
        <section v-else-if="step === 3" class="step-section">
          <h2 class="arsenal step-title">Grant courses</h2>
          <p class="step-lede">
            Which languages should be available to students at this school?
          </p>

          <div v-if="courseGrants.length === 0" class="empty-state">
            Your school doesn't have any course entitlements yet — get in touch with us
            and we'll grant access. You can continue and add classes once courses are available.
          </div>

          <div v-else class="course-grid">
            <label
              v-for="grant in courseGrants"
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
                  <span v-if="grant.source === 'group'" class="course-tile-source">
                    via {{ grant.source_name || 'group' }}
                  </span>
                </div>
              </div>
            </label>
          </div>
        </section>

        <!-- Step 4: Create classes -->
        <section v-else-if="step === 4" class="step-section">
          <h2 class="arsenal step-title">Create classes</h2>
          <p class="step-lede">
            Each class gets a unique join code students enter to be added.
            You can create more later from the dashboard.
          </p>

          <div v-if="classes.length > 0" class="existing-classes">
            <div class="existing-classes-label">Existing classes</div>
            <table class="ssi-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Course</th>
                  <th>Students</th>
                  <th>Join code</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="cls in classes" :key="cls.id">
                  <td class="ssi-table-strong">{{ cls.class_name }}</td>
                  <td>{{ cls.course_code }}</td>
                  <td>{{ cls.student_count }}</td>
                  <td class="ssi-table-code">{{ cls.student_join_code }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="class-draft-list">
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
              <select
                v-model="draft.course_code"
                class="field-select"
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
              <code v-if="draft.joinCode" class="class-draft-code">{{ draft.joinCode }}</code>
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
            <button type="button" class="ghost-btn ghost-btn-add" @click="addClassRow">
              + Add another class
            </button>
          </div>
        </section>

        <div v-if="error" class="setup-error" role="alert">{{ error }}</div>
        <div v-if="successMessage" class="setup-success">{{ successMessage }}</div>

        <footer class="step-nav">
          <button
            type="button"
            class="ghost-btn"
            :disabled="step === 1"
            @click="handleBack"
          >
            <span aria-hidden="true">&larr;</span> Back
          </button>
          <div class="step-nav-right">
            <button type="button" class="ghost-btn" @click="handleSaveExit">
              Save &amp; exit
            </button>
            <button
              type="button"
              class="play-btn"
              :disabled="!canAdvance"
              @click="handleContinue"
            >
              <template v-if="step < 4">Continue <span aria-hidden="true">&rarr;</span></template>
              <template v-else>Finish setup <span aria-hidden="true">&rarr;</span></template>
            </button>
          </div>
        </footer>
      </FrostCard>
    </div>
  </div>
</template>

<style scoped>
.setup-view {
  max-width: 1080px;
  margin: 0 auto;
  opacity: 0;
  transform: translateY(8px);
  transition: opacity 320ms var(--ease-out, ease-out), transform 320ms var(--ease-out, ease-out);
}

.setup-view.is-visible {
  opacity: 1;
  transform: translateY(0);
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--ink-muted);
  margin-bottom: 12px;
}

.breadcrumb a {
  color: inherit;
  text-decoration: none;
  transition: color 160ms ease;
}

.breadcrumb a:hover {
  color: var(--ink-primary);
}

.breadcrumb-sep {
  opacity: 0.4;
}

.breadcrumb-current {
  color: var(--ink-primary);
  font-weight: 500;
}

.setup-header {
  margin-bottom: 22px;
  max-width: 640px;
}

.setup-header h1 {
  font-family: var(--font-display);
  font-size: clamp(28px, 3vw, 36px);
  line-height: 1.05;
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 0 0 8px;
  font-weight: 700;
}

.setup-lede {
  font-size: 14.5px;
  color: var(--ink-secondary);
  line-height: 1.55;
  margin: 0;
  max-width: 56ch;
}

.setup-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 22px;
  align-items: start;
}

.step-rail {
  padding: 12px 8px;
  position: sticky;
  top: calc(var(--nav-height, 80px) + 24px);
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
  border-radius: 10px;
  color: inherit;
  font-family: inherit;
  transition: background 180ms ease;
}

.step-rail-item:hover {
  background: rgba(255, 255, 255, 0.5);
}

.step-rail-item.is-active {
  background: rgba(255, 255, 255, 0.78);
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
  background: rgba(44, 38, 34, 0.08);
  color: var(--ink-muted);
  transition: background 200ms ease, color 200ms ease;
}

.step-rail-item.is-active .step-rail-dot {
  background: var(--ssi-red);
  color: #fff;
}

.step-rail-item.is-done .step-rail-dot {
  background: #1F8A5B;
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
  color: var(--ink-primary);
  transition: color 200ms ease;
}

.step-rail-item.is-active .step-rail-title {
  color: var(--ssi-red);
}

.step-rail-desc {
  font-size: 11.5px;
  color: var(--ink-muted);
  line-height: 1.4;
}

.step-panel {
  padding: 26px 28px 22px;
  max-width: 760px;
  min-height: 420px;
  display: flex;
  flex-direction: column;
}

.step-section {
  flex: 1;
}

.step-title {
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink-primary);
  margin: 0 0 14px;
}

.step-lede {
  font-size: 13.5px;
  color: var(--ink-secondary);
  line-height: 1.55;
  margin: 0 0 18px;
  max-width: 52ch;
}

.step-hint {
  font-size: 12.5px;
  color: var(--ink-muted);
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
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink-secondary);
  text-transform: uppercase;
}

.field-input,
.field-select {
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid rgba(44, 38, 34, 0.18);
  border-radius: 9px;
  background: #fff;
  color: var(--ink-primary);
  font-family: inherit;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.field-input::placeholder {
  color: var(--ink-faint);
}

.field-input:focus,
.field-select:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(217, 69, 69, 0.14);
}

.field-input:disabled,
.field-select:disabled {
  background: rgba(44, 38, 34, 0.03);
  color: var(--ink-muted);
  cursor: not-allowed;
}

.field-input-flex {
  flex: 1;
  min-width: 0;
}

/* Step 2 — invites */

.join-code-callout {
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: 10px;
  margin-bottom: 16px;
}

.join-code-label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-bottom: 6px;
}

.join-code-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.join-code {
  font-family: var(--font-mono, monospace);
  font-size: 14px;
  font-weight: 600;
  color: var(--ink-primary);
  letter-spacing: 0.05em;
}

.join-code-admin {
  font-size: 12px;
  color: var(--ink-muted);
}

.join-code-inline {
  font-family: var(--font-mono, monospace);
  color: var(--ink-secondary);
  font-weight: 600;
  letter-spacing: 0.05em;
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
  border: 1px solid rgba(44, 38, 34, 0.12);
  background: transparent;
  color: var(--ink-muted);
  cursor: pointer;
  transition: color 160ms ease, border-color 160ms ease, background 160ms ease;
}

.icon-btn:hover {
  color: var(--ssi-red);
  border-color: rgba(217, 69, 69, 0.4);
  background: rgba(255, 255, 255, 0.8);
}

.existing-staff {
  margin-top: 22px;
  padding-top: 18px;
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}

.existing-staff-label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-bottom: 8px;
}

.existing-staff-list {
  list-style: none;
  padding: 0;
  margin: 0;
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
  color: var(--ink-primary);
}

.existing-staff-meta {
  font-size: 12px;
  color: var(--ink-muted);
}

/* Step 3 — courses */

.empty-state {
  padding: 18px 20px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px dashed rgba(44, 38, 34, 0.18);
  border-radius: 12px;
  font-size: 13.5px;
  color: var(--ink-secondary);
  line-height: 1.5;
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
  border: 1px solid rgba(44, 38, 34, 0.14);
  border-radius: 10px;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
}

.course-tile:hover {
  border-color: rgba(217, 69, 69, 0.4);
}

.course-tile.is-selected {
  background: rgba(217, 69, 69, 0.06);
  border-color: rgba(217, 69, 69, 0.55);
  box-shadow: 0 0 0 1px rgba(217, 69, 69, 0.2);
}

.course-tile-check {
  margin-top: 2px;
  accent-color: var(--ssi-red);
}

.course-tile-body {
  min-width: 0;
}

.course-tile-name {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--ink-primary);
  margin-bottom: 4px;
}

.course-tile-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--ink-muted);
}

.course-tile-code {
  font-family: var(--font-mono, monospace);
}

.course-tile-source {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(44, 38, 34, 0.06);
  font-size: 10.5px;
  font-weight: 500;
}

/* Step 4 — classes */

.existing-classes {
  margin-bottom: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
}

.existing-classes-label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-bottom: 8px;
}

.ssi-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13.5px;
}

.ssi-table thead th {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-muted);
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid rgba(44, 38, 34, 0.1);
  background: rgba(255, 255, 255, 0.5);
}

.ssi-table tbody td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
  color: var(--ink-primary);
}

.ssi-table tbody tr:last-child td {
  border-bottom: none;
}

.ssi-table-strong {
  font-weight: 600;
}

.ssi-table-code {
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  letter-spacing: 0.04em;
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

.class-draft-row.is-saved .field-input,
.class-draft-row.is-saved .field-select {
  background: rgba(31, 138, 91, 0.05);
  border-color: rgba(31, 138, 91, 0.25);
}

.class-draft-code {
  font-family: var(--font-mono, monospace);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--ink-primary);
  background: rgba(31, 138, 91, 0.1);
  padding: 6px 10px;
  border-radius: 6px;
  white-space: nowrap;
}

/* Buttons */

.ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: transparent;
  color: var(--ink-primary);
  border: 1px solid rgba(44, 38, 34, 0.2);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  text-decoration: none;
  transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
}

.ghost-btn:hover:not(:disabled) {
  background: #fff;
  border-color: var(--ssi-red);
  color: var(--ssi-red);
}

.ghost-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ghost-btn-add {
  align-self: flex-start;
  margin-top: 4px;
  border-style: dashed;
}

.play-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  background: var(--ssi-red);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: background 180ms ease, transform 140ms ease, box-shadow 180ms ease;
}

.play-btn:hover:not(:disabled) {
  background: #b32f2f;
  box-shadow: 0 6px 18px rgba(217, 69, 69, 0.32);
  transform: translateY(-1px);
}

.play-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Feedback */

.setup-error {
  margin-top: 16px;
  padding: 10px 14px;
  background: rgba(217, 69, 69, 0.08);
  border: 1px solid rgba(217, 69, 69, 0.25);
  border-radius: 8px;
  color: #a02020;
  font-size: 13px;
}

.setup-success {
  margin-top: 16px;
  padding: 10px 14px;
  background: rgba(31, 138, 91, 0.1);
  border: 1px solid rgba(31, 138, 91, 0.3);
  border-radius: 8px;
  color: #166b46;
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
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}

.step-nav-right {
  display: flex;
  gap: 8px;
}

/* Responsive */

@media (max-width: 960px) {
  .setup-grid {
    grid-template-columns: 1fr;
  }

  .step-rail {
    position: static;
    padding: 8px;
  }

  .step-rail-item {
    padding: 8px 10px;
  }

  .step-rail-desc {
    display: none;
  }

  .step-panel {
    padding: 22px 20px 20px;
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
