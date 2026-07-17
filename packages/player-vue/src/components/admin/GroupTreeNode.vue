<script setup lang="ts">
/**
 * GroupTreeNode — one row of the admin Organisations tree (SchoolsSetup.vue,
 * Groups tab), recursing over itself so an org tree of ANY depth renders
 * (org -> region -> district -> school...) instead of the old hardcoded
 * root/child/grandchild-only template. Schools attached directly to this
 * group render as leaf ENTITY rows beneath its sub-groups — the founder
 * model's invariant that every branch culminates in a school, never a bare
 * group ("groups are pure containers, arbitrary nesting depth; learners
 * join only an end entity").
 *
 * Action callbacks (rename/delete/add) live once on the root via `provide`
 * (see orgTreeApi in SchoolsSetup.vue) and are `inject`ed here — Vue's
 * provide/inject is inherited through every recursion depth automatically,
 * so no per-level event-relay boilerplate is needed for an arbitrarily deep
 * tree.
 *
 * `entityMode` ("school" | "leaf") — two hosts share this component:
 * SchoolsSetup.vue's real org tree (leaves are named schools an admin can
 * open/claim) and the Demos tool (2026-07-17 spec: NO school/class/teacher/
 * student language anywhere — a leaf is just a join code for learners).
 * "leaf" mode hides the school-creation action and the school-row list
 * entirely, showing a plain join-code affordance on the group row itself
 * instead — the group node IS the joinable thing, no separate entity type.
 */
import { computed, inject, ref } from 'vue'
import ViewAsButton from '@/components/admin/ViewAsButton.vue'
import type { ActAsPersona } from '@/composables/useUserRole'

interface Group {
  id: string
  name: string
  type: string
  parent_id: string | null
  is_demo?: boolean
  is_test?: boolean
  school_count: number
  granted_courses: string[]
}

interface School {
  id: string
  school_name: string
  group_id: string | null
  admin_user_id: string | null
}

interface OrgTreeApi {
  editingGroupId: { value: string | null }
  editingGroupName: { value: string }
  startGroupRename: (group: Group) => void
  saveGroupRename: (group: Group) => void
  cancelGroupRename: () => void
  openGroupDashboard: (groupId: string) => void
  requestDeleteGroup: (group: Group) => void
  requestDeleteSchool: (school: School) => void
  openSchoolDashboard: (schoolId: string) => void
  createSubgroup: (parentId: string, name: string) => Promise<void>
  createSchoolAt: (groupId: string, name: string) => Promise<void>
  groupLeaderCandidates: (group: Group) => ActAsPersona[]
  schoolAdminCandidates: (school: School) => ActAsPersona[]
  /** entityMode="leaf" only — the group's own join code, if one exists yet. */
  leafJoinCode?: (groupId: string) => string | null
  /** entityMode="leaf" only — idempotently provisions the group's join code. */
  ensureLeaf?: (groupId: string) => Promise<void>
}

const props = withDefaults(defineProps<{
  group: Group
  allGroups: Group[]
  allSchools: School[]
  depth: number
  /** Groups-tab search text — a group renders if it (or any descendant) matches, or the box is empty. */
  search?: string
  entityMode?: 'school' | 'leaf'
}>(), { search: '', entityMode: 'school' })

const api = inject<OrgTreeApi>('orgTreeApi')!
const isGettingCode = ref(false)
const justCopied = ref(false)
const joinCode = computed(() => (props.entityMode === 'leaf' ? api.leafJoinCode?.(props.group.id) ?? null : null))

async function getJoinCode(): Promise<void> {
  if (isGettingCode.value || !api.ensureLeaf) return
  isGettingCode.value = true
  try {
    await api.ensureLeaf(props.group.id)
  } finally {
    isGettingCode.value = false
  }
}

async function copyJoinCode(): Promise<void> {
  if (!joinCode.value) return
  try {
    await navigator.clipboard.writeText(joinCode.value)
    justCopied.value = true
    setTimeout(() => { justCopied.value = false }, 1500)
  } catch {
    // clipboard permission denied — the code is still visible to copy by hand
  }
}

function groupMatchesText(g: Group): boolean {
  const q = props.search.trim().toLowerCase()
  return !q || g.name.toLowerCase().includes(q)
}
function hasMatchingDescendant(g: Group): boolean {
  return props.allGroups
    .filter((x) => x.parent_id === g.id)
    .some((child) => groupMatchesText(child) || hasMatchingDescendant(child))
}

const children = computed(() =>
  props.allGroups
    .filter((g) => g.parent_id === props.group.id)
    .filter((g) => !props.search.trim() || groupMatchesText(g) || hasMatchingDescendant(g))
)
const leafSchools = computed(() => props.allSchools.filter((s) => s.group_id === props.group.id))

const indentStyle = computed(() => ({
  paddingLeft: `calc(var(--space-4) + ${props.depth} * var(--space-6))`,
}))
const entityIndentStyle = computed(() => ({
  paddingLeft: `calc(var(--space-4) + ${props.depth + 1} * var(--space-6))`,
}))

const showAddSubgroup = ref(false)
const showAddSchool = ref(false)
const newSubgroupName = ref('')
const newSchoolName = ref('')
const isSubmittingSubgroup = ref(false)
const isSubmittingSchool = ref(false)

async function submitSubgroup(): Promise<void> {
  if (!newSubgroupName.value.trim() || isSubmittingSubgroup.value) return
  isSubmittingSubgroup.value = true
  try {
    await api.createSubgroup(props.group.id, newSubgroupName.value.trim())
    newSubgroupName.value = ''
    showAddSubgroup.value = false
  } finally {
    isSubmittingSubgroup.value = false
  }
}

async function submitSchool(): Promise<void> {
  if (!newSchoolName.value.trim() || isSubmittingSchool.value) return
  isSubmittingSchool.value = true
  try {
    await api.createSchoolAt(props.group.id, newSchoolName.value.trim())
    newSchoolName.value = ''
    showAddSchool.value = false
  } finally {
    isSubmittingSchool.value = false
  }
}
</script>

<template>
  <div class="group-row" :style="indentStyle">
    <template v-if="api.editingGroupId.value === group.id">
      <input
        class="group-rename-input"
        :value="api.editingGroupName.value"
        @input="api.editingGroupName.value = ($event.target as HTMLInputElement).value"
        @blur="api.saveGroupRename(group)"
        @keyup.enter="api.saveGroupRename(group)"
        @keyup.escape="api.cancelGroupRename()"
      />
    </template>
    <span v-else class="group-name-editable" @click="api.startGroupRename(group)" title="Click to rename">
      {{ group.name }}
    </span>
    <span v-if="depth === 0 && entityMode === 'school'" class="org-badge" :class="{ 'is-demo': group.is_demo }">
      {{ group.is_demo ? 'Demo organisation' : 'Organisation' }}
    </span>
    <span v-if="entityMode === 'school'" class="group-meta">{{ group.school_count }} schools</span>
    <span v-if="entityMode === 'school' && group.granted_courses.length > 0" class="group-courses">
      {{ group.granted_courses.length }} courses
    </span>
    <template v-if="entityMode === 'leaf'">
      <span v-if="joinCode" class="join-code-badge" @click="copyJoinCode" :title="justCopied ? 'Copied!' : 'Click to copy'">
        {{ justCopied ? 'Copied!' : joinCode }}
      </span>
      <button v-else class="btn-ghost-sm" :disabled="isGettingCode" @click="getJoinCode">
        {{ isGettingCode ? 'Getting code…' : 'Get join code' }}
      </button>
    </template>
    <div class="row-actions">
      <button class="row-action" title="Add sub-group" @click="showAddSubgroup = !showAddSubgroup">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M20 7h-9M20 12h-9M20 17h-9M4 4v7M4 7h0"/>
          <circle cx="4" cy="15" r="3"/><line x1="4" y1="14" x2="4" y2="16"/><line x1="3" y1="15" x2="5" y2="15"/>
        </svg>
      </button>
      <button v-if="entityMode === 'school'" class="row-action" title="Add school here" @click="showAddSchool = !showAddSchool">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <line x1="12" y1="8" x2="12" y2="14"/><line x1="9" y1="11" x2="15" y2="11"/>
        </svg>
      </button>
      <button v-if="entityMode === 'school'" class="row-action" title="Open cross-schools dashboard" @click="api.openGroupDashboard(group.id)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M9 3v18M3 9h18"/>
        </svg>
      </button>
      <ViewAsButton v-if="entityMode === 'school'" :candidates="api.groupLeaderCandidates(group)" empty-title="No group leader yet" />
      <button class="row-action is-danger" title="Delete group" @click="api.requestDeleteGroup(group)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>

  <div v-if="showAddSubgroup" class="tree-inline-form" :style="entityIndentStyle">
    <input
      v-model="newSubgroupName"
      type="text"
      class="frost-input"
      placeholder="Sub-group name"
      autofocus
      @keyup.enter="submitSubgroup"
      @keyup.escape="showAddSubgroup = false"
    />
    <button class="btn-ghost-sm" :disabled="isSubmittingSubgroup || !newSubgroupName.trim()" @click="submitSubgroup">
      {{ isSubmittingSubgroup ? 'Adding…' : 'Add' }}
    </button>
  </div>

  <div v-if="entityMode === 'school' && showAddSchool" class="tree-inline-form" :style="entityIndentStyle">
    <input
      v-model="newSchoolName"
      type="text"
      class="frost-input"
      placeholder="School name"
      autofocus
      @keyup.enter="submitSchool"
      @keyup.escape="showAddSchool = false"
    />
    <button class="btn-ghost-sm" :disabled="isSubmittingSchool || !newSchoolName.trim()" @click="submitSchool">
      {{ isSubmittingSchool ? 'Adding…' : 'Add' }}
    </button>
  </div>

  <GroupTreeNode
    v-for="child in children"
    :key="child.id"
    :group="child"
    :all-groups="allGroups"
    :all-schools="allSchools"
    :depth="depth + 1"
    :search="search"
    :entity-mode="entityMode"
  />

  <template v-if="entityMode === 'school'">
    <div v-for="school in leafSchools" :key="school.id" class="entity-row" :style="entityIndentStyle">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="entity-icon">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
      <span class="entity-name">{{ school.school_name }}</span>
      <span v-if="!school.admin_user_id" class="status-pill tone-red"><span class="status-dot"></span>Awaiting admin</span>
      <div class="row-actions">
        <button class="row-action" title="Open school dashboard" @click="api.openSchoolDashboard(school.id)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M9 3v18M3 9h18"/>
          </svg>
        </button>
        <ViewAsButton :candidates="api.schoolAdminCandidates(school)" empty-title="No school admin claimed yet" />
        <button class="row-action is-danger" title="Delete school" @click="api.requestDeleteSchool(school)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.join-code-badge {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: var(--font-semibold);
  letter-spacing: 0.04em;
  padding: 3px 10px;
  border-radius: var(--radius-full, 999px);
  background: rgba(var(--tone-green, 58 132 74), 0.12);
  color: rgb(var(--tone-green-ink, 34 92 50));
  cursor: pointer;
  white-space: nowrap;
}
.join-code-badge:hover { background: rgba(var(--tone-green, 58 132 74), 0.2); }

.org-badge {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 2px 8px;
  border-radius: var(--radius-full, 999px);
  background: rgba(44, 38, 34, 0.06);
  color: var(--schools-fg-3);
}
.org-badge.is-demo {
  background: rgba(var(--tone-amber, 194 132 58), 0.12);
  color: rgb(var(--tone-amber-ink, 154 96 24));
}

.tree-inline-form {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1, 4px) var(--space-4) var(--space-2);
}
.tree-inline-form .frost-input {
  max-width: 260px;
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

.entity-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1, 4px) var(--space-4);
  font-size: var(--text-sm);
  color: var(--schools-fg-2);
  border-radius: var(--radius-md);
}
.entity-row:hover { background: rgba(255, 255, 255, 0.4); }
.entity-row .row-actions { margin-left: auto; opacity: 0; transform: translateX(4px); transition: all var(--transition-fast); }
.entity-row:hover .row-actions, .entity-row:focus-within .row-actions { opacity: 1; transform: translateX(0); }
.entity-icon { color: var(--schools-fg-3); flex-shrink: 0; }
.entity-name { font-weight: var(--font-medium); }
</style>
