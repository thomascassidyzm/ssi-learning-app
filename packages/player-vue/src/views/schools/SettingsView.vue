<script setup lang="ts">
import { ref, computed, onMounted, watch, inject } from 'vue'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'

type SectionId = 'profile' | 'locale' | 'data' | 'billing'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'profile', label: 'School profile' },
  { id: 'locale', label: 'Localisation' },
  { id: 'data', label: 'Data & privacy' },
  { id: 'billing', label: 'Billing' },
]

const isAdminView = inject<boolean>('isAdminView', false)
const { currentUser } = useSchoolContext()
const { activeSchool, currentSchool, totalStudents, fetchSchools } = useSchoolData()

const activeSection = ref<SectionId>('profile')

// Profile state
const schoolNameEdit = ref('')
const schoolEmailEdit = ref('')
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

// Billing state (placeholder — no billing table yet)
const billingEmail = ref('')

function syncFromSchoolData() {
  const school = activeSchool.value || currentSchool.value
  schoolNameEdit.value = school?.school_name || currentUser.value?.school_name || ''
  region.value = school?.region_code?.toUpperCase() || currentUser.value?.region_code?.toUpperCase() || ''
  const slug = (school?.school_name || 'school').toLowerCase().replace(/\s+/g, '')
  schoolEmailEdit.value = `contact@${slug}.edu`
  billingEmail.value = `finance@${slug}.edu`
}

watch(currentUser, async (u) => {
  if (u) {
    await fetchSchools()
    syncFromSchoolData()
  }
}, { immediate: true })

watch([activeSchool, currentSchool], syncFromSchoolData)

onMounted(() => {
  language.value = localStorage.getItem('ssi-language') || 'en'
  timezone.value = localStorage.getItem('ssi-timezone') || 'Europe/London'
})

async function saveSchoolProfile() {
  const school = activeSchool.value || currentSchool.value
  if (!school) return
  profileSaveStatus.value = 'saving'
  try {
    const { getSchoolsClient } = await import('@/composables/schools/client')
    const client = getSchoolsClient()
    await client
      .from('schools')
      .update({ school_name: schoolNameEdit.value })
      .eq('id', school.id)
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

const planSeats = computed(() => totalStudents.value || 0)
const planLine = computed(() => {
  const name = (activeSchool.value || currentSchool.value)?.school_name || currentUser.value?.school_name || 'Your school'
  return planSeats.value
    ? `${name} — ${planSeats.value} seats`
    : `${name} — seats not configured`
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
          v-for="s in SECTIONS"
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
            <input v-model="schoolNameEdit" class="field-input" type="text" />
          </label>
          <label class="field">
            <span class="field-label">Type</span>
            <input value="Bilingual immersion · primary + lower secondary" class="field-input" type="text" readonly />
            <span class="field-hint">Type is set by your group administrator.</span>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">City</span>
              <input v-model="city" class="field-input" type="text" placeholder="—" />
            </label>
            <label class="field">
              <span class="field-label">Region</span>
              <input v-model="region" class="field-input" type="text" placeholder="—" />
            </label>
          </div>
          <label class="field">
            <span class="field-label">Contact email</span>
            <input v-model="schoolEmailEdit" class="field-input" type="email" />
          </label>
          <label class="field">
            <span class="field-label">About</span>
            <textarea v-model="about" rows="3" class="field-input field-textarea" placeholder="A short description of your school." />
          </label>
          <div v-if="!isAdminView" class="panel-actions">
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
        </section>

        <section v-else-if="activeSection === 'billing'" class="schools-card schools-card-pad panel">
          <h2 class="arsenal panel-title">Billing</h2>
          <div class="plan-card">
            <div class="schools-kicker plan-kicker">Current plan</div>
            <div class="arsenal plan-title">{{ planLine }}</div>
            <div class="plan-meta">Billing details available once your subscription is activated.</div>
          </div>
          <label class="field">
            <span class="field-label">Billing email</span>
            <input v-model="billingEmail" class="field-input" type="email" />
          </label>
          <div class="panel-actions">
            <button type="button" class="btn-ghost">Download invoices</button>
          </div>
        </section>
      </div>
    </div>
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
