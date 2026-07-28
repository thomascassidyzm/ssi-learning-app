<script setup lang="ts">
// One live list of every outstanding way in — aggregated server-side from
// invite_codes, entitlement_codes, email_access_grants, try_links (see
// docs/invites-redesign/DESIGN.md's UnifiedInvite contract + GET/POST
// /api/admin/invites).
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'

interface UnifiedInvite {
  source: 'invite' | 'entitlement' | 'email_grant' | 'try_link'
  id: string
  code: string | null
  urlPath: string | null
  who: 'learner' | 'teacher' | 'school_admin' | 'govt_admin' | 'tester' | 'ssi_admin' | 'guest' | 'access'
  where: { kind: 'platform' | 'group' | 'school' | 'class'; id: string | null; name: string | null; path: string | null; isDemo: boolean }
  what: string
  email: string | null
  limits: { expiresAt: string | null; maxUses: number | null; useCount: number }
  isActive: boolean
  redeemedAt: string | null
  createdBy: string
  createdByName: string | null
  createdAt: string
}

const route = useRoute()
const { getAuthToken } = useAdminClient()

const invites = ref<UnifiedInvite[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const copiedId = ref<string | null>(null)
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')

watch(() => route.query.q, (v) => {
  if (typeof v === 'string') query.value = v
})

async function fetchInvites(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/admin/invites', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `Request failed: ${resp.status}`)
    invites.value = data.invites || []
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load invites'
    console.warn('[UnifiedInviteList] fetch failed:', err)
  } finally {
    isLoading.value = false
  }
}

defineExpose({ refresh: fetchInvites })

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return invites.value
  return invites.value.filter(inv =>
    (inv.code || '').toLowerCase().includes(q) ||
    (inv.where.name || '').toLowerCase().includes(q) ||
    (inv.where.path || '').toLowerCase().includes(q) ||
    (inv.email || '').toLowerCase().includes(q) ||
    (inv.createdByName || '').toLowerCase().includes(q) ||
    inv.what.toLowerCase().includes(q)
  )
})

const activeCount = computed(() => invites.value.filter(i => i.isActive).length)

function fullUrl(inv: UnifiedInvite): string {
  if (!inv.urlPath) return ''
  return `${window.location.origin}${inv.urlPath}`
}

async function copyLink(inv: UnifiedInvite): Promise<void> {
  const text = inv.urlPath ? fullUrl(inv) : (inv.email || '')
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
  copiedId.value = inv.id
  setTimeout(() => { if (copiedId.value === inv.id) copiedId.value = null }, 1800)
}

async function toggleActive(inv: UnifiedInvite): Promise<void> {
  error.value = null
  const next = !inv.isActive
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ source: inv.source, id: inv.id, is_active: next }),
    })
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      throw new Error(data.error || `Toggle failed: ${resp.status}`)
    }
    inv.isActive = next
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update invite'
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function formatUses(l: UnifiedInvite['limits']): string {
  if (l.maxUses === null) return `${l.useCount} / ∞`
  return `${l.useCount} / ${l.maxUses}`
}

function whoLabel(who: UnifiedInvite['who']): string {
  return {
    learner: 'Learner',
    teacher: 'Teacher',
    school_admin: 'School Admin',
    govt_admin: 'Group Leader',
    tester: 'Tester',
    ssi_admin: 'SSi Admin',
    guest: 'Guest',
    access: 'Access',
  }[who] || who
}

function whoTone(who: UnifiedInvite['who']): string {
  if (who === 'ssi_admin' || who === 'tester') return 'red'
  if (who === 'govt_admin') return 'blue'
  if (who === 'school_admin' || who === 'teacher') return 'green'
  if (who === 'access') return 'gold'
  return 'muted'
}

onMounted(fetchInvites)
</script>

<template>
  <div class="schools-card list-panel">
    <div class="panel-head list-panel-head">
      <div class="list-title">
        <span class="schools-kicker">All invites</span>
        <span v-if="invites.length" class="count-line">{{ invites.length }} invite{{ invites.length === 1 ? '' : 's' }} · {{ activeCount }} active</span>
      </div>
      <div class="filter-bar">
        <svg class="filter-bar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input v-model="query" type="text" class="filter-bar-input" placeholder="Search code, name, email…" />
      </div>
    </div>

    <div v-if="error" class="banner banner-error">{{ error }}</div>

    <table v-if="filtered.length > 0" class="codes-table">
      <thead>
        <tr>
          <th>Who</th>
          <th>Where</th>
          <th>What</th>
          <th>Link</th>
          <th>Uses</th>
          <th>Expires</th>
          <th>Created by</th>
          <th aria-label="Active"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="inv in filtered" :key="`${inv.source}-${inv.id}`" :class="{ 'is-inactive': !inv.isActive }">
          <td>
            <span class="type-pill" :class="`tone-${whoTone(inv.who)}`">{{ whoLabel(inv.who) }}</span>
          </td>
          <td class="cell-where">
            <span v-if="inv.where.name" class="cell-where-name">{{ inv.where.name }}</span>
            <span v-else class="cell-muted">—</span>
            <span v-if="inv.where.isDemo" class="demo-badge">Demo</span>
            <div v-if="inv.where.path" class="cell-where-path">{{ inv.where.path }}</div>
          </td>
          <td class="cell-detail">{{ inv.what }}</td>
          <td class="cell-code">
            <span v-if="inv.email" class="email-value">{{ inv.email }}</span>
            <button
              v-else-if="inv.code"
              class="code-chip"
              :class="{ 'is-copied': copiedId === inv.id }"
              :title="copiedId === inv.id ? 'Copied link!' : 'Click to copy shareable link'"
              @click="copyLink(inv)"
            >
              <span class="code-value mono-nums">{{ inv.code }}</span>
              <svg v-if="copiedId !== inv.id" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
            <span v-else class="cell-muted">—</span>
          </td>
          <td class="cell-muted mono-nums">{{ formatUses(inv.limits) }}</td>
          <td class="cell-muted mono-nums">{{ formatDate(inv.limits.expiresAt) }}</td>
          <td class="cell-muted">{{ inv.createdByName || '—' }}</td>
          <td>
            <button
              class="status-pill"
              :class="inv.isActive ? 'tone-green' : 'tone-muted'"
              data-walk="invites-active-toggle"
              @click="toggleActive(inv)"
            >
              <span class="status-dot"></span>
              {{ inv.isActive ? 'Active' : 'Disabled' }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-else-if="!isLoading" class="empty">
      <div class="empty-ghost">invites</div>
      <div class="empty-copy">
        <strong>{{ invites.length ? 'No invites match your search' : 'No invites yet' }}</strong>
        <p v-if="!invites.length">Create one above — every way in shows up here.</p>
      </div>
    </div>

    <div v-if="isLoading && invites.length === 0" class="loading">Loading invites…</div>
  </div>
</template>

<style scoped>
.mono-nums { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

.list-panel { padding: 0; overflow: hidden; }

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.list-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.list-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.count-line {
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-full);
  min-width: 220px;
}

.filter-bar-icon { color: var(--schools-fg-3); flex: none; }

.filter-bar-input {
  border: none;
  background: transparent;
  outline: none;
  font: inherit;
  font-size: var(--text-sm);
  color: var(--schools-fg);
  width: 100%;
}

.filter-bar-input::placeholder { color: var(--schools-fg-3); }

.banner {
  margin: var(--space-3) var(--space-6) 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
}

.banner-error {
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.28);
  color: rgb(var(--tone-red));
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
  color: var(--schools-fg-3);
  padding: 14px 18px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  background: #fafafa;
}

.codes-table tbody tr { transition: background var(--transition-base); }
.codes-table tbody tr:hover { background: rgba(255, 255, 255, 0.48); }
.codes-table tbody tr.is-inactive { opacity: 0.5; }

.codes-table td {
  padding: 12px 18px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.05);
  vertical-align: middle;
  color: var(--schools-fg-2);
  font-size: var(--text-sm);
}

.codes-table tbody tr:last-child td { border-bottom: none; }

.cell-where { min-width: 160px; }
.cell-where-name { color: var(--schools-fg); font-weight: var(--font-medium); }
.cell-where-path { font-size: var(--text-xs); color: var(--schools-fg-3); margin-top: 2px; }

.demo-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 7px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: var(--font-medium);
  background: rgba(var(--tone-amber, 194 132 58), 0.14);
  color: rgb(var(--tone-amber-ink, 154 96 24));
}

.cell-detail { color: var(--schools-fg); }
.cell-muted { color: var(--schools-fg-3); white-space: nowrap; }

.email-value {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--schools-fg);
}

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
  color: var(--schools-fg-2);
}

.code-chip:hover {
  background: rgba(255, 255, 255, 0.82);
  border-color: rgba(44, 38, 34, 0.16);
  color: var(--schools-fg);
}

.code-chip.is-copied {
  background: rgba(var(--tone-green), 0.16);
  border-color: rgba(var(--tone-green), 0.45);
  color: rgb(var(--tone-green-ink));
}

.code-value { font-size: var(--text-sm); letter-spacing: 0.05em; }

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

.type-pill.tone-blue { background: rgba(var(--tone-blue), 0.14); border-color: rgba(var(--tone-blue), 0.32); color: rgb(var(--tone-blue-ink)); }
.type-pill.tone-gold { background: rgba(var(--tone-gold), 0.18); border-color: rgba(var(--tone-gold), 0.42); color: rgb(var(--tone-gold-ink)); }
.type-pill.tone-green { background: rgba(var(--tone-green), 0.14); border-color: rgba(var(--tone-green), 0.36); color: rgb(var(--tone-green-ink)); }
.type-pill.tone-red { background: rgba(var(--tone-red), 0.12); border-color: rgba(var(--tone-red), 0.32); color: rgb(var(--tone-red)); }
.type-pill.tone-muted { background: rgba(44, 38, 34, 0.06); border-color: rgba(44, 38, 34, 0.1); color: var(--schools-fg-3); }

.status-pill { cursor: pointer; }
.status-pill.tone-green:hover { background: rgba(var(--tone-green), 0.24); }
.status-pill.tone-muted:hover {
  color: rgb(var(--tone-green-ink));
  background: rgba(var(--tone-green), 0.14);
  border-color: rgba(var(--tone-green-ink), 0.28);
}

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
  color: var(--schools-fg-3);
  opacity: 0.35;
  line-height: 0.9;
  user-select: none;
}

.empty-copy strong {
  display: block;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  color: var(--schools-fg);
  margin-bottom: 4px;
}

.empty-copy p { margin: 0; color: var(--schools-fg-3); font-size: var(--text-sm); }

.loading {
  text-align: center;
  padding: var(--space-12);
  color: var(--schools-fg-3);
  font-size: var(--text-sm);
}

@media (max-width: 768px) {
  .codes-table thead th:nth-child(6),
  .codes-table tbody td:nth-child(6),
  .codes-table thead th:nth-child(7),
  .codes-table tbody td:nth-child(7) {
    display: none;
  }
}
</style>
