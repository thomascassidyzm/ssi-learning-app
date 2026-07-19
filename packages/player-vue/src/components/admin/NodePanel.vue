<script setup lang="ts">
// NodePanel — the Structure node panel, VERBS ON TOP (THE-MODEL.md §1.12,
// founder-ruled). Opens on selecting any node in either lens. Leads with
// 3 plain-language task buttons — each an empty-state teaching button when
// its count is zero, never a passive caption (§1.12.3) — then the ways-in
// links list (§1.10 — the invites page dies, links live ON the node), then
// everything else (relabel, demo-mint, delete, raw counts) folded under
// "More" (progressive disclosure, §1.12.2). No "node"/"entitlement"/
// "subtree"/"primitive" in any user-facing string here (§1.12.4) — say
// school/group/courses/everyone below this.
import { ref, computed, watch, inject } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import NodeEntitlementControl from '@/components/schools/NodeEntitlementControl.vue'
import type { StructureApi, StructureNode } from './structureApi'

const props = defineProps<{ node: StructureNode }>()
const emit = defineEmits<{ close: [] }>()

const api = inject<StructureApi>('structureApi')!

// Courses control (§1.11, built by another worker) is keyed the same way
// the old facet panel saved grants — school-shaped nodes by their
// commercial schools.id (continuity with existing grants), plain groups by
// their own group id.
const entitlementNodeId = computed(() => props.node.commercial?.schoolId ?? props.node.id)
const entitlementNodeType = computed<'group' | 'school'>(() => (props.node.commercial ? 'school' : 'group'))
const { getAuthToken } = useAdminClient()

function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ─── Ways in — the links list (§1.10) ───
interface InviteLink { role: string; url: string; code: string; limits: { max_uses: number | null; expires_at: string | null }; useCount: number }
const links = ref<InviteLink[]>([])
const isLoadingLinks = ref(false)
const copiedUrl = ref<string | null>(null)

async function fetchLinks(): Promise<void> {
  isLoadingLinks.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.node.id}/invites`, { headers: authHeaders(token) })
    const data = await resp.json().catch(() => ({}))
    links.value = resp.ok ? (data.links || []) : []
  } finally {
    isLoadingLinks.value = false
  }
}

async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    copiedUrl.value = url
    setTimeout(() => { if (copiedUrl.value === url) copiedUrl.value = null }, 2000)
  } catch { copiedUrl.value = null }
}

const ROLE_WORDS: Record<string, string> = { teacher: 'Teacher', leader: 'Leader', student: 'Student' }

// ─── Verb: invite a teacher (inline role picker, defaults to teacher) ───
const showInviteForm = ref(false)
const inviteRole = ref<'teacher' | 'leader' | 'student'>('teacher')
const isInviting = ref(false)

const inviteVerbLabel = computed(() =>
  props.node.rollup.teacherCount === 0 ? 'No teachers yet → Invite one' : 'Invite a teacher'
)

async function submitInvite(): Promise<void> {
  isInviting.value = true
  try {
    const ok = await api.submitInvite(props.node, { role: inviteRole.value })
    if (ok) { showInviteForm.value = false; await fetchLinks() }
  } finally {
    isInviting.value = false
  }
}

// ─── Verb: add a group (inline name field) ───
const showAddGroupForm = ref(false)
const newGroupName = ref('')
const isAddingGroup = ref(false)

const addGroupVerbLabel = computed(() =>
  props.node.rollup.childGroupCount === 0 ? 'No groups below yet → Add one' : 'Add a group'
)

async function submitAddGroup(): Promise<void> {
  if (!newGroupName.value.trim()) return
  isAddingGroup.value = true
  try {
    const ok = await api.createChild(props.node.id, newGroupName.value.trim(), 'group', false)
    if (ok) { newGroupName.value = ''; showAddGroupForm.value = false }
  } finally {
    isAddingGroup.value = false
  }
}

// ─── Verb: add a school (real schools with commercial attachment) ───
const showAddSchoolForm = ref(false)
const newSchoolName = ref('')
const isAddingSchool = ref(false)

async function submitAddSchool(): Promise<void> {
  if (!newSchoolName.value.trim()) return
  isAddingSchool.value = true
  try {
    const token = await getAuthToken()
    if (!token) throw new Error('Not authenticated')
    const resp = await fetch('/api/admin/create-school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ school_name: newSchoolName.value.trim(), group_id: props.node.id }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    if (newSchoolName.value) {
      newSchoolName.value = ''
      showAddSchoolForm.value = false
      // Refetch to show the new school in the tree
      await fetchLinks()
    }
  } finally {
    isAddingSchool.value = false
  }
}

// ─── Verb: share the JOIN link (copy the learner join link to clipboard) ───
// This panel is a group/school node — those carry learner JOIN links, not a
// class link. "Class link" language is reserved for a class context (which must
// name its owner teacher); here the artifact is the learner join link at this
// node (THE-MODEL.md §1.12, ruled 2026-07-19).
const shareJoinLinkUrl = ref<string | null>(null)
const isSharingJoinLink = ref(false)

async function shareJoinLink(): Promise<void> {
  isSharingJoinLink.value = true
  try {
    // Copy the learner (student-role) join link to clipboard if available, or create one
    const studentLink = links.value.find((l) => l.role === 'student')
    if (studentLink?.url) {
      await navigator.clipboard.writeText(studentLink.url)
      shareJoinLinkUrl.value = studentLink.url
      setTimeout(() => { shareJoinLinkUrl.value = null }, 2000)
    } else {
      // Create a learner join link
      const ok = await api.submitInvite(props.node, { role: 'student' })
      if (ok) {
        await fetchLinks()
        const newStudentLink = links.value.find((l) => l.role === 'student')
        if (newStudentLink?.url) {
          await navigator.clipboard.writeText(newStudentLink.url)
          shareJoinLinkUrl.value = newStudentLink.url
          setTimeout(() => { shareJoinLinkUrl.value = null }, 2000)
        }
      }
    }
  } catch (err) {
    console.error('Error sharing join link:', err)
  } finally {
    isSharingJoinLink.value = false
  }
}

// ─── Verb: see progress — straight drill-in, no form ───
function seeProgress(): void {
  api.openDashboard(props.node)
}

// ─── Progressive disclosure — everything else, collapsed by default ───
const showMore = ref(false)

watch(() => props.node.id, fetchLinks, { immediate: true })
</script>

<template>
  <aside class="node-panel">
    <header class="node-panel-head">
      <div class="node-panel-title">
        <h2>{{ node.name }}</h2>
        <span v-if="node.is_demo" class="tag is-demo">Demo</span>
      </div>
      <button type="button" class="close-btn" @click="emit('close')" aria-label="Close">✕</button>
    </header>

    <!-- VERBS ON TOP (§1.12.1) — big, plain-language, task-first -->
    <div class="verb-row">
      <button type="button" class="verb-btn" :class="{ 'is-empty': node.rollup.teacherCount === 0 }" @click="showInviteForm = !showInviteForm">
        {{ inviteVerbLabel }}
      </button>
      <button type="button" class="verb-btn" :class="{ 'is-empty': node.rollup.childGroupCount === 0 }" @click="showAddGroupForm = !showAddGroupForm">
        {{ addGroupVerbLabel }}
      </button>
      <button type="button" class="verb-btn" @click="showAddSchoolForm = !showAddSchoolForm">
        Add a school
      </button>
      <button v-if="node.rollup.classCount > 0" type="button" class="verb-btn" :disabled="isSharingJoinLink" @click="shareJoinLink">
        {{ isSharingJoinLink ? 'Copying…' : shareJoinLinkUrl ? 'Copied!' : 'Share the join link' }}
      </button>
      <button type="button" class="verb-btn verb-btn-secondary" @click="seeProgress">
        See progress
      </button>
    </div>

    <div v-if="showInviteForm" class="verb-form">
      <select v-model="inviteRole" class="frost-select">
        <option value="teacher">Teacher</option>
        <option value="leader">Leader</option>
        <option value="student">Student</option>
      </select>
      <button class="btn-primary-sm" :disabled="isInviting" @click="submitInvite">
        {{ isInviting ? 'Creating…' : 'Create invite link' }}
      </button>
    </div>

    <div v-if="showAddGroupForm" class="verb-form">
      <input v-model="newGroupName" type="text" class="frost-input" placeholder="Group name" @keyup.enter="submitAddGroup" />
      <button class="btn-primary-sm" :disabled="isAddingGroup || !newGroupName.trim()" @click="submitAddGroup">
        {{ isAddingGroup ? 'Adding…' : 'Add' }}
      </button>
    </div>

    <div v-if="showAddSchoolForm" class="verb-form">
      <input v-model="newSchoolName" type="text" class="frost-input" placeholder="School name" @keyup.enter="submitAddSchool" />
      <button class="btn-primary-sm" :disabled="isAddingSchool || !newSchoolName.trim()" @click="submitAddSchool">
        {{ isAddingSchool ? 'Adding…' : 'Add' }}
      </button>
    </div>

    <!-- Ways in — the links list (§1.10), links-first -->
    <section class="ways-in">
      <h3>Ways in</h3>
      <p v-if="isLoadingLinks" class="hint">Loading…</p>
      <p v-else-if="links.length === 0" class="hint">No invite links yet — use "{{ inviteVerbLabel }}" above to make one.</p>
      <ul v-else class="link-list">
        <li v-for="link in links" :key="link.code" class="link-row">
          <span class="link-role">{{ ROLE_WORDS[link.role] || link.role }}</span>
          <button type="button" class="link-url" :class="{ 'is-copied': copiedUrl === link.url }" @click="copyLink(link.url)">
            {{ copiedUrl === link.url ? 'Copied!' : link.url }}
          </button>
        </li>
      </ul>
    </section>

    <!-- Progressive disclosure — everything else (§1.12.2) -->
    <button type="button" class="more-toggle" @click="showMore = !showMore">
      {{ showMore ? 'Less ▲' : 'More ▼' }}
    </button>
    <section v-if="showMore" class="more-section">
      <div class="stat-row">
        <span>{{ node.rollup.teacherCount }} teacher{{ node.rollup.teacherCount === 1 ? '' : 's' }}</span>
        <span>{{ node.rollup.classCount }} class{{ node.rollup.classCount === 1 ? '' : 'es' }}</span>
        <span>{{ node.rollup.learnerCount }} learner{{ node.rollup.learnerCount === 1 ? '' : 's' }}</span>
      </div>
      <!-- Courses — binary trial/paid control (THE-MODEL.md §1.11). -->
      <NodeEntitlementControl :node-id="entitlementNodeId" :node-type="entitlementNodeType" />
      <div class="more-row">
        <span class="more-label">Rename</span>
        <button v-if="api.editingId.value !== node.id" class="btn-ghost-sm" @click="api.startRename(node)">Rename "{{ node.name }}"</button>
        <span v-else class="rename-inline">
          <input
            class="frost-input"
            :value="api.editingName.value"
            @input="api.editingName.value = ($event.target as HTMLInputElement).value"
            @keyup.enter="api.saveRename(node)"
            @keyup.escape="api.cancelRename()"
          />
        </span>
      </div>
      <div class="more-row">
        <span class="more-label">Label</span>
        <select class="frost-select" :value="node.label" @change="api.updateLabel(node, ($event.target as HTMLSelectElement).value)">
          <option value="group">group</option>
          <option value="organisation">organisation</option>
          <option value="school">school</option>
          <option value="district">district</option>
          <option value="programme">programme</option>
        </select>
      </div>
      <div class="more-row">
        <button class="btn-ghost-sm is-danger" @click="api.requestDelete(node)">Delete "{{ node.name }}"</button>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.node-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5);
}

.node-panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.node-panel-title { display: flex; align-items: center; gap: var(--space-2); }
.node-panel-title h2 { font-family: var(--font-display); font-size: var(--text-xl); font-weight: 400; color: var(--schools-fg); margin: 0; }
.tag { font-size: var(--text-xs); padding: 2px 8px; border-radius: var(--radius-full, 999px); background: rgba(44, 38, 34, 0.06); color: var(--schools-fg-3); }
.tag.is-demo { background: rgba(var(--tone-amber, 194 132 58), 0.12); color: rgb(var(--tone-amber-ink, 154 96 24)); }
.close-btn { background: none; border: none; color: var(--schools-fg-3); cursor: pointer; font-size: var(--text-base); }

.verb-row { display: flex; flex-direction: column; gap: var(--space-2); }
.verb-btn {
  padding: 14px 18px; font: inherit; font-size: var(--text-base); font-weight: var(--font-semibold);
  border-radius: var(--radius-lg); border: 1px solid transparent; background: var(--schools-red); color: #fff;
  cursor: pointer; text-align: left;
}
.verb-btn:hover { background: var(--schools-red-deep); }
.verb-btn.is-empty { background: rgb(var(--tone-amber-ink, 154 96 24)); }
.verb-btn-secondary { background: rgba(44, 38, 34, 0.06); color: var(--schools-fg); }
.verb-btn-secondary:hover { background: rgba(44, 38, 34, 0.12); }

.verb-form { display: flex; align-items: center; gap: var(--space-2); }

.ways-in h3 { font-family: var(--font-display); font-size: var(--text-base); font-weight: 400; color: var(--schools-fg); margin: 0 0 var(--space-2); }
.hint { font-size: var(--text-sm); color: var(--schools-fg-3); margin: 0; }
.link-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.link-row { display: flex; align-items: center; gap: var(--space-3); }
.link-role { font-size: var(--text-xs); font-weight: var(--font-medium); color: var(--schools-fg-3); width: 60px; flex-shrink: 0; }
.link-url {
  flex: 1; text-align: left; font-family: var(--font-mono); font-size: var(--text-xs); padding: 6px 10px;
  background: rgba(255, 255, 255, 0.55); border: 1px solid rgba(44, 38, 34, 0.10); border-radius: var(--radius-md);
  color: var(--schools-fg-2); cursor: pointer; word-break: break-all;
}
.link-url.is-copied { background: rgba(var(--tone-green), 0.16); border-color: rgba(var(--tone-green), 0.45); color: rgb(var(--tone-green-ink)); }

.more-toggle { align-self: flex-start; background: none; border: none; color: var(--schools-fg-3); font-size: var(--text-xs); cursor: pointer; padding: 0; }
.more-section { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-2); border-top: 1px solid rgba(44, 38, 34, 0.06); }
.stat-row { display: flex; gap: var(--space-3); font-size: var(--text-xs); color: var(--schools-fg-3); }
.more-row { display: flex; align-items: center; gap: var(--space-3); }
.more-label { font-size: var(--text-xs); font-weight: var(--font-medium); color: var(--schools-fg-3); width: 60px; flex-shrink: 0; }

.frost-input, .frost-select {
  font: inherit; font-size: var(--text-sm); padding: 8px 12px; color: var(--schools-fg);
  background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(44, 38, 34, 0.12); border-radius: var(--radius-lg);
}
.btn-primary-sm {
  padding: 8px 16px; font: inherit; font-size: var(--text-sm); font-weight: var(--font-semibold);
  border-radius: var(--radius-full); border: none; background: var(--schools-red); color: #fff; cursor: pointer;
}
.btn-primary-sm:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-ghost-sm {
  padding: 6px 12px; font-size: var(--text-xs); font-weight: var(--font-medium); border-radius: var(--radius-md);
  border: 1px solid rgba(44, 38, 34, 0.14); background: rgba(255, 255, 255, 0.6); color: var(--schools-fg-2); cursor: pointer;
}
.btn-ghost-sm.is-danger:hover { color: rgb(var(--tone-red)); border-color: rgba(var(--tone-red), 0.30); }
</style>
