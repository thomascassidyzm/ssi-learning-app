<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

interface TryLink {
  id: string
  code: string
  label: string
  ttl_days: number
  expires_at: string | null
  is_active: boolean
  created_at: string
  visit_count: number
  unique_visitors: number
  is_expired: boolean
}

const { getAuthToken } = useAdminClient()

const links = ref<TryLink[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const copiedId = ref<string | null>(null)

const formLabel = ref('')
const formTtlDays = ref<number>(90)

const activeCount = computed(() =>
  links.value.filter(l => l.is_active && !l.is_expired).length,
)

async function fetchLinks(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    if (!token) {
      error.value = 'Not authenticated'
      return
    }
    const response = await fetch('/api/try-link/list', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `Request failed: ${response.status}`)
    }
    const data = await response.json()
    links.value = data.links || []
  } catch (err: any) {
    error.value = err.message || 'Failed to load try links'
  } finally {
    isLoading.value = false
  }
}

async function createLink(): Promise<void> {
  if (!formLabel.value.trim()) {
    error.value = 'Label is required'
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

    const response = await fetch('/api/try-link/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        label: formLabel.value.trim(),
        ttl_days: formTtlDays.value,
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to create try link')
    }

    const created = await response.json()
    const tryUrl = `${window.location.origin}/try/${created.code}`
    successMessage.value = `Created: ${tryUrl}`
    setTimeout(() => { successMessage.value = null }, 8000)

    formLabel.value = ''
    formTtlDays.value = 90

    await fetchLinks()
  } catch (err: any) {
    error.value = err.message || 'Failed to create try link'
  } finally {
    isCreating.value = false
  }
}

async function deactivateLink(id: string): Promise<void> {
  error.value = null
  try {
    const token = await getAuthToken()
    if (!token) return

    const response = await fetch('/api/try-link/deactivate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to deactivate')
    }

    await fetchLinks()
  } catch (err: any) {
    error.value = err.message || 'Failed to deactivate link'
  }
}

async function copyLink(code: string, id: string): Promise<void> {
  const url = `${window.location.origin}/try/${code}`
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    const el = document.createElement('textarea')
    el.value = url
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
  copiedId.value = id
  setTimeout(() => {
    if (copiedId.value === id) copiedId.value = null
  }, 1800)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: '2-digit',
  })
}

function linkStatus(link: TryLink): { label: string; tone: 'green' | 'gold' | 'muted' } {
  if (!link.is_active) return { label: 'Disabled', tone: 'muted' }
  if (link.is_expired) return { label: 'Expired', tone: 'gold' }
  return { label: 'Active', tone: 'green' }
}

onMounted(() => {
  fetchLinks()
})
</script>

<template>
  <div class="admin-try-links">
    <!-- Page header -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Try Links</h1>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ links.length }}</span>
            links
          </span>
          <template v-if="activeCount > 0">
            <span class="metric-sep">·</span>
            <span class="metric metric-active">
              <span class="metric-value frost-mono-nums">{{ activeCount }}</span>
              active
            </span>
          </template>
        </div>
        <p class="page-subtitle">Zero-friction preview links for partners and affiliates</p>
      </div>
    </header>

    <!-- Banners -->
    <Transition name="fade">
      <div v-if="successMessage" class="banner banner-success">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span class="banner-msg">{{ successMessage }}</span>
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

    <!-- Create form — FrostCard panel -->
    <FrostCard variant="panel" class="create-panel">
      <div class="panel-head">
        <span class="frost-eyebrow">Create new try link</span>
      </div>
      <form class="create-form" @submit.prevent="createLink">
        <div class="field field-wide">
          <label class="frost-eyebrow">Label <span class="required">*</span></label>
          <input
            v-model="formLabel"
            type="text"
            class="frost-input"
            placeholder="e.g. Duolingo partnership, Aran's Twitter…"
          />
        </div>
        <div class="field">
          <label class="frost-eyebrow">Expires after <span class="optional">(days)</span></label>
          <input
            v-model.number="formTtlDays"
            type="number"
            min="1"
            max="365"
            class="frost-input"
          />
        </div>

        <div class="field-actions">
          <button
            type="submit"
            class="btn-primary"
            :disabled="isCreating || !formLabel.trim()"
          >
            <svg v-if="!isCreating" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span v-else class="spinner"></span>
            {{ isCreating ? 'Creating…' : 'Create link' }}
          </button>
        </div>
      </form>
    </FrostCard>

    <!-- Links list -->
    <FrostCard
      v-if="links.length > 0"
      variant="panel"
      class="links-panel"
    >
      <table class="links-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Code</th>
            <th>Visits</th>
            <th>Unique</th>
            <th>Expires</th>
            <th>Status</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="link in links"
            :key="link.id"
            :class="{ 'is-inactive': !link.is_active || link.is_expired }"
          >
            <td class="cell-label">{{ link.label }}</td>
            <td class="cell-code">
              <button
                class="code-chip"
                :class="{ 'is-copied': copiedId === link.id }"
                :title="copiedId === link.id ? 'Copied!' : 'Click to copy link'"
                @click="copyLink(link.code, link.id)"
              >
                <span class="code-value frost-mono-nums">{{ link.code }}</span>
                <svg v-if="copiedId !== link.id" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </td>
            <td class="cell-muted frost-mono-nums">{{ link.visit_count }}</td>
            <td class="cell-muted frost-mono-nums">{{ link.unique_visitors }}</td>
            <td class="cell-muted frost-mono-nums">{{ formatDate(link.expires_at) }}</td>
            <td>
              <span class="status-pill" :class="`tone-${linkStatus(link).tone}`">
                <span class="status-dot"></span>
                {{ linkStatus(link).label }}
              </span>
            </td>
            <td class="cell-actions">
              <button
                v-if="link.is_active && !link.is_expired"
                class="row-action row-action-danger"
                title="Deactivate link"
                @click.stop="deactivateLink(link.id)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </FrostCard>

    <!-- Empty state -->
    <FrostCard
      v-else-if="!isLoading"
      variant="tile"
      class="empty"
    >
      <div class="empty-ghost">try</div>
      <div class="empty-copy">
        <strong>No try links yet</strong>
        <p>Create one above and share it with partners or affiliates.</p>
      </div>
    </FrostCard>

    <!-- Loading -->
    <div v-if="isLoading && links.length === 0" class="loading">
      Loading try links…
    </div>
  </div>
</template>

<style scoped>
.admin-try-links {
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

.metric-sep { color: var(--ink-faint); }
.metric-active .metric-value { color: rgb(var(--tone-green)); }

.page-subtitle {
  margin: var(--space-2) 0 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
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

.banner-msg {
  word-break: break-all;
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
  grid-template-columns: 2fr 1fr;
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

.frost-input {
  font: inherit;
  font-size: var(--text-base);
  padding: 10px 14px;
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.frost-input::placeholder { color: var(--ink-faint); }

.frost-input:focus {
  outline: none;
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14);
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

@keyframes spin { to { transform: rotate(360deg); } }

/* Links table */
.links-panel {
  padding: 0;
  overflow: hidden;
}

.links-table {
  width: 100%;
  border-collapse: collapse;
}

.links-table thead th {
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

.links-table thead th:last-child { width: 56px; }

.links-table tbody tr {
  transition: background var(--transition-base);
}

.links-table tbody tr:hover { background: rgba(255, 255, 255, 0.48); }
.links-table tbody tr.is-inactive { opacity: 0.5; }

.links-table td {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.links-table tbody tr:last-child td { border-bottom: none; }

.cell-label {
  color: var(--ink-primary);
  font-weight: var(--font-medium);
}

.cell-muted {
  color: var(--ink-muted);
  white-space: nowrap;
}

/* Code chip */
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

/* Status pill */
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  border: 1px solid transparent;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.status-pill.tone-green {
  color: rgb(var(--tone-green));
  background: rgba(var(--tone-green), 0.10);
  border-color: rgba(var(--tone-green), 0.30);
}

.status-pill.tone-gold {
  color: rgb(var(--tone-gold));
  background: rgba(var(--tone-gold), 0.12);
  border-color: rgba(var(--tone-gold), 0.32);
}

.status-pill.tone-muted {
  color: var(--ink-faint);
  background: rgba(44, 38, 34, 0.04);
  border-color: rgba(44, 38, 34, 0.10);
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

.links-table tbody tr:hover .row-action,
.links-table tbody tr:focus-within .row-action {
  opacity: 1;
  transform: translateX(0);
}

.row-action:hover {
  color: var(--ink-primary);
  background: rgba(255, 255, 255, 0.72);
  border-color: rgba(44, 38, 34, 0.1);
}

.row-action-danger:hover {
  color: rgb(var(--tone-red));
  background: rgba(var(--tone-red), 0.08);
  border-color: rgba(var(--tone-red), 0.25);
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
  .create-form { grid-template-columns: 1fr; }
  /* Hide Visits + Unique on mobile */
  .links-table thead th:nth-child(3),
  .links-table tbody td:nth-child(3),
  .links-table thead th:nth-child(4),
  .links-table tbody td:nth-child(4) {
    display: none;
  }
}
</style>
