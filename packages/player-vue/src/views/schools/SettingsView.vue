<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Card from '@/components/schools/shared/Card.vue'
import Button from '@/components/schools/shared/Button.vue'
import { useGodMode } from '@/composables/schools/useGodMode'
import { useSchoolData } from '@/composables/schools/useSchoolData'

const { selectedUser } = useGodMode()
const { activeSchool, currentSchool, fetchSchools } = useSchoolData()

// Settings state - editable refs initialized from real data
const schoolNameEdit = ref('')
const schoolEmailEdit = ref('')
const timezone = ref('Europe/London')
const language = ref('en')
const saveStatus = ref<'idle' | 'saving' | 'saved'>('idle')
const localizationSaveStatus = ref<'idle' | 'saving' | 'saved'>('idle')

function syncFromSchoolData() {
  const school = activeSchool.value || currentSchool.value
  schoolNameEdit.value = school?.school_name || selectedUser.value?.school_name || 'Your School'
  schoolEmailEdit.value = school
    ? `admin@${school.school_name.toLowerCase().replace(/\s+/g, '')}.edu`
    : 'admin@school.edu'
}

// Fetch data on mount and sync editable fields
watch(selectedUser, async (user) => {
  if (user) {
    await fetchSchools()
    syncFromSchoolData()
  }
}, { immediate: true })

watch([activeSchool, currentSchool], () => {
  syncFromSchoolData()
})

async function saveSchoolProfile() {
  const school = activeSchool.value || currentSchool.value
  if (!school) return
  saveStatus.value = 'saving'
  try {
    const { getSchoolsClient } = await import('@/composables/schools/client')
    const client = getSchoolsClient()
    await client
      .from('schools')
      .update({ school_name: schoolNameEdit.value })
      .eq('id', school.id)
    saveStatus.value = 'saved'
    setTimeout(() => { saveStatus.value = 'idle' }, 2000)
    await fetchSchools()
  } catch (err) {
    console.error('Failed to save school profile:', err)
    saveStatus.value = 'idle'
  }
}

function saveLocalization() {
  localizationSaveStatus.value = 'saving'
  // Localization preferences saved locally (no DB table yet)
  localStorage.setItem('ssi-timezone', timezone.value)
  localStorage.setItem('ssi-language', language.value)
  setTimeout(() => {
    localizationSaveStatus.value = 'saved'
    setTimeout(() => { localizationSaveStatus.value = 'idle' }, 2000)
  }, 300)
}

// Animation
const isVisible = ref(false)
onMounted(() => {
  setTimeout(() => { isVisible.value = true }, 50)
})
</script>

<template>
  <div class="settings-view" :class="{ 'is-visible': isVisible }">
    <!-- Page Header -->
    <header class="page-header animate-item" :class="{ 'show': isVisible }">
      <div class="page-title">
        <h1>Settings</h1>
        <p class="page-subtitle">Manage your school and account settings</p>
      </div>
    </header>

    <div class="settings-grid">
      <!-- School Profile -->
      <Card title="School Profile" class="animate-item delay-1" :class="{ 'show': isVisible }">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </template>
        <div class="form-group">
          <label class="form-label">School Name</label>
          <input type="text" v-model="schoolNameEdit" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">Contact Email</label>
          <input type="email" v-model="schoolEmailEdit" class="form-input" />
        </div>
        <div class="form-actions">
          <Button variant="primary" size="sm" @click="saveSchoolProfile" :disabled="saveStatus === 'saving'">
            {{ saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save Changes' }}
          </Button>
        </div>
      </Card>

      <!-- Localization -->
      <Card title="Localization" class="animate-item delay-1" :class="{ 'show': isVisible }">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </template>
        <div class="form-group">
          <label class="form-label">Timezone</label>
          <select v-model="timezone" class="form-select">
            <option value="Europe/London">Europe/London (GMT)</option>
            <option value="Europe/Dublin">Europe/Dublin (GMT)</option>
            <option value="America/New_York">America/New York (EST)</option>
            <option value="America/Los_Angeles">America/Los Angeles (PST)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Dashboard Language</label>
          <select v-model="language" class="form-select">
            <option value="en">English</option>
            <option value="cy">Cymraeg (Welsh)</option>
            <option value="es">Espanol (Spanish)</option>
          </select>
        </div>
        <div class="form-actions">
          <Button variant="primary" size="sm" @click="saveLocalization" :disabled="localizationSaveStatus === 'saving'">
            {{ localizationSaveStatus === 'saving' ? 'Saving...' : localizationSaveStatus === 'saved' ? 'Saved!' : 'Save Changes' }}
          </Button>
        </div>
      </Card>

      <!-- Data & Privacy -->
      <Card title="Data & Privacy" class="animate-item delay-2" :class="{ 'show': isVisible }">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </template>
        <div class="setting-row">
          <div class="setting-info">
            <h4>Export All Data</h4>
            <p>Download all your school's learning data</p>
          </div>
          <Button variant="secondary" size="sm">Export</Button>
        </div>
        <div class="setting-row">
          <div class="setting-info">
            <h4>Delete All Data</h4>
            <p>Permanently delete all student progress data</p>
          </div>
          <Button variant="secondary" size="sm" class="btn-danger">Delete</Button>
        </div>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: 1000px;
}

.page-header {
  margin-bottom: var(--space-8);
}

.page-title h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  margin-bottom: var(--space-1);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

/* Settings Grid */
.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-6);
}

/* Form Styles */
.form-group {
  margin-bottom: var(--space-5);
}

.form-group:last-of-type {
  margin-bottom: var(--space-6);
}

.form-label {
  display: block;
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.form-input,
.form-select {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-family: inherit;
  font-size: var(--text-sm);
  transition: all var(--transition-base);
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.2);
}

.form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23707070' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right var(--space-4) center;
  padding-right: var(--space-12);
  cursor: pointer;
}

.form-actions {
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}

/* Setting Row */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--border-subtle);
}

.setting-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.setting-info h4 {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  margin-bottom: var(--space-1);
}

.setting-info p {
  font-size: var(--text-sm);
  color: var(--text-muted);
  margin: 0;
}

/* Toggle Switch */
.toggle-switch {
  width: 48px;
  height: 28px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-full);
  position: relative;
  cursor: pointer;
  transition: all var(--transition-base);
}

.toggle-switch.active {
  background: var(--ssi-red);
  border-color: var(--ssi-red);
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: white;
  border-radius: var(--radius-full);
  transition: transform var(--transition-base);
}

.toggle-switch.active .toggle-thumb {
  transform: translateX(20px);
}

/* Danger Button */
.btn-danger :deep(.btn) {
  border-color: var(--error);
  color: var(--error);
}

.btn-danger :deep(.btn:hover) {
  background: var(--error);
  color: white;
}

/* Animations */
.animate-item {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}

.animate-item.show {
  opacity: 1;
  transform: translateY(0);
}

.animate-item.delay-1 { transition-delay: 0.1s; }
.animate-item.delay-2 { transition-delay: 0.2s; }

/* Responsive */
@media (max-width: 768px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
