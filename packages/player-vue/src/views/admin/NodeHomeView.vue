<script setup lang="ts">
// NodeHomeView — THE VIEW's one recursive NODE HOME (docs/THE-VIEW.md).
// The same page at every level of the org tree: MAP RAIL · IDENTITY HEADER ·
// STATS ROW · CHILDREN LIST (lenses are filters, not pages) · VERBS.
// Mounted at /admin/groups/:id, /admin/schools/:id and /admin/classes/:id —
// one endpoint (/api/groups/:id/home) resolves whichever id it's given.
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import NodeMapRail from '@/components/admin/NodeMapRail.vue'
import NodeChildrenList from '@/components/admin/NodeChildrenList.vue'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'

const route = useRoute()
const router = useRouter()
const { getAuthToken } = useAdminClient()

const isLoading = ref(true)
const error = ref<string | null>(null)
const home = ref<any | null>(null)

const LENSES = [
  { value: 'children', label: 'Directly below' },
  { value: 'groups', label: 'All groups' },
  { value: 'schools', label: 'All schools' },
  { value: 'teachers', label: 'All teachers' },
  { value: 'classes', label: 'All classes' },
]

const isClass = computed(() => home.value?.kind === 'class')
const lens = computed(() => {
  if (isClass.value) return 'students'
  const q = typeof route.query.lens === 'string' ? route.query.lens : ''
  return LENSES.some((l) => l.value === q) ? q : 'children'
})

function setLens(value: string): void {
  router.replace({ query: { ...route.query, lens: value === 'children' ? undefined : value } })
}

async function fetchHome(): Promise<void> {
  const id = String(route.params.id || '')
  if (!id) return
  isLoading.value = true
  error.value = null
  try {
    const token = await getAuthToken()
    const params = new URLSearchParams()
    const activeLens = typeof route.query.lens === 'string' ? route.query.lens : ''
    if (activeLens && activeLens !== 'children') params.set('lens', activeLens)
    const qs = params.toString()
    const resp = await fetch(`/api/groups/${id}/home${qs ? `?${qs}` : ''}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to load')
    home.value = data
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load'
  } finally {
    isLoading.value = false
  }
}

// The ONE refresh protocol: register this node's loader so the navbar button
// and pull-to-refresh drive it. Navigation between nodes/lenses still reloads
// (that's a navigation, not auto-refresh) — routed through refresh() so it
// stamps "Updated HH:MM". No polling: the node holds still until asked.
const { refresh, registerRefresh } = useDashboardRefresh()
registerRefresh(fetchHome, { immediate: false })

watch(
  [() => route.params.id, () => route.query.lens],
  () => { void refresh() },
  { immediate: true },
)

// ─── Identity ───
const stateBadge = computed(() => {
  const n = home.value?.node
  if (!n) return null
  if (n.is_demo) return { word: 'Demo', tone: 'amber' }
  const status = n.commercial?.platformStatus
  if (!status) return null
  if (status === 'active' || status === 'paid') return { word: 'Paid — all courses', tone: 'green' }
  if (status.startsWith('trial')) return { word: n.commercial?.trialCourseCode ? `Trial — ${n.commercial.trialCourseCode}` : 'Trial', tone: 'amber' }
  return { word: status.replace(/_/g, ' '), tone: 'grey' }
})

const labelWord = computed(() => {
  const n = home.value?.node
  if (!n) return ''
  if (isClass.value) return 'Class'
  if (n.commercial || n.hasSchool) return 'School'
  return n.label ? n.label[0].toUpperCase() + n.label.slice(1) : 'Group'
})

// ─── Stats row (same cards at every level, subtree totals) ───
const stats = computed(() => {
  const n = home.value?.node
  if (!n) return []
  const r = n.rollup || {}
  return [
    { value: r.learnerCount ?? 0, word: isClass.value ? 'Students' : 'Learners' },
    { value: r.teacherCount ?? 0, word: 'Teachers' },
    { value: r.classCount ?? 0, word: 'Classes' },
    { value: `${home.value?.practiceHours ?? 0}h`, word: 'Practice hours' },
  ]
})

// ─── Verbs (§1.12 — same corner every level, scoped to the node) ───
const showInvite = ref(false)
const inviteRole = ref<'teacher' | 'leader' | 'student'>('teacher')
const isInviting = ref(false)
const inviteUrl = ref<string | null>(null)
const copied = ref(false)

async function submitInvite(): Promise<void> {
  if (isInviting.value) return
  isInviting.value = true
  try {
    const token = await getAuthToken()
    const nodeId = isClass.value ? home.value?.nodeId : home.value?.node?.id
    const resp = await fetch(`/api/groups/${nodeId}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ role: inviteRole.value, limits: {} }),
    })
    const data = await resp.json().catch(() => ({}))
    if (!resp.ok) throw new Error(data.error || 'Failed to create invite')
    const path = inviteRole.value === 'leader' ? 'group' : 'redeem'
    inviteUrl.value = data.code ? `${window.location.origin}/${path}/${data.code}` : null
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to create invite'
  } finally {
    isInviting.value = false
  }
}

async function copyInvite(): Promise<void> {
  if (!inviteUrl.value) return
  try {
    await navigator.clipboard.writeText(inviteUrl.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* clipboard unavailable */ }
}

const analyticsLink = computed(() => {
  const n = home.value?.node
  if (!n) return null
  if (isClass.value) return home.value?.schoolId ? `/admin/schools/${home.value.schoolId}/classes/${n.id}` : null
  if (n.commercial?.schoolId) return `/admin/schools/${n.commercial.schoolId}/analytics`
  return `/admin/groups/${n.id}/analytics`
})

const structureLink = computed(() => '/admin/structure')

// ─── Children payload for the list ───
const listPayload = computed(() => {
  if (!home.value) return {}
  if (isClass.value) return { students: home.value.students || [] }
  if (lens.value === 'children') return { children: home.value.children || [] }
  return home.value
})
</script>

<template>
  <div class="node-home">
    <div v-if="isLoading && !home" class="node-loading">
      <div class="loading-spinner"></div>
      <p>Loading…</p>
    </div>
    <div v-else-if="error && !home" class="node-loading"><p>{{ error }}</p></div>

    <template v-else-if="home">
      <div class="node-layout">
        <!-- MAP RAIL -->
        <aside class="rail-col schools-card">
          <NodeMapRail
            :ancestors="home.ancestors || []"
            :node="home.node"
            :siblings="home.siblings || []"
            :children="isClass ? [] : (home.children || [])"
            :kind="home.kind"
          />
        </aside>

        <div class="main-col">
          <!-- IDENTITY HEADER -->
          <header class="identity">
            <div class="identity-text">
              <span class="schools-kicker">{{ labelWord }}</span>
              <h1 class="identity-name arsenal">{{ home.node.name }}</h1>
              <div class="identity-badges">
                <span v-if="stateBadge" class="state-badge" :class="`tone-${stateBadge.tone}`">{{ stateBadge.word }}</span>
              </div>
              <p v-if="isClass && home.teachers?.length" class="identity-teachers">
                Taught by
                <template v-for="(t, i) in home.teachers" :key="t.user_id">
                  <strong>{{ t.name }}</strong><span v-if="t.is_lead" class="lead-tag"> (lead)</span><span v-if="i < home.teachers.length - 1">, </span>
                </template>
              </p>
            </div>

            <!-- VERBS — same corner, every level -->
            <div class="verbs">
              <button v-if="!isClass" type="button" class="verb-btn" @click="showInvite = !showInvite">Invite someone</button>
              <router-link v-if="analyticsLink" :to="analyticsLink" class="verb-btn verb-btn-secondary">
                {{ isClass ? 'Class tools' : 'See analytics' }}
              </router-link>
              <router-link v-if="!isClass" :to="structureLink" class="verb-btn verb-btn-secondary">Quick actions</router-link>
            </div>
          </header>

          <div v-if="showInvite" class="invite-form">
            <select v-model="inviteRole" class="frost-select">
              <option value="teacher">Teacher</option>
              <option value="leader">Leader</option>
              <option value="student">Student</option>
            </select>
            <button type="button" class="verb-btn" :disabled="isInviting" @click="submitInvite">
              {{ isInviting ? 'Creating…' : 'Create invite link' }}
            </button>
            <button v-if="inviteUrl" type="button" class="invite-url" :class="{ 'is-copied': copied }" @click="copyInvite">
              {{ copied ? 'Copied!' : inviteUrl }}
            </button>
          </div>

          <!-- STATS ROW -->
          <div class="stats-updated"><UpdatedStamp /></div>
          <div class="stats-row">
            <div v-for="s in stats" :key="s.word" class="stat-card schools-card">
              <span class="stat-value frost-mono-nums">{{ s.value }}</span>
              <span class="stat-word">{{ s.word }}</span>
            </div>
          </div>

          <!-- CHILDREN LIST + lenses -->
          <section class="children-section schools-card">
            <div class="children-head">
              <span class="schools-kicker">{{ isClass ? 'Students' : 'Below this' }}</span>
              <div v-if="!isClass" class="lens-chips">
                <button
                  v-for="l in LENSES" :key="l.value" type="button" class="chip"
                  :class="{ 'is-active': lens === l.value }" @click="setLens(l.value)"
                >{{ l.label }}</button>
              </div>
            </div>
            <div v-if="isLoading" class="children-loading">Loading…</div>
            <NodeChildrenList v-else :lens="lens" :payload="listPayload">
              <template #empty>
                {{ isClass ? 'No students in this class yet.' : 'Nothing below this yet — use "Quick actions" to add a school or group.' }}
              </template>
            </NodeChildrenList>
          </section>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.node-home { display: flex; flex-direction: column; gap: var(--space-5); }
.node-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 40vh; gap: 16px; color: var(--schools-fg-2, #555);
}
.loading-spinner {
  width: 32px; height: 32px; border: 3px solid rgba(15, 18, 18, 0.10);
  border-top-color: var(--schools-red, #DB1E17); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.node-layout { display: grid; grid-template-columns: minmax(220px, 290px) minmax(0, 1fr); gap: var(--space-5); align-items: start; }
@media (max-width: 900px) { .node-layout { grid-template-columns: 1fr; } }

.rail-col { padding: var(--space-4); position: sticky; top: calc(110px + env(safe-area-inset-top, 0px)); }
@media (max-width: 900px) { .rail-col { position: static; } }
.main-col { display: flex; flex-direction: column; gap: var(--space-5); min-width: 0; }

.identity { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.identity-text { min-width: 0; }
.identity-text .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.identity-name {
  font-family: var(--font-display); font-size: clamp(26px, 3.4vw, 38px); font-weight: 400;
  line-height: 1.05; letter-spacing: -0.015em; color: var(--ink-primary, #2C2622); margin: 6px 0 8px;
}
.identity-badges { display: flex; gap: 8px; flex-wrap: wrap; }
.state-badge { font-size: var(--text-xs); font-weight: var(--font-medium); padding: 2px 10px; border-radius: 999px; }
.tone-green { background: rgba(var(--tone-green), 0.12); color: rgb(var(--tone-green-ink)); }
.tone-amber { background: rgba(var(--tone-amber, 194 132 58), 0.12); color: rgb(var(--tone-amber-ink, 154 96 24)); }
.tone-grey { background: rgba(44, 38, 34, 0.07); color: var(--schools-fg-2, #555); }
.identity-teachers { margin: 8px 0 0; font-size: var(--text-sm); color: var(--schools-fg-2, #555); }
.lead-tag { color: var(--schools-fg-3, #8A8078); font-size: var(--text-xs); }

.verbs { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.verb-btn {
  display: inline-flex; align-items: center; padding: 10px 16px; font: inherit; font-size: var(--text-sm);
  font-weight: var(--font-semibold); border-radius: var(--radius-lg); border: 1px solid transparent;
  background: var(--schools-red, #DB1E17); color: #fff; cursor: pointer; text-decoration: none;
}
.verb-btn:hover { background: var(--schools-red-deep, #b21611); }
.verb-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.verb-btn-secondary { background: rgba(44, 38, 34, 0.06); color: var(--schools-fg, #0F1212); }
.verb-btn-secondary:hover { background: rgba(44, 38, 34, 0.12); }

.invite-form { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.frost-select {
  font: inherit; font-size: var(--text-sm); padding: 8px 12px; color: var(--schools-fg, #0F1212);
  background: rgba(255, 255, 255, 0.6); border: 1px solid rgba(44, 38, 34, 0.12); border-radius: var(--radius-lg);
}
.invite-url {
  font-family: var(--font-mono); font-size: var(--text-xs); padding: 8px 12px;
  background: rgba(255, 255, 255, 0.55); border: 1px solid rgba(44, 38, 34, 0.10); border-radius: var(--radius-md);
  color: var(--schools-fg-2, #555); cursor: pointer; word-break: break-all; text-align: left;
}
.invite-url.is-copied { background: rgba(var(--tone-green), 0.16); border-color: rgba(var(--tone-green), 0.45); color: rgb(var(--tone-green-ink)); }

.stats-updated { display: flex; justify-content: flex-end; min-height: 14px; margin-bottom: 4px; }
.stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--space-3); }
.stat-card { display: flex; flex-direction: column; gap: 2px; padding: var(--space-4); }
.stat-value { font-size: clamp(22px, 2.6vw, 30px); font-weight: var(--font-semibold); color: var(--ink-primary, #2C2622); line-height: 1.1; }
.stat-word { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3, #8A8078); }

.children-section { padding: 0; overflow: hidden; }
.children-head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap;
  padding: var(--space-4) var(--space-4) var(--space-3); border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}
.children-head .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.lens-chips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.chip {
  padding: 5px 12px; font-size: var(--text-xs); font-weight: var(--font-medium); border-radius: 999px;
  border: 1px solid rgba(44, 38, 34, 0.14); background: rgba(255, 255, 255, 0.5); color: var(--schools-fg-2, #555); cursor: pointer;
}
.chip.is-active { background: rgba(var(--tone-red, 219 30 23), 0.08); border-color: rgba(var(--tone-red, 219 30 23), 0.4); color: var(--schools-red, #DB1E17); }
.children-loading { padding: var(--space-6); text-align: center; color: var(--schools-fg-3, #8A8078); font-size: var(--text-sm); }
</style>
