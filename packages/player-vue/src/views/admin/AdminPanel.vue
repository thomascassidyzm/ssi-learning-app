<script setup lang="ts">
import { ref, inject, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { getSchoolsClient } from '@/composables/schools/client'
import { useGodMode } from '@/composables/schools/useGodMode'

interface Region {
  code: string
  name: string
}

interface InviteCode {
  id: string
  code: string
  code_type: string
  region_code: string | null
  organization_name: string | null
  created_at: string
  expires_at: string | null
  max_uses: number | null
  use_count: number
  is_active: boolean
}

const { user, learner } = useAuth()
const { selectedUser } = useGodMode()

// Determine current user's platform_role
const isSsiAdmin = ref(false)
const isGovtAdmin = ref(false)

// State
const regions = ref<Region[]>([])
const codes = ref<InviteCode[]>([])
const isLoadingCodes = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const copiedCode = ref<string | null>(null)

// Form state
const selectedRegion = ref('')
const organizationName = ref('')
const expiresAt = ref('')
const maxUses = ref<number | ''>('')
const codeType = ref<'govt_admin' | 'school_admin'>('govt_admin')

function getCurrentUserId(): string | null {
  if (selectedUser.value) return selectedUser.value.user_id
  if (user.value) return user.value.id
  if (learner.value) return learner.value.user_id
  return null
}

async function fetchRegionsAndCodes(): Promise<void> {
  const client = getSchoolsClient()
  const userId = getCurrentUserId()
  if (!userId) return

  isLoadingCodes.value = true
  error.value = null

  try {
    // Fetch regions
    const { data: regionData, error: regionError } = await client
      .from('regions')
      .select('code, name')
      .order('name')

    if (regionError) throw regionError
    regions.value = regionData || []

    // Determine admin role
    const { data: learnerData } = await client
      .from('learners')
      .select('platform_role, educational_role')
      .eq('user_id', userId)
      .single()

    if (learnerData) {
      isSsiAdmin.value = learnerData.platform_role === 'ssi_admin'
      isGovtAdmin.value = learnerData.educational_role === 'govt_admin'
    } else if (selectedUser.value) {
      isSsiAdmin.value = selectedUser.value.platform_role === 'ssi_admin'
      isGovtAdmin.value = selectedUser.value.educational_role === 'govt_admin'
    }

    // Set default code type based on role
    if (!isSsiAdmin.value && isGovtAdmin.value) {
      codeType.value = 'school_admin'
    }

    // Fetch invite codes created by this user
    const { data: codesData, error: codesError } = await client
      .from('invite_codes')
      .select('*')
      .eq('created_by', userId)
      .order('created_at', { ascending: false })

    if (codesError) throw codesError
    codes.value = codesData || []
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load data'
    console.error('[AdminPanel] fetch error:', err)
  } finally {
    isLoadingCodes.value = false
  }
}

async function createCode(): Promise<void> {
  if (!organizationName.value.trim()) {
    error.value = 'Organization name is required'
    return
  }

  isCreating.value = true
  error.value = null
  successMessage.value = null

  try {
    // Get Clerk token for API call
    let token: string | null = null
    if (user.value) {
      // @ts-ignore - Clerk session token
      const session = window.Clerk?.session
      if (session) {
        token = await session.getToken()
      }
    }

    const body: Record<string, unknown> = {
      code_type: codeType.value,
      organization_name: organizationName.value.trim(),
    }

    if (selectedRegion.value) body.region_code = selectedRegion.value
    if (expiresAt.value) body.expires_at = new Date(expiresAt.value).toISOString()
    if (maxUses.value !== '') body.max_uses = Number(maxUses.value)

    // If god mode, include created_by
    if (selectedUser.value) {
      body.created_by = selectedUser.value.user_id
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch('/api/invite/create', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }

    const result = await response.json()
    successMessage.value = `Code created: ${result.code}`

    // Reset form
    organizationName.value = ''
    selectedRegion.value = ''
    expiresAt.value = ''
    maxUses.value = ''

    // Refresh codes list
    await fetchRegionsAndCodes()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create code'
    console.error('[AdminPanel] create error:', err)
  } finally {
    isCreating.value = false
  }
}

async function toggleCodeActive(code: InviteCode): Promise<void> {
  const client = getSchoolsClient()
  error.value = null

  try {
    const { error: updateError } = await client
      .from('invite_codes')
      .update({ is_active: !code.is_active })
      .eq('id', code.id)

    if (updateError) throw updateError

    code.is_active = !code.is_active
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update code'
  }
}

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
    copiedCode.value = code
    setTimeout(() => {
      if (copiedCode.value === code) copiedCode.value = null
    }, 2000)
  } catch {
    // Fallback for older browsers
    const el = document.createElement('textarea')
    el.value = code
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    copiedCode.value = code
    setTimeout(() => {
      if (copiedCode.value === code) copiedCode.value = null
    }, 2000)
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatCodeType(type: string): string {
  return type === 'govt_admin' ? 'Govt Admin' : 'School Admin'
}

onMounted(() => {
  fetchRegionsAndCodes()
})
</script>

<template>
  <div class="admin-panel">
    <h2 class="panel-title">Invite Codes</h2>

    <!-- Error / Success -->
    <div v-if="error" class="alert alert-error">{{ error }}</div>
    <div v-if="successMessage" class="alert alert-success">{{ successMessage }}</div>

    <!-- Create Code Form -->
    <section class="card">
      <h3 class="card-title">Create New Code</h3>

      <div class="form-grid">
        <!-- Code Type -->
        <div class="form-group">
          <label class="form-label">Code Type</label>
          <select v-model="codeType" class="form-control">
            <option v-if="isSsiAdmin" value="govt_admin">Govt Admin</option>
            <option value="school_admin">School Admin</option>
          </select>
        </div>

        <!-- Region -->
        <div class="form-group">
          <label class="form-label">Region</label>
          <select v-model="selectedRegion" class="form-control">
            <option value="">— No region —</option>
            <option v-for="r in regions" :key="r.code" :value="r.code">
              {{ r.name }} ({{ r.code }})
            </option>
          </select>
        </div>

        <!-- Organization Name -->
        <div class="form-group form-group--wide">
          <label class="form-label">Organization Name <span class="required">*</span></label>
          <input
            v-model="organizationName"
            type="text"
            class="form-control"
            placeholder="e.g. Welsh Government, Ysgol Gymraeg Bro Morgannwg"
          />
        </div>

        <!-- Expires At -->
        <div class="form-group">
          <label class="form-label">Expires At <span class="optional">(optional)</span></label>
          <input v-model="expiresAt" type="date" class="form-control" />
        </div>

        <!-- Max Uses -->
        <div class="form-group">
          <label class="form-label">Max Uses <span class="optional">(optional)</span></label>
          <input
            v-model="maxUses"
            type="number"
            class="form-control"
            min="1"
            placeholder="Unlimited"
          />
        </div>
      </div>

      <button
        class="btn btn-primary"
        :disabled="isCreating || !organizationName.trim()"
        @click="createCode"
      >
        {{ isCreating ? 'Creating...' : 'Create Code' }}
      </button>
    </section>

    <!-- Codes Table -->
    <section class="card">
      <h3 class="card-title">Your Codes</h3>

      <div v-if="isLoadingCodes" class="loading">Loading codes...</div>

      <div v-else-if="codes.length === 0" class="empty-state">
        No invite codes yet. Create one above.
      </div>

      <div v-else class="table-wrapper">
        <table class="codes-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Type</th>
              <th>Organization</th>
              <th>Region</th>
              <th>Created</th>
              <th>Expires</th>
              <th>Uses</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="code in codes" :key="code.id" :class="{ 'row--inactive': !code.is_active }">
              <td class="code-cell">
                <span class="code-text">{{ code.code }}</span>
                <button
                  class="copy-btn"
                  :class="{ 'copy-btn--copied': copiedCode === code.code }"
                  @click="copyCode(code.code)"
                >
                  {{ copiedCode === code.code ? 'Copied!' : 'Copy' }}
                </button>
              </td>
              <td>
                <span class="badge" :class="`badge--${code.code_type}`">
                  {{ formatCodeType(code.code_type) }}
                </span>
              </td>
              <td>{{ code.organization_name || '—' }}</td>
              <td>{{ code.region_code || '—' }}</td>
              <td>{{ formatDate(code.created_at) }}</td>
              <td>{{ formatDate(code.expires_at) }}</td>
              <td>
                {{ code.use_count }}{{ code.max_uses !== null ? ` / ${code.max_uses}` : '' }}
              </td>
              <td>
                <button
                  class="toggle-btn"
                  :class="code.is_active ? 'toggle-btn--active' : 'toggle-btn--inactive'"
                  @click="toggleCodeActive(code)"
                >
                  {{ code.is_active ? 'Active' : 'Inactive' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.admin-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.panel-title {
  font-size: 1.5rem;
  font-weight: 700;
  margin: 0 0 8px;
  color: var(--text-primary, #e8e8f0);
}

/* Cards */
.card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 24px;
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 20px;
  color: var(--text-primary, #e8e8f0);
}

/* Alerts */
.alert {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.875rem;
}

.alert-error {
  background: rgba(220, 60, 60, 0.15);
  border: 1px solid rgba(220, 60, 60, 0.3);
  color: #ff8080;
}

.alert-success {
  background: rgba(60, 180, 120, 0.15);
  border: 1px solid rgba(60, 180, 120, 0.3);
  color: #6de8a8;
}

/* Form */
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

.form-group--wide {
  grid-column: 1 / -1;
}

.form-label {
  display: block;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary, #a0a0b8);
  margin-bottom: 6px;
}

.required {
  color: #ff8080;
}

.optional {
  color: var(--text-tertiary, #606078);
  font-weight: 400;
}

.form-control {
  width: 100%;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: var(--text-primary, #e8e8f0);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.form-control:focus {
  border-color: rgba(255, 255, 255, 0.3);
}

.form-control::placeholder {
  color: var(--text-tertiary, #606078);
}

select.form-control option {
  background: #1a1a2e;
  color: #e8e8f0;
}

/* Buttons */
.btn {
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s, transform 0.1s;
}

.btn:active {
  transform: scale(0.98);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--ssi-gold, #d4a853);
  color: #0a0a1a;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

/* Table */
.table-wrapper {
  overflow-x: auto;
}

.codes-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.codes-table th {
  text-align: left;
  padding: 10px 12px;
  color: var(--text-secondary, #a0a0b8);
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.codes-table td {
  padding: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: var(--text-primary, #e8e8f0);
}

.codes-table tr.row--inactive td {
  opacity: 0.5;
}

.code-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.code-text {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.8125rem;
  background: rgba(255, 255, 255, 0.06);
  padding: 3px 8px;
  border-radius: 4px;
}

.copy-btn {
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: var(--text-secondary, #a0a0b8);
  transition: all 0.15s;
  white-space: nowrap;
}

.copy-btn:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: var(--text-primary, #e8e8f0);
}

.copy-btn--copied {
  border-color: rgba(60, 180, 120, 0.4);
  color: #6de8a8;
}

.badge {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.badge--govt_admin {
  background: rgba(100, 120, 220, 0.2);
  color: #8898ee;
}

.badge--school_admin {
  background: rgba(80, 180, 140, 0.2);
  color: #5cd4a8;
}

.toggle-btn {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.15s;
}

.toggle-btn--active {
  background: rgba(60, 180, 120, 0.15);
  border-color: rgba(60, 180, 120, 0.3);
  color: #6de8a8;
}

.toggle-btn--active:hover {
  background: rgba(60, 180, 120, 0.25);
}

.toggle-btn--inactive {
  background: rgba(150, 150, 170, 0.1);
  border-color: rgba(150, 150, 170, 0.2);
  color: var(--text-secondary, #a0a0b8);
}

.toggle-btn--inactive:hover {
  background: rgba(60, 180, 120, 0.1);
}

.loading,
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary, #a0a0b8);
  font-size: 0.875rem;
}

@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-group--wide {
    grid-column: 1;
  }
}
</style>
