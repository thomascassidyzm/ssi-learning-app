<script setup lang="ts">
// StructureTreeNode — one row of the Structure tree lens (THE-MODEL.md
// §1.9/§6/§7). Unlike the legacy GroupTreeNode (dual group/school entity
// types, still used by the Demos tool — left untouched), every row here is
// the SAME thing: a group node. "School" is just a label plus an optional
// `commercial` attachment (schools.node_group_id) carried on the node
// itself — label-not-type (I3): no behaviour branches on label beyond
// choosing an icon/word and showing the commercial badge when present.
import { computed, inject, nextTick, ref } from 'vue'
import type { StructureApi, StructureNode } from './structureApi'

type QuickFilter = 'all' | 'groups' | 'schools' | 'trial' | 'paid' | 'demo'

const props = withDefaults(defineProps<{
  node: StructureNode
  depth: number
  search?: string
  quickFilter?: QuickFilter
  // Quiet the chips (founder-ruled 2026-07-20): information that repeats on
  // every row is not information. The label word shows only where it
  // disambiguates — the PARENT computes whether this node's sibling set
  // mixes labels and passes the verdict down. Same for demo: a subtree
  // that is demo all the way down is marked ONCE at its root, so each row
  // needs to know whether its parent already carries the badge.
  showLabel?: boolean
  parentIsDemo?: boolean
}>(), { search: '', quickFilter: 'all', showLabel: false, parentIsDemo: false })

const api = inject<StructureApi>('structureApi')!

// Groups vs Schools is STRUCTURAL (commercial attachment presence) — never
// the label string (I3). Trial vs Paid mirrors the binary entitlement model
// (§1.11): "paid" = has a commercial attachment and isn't on trial.
function selfMatches(n: StructureNode): boolean {
  const q = props.search.trim().toLowerCase()
  if (q && !n.name.toLowerCase().includes(q)) return false
  switch (props.quickFilter) {
    case 'groups': if (n.commercial) return false; break
    case 'schools': if (!n.commercial) return false; break
    case 'trial': if (n.commercial?.platformStatus !== 'trial') return false; break
    case 'paid': if (!n.commercial || n.commercial.platformStatus === 'trial') return false; break
    case 'demo': if (!n.is_demo) return false; break
  }
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

// Children only see the label word when their sibling set mixes labels
// (computed over ALL children, not the filtered view, so labels don't
// flicker as filters change).
const childLabelsMixed = computed(() => new Set(props.node.children.map((c) => c.label)).size > 1)

// Depth class steps the name's weight/size down by level (roots strongest)
// — typography carries the hierarchy the type word used to shout.
const depthClass = computed(() => `depth-${Math.min(props.depth, 2)}`)

const editing = computed(() => api.editingId.value === props.node.id)

const showOverflow = ref(false)
const showLabelPicker = ref(false)
const labelPickerEl = ref<HTMLSelectElement | null>(null)

const LABEL_OPTIONS = ['group', 'organisation', 'school', 'nation', 'region', 'district', 'programme', 'lea']

function openLabelPicker(): void {
  showLabelPicker.value = true
  nextTick(() => labelPickerEl.value?.focus())
}

async function pickLabel(label: string): Promise<void> {
  showLabelPicker.value = false
  if (label === props.node.label) return
  await api.updateLabel(props.node, label)
}

// ROWS ARE LINKS (founder-ruled 2026-07-19): a click anywhere on the row —
// including the name — opens that node's dashboard/node-home page. In-list
// controls (label badge, the ⋯ menu, the rename input) stop propagation so
// they never trigger this navigation. Never navigate while renaming.
function onRowClick(): void {
  if (editing.value) return
  api.openDashboard(props.node)
}

// Declutter (founder pass C, 2026-07-19: "a bit of a mess"): the row is a
// scannable line — name is the anchor, everything else quieter. One muted
// size figure (subtree learners); the full breakdown rides the tooltip. The
// status pill shows only when the state needs attention (trial/past-due) —
// paid-and-fine is the silent default. Structure verbs (add group, invite,
// mint demo) left the rows entirely: rows are links, verbs live on the node
// home's action bar.
const metaTitle = computed(() => {
  const r = props.node.rollup
  return `${r.teacherCount} teachers · ${r.classCount} classes · ${r.learnerCount} learners (everyone below this)`
})
// Demo is marked ONCE at the demo subtree's root; descendants inherit the
// context silently (founder-ruled 2026-07-20).
const showDemoBadge = computed(() => props.node.is_demo && !props.parentIsDemo)
const attentionStatus = computed(() => {
  const s = props.node.commercial?.platformStatus
  if (!s || s === 'active' || s === 'paid') return null
  // A demo school on trial is its normal state, not attention — the pill is
  // for real orgs where trial means a decision is coming (founder-ruled
  // 2026-07-20). Non-trial oddities still show even on demo.
  if (s === 'trial' && (props.node.is_demo || props.parentIsDemo)) return null
  return s
})
</script>

<template>
  <!-- The whole row is a link to the node's dashboard (founder-ruled
       2026-07-19). Interactive children below stop propagation. -->
  <div
    class="structure-row is-link"
    role="link"
    tabindex="0"
    @click="onRowClick"
    @keydown.enter.self="onRowClick"
    @keydown.space.self.prevent="onRowClick"
  >
    <!-- Depth rails: one faint vertical guide per ancestor level. Rows are
         flat siblings in the DOM, so each row draws its own segments; they
         stack into continuous lines (founder-ruled 2026-07-20: hierarchy
         must be legible at a glance). -->
    <span v-if="depth > 0" class="tree-rails" aria-hidden="true">
      <span v-for="i in depth" :key="i" class="rail"></span>
    </span>
    <template v-if="editing">
      <input
        class="structure-rename-input"
        :value="api.editingName.value"
        @click.stop
        @input="api.editingName.value = ($event.target as HTMLInputElement).value"
        @blur="api.saveRename(node)"
        @keyup.enter="api.saveRename(node)"
        @keyup.escape="api.cancelRename()"
      />
    </template>
    <span v-else class="structure-name" :class="depthClass">
      {{ node.name }}
    </span>

    <select
      v-if="showLabelPicker"
      ref="labelPickerEl"
      class="label-select"
      :value="node.label"
      title="Change label"
      @click.stop
      @change="pickLabel(($event.target as HTMLSelectElement).value)"
      @blur="showLabelPicker = false"
      @keyup.escape="showLabelPicker = false"
    >
      <option v-if="!LABEL_OPTIONS.includes(node.label)" :value="node.label">{{ node.label }}</option>
      <option v-for="opt in LABEL_OPTIONS" :key="opt" :value="opt">{{ opt === 'lea' ? 'LEA' : opt }}</option>
    </select>
    <span v-else-if="showLabel" class="label-word">{{ node.label === 'lea' ? 'LEA' : node.label }}</span>

    <span v-if="showDemoBadge" class="org-badge is-demo">Demo</span>
    <span v-if="attentionStatus" class="status-pill tone-amber">
      <span class="status-dot"></span>{{ attentionStatus.replace(/_/g, ' ') }}
    </span>

    <span class="structure-meta" :title="metaTitle">
      <span v-if="node.rollup.learnerCount" class="meta-item">{{ node.rollup.learnerCount }} learner{{ node.rollup.learnerCount === 1 ? '' : 's' }}</span>
    </span>

    <!-- Row verbs are maintenance-only (Rename / Change label / Delete) —
         labeled words, no hover-gating, so the whole row works on a phone.
         Everything else (invite, add, mint) lives on the node home page. -->
    <div class="row-overflow">
      <button type="button" class="overflow-toggle" :aria-expanded="showOverflow" aria-label="More actions" @click.stop="showOverflow = !showOverflow">⋯</button>
      <div v-if="showOverflow" class="overflow-menu" @click.stop="showOverflow = false">
        <button type="button" class="overflow-item" @click="api.startRename(node)">Rename</button>
        <button type="button" class="overflow-item" @click="openLabelPicker()">Change label</button>
        <button type="button" class="overflow-item is-danger" @click="api.requestDelete(node)">Delete</button>
      </div>
    </div>
  </div>

  <StructureTreeNode
    v-for="child in visibleChildren"
    :key="child.id"
    :node="child"
    :depth="depth + 1"
    :search="search"
    :quick-filter="quickFilter"
    :show-label="childLabelsMixed"
    :parent-is-demo="node.is_demo || parentIsDemo"
  />

  <div v-if="isTruncated" class="structure-drill-in">
    <span class="tree-rails" aria-hidden="true">
      <span v-for="i in depth + 1" :key="i" class="rail"></span>
    </span>
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
.structure-row.is-link { cursor: pointer; }
.structure-row.is-link:hover { background: rgba(255, 255, 255, 0.62); }
.structure-row:hover { background: rgba(255, 255, 255, 0.48); }
.structure-row.is-link:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px rgba(var(--tone-red), 0.45);
}

/* Depth rails — one faint vertical guide per ancestor level. The negative
   vertical margin stretches each segment through the row's own padding so
   consecutive rows read as one continuous line. */
.tree-rails {
  display: flex;
  flex: none;
  align-self: stretch;
  margin: calc(-1 * var(--space-2)) 0;
}
.rail {
  width: 22px;
  position: relative;
}
.rail::before {
  content: '';
  position: absolute;
  left: 7px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(44, 38, 34, 0.10);
}
@media (max-width: 768px) {
  .rail { width: 16px; }
}

/* Name typography steps down by level — roots strongest — so indentation +
   type carry the hierarchy the label word used to spell out. */
.structure-name {
  padding: 2px 6px;
  color: var(--schools-fg);
  font-weight: var(--font-semibold);
}
.structure-name.depth-0 { font-size: 15px; letter-spacing: -0.01em; }
.structure-name.depth-1 { font-size: var(--text-sm); font-weight: var(--font-medium); }
.structure-name.depth-2 { font-size: 13px; font-weight: var(--font-medium); }

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
  border: 1px solid rgba(var(--tone-red), 0.55);
  border-radius: var(--radius-sm);
  padding: 1px 4px;
}

.label-word {
  font-size: 10.5px;
  font-family: var(--font-mono);
  color: var(--schools-fg-3);
  opacity: 0.75;
}

.structure-meta {
  margin-left: auto;
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--schools-fg-3);
}

.row-overflow { position: relative; }
.overflow-toggle {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--schools-fg-3);
  font-size: var(--text-base);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.overflow-toggle:hover { color: var(--schools-fg); background: rgba(255, 255, 255, 0.72); border-color: rgba(44, 38, 34, 0.10); }
@media (max-width: 768px) {
  .overflow-toggle { width: 40px; height: 40px; }
}
.overflow-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 20;
  min-width: 170px;
  display: flex;
  flex-direction: column;
  padding: var(--space-1, 4px);
  background: #fff;
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(44, 38, 34, 0.14);
}
.overflow-item {
  padding: 9px 12px;
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  background: none;
  border: none;
  border-radius: var(--radius-md);
  color: var(--schools-fg-2);
  cursor: pointer;
}
.overflow-item:hover { background: rgba(44, 38, 34, 0.06); color: var(--schools-fg); }
.overflow-item.is-danger { color: rgb(var(--tone-red)); }
.overflow-item.is-danger:hover { background: rgba(var(--tone-red), 0.08); }

.structure-drill-in {
  display: flex;
  align-items: center;
  padding: var(--space-1, 4px) var(--space-4) var(--space-2);
}
.structure-drill-in .tree-rails { margin: calc(-1 * var(--space-1, 4px)) 0 calc(-1 * var(--space-2)); }
.link-btn {
  background: none;
  border: none;
  color: var(--schools-red, #DB1E17);
  font-size: var(--text-xs);
  cursor: pointer;
  padding: 0;
}
.link-btn:hover { text-decoration: underline; }

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
.status-pill.tone-amber { background: rgba(var(--tone-amber, 194 132 58), 0.12); color: rgb(var(--tone-amber-ink, 154 96 24)); }
.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; display: inline-block; }
</style>
