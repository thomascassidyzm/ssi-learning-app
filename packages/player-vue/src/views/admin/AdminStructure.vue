<script setup lang="ts">
// Structure — TWO LENSES ON ONE TREE (THE-MODEL.md §1.9/§6/§7), VERBS ON
// TOP (§1.12). "There is no in-principle difference between a group, a
// school or an organisation" — every row in both lenses is the SAME group
// node; a school is just a node with label 'school' plus a commercial
// attachment (schools.node_group_id) shown as a status pill. Data comes
// from the server-mediated /api/groups/tree and /api/groups/table
// endpoints — no client-direct org-table reads (§6). Selecting a node opens
// NodePanel.vue — plain-language task buttons first (invite/add/see
// progress), ways-in LINKS second (§1.10 — the invites page dies), the
// deep dashboards (/admin/schools/:id, /admin/groups/:id) are one "See
// progress" tap away, not a destination you have to find first.
import { ref, computed, onMounted, provide, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import StructureTreeNode from '@/components/admin/StructureTreeNode.vue'
import NodePanel from '@/components/admin/NodePanel.vue'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import type { StructureApi, StructureNode } from '@/components/admin/structureApi'

const router = useRouter()
const { getAuthToken } = useAdminClient()

// ─── Banners ───
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)
const inviteResult = ref<{ url: string; hint: string } | null>(null)
const copiedCode = ref<string | null>(null)

function setSuccess(message: string, invite: { url: string; hint: string } | null = null): void {
  successMessage.value = message
  inviteResult.value = invite
  error.value = null
}

async function copyCode(code: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(code)
    copiedCode.value = code
    setTimeout(() => { if (copiedCode.value === code) copiedCode.value = null }, 2000)
  } catch {
    copiedCode.value = null
  }
}

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ─── Lens toggle + shared filters ───
const lens = ref<'tree' | 'table'>('tree')
const search = ref('')

// Plain-word quick filter (§1.12.4) — ONE flat, mutually-exclusive set
// replacing the old label-dropdown + demo 3-way + raw-status dropdown (which
// leaked jargon like "organisation"/"past_due" straight into the UI). Groups
// vs Schools is a STRUCTURAL split (has a commercial attachment or not,
// I3 — never the label string); Trial vs Paid mirrors the binary
// entitlement model (§1.11).
type QuickFilter = 'all' | 'groups' | 'schools' | 'trial' | 'paid' | 'demo'
const QUICK_FILTERS: { value: QuickFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'groups', label: 'Groups' },
  { value: 'schools', label: 'Schools' },
  { value: 'trial', label: 'Trial' },
  { value: 'paid', label: 'Paid' },
  { value: 'demo', label: 'Demo' },
]
const quickFilter = ref<QuickFilter>('all')

function flattenNodes(nodes: StructureNode[]): StructureNode[] {
  return nodes.flatMap((n) => [n, ...flattenNodes(n.children || [])])
}

// ─── Tree lens ───
const treeRoots = ref<StructureNode[]>([])
const focusedRootId = ref<string | null>(null)
const focusedRootName = ref<string | null>(null)
const isLoadingTree = ref(false)

async function fetchTree(): Promise<void> {
  isLoadingTree.value = true
  try {
    const token = await getAuthToken()
    const params = new URLSearchParams({ depth: '3' })
    if (focusedRootId.value) params.set('root', focusedRootId.value)
    const resp = await fetch(`/api/groups/tree?${params.toString()}`, { headers: authHeaders(token) })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to load tree')
    treeRoots.value = data.roots || []
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load tree'
  } finally {
    isLoadingTree.value = false
  }
}

function resetToTop(): void {
  focusedRootId.value = null
  focusedRootName.value = null
  fetchTree()
}

// ─── Table lens ───
const tableRows = ref<StructureNode[]>([])
const tableTotal = ref(0)
const tablePage = ref(1)
const tablePageSize = ref(25)
const isLoadingTable = ref(false)
const tableFetchedOnce = ref(false)

async function fetchTable(): Promise<void> {
  isLoadingTable.value = true
  try {
    const token = await getAuthToken()
    const params = new URLSearchParams({ page: String(tablePage.value) })
    if (search.value.trim()) params.set('search', search.value.trim())
    if (quickFilter.value === 'groups') params.set('bucket', 'group')
    if (quickFilter.value === 'schools') params.set('bucket', 'school')
    if (quickFilter.value === 'trial') params.set('status', 'trial')
    if (quickFilter.value === 'paid') params.set('status', 'paid')
    if (quickFilter.value === 'demo') params.set('demo', 'true')
    const resp = await fetch(`/api/groups/table?${params.toString()}`, { headers: authHeaders(token) })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to load table')
    tableRows.value = data.rows || []
    tableTotal.value = data.total || 0
    tablePageSize.value = data.pageSize || 25
    tableFetchedOnce.value = true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load table'
  } finally {
    isLoadingTable.value = false
  }
}

const tablePageCount = computed(() => Math.max(1, Math.ceil(tableTotal.value / tablePageSize.value)))

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    if (lens.value === 'table') { tablePage.value = 1; fetchTable() }
  }, 250)
})
watch(quickFilter, () => {
  if (lens.value === 'table') { tablePage.value = 1; fetchTable() }
})
watch(tablePage, () => { if (lens.value === 'table') fetchTable() })
watch(lens, (v) => { if (v === 'table' && !tableFetchedOnce.value) fetchTable() })

async function refetchCurrentLens(): Promise<void> {
  if (lens.value === 'tree') await fetchTree()
  if (lens.value === 'table' || tableFetchedOnce.value) await fetchTable()
  // Keep an open node panel showing fresh counts/name after a mutating action.
  if (selectedNode.value) {
    const fresh = [...flattenNodes(treeRoots.value), ...tableRows.value].find((n) => n.id === selectedNode.value!.id)
    if (fresh) selectedNode.value = fresh
  }
}

// ─── Root "+ Add organisation" ───
const showAddOrg = ref(false)
const newOrgName = ref('')
const newOrgLabel = ref('organisation')
const newOrgIsDemo = ref(false)
const isCreatingOrg = ref(false)

async function createOrganisation(): Promise<void> {
  if (!newOrgName.value.trim() || isCreatingOrg.value) return
  isCreatingOrg.value = true
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const body: Record<string, unknown> = { name: newOrgName.value.trim(), type: newOrgLabel.value }
    if (newOrgIsDemo.value) body.is_demo = true
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    setSuccess(`Organisation "${data.group?.name || newOrgName.value.trim()}" created`)
    newOrgName.value = ''
    newOrgIsDemo.value = false
    showAddOrg.value = false
    await refetchCurrentLens()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create organisation'
  } finally {
    isCreatingOrg.value = false
  }
}

// ─── Node actions (shared by both lenses via provide/inject) ───
const editingId = ref<string | null>(null)
const editingName = ref('')

function startRename(node: StructureNode): void {
  editingId.value = node.id
  editingName.value = node.name
}
function cancelRename(): void { editingId.value = null }

async function saveRename(node: StructureNode): Promise<void> {
  const newName = editingName.value.trim()
  editingId.value = null
  if (!newName || newName === node.name) return
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ name: newName }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to rename')
    setSuccess(`Renamed to "${newName}"`)
    await refetchCurrentLens()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to rename'
  }
}

async function updateLabel(node: StructureNode, label: string): Promise<void> {
  if (label === node.label) return
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ type: label }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to relabel')
    setSuccess(`"${node.name}" relabelled to ${label}`)
    await refetchCurrentLens()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to relabel'
  }
}

function openDashboard(node: StructureNode): void {
  if (node.commercial) router.push(`/admin/schools/${node.commercial.schoolId}`)
  else router.push(`/admin/groups/${node.id}`)
}

async function createChild(parentId: string, name: string, label: string, isDemo: boolean): Promise<boolean> {
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const body: Record<string, unknown> = { name, type: label, parent_id: parentId }
    if (isDemo) body.is_demo = true
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    setSuccess(`"${name}" created`)
    await refetchCurrentLens()
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create group'
    return false
  }
}

// Invites are people-only (THE-MODEL.md I8) — the endpoint is owned by
// another worker per THE-MODEL.md §6; this UI calls it per the contract.
async function submitInvite(node: StructureNode, opts: { role: 'teacher' | 'leader' | 'student' }): Promise<boolean> {
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch(`/api/groups/${node.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ role: opts.role, limits: {} }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    const code = data.code as string | undefined
    // Leader codes land on the /group landing door (govt_admin invite flow);
    // teacher/student codes use the general shareable /redeem link.
    const path = opts.role === 'leader' ? 'group' : 'redeem'
    setSuccess(
      `Invite created for "${node.name}"`,
      code ? { url: `${window.location.origin}/${path}/${code}`, hint: 'Share this invite link.' } : null,
    )
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create invite'
    return false
  }
}

// Demo-mint endpoint owned by another worker per THE-MODEL.md §6; called
// per the contract.
async function submitDemoMint(node: StructureNode, opts: { name: string; leaderEmail?: string }): Promise<boolean> {
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch(`/api/groups/${node.id}/demo-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ name: opts.name, leader_email: opts.leaderEmail }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    // Links-first (THE-MODEL §1.10): the leader link is server-built
    // (/group/<code>) — use it directly rather than re-deriving a URL.
    const leaderLink = Array.isArray(data.links) ? data.links.find((l: any) => l.role === 'leader') : null
    setSuccess(
      `Demo org "${opts.name}" minted under "${node.name}"`,
      leaderLink?.url ? { url: leaderLink.url, hint: 'Share this with the demo leader.' } : null,
    )
    await refetchCurrentLens()
    return true
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to mint demo org'
    return false
  }
}

function drillInto(node: StructureNode): void {
  focusedRootId.value = node.id
  focusedRootName.value = node.name
  fetchTree()
}

// ─── Node panel (THE-MODEL.md §1.12 — verbs on top) ───
const selectedNode = ref<StructureNode | null>(null)
function selectNode(node: StructureNode): void {
  selectedNode.value = node
}
function closeNodePanel(): void {
  selectedNode.value = null
}

// ─── Delete (unchanged wiring from the old Structure page) ───
interface DeleteImpact {
  classCount?: number
  schoolCount?: number
  sessionCount: number
  learnerCount: number
  teacherCount: number
  hasRealActivity: boolean
}
const deleteModalOpen = ref(false)
const deleteModalTarget = ref<StructureNode | null>(null)
const deleteModalImpact = ref<DeleteImpact | null>(null)
const deleteModalSubmitting = ref(false)
const deleteModalError = ref('')

const deleteModalTitle = computed(() => (deleteModalTarget.value?.commercial ? 'Delete school' : 'Delete group'))
const deleteModalImpactLines = computed(() => {
  const impact = deleteModalImpact.value
  if (!impact) return []
  const lines: string[] = []
  if (impact.schoolCount !== undefined) lines.push(`${impact.schoolCount} school(s)`)
  if (impact.classCount !== undefined) lines.push(`${impact.classCount} class(es)`)
  lines.push(`${impact.sessionCount} session(s) recorded`)
  lines.push(`${impact.learnerCount} learner(s)`)
  lines.push(`${impact.teacherCount} teacher(s)`)
  return lines
})

async function requestDelete(node: StructureNode): Promise<void> {
  deleteModalTarget.value = node
  deleteModalImpact.value = null
  deleteModalError.value = ''
  deleteModalOpen.value = true
  try {
    const token = await getAuthToken()
    const url = node.commercial
      ? `/api/admin/update-school?school_id=${encodeURIComponent(node.commercial.schoolId)}`
      : `/api/groups/${node.id}`
    const resp = await fetch(url, { method: 'GET', headers: authHeaders(token) })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to load deletion impact')
    deleteModalImpact.value = data.impact
  } catch (err) {
    deleteModalError.value = err instanceof Error ? err.message : 'Failed to load deletion impact'
  }
}

function closeDeleteModal(): void {
  if (deleteModalSubmitting.value) return
  deleteModalOpen.value = false
  deleteModalTarget.value = null
  deleteModalImpact.value = null
  deleteModalError.value = ''
}

async function confirmDelete(typedName: string): Promise<void> {
  const target = deleteModalTarget.value
  if (!target) return
  deleteModalSubmitting.value = true
  deleteModalError.value = ''
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const headers = authHeaders(token)
    if (target.commercial) {
      const params = new URLSearchParams({ school_id: target.commercial.schoolId })
      if (typedName) params.set('confirm_name', typedName)
      const resp = await fetch(`/api/admin/update-school?${params.toString()}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || 'Failed to delete school')
    } else {
      const qp = typedName ? `?confirm_name=${encodeURIComponent(typedName)}` : ''
      const resp = await fetch(`/api/groups/${target.id}${qp}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || 'Failed to delete group')
    }
    setSuccess(`"${target.name}" deleted`)
    deleteModalOpen.value = false
    deleteModalTarget.value = null
    await refetchCurrentLens()
  } catch (err) {
    deleteModalError.value = err instanceof Error ? err.message : 'Failed to delete'
  } finally {
    deleteModalSubmitting.value = false
  }
}

provide<StructureApi>('structureApi', {
  editingId, editingName, startRename, saveRename, cancelRename, updateLabel,
  openDashboard, createChild, requestDelete, submitInvite, submitDemoMint, drillInto, selectNode,
})

// The ONE refresh protocol: a full-page reload (both lenses) drives the navbar
// button + pull-to-refresh; the initial load routes through it so the spinner
// and "Updated HH:MM" stamp are honest. No polling — Structure holds still.
async function loadPage(): Promise<void> {
  await Promise.all([fetchTree(), fetchTable()])
}
const { registerRefresh, refresh } = useDashboardRefresh()
registerRefresh(loadPage, { immediate: false })

onMounted(() => { void refresh() })
</script>

<template>
  <div class="admin-structure">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Schools admin</span>
        <h1 class="arsenal">Structure</h1>
        <p class="subtitle">One tree, two lenses — table and tree — for every organisation, school and group.</p>
        <div class="metrics">
          <span class="metric"><span class="metric-value frost-mono-nums">{{ tableTotal }}</span> organisations</span>
          <span class="metric-sep">·</span>
          <UpdatedStamp />
        </div>
      </div>
    </header>

    <Transition name="fade">
      <div v-if="successMessage" class="banner banner-success" :class="{ 'banner-success--invite': inviteResult }">
        <span class="banner-body">
          <span>{{ successMessage }}</span>
          <div v-if="inviteResult" class="invite-result">
            <span class="schools-kicker">Invite link</span>
            <button
              type="button"
              class="code-chip is-large"
              :class="{ 'is-copied': copiedCode === inviteResult.url }"
              @click="copyCode(inviteResult.url)"
            >
              <span class="code-value frost-mono-nums">{{ inviteResult.url }}</span>
            </button>
            <span class="invite-hint">{{ inviteResult.hint }}</span>
          </div>
        </span>
      </div>
    </Transition>
    <Transition name="fade">
      <div v-if="error" class="banner banner-error">{{ error }}</div>
    </Transition>

    <!-- Lens toggle -->
    <div class="lens-toggle">
      <button type="button" class="lens-btn" :class="{ 'is-active': lens === 'tree' }" @click="lens = 'tree'">Tree</button>
      <button type="button" class="lens-btn" :class="{ 'is-active': lens === 'table' }" @click="lens = 'table'">Table</button>
    </div>

    <!-- Search + quick filters (shared across both lenses). Note: these
         classes are deliberately NOT named "filter-bar"/"filter-bar-input" —
         those are already claimed globally by schools-design.css's compact
         search-box pattern (max-width 340px, height 38px), and reusing them
         here silently squashed this whole row into a 340×38 box with its
         wrapped second line rendering behind the panel below (founder-
         reported: chips only showing their top edge). -->
    <div class="structure-filters">
      <input v-model="search" class="structure-search-input" type="text" placeholder="Search organisations…" />
      <div class="chip-group">
        <button
          v-for="f in QUICK_FILTERS" :key="f.value" type="button" class="chip"
          :class="{ 'is-active': quickFilter === f.value }" @click="quickFilter = f.value"
        >{{ f.label }}</button>
      </div>
    </div>

    <div class="structure-layout" :class="{ 'has-panel': selectedNode }">
      <div class="schools-card structure-panel">
        <div class="panel-head">
          <span class="schools-kicker">Organisations</span>
          <button type="button" class="btn-ghost-sm" @click="showAddOrg = !showAddOrg">+ Add organisation</button>
        </div>
        <div v-if="showAddOrg" class="structure-inline-form root-inline-form">
          <input
            v-model="newOrgName" type="text" class="frost-input" placeholder="Organisation name" autofocus
            @keyup.enter="createOrganisation" @keyup.escape="showAddOrg = false"
          />
          <select v-model="newOrgLabel" class="frost-select">
            <option value="organisation">organisation</option>
            <option value="nation">nation</option>
            <option value="region">region</option>
            <option value="school">school</option>
          </select>
          <label class="checkbox-field"><input v-model="newOrgIsDemo" type="checkbox" /><span>Demo</span></label>
          <button class="btn-ghost-sm" :disabled="isCreatingOrg || !newOrgName.trim()" @click="createOrganisation">
            {{ isCreatingOrg ? 'Adding…' : 'Add' }}
          </button>
        </div>

        <!-- TREE lens -->
        <template v-if="lens === 'tree'">
          <div v-if="focusedRootId" class="focused-breadcrumb">
            <button type="button" class="link-btn" @click="resetToTop">← Back to top</button>
            <span>Showing subtree of: <strong>{{ focusedRootName }}</strong></span>
          </div>
          <div v-if="isLoadingTree" class="structure-empty">Loading…</div>
          <div v-else class="structure-tree">
            <StructureTreeNode
              v-for="root in treeRoots"
              :key="root.id"
              :node="root"
              :depth="0"
              :search="search"
              :quick-filter="quickFilter"
            />
            <div v-if="treeRoots.length === 0" class="structure-empty">
              <strong>No organisations yet</strong>
              <p>Add one above.</p>
            </div>
          </div>
        </template>

        <!-- TABLE lens -->
        <template v-else>
          <div v-if="isLoadingTable" class="structure-empty">Loading…</div>
          <table v-else class="structure-table">
            <thead>
              <tr>
                <th>Name</th><th>Label</th><th>Demo</th><th>Status</th>
                <th>Teachers</th><th>Classes</th><th>Learners</th><th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in tableRows" :key="row.id">
                <td class="cell-name" @click="selectNode(row)">{{ row.name }}</td>
                <td>{{ row.label }}</td>
                <td>{{ row.is_demo ? 'Demo' : '—' }}</td>
                <td>{{ row.commercial?.platformStatus || '—' }}</td>
                <td>{{ row.rollup.teacherCount }}</td>
                <td>{{ row.rollup.classCount }}</td>
                <td>{{ row.rollup.learnerCount }}</td>
                <td class="cell-actions">
                  <button class="row-action" title="Rename" @click="startRename(row)">✎</button>
                  <button class="row-action" title="Open dashboard" @click="openDashboard(row)">↗</button>
                  <button class="row-action is-danger" title="Delete" @click="requestDelete(row)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="tableRows.length === 0 && !isLoadingTable" class="structure-empty">
            <strong>No matches</strong>
            <p>Try clearing a filter.</p>
          </div>
          <div class="pagination">
            <button class="btn-ghost-sm" :disabled="tablePage <= 1" @click="tablePage -= 1">← Prev</button>
            <span class="pagination-info">Page {{ tablePage }} of {{ tablePageCount }} ({{ tableTotal }} total)</span>
            <button class="btn-ghost-sm" :disabled="tablePage >= tablePageCount" @click="tablePage += 1">Next →</button>
          </div>
        </template>
      </div>

      <div v-if="selectedNode" class="schools-card node-panel-host">
        <NodePanel :node="selectedNode" @close="closeNodePanel" />
      </div>
    </div>

    <ConfirmDeleteModal
      :is-open="deleteModalOpen"
      :title="deleteModalTitle"
      :target-name="deleteModalTarget?.name || ''"
      :impact-lines="deleteModalImpactLines"
      :require-typed-confirm="!!deleteModalImpact?.hasRealActivity"
      :submitting="deleteModalSubmitting"
      :error="deleteModalError"
      @close="closeDeleteModal"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.admin-structure { display: flex; flex-direction: column; gap: var(--space-6); }

.page-header { margin-bottom: 22px; }
.title-block .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.title-block h1 {
  font-family: var(--font-display); font-size: clamp(30px, 4vw, 44px); font-weight: 400;
  line-height: 1.04; letter-spacing: -0.015em; color: var(--ink-primary, #2C2622); margin: 8px 0 10px;
}
.subtitle { font-size: 16px; line-height: 1.55; color: var(--ink-secondary, #5b534c); max-width: 64ch; margin: 0 0 14px; }
.metrics { display: flex; align-items: baseline; gap: var(--space-2); color: var(--ink-muted, #8A8078); font-size: var(--text-sm); }
.metric-value { color: var(--ink-primary, #2C2622); font-weight: var(--font-semibold); margin-right: 4px; }

.banner { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-lg); font-size: var(--text-sm); }
.banner-success { background: rgba(var(--tone-green), 0.10); border: 1px solid rgba(var(--tone-green), 0.28); color: rgb(var(--tone-green-ink)); }
.banner-error { background: rgba(var(--tone-red), 0.08); border: 1px solid rgba(var(--tone-red), 0.28); color: rgb(var(--tone-red)); }
.banner-body { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.invite-result { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin-top: 6px; }
.invite-hint { font-size: var(--text-xs); color: var(--schools-fg-3); margin-top: 4px; }
.code-chip {
  display: inline-flex; align-items: center; gap: 8px; padding: 5px 10px;
  background: rgba(255, 255, 255, 0.55); border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-md); font: inherit; cursor: pointer; transition: all var(--transition-fast); color: var(--schools-fg-2);
}
.code-chip:hover { background: rgba(255, 255, 255, 0.82); border-color: rgba(44, 38, 34, 0.16); }
.code-chip.is-copied { background: rgba(var(--tone-green), 0.16); border-color: rgba(var(--tone-green), 0.45); color: rgb(var(--tone-green-ink)); }
.code-chip.is-large { padding: 10px 16px; font-size: var(--text-base); }
.code-chip.is-large .code-value { font-size: var(--text-sm); letter-spacing: 0.03em; word-break: break-all; text-align: left; }

.lens-toggle { display: inline-flex; gap: var(--space-1); background: rgba(44, 38, 34, 0.05); border-radius: var(--radius-full, 999px); padding: 3px; width: fit-content; }
.lens-btn {
  padding: 6px 18px; border: none; background: transparent; border-radius: var(--radius-full, 999px);
  font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--schools-fg-3); cursor: pointer;
}
.lens-btn.is-active { background: #fff; color: var(--schools-fg); box-shadow: 0 1px 2px rgba(44, 38, 34, 0.10); }

.structure-filters { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.structure-search-input {
  flex: 1; min-width: 220px; padding: 9px 14px; font: inherit; font-size: var(--text-sm);
  background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(44, 38, 34, 0.12); border-radius: var(--radius-lg); color: var(--schools-fg);
}
.chip-group { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.chip {
  padding: 6px 14px; font-size: var(--text-xs); font-weight: var(--font-medium); border-radius: var(--radius-full, 999px);
  border: 1px solid rgba(44, 38, 34, 0.14); background: rgba(255, 255, 255, 0.5); color: var(--schools-fg-2); cursor: pointer;
}
.chip.is-active { background: rgba(var(--tone-gold), 0.18); border-color: rgba(var(--tone-gold), 0.45); color: rgb(var(--tone-gold-ink)); }

.structure-layout { display: grid; grid-template-columns: 1fr; gap: var(--space-5); align-items: start; }
.structure-layout.has-panel { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
@media (max-width: 1000px) { .structure-layout.has-panel { grid-template-columns: 1fr; } }

.structure-panel { padding: 0; overflow: hidden; }
.node-panel-host { padding: 0; overflow: hidden; }
.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3); border-bottom: 1px solid rgba(44, 38, 34, 0.06);
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap;
}

.focused-breadcrumb {
  display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4);
  font-size: var(--text-xs); color: var(--schools-fg-3); border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}
.link-btn { background: none; border: none; color: var(--schools-red, #DB1E17); font-size: var(--text-xs); cursor: pointer; padding: 0; }
.link-btn:hover { text-decoration: underline; }

.structure-tree { padding: var(--space-3) var(--space-2); }
.structure-empty { padding: var(--space-6); color: var(--schools-fg-3); font-size: var(--text-sm); text-align: center; }
.structure-empty strong { display: block; font-family: var(--font-display); font-size: var(--text-lg); color: var(--schools-fg); margin-bottom: 4px; }

.root-inline-form { padding: var(--space-2) var(--space-4) 0; }
.structure-inline-form { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }

.checkbox-field { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-sm); color: var(--schools-fg-2); cursor: pointer; white-space: nowrap; }
.checkbox-field input[type="checkbox"] { width: 16px; height: 16px; accent-color: rgb(var(--tone-red)); cursor: pointer; }

.frost-input, .frost-select {
  font: inherit; font-size: var(--text-sm); padding: 8px 12px; color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(44, 38, 34, 0.12); border-radius: var(--radius-lg);
}
.frost-input:focus, .frost-select:focus { outline: none; border-color: rgba(var(--tone-red), 0.55); box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14); }

.btn-ghost-sm {
  padding: 6px 12px; font-size: var(--text-xs); font-weight: var(--font-medium); border-radius: var(--radius-md);
  border: 1px solid rgba(44, 38, 34, 0.14); background: rgba(255, 255, 255, 0.6); color: var(--schools-fg-2); cursor: pointer; white-space: nowrap;
}
.btn-ghost-sm:hover:not(:disabled) { background: rgba(255, 255, 255, 0.9); }
.btn-ghost-sm:disabled { opacity: 0.5; cursor: not-allowed; }

.structure-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.structure-table th {
  text-align: left; padding: var(--space-2) var(--space-4); font-size: var(--text-xs); font-weight: var(--font-medium);
  text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3); border-bottom: 1px solid rgba(44, 38, 34, 0.08);
}
.structure-table td { padding: var(--space-2) var(--space-4); border-bottom: 1px solid rgba(44, 38, 34, 0.05); color: var(--schools-fg-2); }
.cell-name { font-weight: var(--font-medium); color: var(--schools-fg); cursor: pointer; }
.cell-name:hover { text-decoration: underline; }
.cell-actions { display: flex; gap: 4px; }
.row-action {
  width: 26px; height: 26px; display: grid; place-items: center; background: transparent; border: 1px solid transparent;
  border-radius: var(--radius-md); color: var(--schools-fg-3); cursor: pointer;
}
.row-action:hover { color: var(--schools-fg); background: rgba(255, 255, 255, 0.72); border-color: rgba(44, 38, 34, 0.10); }
.row-action.is-danger:hover { color: rgb(var(--tone-red)); background: rgba(var(--tone-red), 0.08); border-color: rgba(var(--tone-red), 0.30); }

.pagination { display: flex; align-items: center; justify-content: center; gap: var(--space-4); padding: var(--space-4); }
.pagination-info { font-size: var(--text-xs); color: var(--schools-fg-3); }

.fade-enter-active, .fade-leave-active { transition: opacity var(--transition-base), transform var(--transition-base); }
.fade-enter-from, .fade-leave-to { opacity: 0; transform: translateY(-4px); }
</style>
