<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'

type SectionId = 'profile' | 'locale' | 'data' | 'billing'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'profile', label: 'School profile' },
  { id: 'locale', label: 'Localisation' },
  { id: 'data', label: 'Data & privacy' },
  { id: 'billing', label: 'Billing' },
]

const isAdminView = inject<boolean>('isAdminView', false)
const supabase = inject<import('vue').Ref<any>>('supabase', ref(null))
const { currentUser, isSchoolAdmin } = useSchoolContext()
const { activeSchool, currentSchool, fetchSchools } = useSchoolData()

// School profile edits + Billing are admin-only (renaming the school and
// changing paid seats are school_admin actions server-side — see
// api/school/update-profile.ts / update-seats.ts). A plain teacher gets the
// profile section read-only and the Billing tab hidden entirely, matching
// how other admin-only controls hide (not disable) for teachers elsewhere
// (e.g. TeachersView's invite/remove buttons).
const canEditSchool = computed(() => isSchoolAdmin.value && !isAdminView)
const visibleSections = computed(() => SECTIONS.filter((s) => s.id !== 'billing' || isSchoolAdmin.value))

const activeSection = ref<SectionId>('profile')

// Profile state
const schoolNameEdit = ref('')
const schoolEmailEdit = ref('')
// The admin's real signup email — the sensible default for the school's contact
// email (replaces the old invented `contact@<slug>.edu`). Resolved from the
// authenticated session.
const adminEmail = ref('')
const city = ref('')
const region = ref('')
const about = ref('')
const profileSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle')

// Localisation state
const language = ref('en')
const timezone = ref('Europe/London')
const weekStart = ref('Monday')
const showFlags = ref(true)
const localizationSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle')

// Data & privacy toggles (visual placeholders — no DB column yet)
const dataToggles = ref<{ id: string; title: string; desc: string; value: boolean }[]>([
  {
    id: 'analytics',
    title: 'Share anonymised analytics with the SSi team',
    desc: 'Helps us improve recommendations across schools.',
    value: true,
  },
  {
    id: 'messaging',
    title: 'Allow students to message each other',
    desc: 'Disabled by default in school accounts.',
    value: false,
  },
  {
    id: 'realnames',
    title: 'Show student real names to other students',
    desc: 'When off, only first name + initial is shown.',
    value: true,
  },
  {
    id: 'retention',
    title: 'Retain inactive accounts after 12 months',
    desc: 'Otherwise we delete them automatically.',
    value: false,
  },
])
const isExporting = ref(false)

// Billing summary only. The actual subscribe / seat-change flow lives on the
// canonical Upgrade page (/schools/upgrade) — this section just shows the plan
// line and links there, so checkout logic isn't duplicated across surfaces.
const PRICE_PER_SEAT_GBP = 15
const seatCount = ref(1)

// Live subscription state, read from the server for an accurate plan summary.
const platformStatus = ref<string | null>(null)
const paidSeats = ref<number | null>(null)
const isSubscribed = computed(() => platformStatus.value === 'active')

async function authHeaders(): Promise<Record<string, string> | null> {
  if (!supabase.value) return null
  const { data: { session } } = await supabase.value.auth.getSession()
  const token = session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : null
}

async function loadSubscription() {
  const headers = await authHeaders()
  if (!headers) return
  try {
    const res = await fetch('/api/school/subscription', { headers })
    if (!res.ok) return
    const data = await res.json()
    platformStatus.value = data?.school?.platform_status ?? null
    const seats = data?.school?.teacher_seats
    if (typeof seats === 'number' && seats > 0) {
      paidSeats.value = seats
      // Seed the stepper from what's actually paid for, once.
      if (isSubscribed.value) seatCount.value = seats
    }
  } catch {
    // Non-fatal — billing UI just stays in its default (Subscribe) state.
  }
}

// Paddle billing portal — invoices, card updates, cancellation. Only
// meaningful once subscribed (the webhook stamps provider_customer_id).
const isOpeningPortal = ref(false)
const portalError = ref('')
async function openBillingPortal() {
  if (isOpeningPortal.value) return
  isOpeningPortal.value = true
  portalError.value = ''
  try {
    const headers = await authHeaders()
    if (!headers) {
      portalError.value = 'Sign in again to open billing'
      return
    }
    const res = await fetch('/api/school/portal', { headers })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.portalUrl) {
      window.location.href = data.portalUrl
      return
    }
    portalError.value = data?.error || 'Could not open the billing portal — try again'
  } catch {
    portalError.value = 'Could not open the billing portal — try again'
  } finally {
    isOpeningPortal.value = false
  }
}

// Delete school — self-serve for the school's own admin ("every level can
// delete the things it created", founder ruling). api/admin/update-school.ts
// enforces ownership server-side (schoolIdForAdmin), same shape as the
// ssi_admin delete path it already had.
const showDeleteSchoolModal = ref(false)
const deleteSchoolImpact = ref<{
  schoolName: string
  classCount: number
  sessionCount: number
  learnerCount: number
  teacherCount: number
  hasRealActivity: boolean
} | null>(null)
const isDeletingSchool = ref(false)
const deleteSchoolError = ref('')

async function openDeleteSchoolModal() {
  deleteSchoolError.value = ''
  deleteSchoolImpact.value = null
  const headers = await authHeaders()
  const schoolId = activeSchool.value?.id
  if (!headers || !schoolId) return
  try {
    const res = await fetch(`/api/admin/update-school?school_id=${encodeURIComponent(schoolId)}`, { headers })
    const data = await res.json().catch(() => ({}))
    if (res.ok) deleteSchoolImpact.value = data.impact
  } catch { /* modal still opens; impact list just stays empty */ }
  showDeleteSchoolModal.value = true
}

function closeDeleteSchoolModal() {
  showDeleteSchoolModal.value = false
  deleteSchoolError.value = ''
}

async function confirmDeleteSchool(typedName: string) {
  const headers = await authHeaders()
  const schoolId = activeSchool.value?.id
  if (!headers || !schoolId) {
    deleteSchoolError.value = 'Sign in again to delete your school'
    return
  }
  isDeletingSchool.value = true
  deleteSchoolError.value = ''
  try {
    const params = typedName ? `?confirm_name=${encodeURIComponent(typedName)}` : ''
    const res = await fetch(`/api/admin/update-school?school_id=${encodeURIComponent(schoolId)}${params}`, {
      method: 'DELETE',
      headers,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (data.impact) deleteSchoolImpact.value = data.impact
      deleteSchoolError.value = data.error || 'Failed to delete school'
      return
    }
    // The admin's own school is gone — sign out to a clean slate, same
    // escape-hatch pattern as SchoolsContainer's "no school access" wall.
    await supabase.value?.auth?.signOut()
    window.location.href = '/schools'
  } catch {
    deleteSchoolError.value = 'Failed to delete school'
  } finally {
    isDeletingSchool.value = false
  }
}

const deleteSchoolImpactLines = computed(() => {
  const impact = deleteSchoolImpact.value
  if (!impact) return []
  const lines: string[] = []
  if (impact.classCount) lines.push(`${impact.classCount} class${impact.classCount === 1 ? '' : 'es'}`)
  if (impact.learnerCount) lines.push(`${impact.learnerCount} student${impact.learnerCount === 1 ? '' : 's'}`)
  if (impact.teacherCount) lines.push(`${impact.teacherCount} teacher${impact.teacherCount === 1 ? '' : 's'}`)
  if (impact.sessionCount) lines.push(`${impact.sessionCount} recorded session${impact.sessionCount === 1 ? '' : 's'}`)
  return lines
})

function syncFromSchoolData() {
  const school = activeSchool.value || currentSchool.value
  schoolNameEdit.value = school?.school_name || currentUser.value?.school_name || ''
  region.value = school?.region_code?.toUpperCase() || currentUser.value?.region_code?.toUpperCase() || ''
  // Contact email defaults to the school's saved value if present, else the
  // admin's real signup email — never a fabricated `contact@<slug>.edu`.
  schoolEmailEdit.value = (school as any)?.contact_email || adminEmail.value || ''
}

watch(currentUser, async (u) => {
  if (u) {
    await fetchSchools()
    // Resolve the admin's signup email before seeding the profile fields so the
    // contact-email default is the real address, not an invented one.
    try {
      const { data } = (await supabase.value?.auth.getUser()) ?? { data: null }
      adminEmail.value = data?.user?.email || ''
    } catch { /* non-fatal — field just defaults to any saved value or blank */ }
    syncFromSchoolData()
  }
}, { immediate: true })

watch([activeSchool, currentSchool], syncFromSchoolData)

onMounted(() => {
  language.value = localStorage.getItem('ssi-language') || 'en'
  timezone.value = localStorage.getItem('ssi-timezone') || 'Europe/London'
  loadSubscription()
})

async function saveSchoolProfile() {
  const school = activeSchool.value || currentSchool.value
  if (!school) return
  profileSaveStatus.value = 'saving'
  try {
    // The `schools` table's authenticated UPDATE grant is revoked (see
    // CLAUDE.md RLS section) — routed through the same caller-scoped server
    // endpoint SetupView.vue's saveSchool() uses (finding #2c, 2026-07-13
    // audit) rather than a direct client write.
    if (!supabase?.value) throw new Error('Not signed in')
    const { data: { session } } = await supabase.value.auth.getSession()
    const token = session?.access_token
    if (!token) throw new Error('Not signed in')
    const res = await fetch('/api/school/update-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ school_name: schoolNameEdit.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${res.status}`)
    }
    profileSaveStatus.value = 'saved'
    setTimeout(() => { profileSaveStatus.value = 'idle' }, 2000)
    await fetchSchools()
  } catch (err) {
    console.error('Failed to save school profile:', err)
    profileSaveStatus.value = 'idle'
  }
}

function saveLocalization() {
  localizationSaveStatus.value = 'saving'
  localStorage.setItem('ssi-timezone', timezone.value)
  localStorage.setItem('ssi-language', language.value)
  setTimeout(() => {
    localizationSaveStatus.value = 'saved'
    setTimeout(() => { localizationSaveStatus.value = 'idle' }, 2000)
  }, 250)
}

async function handleExportData() {
  const school = activeSchool.value || currentSchool.value
  if (!school) return
  isExporting.value = true
  try {
    const { getSchoolsClient } = await import('@/composables/schools/client')
    const client = getSchoolsClient()
    const { data: progress } = await client
      .from('class_student_progress')
      .select('*')
      .eq('school_id', school.id)

    const rows = (progress || []).map((p: any) =>
      [p.student_name, p.class_name, p.seeds_completed, p.total_practice_seconds, p.last_active_at].join(','),
    )
    const csv = ['Student,Class,Seeds Completed,Practice Seconds,Last Active', ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${school.school_name.replace(/\s+/g, '-').toLowerCase()}-data-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Export failed:', err)
  } finally {
    isExporting.value = false
  }
}

const planLine = computed(() => {
  const name = (activeSchool.value || currentSchool.value)?.school_name || currentUser.value?.school_name || 'Your school'
  // When subscribed, anchor on what's actually PAID (DB), not the local stepper.
  const n = isSubscribed.value && paidSeats.value != null ? paidSeats.value : seatCount.value
  const seatWord = `teacher ${n === 1 ? 'seat' : 'seats'}`
  return isSubscribed.value
    ? `${name} — ${n} ${seatWord} (active)`
    : `${name} — ${n} ${seatWord}`
})

function toggleDataItem(id: string) {
  const item = dataToggles.value.find((t) => t.id === id)
  if (item) item.value = !item.value
}
</script>

<template>
  <main class="settings-screen">
    <h1 class="arsenal page-title">Settings</h1>

    <div class="settings-layout">
      <aside class="schools-card section-nav">
        <button
          v-for="s in visibleSections"
          :key="s.id"
          type="button"
          class="section-link"
          :class="{ active: activeSection === s.id }"
          @click="activeSection = s.id"
        >
          {{ s.label }}
        </button>
      </aside>

      <div class="settings-content">
        <section v-if="activeSection === 'profile'" class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">School profile</h2>
          <label class="field">
            <span class="field-label">School name</span>
            <input v-model="schoolNameEdit" class="field-input" type="text" :readonly="!canEditSchool" />
          </label>
          <label class="field">
            <span class="field-label">Type</span>
            <input value="Bilingual immersion · primary + lower secondary" class="field-input" type="text" readonly />
            <span class="field-hint">Type is set by your group administrator.</span>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">City</span>
              <input v-model="city" class="field-input" type="text" placeholder="—" :readonly="!canEditSchool" />
            </label>
            <label class="field">
              <span class="field-label">Region</span>
              <input v-model="region" class="field-input" type="text" placeholder="—" :readonly="!canEditSchool" />
            </label>
          </div>
          <label class="field">
            <span class="field-label">Contact email</span>
            <input v-model="schoolEmailEdit" class="field-input" type="email" :readonly="!canEditSchool" />
          </label>
          <label class="field">
            <span class="field-label">About</span>
            <textarea v-model="about" rows="3" class="field-input field-textarea" placeholder="A short description of your school." :readonly="!canEditSchool" />
          </label>
          <p v-if="!canEditSchool" class="field-hint">Only a school admin can edit the school profile.</p>
          <div v-if="canEditSchool" class="panel-actions">
            <button type="button" class="btn-play" :disabled="profileSaveStatus === 'saving'" @click="saveSchoolProfile">
              {{ profileSaveStatus === 'saving' ? 'Saving…' : profileSaveStatus === 'saved' ? 'Saved' : 'Save changes' }}
            </button>
            <button type="button" class="btn-ghost">Cancel</button>
          </div>
        </section>

        <section v-else-if="activeSection === 'locale'" class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">Localisation</h2>
          <label class="field">
            <span class="field-label">Default interface language</span>
            <select v-model="language" class="field-input">
              <option value="en">English</option>
              <option value="cy">Cymraeg (Welsh)</option>
              <option value="es">Español (Spanish)</option>
              <option value="br">Brezhoneg (Breton)</option>
            </select>
            <span class="field-hint">Teachers and students can override individually.</span>
          </label>
          <label class="field">
            <span class="field-label">Time zone</span>
            <select v-model="timezone" class="field-input">
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Paris">Europe/Paris</option>
              <option value="Europe/Dublin">Europe/Dublin</option>
              <option value="America/New_York">America/New York</option>
              <option value="America/Los_Angeles">America/Los Angeles</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Week starts on</span>
            <select v-model="weekStart" class="field-input">
              <option value="Monday">Monday</option>
              <option value="Sunday">Sunday</option>
            </select>
          </label>
          <div class="toggle-row">
            <div>
              <div class="toggle-title">Show flags on courses</div>
              <div class="toggle-desc">Display country flags next to course names.</div>
            </div>
            <button
              type="button"
              class="toggle"
              :class="{ on: showFlags }"
              :aria-pressed="showFlags"
              @click="showFlags = !showFlags"
            >
              <span class="toggle-thumb" />
            </button>
          </div>
          <div v-if="!isAdminView" class="panel-actions">
            <button type="button" class="btn-play" :disabled="localizationSaveStatus === 'saving'" @click="saveLocalization">
              {{ localizationSaveStatus === 'saving' ? 'Saving…' : localizationSaveStatus === 'saved' ? 'Saved' : 'Save changes' }}
            </button>
          </div>
        </section>

        <section v-else-if="activeSection === 'data'" class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">Data &amp; privacy</h2>
          <div
            v-for="t in dataToggles"
            :key="t.id"
            class="toggle-row toggle-row-bordered"
          >
            <div>
              <div class="toggle-title">{{ t.title }}</div>
              <div class="toggle-desc">{{ t.desc }}</div>
            </div>
            <button
              type="button"
              class="toggle"
              :class="{ on: t.value }"
              :aria-pressed="t.value"
              @click="toggleDataItem(t.id)"
            >
              <span class="toggle-thumb" />
            </button>
          </div>
          <div class="panel-actions data-actions">
            <button type="button" class="btn-ghost" :disabled="isExporting" @click="handleExportData">
              {{ isExporting ? 'Preparing…' : 'Download all data (.csv)' }}
            </button>
          </div>

          <div v-if="canEditSchool" class="danger-zone">
            <h3 class="danger-zone-title">Danger zone</h3>
            <div class="toggle-row toggle-row-bordered">
              <div>
                <div class="toggle-title">Delete this school</div>
                <div class="toggle-desc">Permanently deletes the school, its classes and enrolments. Cannot be undone.</div>
              </div>
              <button type="button" class="btn-danger" @click="openDeleteSchoolModal">Delete school</button>
            </div>
          </div>
        </section>

        <section v-else-if="activeSection === 'billing'" class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">Billing</h2>
          <div class="plan-card">
            <div class="schools-kicker plan-kicker">Current plan</div>
            <div class="arsenal plan-title">{{ planLine }}</div>
            <div class="plan-meta">£{{ PRICE_PER_SEAT_GBP }} per teacher seat / month.</div>
          </div>

          <!-- Subscription + seats are managed on the canonical Upgrade page so
               there's a single payment surface (no duplicated checkout logic). -->
          <div class="panel-actions">
            <router-link to="/schools/upgrade" class="btn-play">
              {{ isSubscribed ? 'Manage subscription & seats →' : 'Subscribe / choose seats →' }}
            </router-link>
            <!-- Paddle portal: invoices, card updates, cancellation. -->
            <button
              v-if="isSubscribed"
              type="button"
              class="btn-ghost"
              :disabled="isOpeningPortal"
              @click="openBillingPortal"
            >
              {{ isOpeningPortal ? 'Opening…' : 'Billing & invoices' }}
            </button>
          </div>
          <p v-if="portalError" class="portal-error" role="alert">{{ portalError }}</p>
        </section>
      </div>
    </div>

    <ConfirmDeleteModal
      :is-open="showDeleteSchoolModal"
      title="Delete school"
      :target-name="deleteSchoolImpact?.schoolName || activeSchool?.school_name || ''"
      :impact-lines="deleteSchoolImpactLines"
      :require-typed-confirm="!!deleteSchoolImpact?.hasRealActivity"
      :submitting="isDeletingSchool"
      :error="deleteSchoolError"
      @close="closeDeleteSchoolModal"
      @confirm="confirmDeleteSchool"
    />
  </main>
</template>

<style scoped>
.settings-screen {
  padding: 22px 28px 32px;
  max-width: 1080px;
  margin: 0 auto;
}

.page-title {
  font-size: 30px;
  line-height: 1.05;
  margin-bottom: 14px;
}

.settings-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 18px;
  align-items: start;
}

.section-nav {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 70px;
}

.section-link {
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--schools-fg);
  font-family: var(--font-body);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease-out, color 120ms ease-out;
}

.section-link:hover {
  background: #f6f5f1;
}

.section-link.active {
  background: #f6f5f1;
  color: var(--schools-red);
  font-weight: 600;
}

.settings-content {
  min-width: 0;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 640px;
}

.panel-title {
  font-size: 22px;
  margin: 0;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.field-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--schools-fg);
}

.field-hint {
  font-size: 11.5px;
  color: var(--schools-fg-2);
}

.field-input {
  padding: 10px 12px;
  font-size: 14px;
  border: 1px solid var(--schools-border-strong);
  border-radius: 8px;
  background: #fff;
  font-family: var(--font-body);
  color: var(--schools-fg);
}

.field-input:focus {
  outline: none;
  border-color: var(--schools-red);
  box-shadow: 0 0 0 3px rgba(219, 30, 23, 0.12);
}

.field-input[readonly] {
  background: #fafaf6;
  color: var(--schools-fg-2);
}

.field-textarea {
  resize: vertical;
  min-height: 76px;
  font-family: var(--font-body);
}

.panel-actions {
  display: flex;
  gap: 8px;
  padding-top: 6px;
}

.portal-error {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--ssi-red, #c23a3a);
}

.data-actions {
  padding-top: 8px;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 0;
}

.toggle-row-bordered {
  border-top: 1px solid var(--schools-border);
  padding: 10px 0;
}

.toggle-title {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--schools-fg);
}

.toggle-desc {
  font-size: 12px;
  color: var(--schools-fg-2);
  margin-top: 2px;
  max-width: 380px;
  line-height: 1.5;
}

.danger-zone {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--schools-border);
}

.danger-zone-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ssi-red, #c23a3a);
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.btn-danger {
  padding: 10px 16px;
  border-radius: 10px;
  background: transparent;
  border: 1px solid var(--ssi-red, #c23a3a);
  color: var(--ssi-red, #c23a3a);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.btn-danger:hover {
  background: var(--ssi-red, #c23a3a);
  color: white;
}

.toggle {
  width: 42px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background: #ccc;
  position: relative;
  cursor: pointer;
  flex: none;
  padding: 0;
  transition: background 160ms ease-out;
}

.toggle.on {
  background: var(--schools-success);
}

.toggle-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: left 150ms ease-out;
}

.toggle.on .toggle-thumb {
  left: 20px;
}

.plan-card {
  padding: 14px;
  background: #fdf6df;
  border: 1px solid #f0d97a;
  border-radius: 8px;
}

.plan-kicker {
  color: #7a5418;
}

.plan-title {
  font-size: 24px;
  margin-top: 4px;
  color: #4a3308;
}

.plan-meta {
  font-size: 12.5px;
  color: #5a3e10;
  margin-top: 4px;
}

@media (max-width: 960px) {
  .settings-screen {
    padding: 20px 16px 32px;
  }

  .settings-layout {
    grid-template-columns: 1fr;
  }

  .section-nav {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    gap: 4px;
  }

  .section-link {
    flex: none;
    padding: 8px 12px;
  }

  .field-row {
    grid-template-columns: 1fr;
  }
}
</style>
