<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useGodMode } from '@/composables/schools/useGodMode'

interface EntitlementCode {
  id: string
  code: string
  access_type: 'full' | 'courses'
  granted_courses: string[] | null
  duration_type: 'lifetime' | 'time_limited'
  duration_days: number | null
  label: string
  max_uses: number | null
  use_count: number
  expires_at: string | null
  is_active: boolean
  created_at: string
  created_by: string
}

const { getAuthToken } = useAdminClient()
const { selectedUser } = useGodMode()

// State
const codes = ref<EntitlementCode[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const copiedCode = ref<string | null>(null)

// Form state
const formAccessType = ref<'full' | 'courses'>('full')
const formGrantedCourses = ref('')
const formDurationType = ref<'lifetime' | 'time_limited'>('lifetime')
const formDurationDays = ref<number | ''>('')
const formLabel = ref('')
const formMaxUses = ref<number | ''>('')
const formExpiresAt = ref('')

async function fetchCodes(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    if (!token) {
      error.value = 'Not authenticated'
      return
    }
    const response = await fetch('/api/entitlement/list', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }
    const data = await response.json()
    codes.value = data.codes || []
  } catch (err: any) {
    error.value = err.message || 'Failed to load codes'
  } finally {
    isLoading.value = false
  }
}

async function createCode(): Promise<void> {
  if (!formLabel.value.trim()) {
    error.value = 'Label is required'
    return
  }
  if (formAccessType.value === 'courses' && !formGrantedCourses.value.trim()) {
    error.value = 'Course codes are required for course-specific access'
    return
  }
  if (formDurationType.value === 'time_limited' && (!formDurationDays.value || Number(formDurationDays.value) < 1)) {
    error.value = 'Duration days must be at least 1'
    return
  }

  isCreating.value = true
  error.value = null
  successMessage.value = null

  try {
    const token = await getAuthToken()
    if (!token) {
      error.value = 'Not authenticated'
      return
    }

    const body: Record<string, unknown> = {
      access_type: formAccessType.value,
      duration_type: formDurationType.value,
      label: formLabel.value.trim(),
    }

    if (formAccessType.value === 'courses') {
      body.granted_courses = formGrantedCourses.value.split(',').map(s => s.trim()).filter(Boolean)
    }
    if (formDurationType.value === 'time_limited') {
      body.duration_days = Number(formDurationDays.value)
    }
    if (formMaxUses.value !== '') body.max_uses = Number(formMaxUses.value)
    if (formExpiresAt.value) body.expires_at = new Date(formExpiresAt.value).toISOString()

    const response = await fetch('/api/entitlement/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }

    const result = await response.json()
    successMessage.value = `Code created: ${result.code}`

    // Reset form
    formLabel.value = ''
    formGrantedCourses.value = ''
    formDurationDays.value = ''
    formMaxUses.value = ''
    formExpiresAt.value = ''
    formAccessType.value = 'full'
    formDurationType.value = 'lifetime'

    // Refresh list
    await fetchCodes()
  } catch (err: any) {
    error.value = err.message || 'Failed to create code'
  } finally {
    isCreating.value = false
  }
}

function copyLink(code: string) {
  const url = `${window.location.origin}/redeem/${code}`
  navigator.clipboard.writeText(url).then(() => {
    copiedCode.value = code
    setTimeout(() => { copiedCode.value = null }, 2000)
  })
}

function copyCode(code: string) {
  navigator.clipboard.writeText(code).then(() => {
    copiedCode.value = code
    setTimeout(() => { copiedCode.value = null }, 2000)
  })
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString()
}

function formatAccess(code: EntitlementCode): string {
  if (code.access_type === 'full') return 'Full access'
  if (code.granted_courses?.length) return code.granted_courses.join(', ')
  return 'Courses'
}

function formatDuration(code: EntitlementCode): string {
  if (code.duration_type === 'lifetime') return 'Lifetime'
  if (code.duration_days) return `${code.duration_days} days`
  return '-'
}

function formatUses(code: EntitlementCode): string {
  if (code.max_uses === null) return `${code.use_count} / unlimited`
  return `${code.use_count} / ${code.max_uses}`
}

onMounted(() => {
  fetchCodes()
})
</script>

<template>
  <div class="admin-entitlements">
    <h2>Entitlement Codes</h2>
    <p class="subtitle">Create and manage access codes for premium content</p>

    <!-- Create Form -->
    <div class="create-form card">
      <h3>Create New Code</h3>
      <div class="form-grid">
        <div class="form-group">
          <label>Label</label>
          <input v-model="formLabel" type="text" placeholder="Welsh Govt 2026, Press Pass..." />
        </div>

        <div class="form-group">
          <label>Access Type</label>
          <select v-model="formAccessType">
            <option value="full">Full access (all courses)</option>
            <option value="courses">Specific courses</option>
          </select>
        </div>

        <div class="form-group" v-if="formAccessType === 'courses'">
          <label>Course Codes (comma-separated)</label>
          <input v-model="formGrantedCourses" type="text" placeholder="cym_for_eng, spa_for_eng" />
        </div>

        <div class="form-group">
          <label>Duration</label>
          <select v-model="formDurationType">
            <option value="lifetime">Lifetime</option>
            <option value="time_limited">Time-limited</option>
          </select>
        </div>

        <div class="form-group" v-if="formDurationType === 'time_limited'">
          <label>Duration (days)</label>
          <input v-model="formDurationDays" type="number" min="1" placeholder="30" />
        </div>

        <div class="form-group">
          <label>Max Uses (blank = unlimited)</label>
          <input v-model="formMaxUses" type="number" min="1" placeholder="Unlimited" />
        </div>

        <div class="form-group">
          <label>Code Expires (optional)</label>
          <input v-model="formExpiresAt" type="date" />
        </div>
      </div>

      <div class="form-actions">
        <button class="btn btn-primary" :disabled="isCreating" @click="createCode">
          {{ isCreating ? 'Creating...' : 'Create Code' }}
        </button>
      </div>

      <p v-if="successMessage" class="success-msg">{{ successMessage }}</p>
      <p v-if="error" class="error-msg">{{ error }}</p>
    </div>

    <!-- Codes Table -->
    <div class="codes-table card">
      <h3>Active Codes</h3>
      <div v-if="isLoading" class="loading">Loading...</div>
      <table v-else-if="codes.length > 0">
        <thead>
          <tr>
            <th>Code</th>
            <th>Label</th>
            <th>Access</th>
            <th>Duration</th>
            <th>Uses</th>
            <th>Expires</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="code in codes" :key="code.id" :class="{ inactive: !code.is_active }">
            <td class="code-cell">
              <code>{{ code.code }}</code>
            </td>
            <td>{{ code.label }}</td>
            <td>{{ formatAccess(code) }}</td>
            <td>{{ formatDuration(code) }}</td>
            <td>{{ formatUses(code) }}</td>
            <td>{{ formatDate(code.expires_at) }}</td>
            <td class="actions-cell">
              <button class="icon-btn" @click="copyCode(code.code)" :title="copiedCode === code.code ? 'Copied!' : 'Copy code'">
                {{ copiedCode === code.code ? 'Copied' : 'Copy' }}
              </button>
              <button class="icon-btn" @click="copyLink(code.code)" title="Copy shareable link">
                Link
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-state">No entitlement codes yet. Create one above.</p>
    </div>
  </div>
</template>

<style scoped>
.admin-entitlements {
  padding: 0;
}

h2 {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
  color: var(--text-primary, #fff);
}

.subtitle {
  color: var(--text-secondary, #aaa);
  margin: 0 0 1.5rem;
}

.card {
  background: var(--bg-card, #141420);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1.5rem;
}

.card h3 {
  margin: 0 0 1rem;
  font-size: 1rem;
  color: var(--text-primary, #fff);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

@media (max-width: 600px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-group label {
  font-size: 0.75rem;
  color: var(--text-secondary, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.form-group input,
.form-group select {
  background: var(--bg-primary, #0a0a0f);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: var(--text-primary, #e0e0e0);
  font-size: 0.875rem;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--accent, #4fc3f7);
}

.form-actions {
  margin-top: 1rem;
  display: flex;
  gap: 0.5rem;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid var(--border, #333);
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.2s;
}

.btn-primary {
  background: var(--accent, #4fc3f7);
  color: #000;
  border-color: var(--accent, #4fc3f7);
}

.btn-primary:hover { opacity: 0.9; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.success-msg {
  color: #66bb6a;
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
}

.error-msg {
  color: #ef5350;
  margin: 0.75rem 0 0;
  font-size: 0.875rem;
}

.loading {
  color: var(--text-secondary, #aaa);
  padding: 1rem 0;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

thead th {
  text-align: left;
  padding: 0.5rem;
  color: var(--text-secondary, #aaa);
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border, #333);
}

tbody td {
  padding: 0.5rem;
  color: var(--text-primary, #e0e0e0);
  border-bottom: 1px solid var(--border-subtle, #222);
}

.inactive td {
  opacity: 0.5;
}

.code-cell code {
  background: var(--bg-primary, #0a0a0f);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.8125rem;
}

.actions-cell {
  white-space: nowrap;
}

.icon-btn {
  background: none;
  border: 1px solid var(--border, #333);
  color: var(--text-secondary, #aaa);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.75rem;
  margin-right: 0.25rem;
  transition: all 0.2s;
}

.icon-btn:hover {
  color: var(--text-primary, #fff);
  border-color: var(--accent, #4fc3f7);
}

.empty-state {
  color: var(--text-secondary, #aaa);
  padding: 1rem 0;
  text-align: center;
}
</style>
