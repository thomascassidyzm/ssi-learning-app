<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { useGodMode } from '@/composables/schools/useGodMode'
import Card from '@/components/schools/shared/Card.vue'

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
    <!-- Page Header -->
    <header class="page-header animate-in">
      <h1 class="page-title">Entitlement Codes</h1>
      <p class="page-subtitle">Create and manage access codes for premium content</p>
    </header>

    <!-- Success Message -->
    <div v-if="successMessage" class="message-banner success-banner animate-in">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <span>{{ successMessage }}</span>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="message-banner error-banner animate-in">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
      <span>{{ error }}</span>
    </div>

    <!-- Create Form -->
    <section class="create-section animate-in delay-1">
      <Card title="Create New Code" accent="gold">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </template>
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

        <template #footer>
          <div class="form-actions">
            <button class="btn-create" :disabled="isCreating" @click="createCode">
              <svg v-if="!isCreating" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span v-if="isCreating" class="spinner"></span>
              {{ isCreating ? 'Creating...' : 'Create Code' }}
            </button>
          </div>
        </template>
      </Card>
    </section>

    <!-- Codes Table -->
    <section class="codes-section animate-in delay-2">
      <Card title="Active Codes" accent="gradient" :loading="isLoading">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </template>

        <div v-if="codes.length > 0" class="table-wrapper">
          <table>
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
                <td>
                  <span class="access-badge" :class="code.access_type === 'full' ? 'badge-full' : 'badge-courses'">
                    {{ formatAccess(code) }}
                  </span>
                </td>
                <td>{{ formatDuration(code) }}</td>
                <td>{{ formatUses(code) }}</td>
                <td>{{ formatDate(code.expires_at) }}</td>
                <td class="actions-cell">
                  <button class="action-btn" @click="copyCode(code.code)" :title="copiedCode === code.code ? 'Copied!' : 'Copy code'">
                    <svg v-if="copiedCode !== code.code" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {{ copiedCode === code.code ? 'Copied' : 'Copy' }}
                  </button>
                  <button class="action-btn" @click="copyLink(code.code)" title="Copy shareable link">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    Link
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else-if="!isLoading" class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p>No entitlement codes yet</p>
          <span>Create one above to get started</span>
        </div>
      </Card>
    </section>
  </div>
</template>

<style scoped>
.admin-entitlements {
  padding: 0;
  max-width: 1200px;
}

/* Page Header */
.page-header {
  margin-bottom: var(--space-8);
}

.page-title {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  color: var(--text-primary);
  margin: 0 0 var(--space-1);
}

.page-subtitle {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  margin: 0;
}

/* Message Banners */
.message-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  margin-bottom: var(--space-4);
}

.success-banner {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--success) 25%, transparent);
  color: var(--success);
}

.error-banner {
  background: color-mix(in srgb, var(--error) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--error) 25%, transparent);
  color: var(--error);
}

/* Sections */
.create-section {
  margin-bottom: var(--space-8);
}

.codes-section {
  margin-bottom: var(--space-8);
}

/* Form Grid */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.form-group label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: var(--font-medium);
}

.form-group input,
.form-group select {
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-4);
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  transition: border-color var(--transition-fast);
}

.form-group input::placeholder {
  color: var(--text-muted);
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ssi-red) 15%, transparent);
}

/* Form Actions (in Card footer) */
.form-actions {
  display: flex;
  justify-content: flex-end;
}

.btn-create {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  background: var(--ssi-gold);
  color: #000;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-create:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

.btn-create:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-top-color: #000;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Table */
.table-wrapper {
  overflow-x: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

thead th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  color: var(--text-muted);
  font-weight: var(--font-medium);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-medium);
}

tbody td {
  padding: var(--space-3) var(--space-4);
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}

tbody tr {
  transition: background var(--transition-fast);
}

tbody tr:hover {
  background: var(--bg-secondary);
}

.inactive {
  opacity: 0.5;
}

.code-cell code {
  font-family: var(--font-mono);
  background: var(--bg-input);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--ssi-gold);
  border: 1px solid var(--border-subtle);
}

/* Access Badge */
.access-badge {
  display: inline-block;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.badge-full {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}

.badge-courses {
  background: color-mix(in srgb, var(--info) 12%, transparent);
  color: var(--info);
}

/* Action Buttons */
.actions-cell {
  white-space: nowrap;
  display: flex;
  gap: var(--space-2);
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  background: var(--bg-secondary);
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: var(--text-xs);
  font-family: var(--font-body);
  transition: all var(--transition-fast);
}

.action-btn:hover {
  color: var(--text-primary);
  border-color: var(--ssi-red);
  background: var(--bg-elevated);
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-12) var(--space-6);
  text-align: center;
}

.empty-state svg {
  color: var(--text-muted);
  opacity: 0.4;
  margin-bottom: var(--space-2);
}

.empty-state p {
  color: var(--text-secondary);
  font-weight: var(--font-medium);
  font-size: var(--text-base);
  margin: 0;
}

.empty-state span {
  color: var(--text-muted);
  font-size: var(--text-sm);
}
</style>
