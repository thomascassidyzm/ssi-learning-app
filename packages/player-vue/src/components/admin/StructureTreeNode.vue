<script setup lang="ts">
// StructureTreeNode — one row of the Structure tree lens (THE-MODEL.md
// §1.9/§6/§7). Unlike the legacy GroupTreeNode (dual group/school entity
// types, still used by the Demos tool — left untouched), every row here is
// the SAME thing: a group node. "School" is just a label plus an optional
// `commercial` attachment (schools.node_group_id) carried on the node
// itself — label-not-type (I3): no behaviour branches on label beyond
// choosing an icon/word and showing the commercial badge when present.
import { computed, inject, ref } from 'vue'
import type { StructureApi, StructureNode } from './structureApi'

const props = withDefaults(defineProps<{
  node: StructureNode
  depth: number
  search?: string
  filterLabel?: string
  filterDemo?: 'all' | 'demo' | 'real'
  filterStatus?: string
}>(), { search: '', filterLabel: '', filterDemo: 'all', filterStatus: '' })

const api = inject<StructureApi>('structureApi')!

function selfMatches(n: StructureNode): boolean {
  const q = props.search.trim().toLowerCase()
  if (q && !n.name.toLowerCase().includes(q)) return false
  if (props.filterLabel && n.label !== props.filterLabel) return false
  if (props.filterDemo === 'demo' && !n.is_demo) return false
  if (props.filterDemo === 'real' && n.is_demo) return false
  if (props.filterStatus && n.commercial?.platformStatus !== props.filterStatus) return false
  return true
}
function isVisible(n: StructureNode): boolean {
  if (selfMatches(n)) return true
  return n.children.some(isVisible)
}

const visibleChildren = computed(() =>
  props.node.children.filter(isVisible).slice().sort((a, b) => a.name.localeCompare(b.name))
)
const isTruncated = computed(() => props.node.rollup.childGroupCount > 0 && props.node.children.length === 0)

const indentStyle = computed(() => ({ paddingLeft: `calc(var(--space-4) + ${props.depth} * var(--space-6))` }))
const childIndentStyle = computed(() => ({ paddingLeft: `calc(var(--space-4) + ${props.depth + 1} * var(--space-6))` }))

const editing = computed(() => api.editingId.value === props.node.id)

const showAddChild = ref(false)
const showInvite = ref(false)
const showDemoMint = ref(false)
const newChildName = ref('')
const newChildLabel = ref('group')
const newChildIsDemo = ref(false)
const isSubmittingChild = ref(false)
const inviteRole = ref<'teacher' | 'leader' | 'student'>('teacher')
const isSubmittingInvite = ref(false)
const demoMintName = ref('')
const demoMintLeaderEmail = ref('')
const isSubmittingDemoMint = ref(false)

async function submitChild(): Promise<void> {
  if (!newChildName.value.trim() || isSubmittingChild.value) return
  isSubmittingChild.value = true
  try {
    const ok = await api.createChild(props.node.id, newChildName.value.trim(), newChildLabel.value, newChildIsDemo.value)
    if (ok) {
      newChildName.value = ''
      newChildIsDemo.value = false
      showAddChild.value = false
    }
  } finally {
    isSubmittingChild.value = false
  }
}

async function submitInvite(): Promise<void> {
  if (isSubmittingInvite.value) return
  isSubmittingInvite.value = true
  try {
    const ok = await api.submitInvite(props.node, { role: inviteRole.value })
    if (ok) showInvite.value = false
  } finally {
    isSubmittingInvite.value = false
  }
}

async function submitDemoMint(): Promise<void> {
  if (!demoMintName.value.trim() || isSubmittingDemoMint.value) return
  isSubmittingDemoMint.value = true
  try {
    const ok = await api.submitDemoMint(props.node, {
      name: demoMintName.value.trim(),
      leaderEmail: demoMintLeaderEmail.value.trim() || undefined,
    })
    if (ok) {
      demoMintName.value = ''
      demoMintLeaderEmail.value = ''
      showDemoMint.value = false
    }
  } finally {
    isSubmittingDemoMint.value = false
  }
}
</script>

<template>
  <div class="structure-row" :style="indentStyle">
    <template v-if="editing">
      <input
        class="structure-rename-input"
        :value="api.editingName.value"
        @input="api.editingName.value = ($event.target as HTMLInputElement).value"
        @blur="api.saveRename(node)"
        @keyup.enter="api.saveRename(node)"
        @keyup.escape="api.cancelRename()"
      />
    </template>
    <span v-else class="structure-name" title="Click to open" @click="api.selectNode(node)">
      {{ node.name }}
    </span>

    <select
      class="label-select"
      :value="node.label"
      title="Relabel (display only — I3)"
      @change="api.updateLabel(node, ($event.target as HTMLSelectElement).value)"
    >
      <option v-if="!['group','organisation','school','nation','region','district','programme','lea'].includes(node.label)" :value="node.label">{{ node.label }}</option>
      <option value="group">group</option>
      <option value="organisation">organisation</option>
      <option value="school">school</option>
      <option value="nation">nation</option>
      <option value="region">region</option>
      <option value="district">district</option>
      <option value="programme">programme</option>
      <option value="lea">LEA</option>
    </select>

    <span v-if="node.is_demo" class="org-badge is-demo">Demo</span>
    <span v-if="node.commercial" class="status-pill" :class="node.commercial.platformStatus === 'active' ? 'tone-green' : 'tone-amber'">
      <span class="status-dot"></span>{{ node.commercial.platformStatus }}
    </span>

    <span class="structure-meta">
      <span v-if="node.rollup.teacherCount" class="meta-item">{{ node.rollup.teacherCount }} teacher{{ node.rollup.teacherCount === 1 ? '' : 's' }}</span>
      <span v-if="node.rollup.classCount" class="meta-item">{{ node.rollup.classCount }} class{{ node.rollup.classCount === 1 ? '' : 'es' }}</span>
      <span v-if="node.rollup.learnerCount" class="meta-item">{{ node.rollup.learnerCount }} learner{{ node.rollup.learnerCount === 1 ? '' : 's' }}</span>
    </span>

    <div class="row-actions">
      <button class="row-action" title="Rename" @click="api.startRename(node)">✎</button>
      <button class="row-action" title="Add child group" @click="showAddChild = !showAddChild">+</button>
      <button class="row-action" title="Invite people" @click="showInvite = !showInvite">✉</button>
      <button class="row-action" title="Mint a demo org here" @click="showDemoMint = !showDemoMint">✨</button>
      <button class="row-action" title="Open dashboard" @click="api.openDashboard(node)">↗</button>
      <button class="row-action is-danger" title="Delete" @click="api.requestDelete(node)">✕</button>
    </div>
  </div>

  <div v-if="showAddChild" class="structure-inline-form" :style="childIndentStyle">
    <input v-model="newChildName" type="text" class="frost-input" placeholder="Group name" autofocus @keyup.enter="submitChild" @keyup.escape="showAddChild = false" />
    <select v-model="newChildLabel" class="frost-select">
      <option value="group">group</option>
      <option value="organisation">organisation</option>
      <option value="school">school</option>
      <option value="district">district</option>
      <option value="programme">programme</option>
    </select>
    <label class="checkbox-field"><input v-model="newChildIsDemo" type="checkbox" /><span>Demo</span></label>
    <button class="btn-ghost-sm" :disabled="isSubmittingChild || !newChildName.trim()" @click="submitChild">
      {{ isSubmittingChild ? 'Adding…' : 'Add' }}
    </button>
  </div>

  <div v-if="showInvite" class="structure-inline-form" :style="childIndentStyle">
    <select v-model="inviteRole" class="frost-select">
      <option value="teacher">Teacher</option>
      <option value="leader">Leader</option>
      <option value="student">Student</option>
    </select>
    <button class="btn-ghost-sm" :disabled="isSubmittingInvite" @click="submitInvite">
      {{ isSubmittingInvite ? 'Creating…' : 'Create invite' }}
    </button>
  </div>

  <div v-if="showDemoMint" class="structure-inline-form" :style="childIndentStyle">
    <input v-model="demoMintName" type="text" class="frost-input" placeholder="Demo org name" autofocus @keyup.enter="submitDemoMint" @keyup.escape="showDemoMint = false" />
    <input v-model="demoMintLeaderEmail" type="email" class="frost-input" placeholder="Leader email (optional)" />
    <button class="btn-ghost-sm" :disabled="isSubmittingDemoMint || !demoMintName.trim()" @click="submitDemoMint">
      {{ isSubmittingDemoMint ? 'Minting…' : 'Mint' }}
    </button>
  </div>

  <StructureTreeNode
    v-for="child in visibleChildren"
    :key="child.id"
    :node="child"
    :depth="depth + 1"
    :search="search"
    :filter-label="filterLabel"
    :filter-demo="filterDemo"
    :filter-status="filterStatus"
  />

  <div v-if="isTruncated" class="structure-drill-in" :style="childIndentStyle">
    <button class="link-btn" @click="api.drillInto(node)">
      → {{ node.rollup.childGroupCount }} more group{{ node.rollup.childGroupCount === 1 ? '' : 's' }} — drill in
    </button>
  </div>
</template>

<style scoped>
.structure-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  color: var(--schools-fg-2);
}
.structure-row:hover { background: rgba(255, 255, 255, 0.48); }

.structure-name {
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
  color: var(--schools-fg);
  font-weight: var(--font-semibold);
}
.structure-name:hover { background: rgba(44, 38, 34, 0.06); }

.structure-rename-input {
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.85);
  border: 1px solid rgba(var(--tone-red), 0.55);
  border-radius: var(--radius-sm);
  color: var(--schools-fg);
  width: 220px;
}
.structure-rename-input:focus { outline: none; box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14); }

.label-select {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--schools-fg-3);
  background: transparent;
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
}

.structure-meta {
  margin-left: auto;
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}

.structure-row .row-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: 0;
  transform: translateX(4px);
  transition: all var(--transition-fast);
}
.structure-row:hover .row-actions,
.structure-row:focus-within .row-actions { opacity: 1; transform: translateX(0); }

.row-action {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--schools-fg-3);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.row-action:hover { color: var(--schools-fg); background: rgba(255, 255, 255, 0.72); border-color: rgba(44, 38, 34, 0.10); }
.row-action.is-danger:hover { color: rgb(var(--tone-red)); background: rgba(var(--tone-red), 0.08); border-color: rgba(var(--tone-red), 0.30); }

.structure-inline-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1, 4px) var(--space-4) var(--space-2);
}
.structure-drill-in { padding: var(--space-1, 4px) var(--space-4) var(--space-2); }
.link-btn {
  background: none;
  border: none;
  color: var(--schools-red, #DB1E17);
  font-size: var(--text-xs);
  cursor: pointer;
  padding: 0;
}
.link-btn:hover { text-decoration: underline; }

.checkbox-field {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--schools-fg-2);
  cursor: pointer;
  white-space: nowrap;
}
.checkbox-field input[type="checkbox"] { width: 16px; height: 16px; accent-color: rgb(var(--tone-red)); cursor: pointer; }

.frost-input {
  font: inherit;
  font-size: var(--text-sm);
  padding: 8px 12px;
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
}
.frost-input:focus { outline: none; border-color: rgba(var(--tone-red), 0.55); box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14); }

.frost-select {
  font: inherit;
  font-size: var(--text-sm);
  padding: 7px 10px;
  color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
}

.btn-ghost-sm {
  padding: 6px 12px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  border-radius: var(--radius-md);
  border: 1px solid rgba(44, 38, 34, 0.14);
  background: rgba(255, 255, 255, 0.6);
  color: var(--schools-fg-2);
  cursor: pointer;
  white-space: nowrap;
}
.btn-ghost-sm:hover:not(:disabled) { background: rgba(255, 255, 255, 0.9); }
.btn-ghost-sm:disabled { opacity: 0.5; cursor: not-allowed; }

.org-badge {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 2px 8px;
  border-radius: var(--radius-full, 999px);
  background: rgba(44, 38, 34, 0.06);
  color: var(--schools-fg-3);
}
.org-badge.is-demo { background: rgba(var(--tone-amber, 194 132 58), 0.12); color: rgb(var(--tone-amber-ink, 154 96 24)); }

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 2px 8px;
  border-radius: var(--radius-full, 999px);
}
.status-pill.tone-green { background: rgba(var(--tone-green), 0.12); color: rgb(var(--tone-green-ink)); }
.status-pill.tone-amber { background: rgba(var(--tone-amber, 194 132 58), 0.12); color: rgb(var(--tone-amber-ink, 154 96 24)); }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }
</style>
