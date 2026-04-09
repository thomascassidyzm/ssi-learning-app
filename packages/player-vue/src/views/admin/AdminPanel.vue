<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useAdminClient } from '@/composables/useAdminClient'
import { useGodMode } from '@/composables/schools/useGodMode'
import Card from '@/components/schools/shared/Card.vue'

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
const { getClient, getAuthToken } = useAdminClient()
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
const codeType = ref<'ssi_admin' | 'govt_admin' | 'school_admin'>('govt_admin')

function getCurrentUserId(): string | null {
  if (selectedUser.value) return selectedUser.value.user_id
  if (user.value) return user.value.id
  if (learner.value) return learner.value.user_id
  return null
}

async function fetchRegionsAndCodes(): Promise<void> {
  const client = getClient()
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
      isSsiAdmin.value = learnerData.platform_role === 'ssi_admin' || learnerData.educational_role === 'god'
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
    const token = await getAuthToken()

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
  const client = getClient()
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
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatCodeType(type: string): string {
  if (type === 'ssi_admin') return 'SSi Admin'
  if (type === 'govt_admin') return 'Govt Admin'
  if (type === 'school_admin') return 'School Admin'
  if (type === 'tester') return 'Beta Tester'
  return type
}

function formatUses(code: InviteCode): string {
  if (code.max_uses === null) return `${code.use_count} / unlimited`
  return `${code.use_count} / ${code.max_uses}`
}

onMounted(() => {
  fetchRegionsAndCodes()
})
</script>

<template>
  <div class="admin-invite-codes">
    <!-- Quick Links -->
    <nav class="quick-links animate-in">
      <a href="/schools" class="quick-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
        <span>Schools Dashboard</span>
      </a>
      <a href="/demo" class="quick-link">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>Schools Demo</span>
      </a>
    </nav>

    <!-- Page Header -->
    <header class="page-header animate-in">
      <h1 class="page-title">Invite Codes</h1>
      <p class="page-subtitle">Create role-based invite codes for organizations and schools</p>
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
      <Card title="Create New Code" accent="red">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </template>
        <div class="form-grid">
          <div class="form-group">
            <label>Code Type</label>
            <select v-model="codeType">
              <option v-if="isSsiAdmin" value="ssi_admin">SSi Admin</option>
              <option v-if="isSsiAdmin" value="govt_admin">Govt Admin</option>
              <option v-if="isSsiAdmin" value="tester">Tester</option>
              <option value="school_admin">School Admin</option>
            </select>
          </div>

          <div class="form-group">
            <label>Region</label>
            <select v-model="selectedRegion">
              <option value="">- No region -</option>
              <option v-for="r in regions" :key="r.code" :value="r.code">
                {{ r.name }} ({{ r.code }})
              </option>
            </select>
          </div>

          <div class="form-group form-group--wide">
            <label>Organization Name <span class="required">*</span></label>
            <input
              v-model="organizationName"
              type="text"
              placeholder="e.g. Welsh Government, Ysgol Gymraeg Bro Morgannwg"
            />
          </div>

          <div class="form-group">
            <label>Expires (optional)</label>
            <input v-model="expiresAt" type="date" />
          </div>

          <div class="form-group">
            <label>Max Uses (blank = unlimited)</label>
            <input v-model="maxUses" type="number" min="1" placeholder="Unlimited" />
          </div>
        </div>

        <template #footer>
          <div class="form-actions">
            <button class="btn-create" :disabled="isCreating || !organizationName.trim()" @click="createCode">
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
      <Card title="Your Codes" accent="gradient" :loading="isLoadingCodes">
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
                <th>Type</th>
                <th>Organization</th>
                <th>Region</th>
                <th>Uses</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="code in codes" :key="code.id" :class="{ inactive: !code.is_active }">
                <td class="code-cell">
                  <code>{{ code.code }}</code>
                  <button
                    class="action-btn"
                    @click="copyCode(code.code)"
                    :title="copiedCode === code.code ? 'Copied!' : 'Copy code'"
                  >
                    <svg v-if="copiedCode !== code.code" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {{ copiedCode === code.code ? 'Copied' : 'Copy' }}
                  </button>
                </td>
                <td>
                  <span class="type-badge" :class="`type-${code.code_type}`">
                    {{ formatCodeType(code.code_type) }}
                  </span>
                </td>
                <td>{{ code.organization_name || '-' }}</td>
                <td>{{ code.region_code || '-' }}</td>
                <td>{{ formatUses(code) }}</td>
                <td>{{ formatDate(code.expires_at) }}</td>
                <td>
                  <button
                    class="status-toggle"
                    :class="code.is_active ? 'status-active' : 'status-inactive'"
                    @click="toggleCodeActive(code)"
                  >
                    {{ code.is_active ? 'Active' : 'Inactive' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else-if="!isLoadingCodes" class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p>No invite codes yet</p>
          <span>Create one above to get started</span>
        </div>
      </Card>
    </section>
  </div>
</template>

<style scoped>
.quick-links {
  display: flex;
  gap: 12px;
  margin-bottom: 28px;
}

.quick-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-subtle, rgba(0,0,0,0.06));
  border-radius: 12px;
  color: var(--text-primary, #2C2622);
  text-decoration: none;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 500;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

.quick-link:hover {
  border-color: var(--ssi-red, #c23a3a);
  color: var(--ssi-red, #c23a3a);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.quick-link svg {
  opacity: 0.6;
  flex-shrink: 0;
}

.quick-link:hover svg {
  opacity: 1;
}

@media (max-width: 480px) {
  .quick-links {
    flex-direction: column;
  }
}

.admin-invite-codes {
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
  .form-group--wide {
    grid-column: 1;
  }
}

.form-group--wide {
  grid-column: 1 / -1;
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

.required {
  color: var(--ssi-red);
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

/* Form Actions */
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

.code-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
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

/* Type Badges */
.type-badge {
  display: inline-block;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.type-ssi_admin {
  background: color-mix(in srgb, var(--ssi-gold) 12%, transparent);
  color: var(--ssi-gold);
}

.type-govt_admin {
  background: color-mix(in srgb, var(--info) 12%, transparent);
  color: var(--info);
}

.type-school_admin {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}

/* Status Toggle */
.status-toggle {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  font-family: var(--font-body);
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--transition-fast);
}

.status-active {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  border-color: color-mix(in srgb, var(--success) 25%, transparent);
  color: var(--success);
}

.status-active:hover {
  background: color-mix(in srgb, var(--success) 20%, transparent);
}

.status-inactive {
  background: var(--bg-secondary);
  border-color: var(--border-subtle);
  color: var(--text-muted);
}

.status-inactive:hover {
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
  color: var(--text-secondary);
}

/* Action Buttons */
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
