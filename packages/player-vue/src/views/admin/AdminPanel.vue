<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useAdminClient } from '@/composables/useAdminClient'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

interface Group {
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

const isSsiAdmin = ref(false)
const isGovtAdmin = ref(false)

const groups = ref<Group[]>([])
const codes = ref<InviteCode[]>([])
const isLoadingCodes = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const copiedCode = ref<string | null>(null)

// Form state
const selectedGroup = ref('')
const organizationName = ref('')
const expiresAt = ref('')
const maxUses = ref<number | ''>('')
const codeType = ref<'ssi_admin' | 'govt_admin' | 'school_admin' | 'tester'>('govt_admin')

const activeCount = computed(() => codes.value.filter(c => c.is_active).length)

function getCurrentUserId(): string | null {
  if (user.value) return user.value.id
  if (learner.value) return learner.value.user_id
  return null
}

async function fetchGroupsAndCodes(): Promise<void> {
  const client = getClient()
  const userId = getCurrentUserId()
  if (!userId) return

  isLoadingCodes.value = true
  error.value = null

  try {
    const { data: groupData, error: groupError } = await client
      .from('regions')
      .select('code, name')
      .order('name')

    if (groupError) throw groupError
    groups.value = groupData || []

    const { data: learnerData } = await client
      .from('learners')
      .select('platform_role, educational_role')
      .eq('user_id', userId)
      .single()

    if (learnerData) {
      isSsiAdmin.value =
        learnerData.platform_role === 'ssi_admin' || learnerData.educational_role === 'god'
      isGovtAdmin.value = learnerData.educational_role === 'govt_admin'
    }

    if (!isSsiAdmin.value && isGovtAdmin.value) {
      codeType.value = 'school_admin'
    }

    let query = client.from('invite_codes').select('*').order('created_at', { ascending: false })
    if (!isSsiAdmin.value) {
      query = query.eq('created_by', userId)
    }
    const { data: codesData, error: codesError } = await query

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

    if (selectedGroup.value) body.region_code = selectedGroup.value
    if (expiresAt.value) body.expires_at = new Date(expiresAt.value).toISOString()
    if (maxUses.value !== '') body.max_uses = Number(maxUses.value)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
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

    organizationName.value = ''
    selectedGroup.value = ''
    expiresAt.value = ''
    maxUses.value = ''

    await fetchGroupsAndCodes()
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
  } catch {
    const el = document.createElement('textarea')
    el.value = code
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
  copiedCode.value = code
  setTimeout(() => {
    if (copiedCode.value === code) copiedCode.value = null
  }, 1800)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  })
}

function formatCodeType(type: string): string {
  if (type === 'ssi_admin') return 'SSi Admin'
  if (type === 'govt_admin') return 'Govt Admin'
  if (type === 'school_admin') return 'School Admin'
  if (type === 'tester') return 'Tester'
  return type
}

function codeTypeTone(type: string): string {
  if (type === 'ssi_admin') return 'gold'
  if (type === 'govt_admin') return 'blue'
  if (type === 'school_admin') return 'green'
  if (type === 'tester') return 'red'
  return 'blue'
}

function formatUses(code: InviteCode): string {
  if (code.max_uses === null) return `${code.use_count} / ∞`
  return `${code.use_count} / ${code.max_uses}`
}

onMounted(() => {
  fetchGroupsAndCodes()
})
</script>

<template>
  <div class="admin-invites">
    <!-- Page header — canon §5.1 -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Invite Codes</h1>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ codes.length }}</span>
            codes
          </span>
          <template v-if="codes.length > 0">
            <span class="metric-sep">·</span>
            <span class="metric metric-active">
              <span class="metric-value frost-mono-nums">{{ activeCount }}</span>
              active
            </span>
          </template>
        </div>
      </div>
    </header>

    <!-- Banners -->
    <Transition name="fade">
      <div v-if="successMessage" class="banner banner-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span>{{ successMessage }}</span>
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="error" class="banner banner-error">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <span>{{ error }}</span>
      </div>
    </Transition>

    <!-- Create form — FrostCard panel, NOT a Card header -->
    <FrostCard variant="panel" class="create-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Create new code</span>
      </div>
      <form class="create-form" @submit.prevent="createCode">
        <div class="field">
          <label class="frost-eyebrow">Code type</label>
          <select v-model="codeType" class="frost-select">
            <option v-if="isSsiAdmin" value="ssi_admin">SSi Admin</option>
            <option v-if="isSsiAdmin" value="govt_admin">Govt Admin</option>
            <option v-if="isSsiAdmin" value="tester">Tester</option>
            <option value="school_admin">School Admin</option>
          </select>
        </div>

        <div class="field">
          <label class="frost-eyebrow">Group</label>
          <select v-model="selectedGroup" class="frost-select">
            <option value="">— No group —</option>
            <option v-for="r in groups" :key="r.code" :value="r.code">
              {{ r.name }}
            </option>
          </select>
        </div>

        <div class="field field-wide">
          <label class="frost-eyebrow">Organisation name <span class="required">*</span></label>
          <input
            v-model="organizationName"
            type="text"
            class="frost-input"
            placeholder="e.g. Welsh Government"
          />
        </div>

        <div class="field">
          <label class="frost-eyebrow">Expires <span class="optional">(optional)</span></label>
          <input v-model="expiresAt" type="date" class="frost-input" />
        </div>

        <div class="field">
          <label class="frost-eyebrow">Max uses <span class="optional">(blank = unlimited)</span></label>
          <input
            v-model="maxUses"
            type="number"
            min="1"
            class="frost-input"
            placeholder="Unlimited"
          />
        </div>

        <div class="field-actions">
          <button
            type="submit"
            class="btn-primary"
            :disabled="isCreating || !organizationName.trim()"
          >
            <svg v-if="!isCreating" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span v-else class="spinner"></span>
            {{ isCreating ? 'Creating…' : 'Create code' }}
          </button>
        </div>
      </form>
    </FrostCard>

    <!-- Codes list — table-inside-panel canon §5.3 -->
    <FrostCard
      v-if="codes.length > 0"
      variant="panel"
      class="codes-panel"
    >
      <table class="codes-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Type</th>
            <th>Organisation</th>
            <th>Group</th>
            <th>Uses</th>
            <th>Expires</th>
            <th>Status</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="code in codes"
            :key="code.id"
            :class="{ 'is-inactive': !code.is_active }"
          >
            <td class="cell-code">
              <button
                class="code-chip"
                :class="{ 'is-copied': copiedCode === code.code }"
                :title="copiedCode === code.code ? 'Copied!' : 'Click to copy'"
                @click="copyCode(code.code)"
              >
                <span class="code-value frost-mono-nums">{{ code.code }}</span>
                <svg v-if="copiedCode !== code.code" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </td>
            <td>
              <span
                class="type-pill"
                :class="`tone-${codeTypeTone(code.code_type)}`"
              >
                {{ formatCodeType(code.code_type) }}
              </span>
            </td>
            <td class="cell-org">{{ code.organization_name || '—' }}</td>
            <td class="cell-muted">{{ code.region_code || '—' }}</td>
            <td class="cell-muted frost-mono-nums">{{ formatUses(code) }}</td>
            <td class="cell-muted frost-mono-nums">{{ formatDate(code.expires_at) }}</td>
            <td>
              <button
                class="status-pill"
                :class="code.is_active ? 'is-active' : 'is-disabled'"
                @click="toggleCodeActive(code)"
              >
                <span class="status-dot"></span>
                {{ code.is_active ? 'Active' : 'Disabled' }}
              </button>
            </td>
            <td class="cell-actions">
              <button
                class="row-action"
                :title="copiedCode === code.code ? 'Copied!' : 'Copy code'"
                @click.stop="copyCode(code.code)"
              >
                <svg v-if="copiedCode !== code.code" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </FrostCard>

    <!-- Empty state — canon §5.5 -->
    <FrostCard
      v-else-if="!isLoadingCodes"
      variant="tile"
      class="empty"
    >
      <div class="empty-ghost">codes</div>
      <div class="empty-copy">
        <strong>No invite codes yet</strong>
        <p>Create one above and share it to invite admins or testers.</p>
      </div>
    </FrostCard>

    <!-- Loading -->
    <div v-if="isLoadingCodes && codes.length === 0" class="loading">
      Loading codes…
    </div>
  </div>
</template>

<style scoped>
.admin-invites {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* Page header */
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-6);
}

.title-block h1 {
  font-family: var(--font-display);
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 0 0 var(--space-2);
}

.metrics {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.metric-value {
  color: var(--ink-primary);
  font-weight: var(--font-semibold);
  margin-right: 4px;
}

.metric-sep {
  color: var(--ink-faint);
}

.metric-active .metric-value {
  color: rgb(var(--tone-green));
}

/* Banners */
.banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-success {
  background: rgba(var(--tone-green), 0.10);
  border: 1px solid rgba(var(--tone-green), 0.28);
  color: rgb(var(--tone-green));
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
}

/* Create form */
.create-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.create-form {
  padding: var(--space-5) var(--space-6) var(--space-6);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-wide {
  grid-column: 1 / -1;
}

.field-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-2);
}

.field label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.required {
  color: rgb(var(--tone-red));
  font-weight: var(--font-bold);
  font-family: var(--font-mono);
}

.optional {
  color: var(--ink-faint);
  font-weight: var(--font-normal);
  text-transform: none;
  letter-spacing: 0;
}

.frost-input,
.frost-select {
  font: inherit;
  font-size: var(--text-base);
  padding: 10px 14px;
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder {
  color: var(--ink-faint);
}

.frost-input:focus,
.frost-select:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
}

.frost-select {
  appearance: none;
  background-image:
    url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238A8078' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
}

/* Buttons */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 10px 18px;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  background: var(--ssi-red);
  color: #fff;
  cursor: pointer;
  transition: all var(--transition-base);
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.08), 0 4px 14px rgba(194, 58, 58, 0.22);
}

.btn-primary:hover:not(:disabled) {
  background: var(--ssi-red-light);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.10), 0 8px 22px rgba(194, 58, 58, 0.28);
}

.btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Codes table */
.codes-panel {
  padding: 0;
  overflow: hidden;
}

.codes-table {
  width: 100%;
  border-collapse: collapse;
}

.codes-table thead th {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  text-align: left;
  color: var(--ink-muted);
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  background: rgba(255, 255, 255, 0.35);
}

.codes-table thead th:last-child {
  width: 56px;
}

.codes-table tbody tr {
  transition: background var(--transition-base);
}

.codes-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.48);
}

.codes-table tbody tr.is-inactive {
  opacity: 0.5;
}

.codes-table td {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.codes-table tbody tr:last-child td {
  border-bottom: none;
}

.cell-org {
  color: var(--ink-primary);
  font-weight: var(--font-medium);
}

.cell-muted {
  color: var(--ink-muted);
  white-space: nowrap;
}

/* Code chip — primary representation of the code value */
.code-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-md);
  font: inherit;
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--ink-secondary);
}

.code-chip:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.16);
  color: var(--ink-primary);
}

.code-chip.is-copied {
  background: rgba(var(--tone-green), 0.16);
  border-color: rgba(var(--tone-green), 0.45);
  color: rgb(var(--tone-green));
}

.code-value {
  font-size: var(--text-sm);
  letter-spacing: 0.05em;
}

/* Type pill — tonal */
.type-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid transparent;
}

.type-pill.tone-blue {
  background: rgba(var(--tone-blue), 0.14);
  border-color: rgba(var(--tone-blue), 0.32);
  color: rgb(var(--tone-blue));
}

.type-pill.tone-gold {
  background: rgba(var(--tone-gold), 0.18);
  border-color: rgba(var(--tone-gold), 0.42);
  color: rgb(var(--tone-gold));
}

.type-pill.tone-green {
  background: rgba(var(--tone-green), 0.14);
  border-color: rgba(var(--tone-green), 0.36);
  color: rgb(var(--tone-green));
}

.type-pill.tone-red {
  background: rgba(var(--tone-red), 0.12);
  border-color: rgba(var(--tone-red), 0.32);
  color: rgb(var(--tone-red));
}

/* Status pill (clickable to toggle) */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-pill.is-active {
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.10);
  border-color: rgba(var(--tone-green), 0.30);
}

.status-pill.is-active:hover {
  background: rgba(var(--tone-green), 0.18);
}

.status-pill.is-disabled {
  color: var(--ink-faint);
  background: rgba(44, 38, 34, 0.04);
  border-color: rgba(44, 38, 34, 0.10);
}

.status-pill.is-disabled:hover {
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.08);
  border-color: rgba(var(--tone-green), 0.25);
}

/* Hover-reveal action */
.cell-actions {
  text-align: right;
  padding-right: 12px;
}

.row-action {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--ink-muted);
  cursor: pointer;
  opacity: 0;
  transform: translateX(4px);
  transition: all var(--transition-fast);
}

.codes-table tbody tr:hover .row-action,
.codes-table tbody tr:focus-within .row-action {
  opacity: 1;
  transform: translateX(0);
}

.row-action:hover {
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(44, 38, 34, 0.1);
}

/* Empty state */
.empty {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-6);
  align-items: center;
  padding: var(--space-10) var(--space-8);
  min-height: 180px;
}

.empty-ghost {
  font-family: var(--font-display);
  font-size: 88px;
  font-weight: var(--font-bold);
  letter-spacing: -0.03em;
  color: var(--ink-faint);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--ink-primary);
  margin-bottom: 4px;
}

.empty-copy p {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.loading {
  text-align: center;
  padding: var(--space-12);
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

/* Transitions */
.fade-enter-active, .fade-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (max-width: 768px) {
  .create-form {
    grid-template-columns: 1fr;
  }
  .codes-table thead th:nth-child(4),
  .codes-table tbody td:nth-child(4),
  .codes-table thead th:nth-child(6),
  .codes-table tbody td:nth-child(6) {
    display: none;
  }
}
</style>
