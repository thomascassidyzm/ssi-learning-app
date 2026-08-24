<script setup lang="ts">
// Structure — TWO LENSES ON ONE TREE (THE-MODEL.md §1.9/§6/§7), VERBS ON
// TOP (§1.12). "There is no in-principle difference between a group, a
// school or an organisation" — every row in both lenses is the SAME group
// node; a school is just a node with label 'school' plus a commercial
// attachment (schools.node_group_id) shown as a status pill. Data comes
// from the server-mediated /api/groups/tree and /api/groups/table
// endpoints — no client-direct org-table reads (§6). ROWS ARE LINKS
// (founder-ruled 2026-07-19): a click anywhere on a row opens that node's home
// page (/admin/schools/:id or /admin/groups/:id) — where the verbs now live
// (NodeActionBar.vue). The ⋯ menu keeps the in-list actions and stops
// propagation so it never triggers the row navigation. The old name-click
// side-panel (NodePanel.vue) is retired.
import { ref, computed, onMounted, provide, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import StructureTreeNode from '@/components/admin/StructureTreeNode.vue'
import IndividualAccessForm from '@/components/admin/invites/IndividualAccessForm.vue'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import type { StructureApi, StructureNode } from '@/components/admin/structureApi'
import { structureNodeIsVisible } from '@/components/admin/structureApi'
import { formatDeleteImpactLines, type DeleteImpact } from '@/components/admin/deleteImpact'
import { readDuplicateWarning } from '@/utils/duplicateNameWarning'

const router = useRouter()
const { getAuthToken } = useAdminClient()

// ─── Banners ───
const error = ref<string | null>(null)
const successMessage = ref<string | null>(null)

function setSuccess(message: string): void {
  successMessage.value = message
  error.value = null
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

// The type word shows only where it disambiguates (founder-ruled 2026-07-20):
// root rows carry it only when the forest mixes labels at the top level;
// each node makes the same call for its own children.
const rootLabelsMixed = computed(() => new Set(treeRoots.value.map((r) => r.label)).size > 1)

// Search/quick-filter must also apply at the FOREST's own top level, not
// just to descendants — most organisations are roots with no parent, so
// filtering only inside StructureTreeNode's children (the bug: search box
// did nothing) never touched the common case. Uses the same predicate as
// each node's own child filtering, so a match anywhere down a root's
// subtree keeps that root's ancestor path visible.
const visibleTreeRoots = computed(() =>
  treeRoots.value.filter((r) => structureNodeIsVisible(r, search.value, quickFilter.value))
)

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
}

// ─── Root "+ Add organisation" ───
const showAddOrg = ref(false)
const newOrgName = ref('')
const newOrgLabel = ref('organisation')
const newOrgIsDemo = ref(false)
const isCreatingOrg = ref(false)
// Duplicate-name warning: set when the API answers 409 `duplicate_name`.
// Nothing was created — the creator either changes the name or confirms, and
// confirming re-sends the same request with confirm_duplicate: true.
const orgDuplicateWarning = ref<string | null>(null)

async function createOrganisation(confirmDuplicate = false): Promise<void> {
  if (!newOrgName.value.trim() || isCreatingOrg.value) return
  isCreatingOrg.value = true
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const body: Record<string, unknown> = { name: newOrgName.value.trim(), type: newOrgLabel.value }
    if (newOrgIsDemo.value) body.is_demo = true
    if (confirmDuplicate) body.confirm_duplicate = true
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    const duplicate = readDuplicateWarning(resp.status, data)
    if (duplicate) {
      orgDuplicateWarning.value = duplicate.message
      return
    }
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    setSuccess(`Organisation "${data.group?.name || newOrgName.value.trim()}" created`)
    newOrgName.value = ''
    newOrgIsDemo.value = false
    orgDuplicateWarning.value = null
    showAddOrg.value = false
    await refetchCurrentLens()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create organisation'
  } finally {
    isCreatingOrg.value = false
  }
}

// ─── Root "+ Add individual" ───
// A person is not a node in the tree, so this is a sibling verb rather than a
// row: same height in the page as "+ Add organisation", because adding one
// human should cost the same as adding one school. The form itself is the
// same component the /admin/invites create card uses.
const showAddIndividual = ref(false)

function onIndividualCreated(): void {
  setSuccess('Access created — copy the link below and send it on.')
}

// Editing the name is "change the name" — drop the warning so a fresh name
// gets a fresh answer from the server rather than a stale confirmation.
watch(newOrgName, () => { orgDuplicateWarning.value = null })
watch(showAddOrg, () => { orgDuplicateWarning.value = null })

// ─── Node actions (shared by both lenses via provide/inject) ───
const editingId = ref<string | null>(null)
const editingName = ref('')

function startRename(node: StructureNode): void {
  editingId.value = node.id
  editingName.value = node.name
}
function cancelRename(): void { editingId.value = null; clearRenameWarning() }

// Duplicate-name warning on RENAME — the same 409 `duplicate_name` the
// creation surfaces read, from PATCH /api/groups/:id. Nothing was renamed:
// the pending rename is held so "Go ahead anyway" can re-send the identical
// request with confirm_duplicate: true, and "Change the name" re-opens the
// input on the name they typed.
const renameDuplicateWarning = ref<string | null>(null)
const pendingRename = ref<{ node: StructureNode; name: string } | null>(null)

/**
 * `confirmDuplicate` is an explicit boolean and every template call site
 * passes it (or nothing) with parens — an @keyup.enter handler called bare
 * would hand this a KeyboardEvent, which is truthy, and silently confirm a
 * duplicate with no warning at all. Pinned by a test.
 */
async function saveRename(node: StructureNode, confirmDuplicate = false): Promise<void> {
  const newName = confirmDuplicate
    ? (pendingRename.value?.name || '')
    : editingName.value.trim()
  editingId.value = null
  if (!newName || (!confirmDuplicate && newName === node.name)) return
  try {
    const token = await getAuthToken()
    const body: Record<string, unknown> = { name: newName }
    if (confirmDuplicate === true) body.confirm_duplicate = true
    const resp = await fetch(`/api/groups/${node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify(body),
    })
    const data = await resp.json().catch(() => ({}))
    const duplicate = readDuplicateWarning(resp.status, data, node.parent_id ? 'group' : 'organisation', 'Renaming')
    if (duplicate) {
      pendingRename.value = { node, name: newName }
      renameDuplicateWarning.value = duplicate.message
      return
    }
    if (!resp.ok) throw new Error(data.error || 'Failed to rename')
    setSuccess(`Renamed to "${newName}"`)
    clearRenameWarning()
    await refetchCurrentLens()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to rename'
  }
}

function clearRenameWarning(): void {
  renameDuplicateWarning.value = null
  pendingRename.value = null
}

/** "Change the name" — back into the rename input, on the name they typed. */
function reopenRename(): void {
  const pending = pendingRename.value
  renameDuplicateWarning.value = null
  if (!pending) return
  editingId.value = pending.node.id
  editingName.value = pending.name
  pendingRename.value = null
}

/** "Go ahead anyway" — the identical PATCH, plus confirm_duplicate. */
async function confirmRename(): Promise<void> {
  const pending = pendingRename.value
  if (!pending) return
  renameDuplicateWarning.value = null
  await saveRename(pending.node, true)
}

// Editing the name is "change the name" — a fresh name always gets a fresh
// answer from the server, never a stale confirmation (same rule as creation).
watch(editingName, () => { if (renameDuplicateWarning.value) clearRenameWarning() })

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

// Row verbs are maintenance-only (founder pass C, 2026-07-19): invite /
// add-child / demo-mint moved to the node home's action bar (NodeActionBar).
// Only root-level "+ Add organisation" creates structure from this page.

function drillInto(node: StructureNode): void {
  focusedRootId.value = node.id
  focusedRootName.value = node.name
  fetchTree()
}

// ─── Delete — honest impact lines (deleteImpact.ts states the actual
// cascade consequence with names/counts) ───
const deleteModalOpen = ref(false)
const deleteModalTarget = ref<StructureNode | null>(null)
const deleteModalImpact = ref<DeleteImpact | null>(null)
const deleteModalSubmitting = ref(false)
const deleteModalError = ref('')

const deleteModalTitle = computed(() => (deleteModalTarget.value?.commercial ? 'Delete school' : 'Delete group'))
const deleteModalImpactLines = computed(() => formatDeleteImpactLines(deleteModalImpact.value))

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
  openDashboard, requestDelete, drillInto,
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
      <div v-if="successMessage" class="banner banner-success">{{ successMessage }}</div>
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

    <div class="structure-layout">
      <div class="schools-card structure-panel">
        <div class="panel-head">
          <span class="schools-kicker">Organisations</span>
          <div class="head-actions">
            <button type="button" class="btn-ghost-sm" @click="showAddOrg = !showAddOrg">+ Add organisation</button>
            <button type="button" class="btn-ghost-sm" @click="showAddIndividual = !showAddIndividual">+ Add individual</button>
          </div>
        </div>

        <!-- One person, no organisation, no trial — a deliberate complimentary
             grant scoped by course and duration. Peer of "+ Add organisation"
             (founder ask 2026-08-11: adding a human should cost what adding a
             school costs), not a third level down a menu. -->
        <div v-if="showAddIndividual" class="individual-panel">
          <div class="individual-head">
            <span class="schools-kicker">New individual</span>
            <button type="button" class="link-btn" @click="showAddIndividual = false">Close</button>
          </div>
          <IndividualAccessForm @created="onIndividualCreated" />
        </div>
        <div v-if="showAddOrg" class="structure-inline-form root-inline-form">
          <input
            v-model="newOrgName" type="text" class="frost-input" placeholder="Organisation name" autofocus
            @keyup.enter="createOrganisation()" @keyup.escape="showAddOrg = false"
          />
          <select v-model="newOrgLabel" class="frost-select">
            <option value="organisation">organisation</option>
            <option value="nation">nation</option>
            <option value="region">region</option>
            <option value="school">school</option>
          </select>
          <label class="checkbox-field"><input v-model="newOrgIsDemo" type="checkbox" /><span>Demo</span></label>
          <button class="btn-ghost-sm" :disabled="isCreatingOrg || !newOrgName.trim()" @click="createOrganisation()">
            {{ isCreatingOrg ? 'Adding…' : 'Add' }}
          </button>
        </div>
        <div v-if="showAddOrg && orgDuplicateWarning" class="duplicate-warning root-inline-form" role="alert">
          <p class="duplicate-warning-text">{{ orgDuplicateWarning }}</p>
          <div class="duplicate-warning-actions">
            <button type="button" class="btn-ghost-sm" @click="orgDuplicateWarning = null">Change the name</button>
            <button type="button" class="btn-ghost-sm" :disabled="isCreatingOrg" @click="createOrganisation(true)">
              {{ isCreatingOrg ? 'Adding…' : 'Go ahead anyway' }}
            </button>
          </div>
        </div>

        <!-- Same warning, same two ways out, for a RENAME onto a sibling's name. -->
        <div v-if="renameDuplicateWarning" class="duplicate-warning root-inline-form" role="alert">
          <p class="duplicate-warning-text">{{ renameDuplicateWarning }}</p>
          <div class="duplicate-warning-actions">
            <button type="button" class="btn-ghost-sm" @click="reopenRename()">Change the name</button>
            <button type="button" class="btn-ghost-sm" @click="confirmRename()">Go ahead anyway</button>
          </div>
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
              v-for="root in visibleTreeRoots"
              :key="root.id"
              :node="root"
              :depth="0"
              :search="search"
              :quick-filter="quickFilter"
              :show-label="rootLabelsMixed"
            />
            <div v-if="treeRoots.length === 0" class="structure-empty">
              <strong>No organisations yet</strong>
              <p>Add one above.</p>
            </div>
            <div v-else-if="visibleTreeRoots.length === 0" class="structure-empty">
              <strong>No matches</strong>
              <p>Try a different search or filter.</p>
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
              <!-- Rows are links (founder-ruled 2026-07-19): the whole row
                   opens the node's dashboard; the action buttons stop
                   propagation so they don't trigger it. -->
              <tr
                v-for="row in tableRows"
                :key="row.id"
                class="row-link"
                role="link"
                tabindex="0"
                @click="openDashboard(row)"
                @keydown.enter.self="openDashboard(row)"
                @keydown.space.self.prevent="openDashboard(row)"
              >
                <td class="cell-name">
                  <span class="cell-name-text">{{ row.name }}</span>
                </td>
                <td>{{ row.label }}</td>
                <td>{{ row.is_demo ? 'Demo' : '—' }}</td>
                <td>{{ row.commercial?.platformStatus || '—' }}</td>
                <td>{{ row.rollup.teacherCount }}</td>
                <td>{{ row.rollup.classCount }}</td>
                <td>{{ row.rollup.learnerCount }}</td>
                <td class="cell-actions">
                  <button class="row-action" title="Rename" @click.stop="startRename(row)">✎</button>
                  <button class="row-action is-danger" title="Delete" @click.stop="requestDelete(row)">✕</button>
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

.structure-panel { padding: 0; overflow: hidden; }
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

.head-actions { display: inline-flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }

.individual-panel { border-bottom: 1px solid rgba(44, 38, 34, 0.06); background: rgba(255, 255, 255, 0.42); }
.individual-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-4);
  padding: var(--space-4) var(--space-6) 0;
}

/* Duplicate-name warning — information, not an error. Warm neutral rather
   than the red error banner: nothing has gone wrong, there is just a choice. */
.duplicate-warning { display: flex; flex-direction: column; gap: var(--space-2); }
.duplicate-warning-text {
  margin: 0; font-size: var(--text-sm); color: var(--schools-fg-2); line-height: 1.5;
  background: rgba(var(--tone-red), 0.06); border: 1px solid rgba(var(--tone-red), 0.18);
  border-radius: var(--radius-lg); padding: var(--space-3);
}
.duplicate-warning-actions { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
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
/* Zebra shading (founder pass C, 2026-07-19): a whisper of the warm ink so
   the eye can track a row across seven columns — hover stays brighter. */
.structure-table tbody tr:nth-child(even) td { background: rgba(44, 38, 34, 0.03); }
.row-link { cursor: pointer; transition: background var(--transition-fast); }
.row-link:hover td { background: rgba(255, 255, 255, 0.75); }
.row-link:focus-visible { outline: none; box-shadow: inset 0 0 0 2px rgba(var(--tone-red), 0.45); }
.cell-name { display: flex; align-items: center; gap: var(--space-3); font-weight: var(--font-medium); color: var(--schools-fg); }
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
