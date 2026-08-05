<script setup lang="ts">
// NodeActionBar — the verbs, across the top of every node's dashboard page
// (founder-ruled 2026-07-19: "rows are links, verbs on the node page"). The
// same action set the Structure ⋯ menu carries — Invite people · Get join
// link · Add a group · Add a school · Mint a demo org · Courses · Rename ·
// Refresh demo activity · Delete — ordered most-common-first. Self-contained:
// calls the same server endpoints AdminStructure/the retired NodePanel used,
// then emits `changed` so the host page refetches. No "node"/"entitlement"
// jargon in any user-facing string (say school/group/courses).
import { ref, computed, watch } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import NodeEntitlementControl from '@/components/schools/NodeEntitlementControl.vue'
import ConfirmDeleteModal from '@/components/schools/ConfirmDeleteModal.vue'
import { formatDeleteImpactLines, type DeleteImpact } from '@/components/admin/deleteImpact'

interface NodeShape {
  id: string
  name: string
  label: string
  is_demo?: boolean
  commercial?: { schoolId: string } | null
  rollup?: { teacherCount?: number; classCount?: number; childGroupCount?: number; learnerCount?: number }
}

// `member` = the /org mount (a leader on their own subtree). Leaders get the
// invite verbs AND Add-a-group — /api/groups/:id/invites and POST /api/groups
// both authorize a govt_admin on their governed node or any strict descendant
// — while the remaining structural verbs (school/rename/mint/delete/courses)
// stay admin-only: their endpoints are ssi_admin-gated, and a leader's
// create-school lane is a separate surface (POST /api/govt/create-school).
// `preset` = the vocabulary dressing (founder ruling 2026-08-02, groups all
// the way down): 'neutral' hides every school/teacher word — no Add-a-school
// verb, invites default to Group leader. Defaults to 'education' so mounts
// that don't pass it (legacy school surfaces) keep their vocabulary.
const props = withDefaults(
  defineProps<{ node: NodeShape; member?: boolean; preset?: 'education' | 'neutral' }>(),
  { preset: 'education' },
)
const emit = defineEmits<{ changed: []; renamed: [name: string]; minted: [] }>()

const neutral = computed(() => props.preset === 'neutral')

const { getAuthToken } = useAdminClient()
function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const shareUrl = ref<{ url: string; hint: string } | null>(null)
const copied = ref(false)

function announce(message: string, url: { url: string; hint: string } | null = null): void {
  notice.value = message
  shareUrl.value = url
  error.value = null
}

async function copyShare(): Promise<void> {
  if (!shareUrl.value) return
  try {
    await navigator.clipboard.writeText(shareUrl.value.url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* clipboard unavailable */ }
}

// One inline form open at a time.
type Form = 'person' | 'invite' | 'group' | 'school' | 'demo' | 'courses' | 'rename' | null
const openForm = ref<Form>(null)
function toggle(f: Exclude<Form, null>): void {
  openForm.value = openForm.value === f ? null : f
  error.value = null
  notice.value = null
  shareUrl.value = null
}

const entitlementNodeId = computed(() => props.node.commercial?.schoolId ?? props.node.id)
const entitlementNodeType = computed<'group' | 'school'>(() => (props.node.commercial ? 'school' : 'group'))

// ─── Invite a person (species 1: personal link — the account is provisioned
// NOW with their name; the link is their login, zero screens on click) ───
// Under the neutral dressing the default role is GROUP LEADER, not teacher —
// a council is not a school (founder taste-test 2026-08-02).
const defaultRole = computed<'teacher' | 'leader'>(() => (neutral.value ? 'leader' : 'teacher'))
const personRole = ref<'teacher' | 'leader' | 'school_leader' | 'student'>(defaultRole.value)
const personName = ref('')
const personEmail = ref('')
const isInvitingPerson = ref(false)
async function submitPerson(): Promise<void> {
  if (isInvitingPerson.value || !personName.value.trim()) return
  isInvitingPerson.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.node.id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({
        role: personRole.value,
        limits: {},
        personal: { name: personName.value.trim(), ...(personEmail.value.trim() ? { email: personEmail.value.trim() } : {}) },
      }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    openForm.value = null
    // Tester feedback (Aran 2026-08-03): entering an email should SEND the
    // invite, not tell the leader to post it themselves. The server does that
    // now; the link stays on screen because sharing it by WhatsApp is often
    // better, and because it is the fallback when the send fails.
    const name = personName.value.trim()
    // `via` (2026-08-05): 'link' is the invite email carrying a clickable way
    // in — the whole point. 'code' is the sign-in-code fallback, sent only to
    // someone who has already accepted an invite before; say so plainly rather
    // than letting the leader assume a link went out.
    const emailed = data.emailed as { sent?: boolean; to?: string; via?: 'link' | 'code' } | undefined
    const message = emailed?.sent
      ? emailed.via === 'code'
        ? `${name} is in — ${emailed.to} already has an account, so we sent a sign-in code. Send them this link too.`
        : `Invite sent to ${emailed.to} — ${name} is in.`
      : emailed
        ? `${name} is in, but we couldn't email the invite — send them this link.`
        : `Personal link created for ${name}`
    announce(
      message,
      data.url
        ? {
            url: data.url,
            hint: emailed?.sent
              ? 'Same link, if you\'d rather send it yourself too — clicking it signs them straight in.'
              : 'Send this to them — clicking it signs them straight in.',
          }
        : null,
    )
    personName.value = ''
    personEmail.value = ''
    emit('minted')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create the personal link'
  } finally {
    isInvitingPerson.value = false
  }
}

// ─── Invite people ───
// Role-scoped links (founder-ruled 2026-07-20): every link names its role and
// its node — never one generic link. 'school_leader' appears only on school
// nodes (it grants the school-admin seat); 'student' is the learner join.
const inviteRole = ref<'teacher' | 'leader' | 'school_leader' | 'student'>(defaultRole.value)
// A node switch reuses this component instance — re-seed the defaults when
// the dressing flips so a neutral node never opens on 'Teacher'.
watch(defaultRole, (r) => {
  personRole.value = r
  inviteRole.value = r
})
const isInviting = ref(false)
const inviteHintByRole: Record<string, string> = {
  teacher: 'Share this with the teacher it\'s for.',
  leader: 'Share this with the leader it\'s for.',
  school_leader: 'Share this with the school leader it\'s for.',
  student: 'Anyone with this link joins as a learner.',
}
async function submitInvite(): Promise<void> {
  if (isInviting.value) return
  isInviting.value = true
  try {
    const token = await getAuthToken()
    // Reuse this node's existing shareable link for the role when one is
    // live (the old Get-join-link behaviour, now for every role) — keeps the
    // ledger free of duplicate open links.
    const listResp = await fetch(`/api/groups/${props.node.id}/invites`, { headers: authHeaders(token) })
    const listData = await listResp.json().catch(() => ({}))
    let link = listResp.ok
      ? (listData.links || []).find((l: any) => l.role === inviteRole.value && !l.personal)
      : null
    if (!link) {
      const resp = await fetch(`/api/groups/${props.node.id}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
        body: JSON.stringify({ role: inviteRole.value, limits: {} }),
      })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
      const path = inviteRole.value === 'leader' ? 'group' : 'redeem'
      link = data.url ? data : (data.code ? { url: `${window.location.origin}/${path}/${data.code}` } : null)
    }
    openForm.value = null
    try { if (link?.url) await navigator.clipboard.writeText(link.url) } catch { /* clipboard unavailable */ }
    announce(
      `Shareable link for "${props.node.name}" — copied.`,
      link?.url ? { url: link.url, hint: inviteHintByRole[inviteRole.value] || 'Share this invite link.' } : null,
    )
    emit('minted')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create invite'
  } finally {
    isInviting.value = false
  }
}

// ─── Add a group / Add a school ───
const newChildName = ref('')
const isAddingChild = ref(false)
async function submitGroup(): Promise<void> {
  if (!newChildName.value.trim() || isAddingChild.value) return
  isAddingChild.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ name: newChildName.value.trim(), type: 'group', parent_id: props.node.id }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(`"${newChildName.value.trim()}" added.`)
    newChildName.value = ''
    openForm.value = null
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add group'
  } finally {
    isAddingChild.value = false
  }
}
async function submitSchool(): Promise<void> {
  if (!newChildName.value.trim() || isAddingChild.value) return
  isAddingChild.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/admin/create-school', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ school_name: newChildName.value.trim(), group_id: props.node.id }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(`School "${newChildName.value.trim()}" added.`)
    newChildName.value = ''
    openForm.value = null
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to add school'
  } finally {
    isAddingChild.value = false
  }
}

// ─── Mint a demo org ───
const demoName = ref('')
const demoLeaderEmail = ref('')
const isMinting = ref(false)
async function submitDemo(): Promise<void> {
  if (!demoName.value.trim() || isMinting.value) return
  isMinting.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.node.id}/demo-mint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ name: demoName.value.trim(), leader_email: demoLeaderEmail.value.trim() || undefined }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    const leaderLink = Array.isArray(data.links) ? data.links.find((l: any) => l.role === 'leader') : null
    openForm.value = null
    announce(
      `Demo org "${demoName.value.trim()}" minted.`,
      leaderLink?.url ? { url: leaderLink.url, hint: 'Share this with the demo leader.' } : null,
    )
    demoName.value = ''
    demoLeaderEmail.value = ''
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to mint demo org'
  } finally {
    isMinting.value = false
  }
}

// ─── Rename ───
const renameValue = ref('')
const isRenaming = ref(false)
function openRename(): void {
  renameValue.value = props.node.name
  toggle('rename')
}
async function submitRename(): Promise<void> {
  const name = renameValue.value.trim()
  if (!name || isRenaming.value) return
  if (name === props.node.name) { openForm.value = null; return }
  isRenaming.value = true
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.node.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ name }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(`Renamed to "${name}".`)
    openForm.value = null
    emit('renamed', name)
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to rename'
  } finally {
    isRenaming.value = false
  }
}

// ─── Refresh demo activity (demo nodes only) ───
const isRefreshing = ref(false)
async function refreshDemo(): Promise<void> {
  if (isRefreshing.value) return
  isRefreshing.value = true
  error.value = null
  notice.value = null
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${props.node.id}/demo-refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    announce(data.noop
      ? 'Nothing to refresh — no demo learners below this node yet.'
      : `Fresh activity for ${data.learnersTouched} learners — ${data.sessionsWritten} practice sessions.`)
    emit('changed')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to refresh demo activity'
  } finally {
    isRefreshing.value = false
  }
}

// ─── Delete — honest impact lines (deleteImpact.ts states the actual
// cascade consequence with names/counts) ───
const deleteOpen = ref(false)
const deleteImpact = ref<DeleteImpact | null>(null)
const deleteSubmitting = ref(false)
const deleteError = ref('')
const deleteTitle = computed(() => (props.node.commercial ? 'Delete school' : 'Delete group'))
const deleteImpactLines = computed(() => formatDeleteImpactLines(deleteImpact.value))
async function requestDelete(): Promise<void> {
  deleteImpact.value = null
  deleteError.value = ''
  deleteOpen.value = true
  try {
    const token = await getAuthToken()
    const url = props.node.commercial
      ? `/api/admin/update-school?school_id=${encodeURIComponent(props.node.commercial.schoolId)}`
      : `/api/groups/${props.node.id}`
    const resp = await fetch(url, { method: 'GET', headers: authHeaders(token) })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to load deletion impact')
    deleteImpact.value = data.impact
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : 'Failed to load deletion impact'
  }
}
async function confirmDelete(typedName: string): Promise<void> {
  deleteSubmitting.value = true
  deleteError.value = ''
  try {
    const token = await getAuthToken()
    const headers = authHeaders(token)
    if (props.node.commercial) {
      const params = new URLSearchParams({ school_id: props.node.commercial.schoolId })
      if (typedName) params.set('confirm_name', typedName)
      const resp = await fetch(`/api/admin/update-school?${params.toString()}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || 'Failed to delete school')
    } else {
      const qp = typedName ? `?confirm_name=${encodeURIComponent(typedName)}` : ''
      const resp = await fetch(`/api/groups/${props.node.id}${qp}`, { method: 'DELETE', headers })
      const data = await resp.json().catch(() => ({}))
      if (!resp.ok) throw new Error(data.error || 'Failed to delete group')
    }
    deleteOpen.value = false
    emit('changed')
  } catch (err) {
    deleteError.value = err instanceof Error ? err.message : 'Failed to delete'
  } finally {
    deleteSubmitting.value = false
  }
}
function closeDelete(): void {
  if (deleteSubmitting.value) return
  deleteOpen.value = false
  deleteImpact.value = null
  deleteError.value = ''
}
</script>

<template>
  <div class="node-actions">
    <!-- Verbs, most-common-first (founder-ruled 2026-07-19) -->
    <div class="verb-bar">
      <!-- Two link species, two verbs (founder-ruled 2026-07-20): a personal
           link for a known person, or a shareable link by role — the old
           learner-only "Get join link" folded into the shareable menu. -->
      <button type="button" class="verb" :class="{ 'is-open': openForm === 'person' }" data-walk="verb-invite-person" @click="toggle('person')">Invite a person</button>
      <button type="button" class="verb" :class="{ 'is-open': openForm === 'invite' }" @click="toggle('invite')">Get a shareable link</button>
      <!-- Add a group is for LEADERS too (founder ruling 2026-08-02: any
           group can contain subgroups — the endpoint authorizes a leader on
           their own subtree). Add a school is education-dressing-only. -->
      <button type="button" class="verb" :class="{ 'is-open': openForm === 'group' }" @click="toggle('group')">Add a group</button>
      <button v-if="!member && !node.commercial && !neutral" type="button" class="verb" :class="{ 'is-open': openForm === 'school' }" @click="toggle('school')">Add a school</button>
      <button v-if="!member" type="button" class="verb" :class="{ 'is-open': openForm === 'demo' }" @click="toggle('demo')">Mint a demo org</button>
      <button v-if="!member" type="button" class="verb" :class="{ 'is-open': openForm === 'courses' }" @click="toggle('courses')">Courses</button>
      <button v-if="!member" type="button" class="verb" :class="{ 'is-open': openForm === 'rename' }" @click="openRename">Rename</button>
      <button v-if="!member && node.is_demo" type="button" class="verb verb-demo" :disabled="isRefreshing" @click="refreshDemo">
        {{ isRefreshing ? 'Refreshing…' : 'Refresh demo activity' }}
      </button>
      <button v-if="!member" type="button" class="verb verb-danger" @click="requestDelete">Delete</button>
    </div>

    <!-- Inline forms (one at a time) -->
    <div v-if="openForm === 'person'" class="verb-form-block">
      <div class="verb-form">
        <select v-model="personRole" class="frost-select" data-walk="invite-form-role">
          <option v-if="!neutral" value="teacher">Teacher</option>
          <option value="leader">Group leader</option>
          <option v-if="!neutral && node.commercial" value="school_leader">School leader</option>
          <option value="student">Learner</option>
        </select>
        <input v-model="personName" type="text" class="frost-input" placeholder="Their name" @keyup.enter="submitPerson" />
        <input v-model="personEmail" type="email" class="frost-input" placeholder="Their email — we'll send the invite" />
        <button class="btn-primary-sm" data-walk="invite-form-submit" :disabled="isInvitingPerson || !personName.trim()" @click="submitPerson">
          {{ isInvitingPerson ? (personEmail.trim() ? 'Sending…' : 'Creating…') : (personEmail.trim() ? 'Send their invite' : 'Create their link') }}
        </button>
      </div>
      <p class="kind-hint">Named invite — goes straight in, no screens. Give an email and we send it for you; leave it blank and you get a link to share.</p>
    </div>
    <div v-else-if="openForm === 'invite'" class="verb-form-block">
      <div class="verb-form">
        <select v-model="inviteRole" class="frost-select">
          <option v-if="!neutral" value="teacher">Teacher</option>
          <option value="leader">Group leader</option>
          <option v-if="!neutral && node.commercial" value="school_leader">School leader</option>
          <option value="student">Learner</option>
        </select>
        <button class="btn-primary-sm" :disabled="isInviting" @click="submitInvite">
          {{ isInviting ? 'Creating…' : 'Create invite link' }}
        </button>
      </div>
      <p class="kind-hint">Shareable — new arrivals enter their name before they're in.</p>
    </div>
    <div v-else-if="openForm === 'group'" class="verb-form">
      <input v-model="newChildName" type="text" class="frost-input" placeholder="Group name" @keyup.enter="submitGroup" />
      <button class="btn-primary-sm" :disabled="isAddingChild || !newChildName.trim()" @click="submitGroup">
        {{ isAddingChild ? 'Adding…' : 'Add' }}
      </button>
    </div>
    <div v-else-if="openForm === 'school'" class="verb-form">
      <input v-model="newChildName" type="text" class="frost-input" placeholder="School name" @keyup.enter="submitSchool" />
      <button class="btn-primary-sm" :disabled="isAddingChild || !newChildName.trim()" @click="submitSchool">
        {{ isAddingChild ? 'Adding…' : 'Add' }}
      </button>
    </div>
    <div v-else-if="openForm === 'demo'" class="verb-form">
      <input v-model="demoName" type="text" class="frost-input" placeholder="Demo org name" @keyup.enter="submitDemo" />
      <input v-model="demoLeaderEmail" type="email" class="frost-input" placeholder="Leader email (optional)" />
      <button class="btn-primary-sm" :disabled="isMinting || !demoName.trim()" @click="submitDemo">
        {{ isMinting ? 'Minting…' : 'Mint' }}
      </button>
    </div>
    <div v-else-if="openForm === 'rename'" class="verb-form">
      <input v-model="renameValue" type="text" class="frost-input" placeholder="New name" @keyup.enter="submitRename" @keyup.escape="openForm = null" />
      <button class="btn-primary-sm" :disabled="isRenaming || !renameValue.trim()" @click="submitRename">
        {{ isRenaming ? 'Saving…' : 'Save' }}
      </button>
    </div>
    <div v-else-if="openForm === 'courses'" class="verb-form verb-form-block">
      <NodeEntitlementControl :node-id="entitlementNodeId" :node-type="entitlementNodeType" />
    </div>

    <!-- Result / error banners -->
    <p v-if="error" class="node-actions-banner is-error">{{ error }}</p>
    <div v-else-if="notice" class="node-actions-banner is-ok">
      <span>{{ notice }}</span>
      <button
        v-if="shareUrl" type="button" class="share-chip" :class="{ 'is-copied': copied }" @click="copyShare"
      >{{ copied ? 'Copied!' : shareUrl.url }}</button>
      <span v-if="shareUrl" class="share-hint">{{ shareUrl.hint }}</span>
    </div>

    <ConfirmDeleteModal
      :is-open="deleteOpen"
      :title="deleteTitle"
      :target-name="node.name"
      :impact-lines="deleteImpactLines"
      :require-typed-confirm="!!deleteImpact?.hasRealActivity"
      :submitting="deleteSubmitting"
      :error="deleteError"
      @close="closeDelete"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped>
.node-actions { display: flex; flex-direction: column; gap: var(--space-3); }
.verb-bar { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.verb {
  padding: 8px 14px; font: inherit; font-size: var(--text-sm); font-weight: var(--font-semibold);
  border-radius: var(--radius-lg); border: 1px solid rgba(44, 38, 34, 0.12);
  background: rgba(44, 38, 34, 0.05); color: var(--schools-fg, #0F1212); cursor: pointer;
  transition: all var(--transition-fast);
}
.verb:hover:not(:disabled) { background: rgba(44, 38, 34, 0.11); }
.verb.is-open { background: var(--schools-red, #DB1E17); border-color: transparent; color: #fff; }
.verb:disabled { opacity: 0.55; cursor: wait; }
.verb-demo { background: rgba(var(--tone-amber, 194 132 58), 0.16); border-color: rgba(var(--tone-amber, 194 132 58), 0.3); color: rgb(var(--tone-amber-ink, 154 96 24)); }
.verb-danger { color: rgb(var(--tone-red)); border-color: rgba(var(--tone-red), 0.28); }
.verb-danger:hover:not(:disabled) { background: rgba(var(--tone-red), 0.08); }

.verb-form { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.verb-form-block { display: block; }
.kind-hint { margin: 6px 0 0; font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); }
.frost-input, .frost-select {
  font: inherit; font-size: var(--text-sm); padding: 8px 12px; color: var(--schools-fg, #0F1212);
  background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(44, 38, 34, 0.12); border-radius: var(--radius-lg);
}
.frost-input:focus, .frost-select:focus { outline: none; border-color: rgba(var(--tone-red), 0.55); box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.14); }
.btn-primary-sm {
  padding: 8px 16px; font: inherit; font-size: var(--text-sm); font-weight: var(--font-semibold);
  border-radius: var(--radius-full, 999px); border: none; background: var(--schools-red, #DB1E17); color: #fff; cursor: pointer;
}
.btn-primary-sm:disabled { opacity: 0.5; cursor: not-allowed; }

.node-actions-banner {
  display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
  padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); font-size: var(--text-sm);
}
.node-actions-banner.is-ok { background: rgba(var(--tone-green), 0.10); border: 1px solid rgba(var(--tone-green), 0.28); color: rgb(var(--tone-green-ink)); }
.node-actions-banner.is-error { background: rgba(var(--tone-red), 0.08); border: 1px solid rgba(var(--tone-red), 0.28); color: rgb(var(--tone-red)); }
.share-chip {
  font-family: var(--font-mono); font-size: var(--text-xs); padding: 5px 10px; cursor: pointer;
  background: rgba(255, 255, 255, 0.7); border: 1px solid rgba(44, 38, 34, 0.10); border-radius: var(--radius-md);
  color: var(--schools-fg-2, #555); word-break: break-all; text-align: left;
}
.share-chip.is-copied { background: rgba(var(--tone-green), 0.16); border-color: rgba(var(--tone-green), 0.45); color: rgb(var(--tone-green-ink)); }
.share-hint { font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078); }
</style>
