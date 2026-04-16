<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import Card from '@/components/schools/shared/Card.vue'

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

// State
const links = ref<TryLink[]>([])
const isLoading = ref(false)
const isCreating = ref(false)
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const copiedId = ref<string | null>(null)

// Form state
const formLabel = ref('')
const formTtlDays = ref<number>(90)

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
      headers: { 'Authorization': `Bearer ${token}` },
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
        'Authorization': `Bearer ${token}`,
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
    successMessage.value = `Created! Link: ${tryUrl}`
    setTimeout(() => { successMessage.value = null }, 8000)

    // Reset form
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
        'Authorization': `Bearer ${token}`,
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

function copyLink(code: string, id: string) {
  const url = `${window.location.origin}/try/${code}`
  navigator.clipboard.writeText(url).then(() => {
    copiedId.value = id
    setTimeout(() => { copiedId.value = null }, 2000)
  })
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  return new Date(dateStr).toLocaleDateString()
}

function linkStatus(link: TryLink): string {
  if (!link.is_active) return 'Deactivated'
  if (link.is_expired) return 'Expired'
  return 'Active'
}

function statusClass(link: TryLink): string {
  if (!link.is_active) return 'status-deactivated'
  if (link.is_expired) return 'status-expired'
  return 'status-active'
}

onMounted(() => {
  fetchLinks()
})
</script>

<template>
  <div class="admin-try-links">
    <!-- Page Header -->
    <header class="page-header animate-in">
      <h1 class="page-title">Try Links</h1>
      <p class="page-subtitle">Zero-friction preview links for partners and affiliates</p>
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
      <Card title="Create Try Link" accent="gold">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
        </template>
        <div class="form-grid">
          <div class="form-group">
            <label>Label</label>
            <input v-model="formLabel" type="text" placeholder="e.g. Duolingo partnership, Aran's Twitter..." />
          </div>

          <div class="form-group">
            <label>Expires after (days)</label>
            <input v-model.number="formTtlDays" type="number" min="1" max="365" />
          </div>
        </div>

        <template #footer>
          <div class="form-actions">
            <button class="btn-create" :disabled="isCreating || !formLabel.trim()" @click="createLink">
              <span v-if="isCreating" class="spinner" />
              {{ isCreating ? 'Creating...' : 'Create Link' }}
            </button>
          </div>
        </template>
      </Card>
    </section>

    <!-- Links Table -->
    <section class="links-section animate-in delay-2">
      <Card title="All Try Links" accent="gradient" :loading="isLoading">
        <template #icon>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </template>

        <div v-if="links.length > 0" class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Code</th>
                <th>Visits</th>
                <th>Unique</th>
                <th>Expires</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="link in links" :key="link.id" :class="{ inactive: !link.is_active || link.is_expired }">
                <td class="label-cell">{{ link.label }}</td>
                <td class="code-cell"><code>{{ link.code }}</code></td>
                <td class="count-cell">{{ link.visit_count }}</td>
                <td class="count-cell">{{ link.unique_visitors }}</td>
                <td>{{ formatDate(link.expires_at) }}</td>
                <td>
                  <span class="status-badge" :class="statusClass(link)">
                    {{ linkStatus(link) }}
                  </span>
                </td>
                <td class="actions-cell">
                  <button class="action-btn" @click="copyLink(link.code, link.id)" :title="copiedId === link.id ? 'Copied!' : 'Copy link'">
                    <svg v-if="copiedId !== link.id" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {{ copiedId === link.id ? 'Copied' : 'Copy link' }}
                  </button>
                  <button
                    v-if="link.is_active && !link.is_expired"
                    class="action-btn action-danger"
                    @click="deactivateLink(link.id)"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="15" y1="9" x2="9" y2="15"/>
                      <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    Deactivate
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else-if="!isLoading" class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          <p>No try links yet</p>
          <span>Create one above to share with partners</span>
        </div>
      </Card>
    </section>
  </div>
</template>

<style scoped>
.admin-try-links {
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
  word-break: break-all;
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

.links-section {
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

.form-group input:focus {
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
  -webkit-overflow-scrolling: touch;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

thead th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}

tbody td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  vertical-align: middle;
}

tbody tr:last-child td {
  border-bottom: none;
}

tbody tr.inactive {
  opacity: 0.5;
}

.label-cell {
  font-weight: var(--font-medium);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.code-cell code {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding: var(--space-1) var(--space-2);
  background: var(--bg-input);
  border-radius: var(--radius-sm);
}

.count-cell {
  font-family: var(--font-mono);
  font-weight: var(--font-semibold);
}

/* Status Badges */
.status-badge {
  display: inline-block;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
}

.status-active {
  background: color-mix(in srgb, var(--success) 15%, transparent);
  color: var(--success);
}

.status-expired {
  background: color-mix(in srgb, var(--warning, #f59e0b) 15%, transparent);
  color: var(--warning, #f59e0b);
}

.status-deactivated {
  background: color-mix(in srgb, var(--text-muted) 15%, transparent);
  color: var(--text-muted);
}

/* Actions */
.actions-cell {
  white-space: nowrap;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: var(--font-body);
  margin-right: var(--space-2);
}

.action-btn:hover {
  border-color: var(--text-primary);
  color: var(--text-primary);
}

.action-danger:hover {
  border-color: var(--error);
  color: var(--error);
}

/* Empty State */
.empty-state {
  text-align: center;
  padding: var(--space-12) var(--space-4);
  color: var(--text-muted);
}

.empty-state svg {
  opacity: 0.3;
  margin-bottom: var(--space-4);
}

.empty-state p {
  font-size: var(--text-base);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
  margin: 0 0 var(--space-2);
}

.empty-state span {
  font-size: var(--text-sm);
}

/* Animations */
.animate-in {
  animation: fadeSlideIn 0.3s ease-out both;
}

.delay-1 { animation-delay: 0.05s; }
.delay-2 { animation-delay: 0.1s; }

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
