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
import NodeActionBar from '@/components/admin/NodeActionBar.vue'
import WaysInLedger from '@/components/admin/WaysInLedger.vue'
import HowThisWorks from '@/components/admin/HowThisWorks.vue'
import NoticingInvitations from '@/components/admin/NoticingInvitations.vue'
import { nodeKindOf } from '@/explainer/evaluateRules'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import JourneyBar from '@/components/schools/shared/JourneyBar.vue'
import BeltStrip from '@/components/schools/shared/BeltStrip.vue'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import Bench from '@/components/schools/shared/Bench.vue'
import { deriveBelt, BELTS, type Belt } from '@/composables/schools/belts'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import { isMemberNodeSurface, nodeInsightsPath } from '@/composables/nodeSurfacePaths'
import { timeAgo } from '@/composables/admin/adminUtils'

const route = useRoute()
const router = useRouter()
const { getAuthToken } = useAdminClient()

// Member mount (/schools/org/:id — a leader inside the /schools shell) vs the
// admin mount. Same page, same endpoint; the server scopes a leader to their
// subtree, and links/verbs stay within member scope (nodeSurfacePaths.ts).
const member = computed(() => isMemberNodeSurface(route.path))

const isLoading = ref(true)
const error = ref<string | null>(null)
const home = ref<any | null>(null)

// ─── Layout stability across node switches (founder bug 2026-07-20: "3-4
// up and down page wobbles" per rail switch). The rules while a load runs:
// hold every section's GEOMETRY, never show the WRONG node's VALUES.
// · switching (node id changed): value slots blank to nbsp but keep their
//   boxes; the children list keeps its previous height via min-height.
// · same-node refresh / lens change: identity+stats keep their (still
//   correct) numbers — stale-while-refreshing; only the children body holds.
const loadedId = ref('')
const switching = computed(() => isLoading.value && !!home.value && String(route.params.id || '') !== loadedId.value)
const childrenBodyEl = ref<HTMLElement | null>(null)
const childrenHoldPx = ref<number | null>(null)
// The identity header holds its height too: on phone widths the node name
// wraps to two lines, so blanking it to a single nbsp mid-switch dropped a
// line and shoved everything below up then down (390px probe, 2026-07-20).
const identityEl = ref<HTMLElement | null>(null)
// The ways-in ledger refreshes when the action bar mints something new.
const ledgerEl = ref<InstanceType<typeof WaysInLedger> | null>(null)
const identityHoldPx = ref<number | null>(null)
const NBSP = '\u00A0'

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
  // Measure the children body BEFORE the loading state swaps in, so the
  // section can hold exactly this height until the new rows land.
  childrenHoldPx.value = childrenBodyEl.value?.offsetHeight || null
  identityHoldPx.value = identityEl.value?.offsetHeight || null
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
    loadedId.value = id
    markUpdated()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load'
  } finally {
    isLoading.value = false
  }
}

// The ONE refresh protocol: register this node's loader so the navbar button
// and pull-to-refresh drive it. No polling: the node holds still until asked.
// Navigation loads call the loader DIRECTLY, not via refresh() — the
// singleton's in-flight guard is for the button, and riding it let another
// surface's still-running refresh swallow this page's only load when the
// admin containers re-gate and remount as auth resolves (same wedge fixed in
// NodeRateEngine, seen live on deployed dev).
// Because loads bypass refresh(), fetchHome stamps the "Updated" marker itself
// (markUpdated on success) — otherwise the stamp stays blank until the first
// manual refresh, which is exactly the staleness-honesty gap it exists to close.
const { registerRefresh, markUpdated } = useDashboardRefresh()
registerRefresh(fetchHome, { immediate: false })

watch(
  [() => route.params.id, () => route.query.lens],
  () => { void fetchHome() },
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
  // Label-not-type (THE-MODEL §2.1): the node's OWN label is the display
  // word. Only when a node carries no label do we fall back to what its
  // attachments suggest. (Founder-reported wart 2026-07-20: the IME
  // programme kicker read "School" because the demo root's hidden join-leaf
  // school row made `commercial` truthy — the attachment must never outvote
  // the label.)
  if (n.label) return n.label[0].toUpperCase() + n.label.slice(1)
  if (n.commercial || n.hasSchool) return 'School'
  return 'Group'
})

// ─── Stats row (same cards at every level, subtree totals). CLASS PRACTICE
// leads (founder ruling: play-as-class is the only metric that matters in a
// school — individual accounts are the bonus). Student practice hours stay
// available per-student / per-school below and in THE LENS. ───
const classPractice = computed(() => home.value?.classPractice ?? null)
const stats = computed(() => {
  const n = home.value?.node
  if (!n) return []
  const r = n.rollup || {}
  const cp = classPractice.value
  if (isClass.value) {
    return [
      { value: cp?.weekSessions ?? 0, word: 'Class sessions this week' },
      { value: `${cp?.hours ?? 0}h`, word: 'Class practice' },
      { value: r.learnerCount ?? 0, word: 'Students' },
      { value: r.teacherCount ?? 0, word: 'Teachers' },
    ]
  }
  return [
    { value: cp ? `${cp.hours}h` : `${home.value?.practiceHours ?? 0}h`, word: 'Class practice' },
    { value: cp ? `${cp.activeClasses7d}/${cp.classCount || r.classCount || 0}` : (r.classCount ?? 0), word: cp ? 'Classes practising this week' : 'Classes' },
    { value: r.teacherCount ?? 0, word: 'Teachers' },
    { value: r.learnerCount ?? 0, word: 'Learners' },
  ]
})

// Node verbs (invite / add / rename / mint / delete / courses) live in
// NodeActionBar.vue, which calls the endpoints and emits `changed` → fetchHome.

// THE LENS: "See insights" on every node — the Insight Engine opens scoped to
// THIS node, parent's average as the default mirror (docs/THE-VIEW.md sibling).
const insightsLink = computed(() => {
  const n = home.value?.node
  if (!n) return null
  return nodeInsightsPath(n, isClass.value, member.value)
})

// The old "Class tools" page is DEAD (founder ruling 2026-07-19): in the
// admin read-view it carried no verbs (play-as-class, rename, delete and
// roster edits are all teacher-side) and no data this page doesn't already
// show. Its route now redirects here.

// ─── Class teaching data (the density the old roster had, in THE VIEW's
// grammar): per-student belt + health, class journey / belt distribution /
// practice benchmark cards. Health rule mirrors the old ClassDetail page. ───
type Health = 'excellent' | 'good' | 'needs-attention' | 'inactive'
function deriveStudentHealth(seeds: number, lastActiveAt: string | null, classAvg: number): Health {
  if (!lastActiveAt) return 'inactive'
  const diffDays = Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / 86400000)
  if (diffDays > 14) return 'needs-attention'
  if (classAvg > 0 && seeds < classAvg * 0.5) return 'needs-attention'
  if (classAvg > 0 && seeds >= classAvg * 1.25 && diffDays <= 2) return 'excellent'
  return 'good'
}

const classAvgSeeds = computed(() => {
  const list = home.value?.students ?? []
  if (!list.length) return 0
  return Math.round(list.reduce((s: number, x: any) => s + (x.seeds_completed || 0), 0) / list.length)
})

const classAvgLegos = computed(() => {
  const list = home.value?.students ?? []
  if (!list.length) return 0
  return Math.round(list.reduce((s: number, x: any) => s + (x.legos_mastered || 0), 0) / list.length)
})

// The class's OWN belt comes from its play-as-class position (the journey's
// seed number) when the class has practised together; students' average is
// the fallback for classes that have never pressed Play as class.
const classPlaySeeds = computed<number | null>(() => {
  const j = home.value?.journey
  return j?.source === 'class-play' && typeof j.seedNumber === 'number' ? j.seedNumber : null
})
const classBelt = computed<Belt>(() => deriveBelt(classPlaySeeds.value ?? classAvgSeeds.value))

const nextBeltInfo = computed(() => {
  const idx = BELTS.findIndex((b) => b.key === classBelt.value)
  const next = BELTS[idx + 1]
  if (!next) return null
  const seeds = classPlaySeeds.value ?? classAvgSeeds.value
  return { name: next.name, remaining: Math.max(0, next.min - seeds) }
})

const beltDistribution = computed<Record<string, number>>(() => {
  const dist: Record<string, number> = {}
  for (const s of home.value?.students ?? []) {
    const belt = deriveBelt(s.seeds_completed || 0)
    dist[belt] = (dist[belt] || 0) + 1
  }
  return dist
})

const beltDistributionOrdered = computed(() =>
  BELTS.filter((b) => beltDistribution.value[b.key]).map((b) => ({ belt: b.key, count: beltDistribution.value[b.key] })),
)

const journey = computed(() => home.value?.journey ?? null)
const benchmark = computed(() => home.value?.benchmark ?? null)

const enrichedStudents = computed(() => {
  const avg = classAvgSeeds.value
  const total = journey.value?.total || 0
  return (home.value?.students ?? []).map((s: any) => ({
    ...s,
    belt: deriveBelt(s.seeds_completed || 0),
    health: deriveStudentHealth(s.seeds_completed || 0, s.last_active_at, avg),
    journey_total: total,
  }))
})

// ─── The self-explaining dashboard (docs/self-explaining-dashboard.md):
// persona is what the mount already knows; place is the payload's own kind. ───
const explainerPersona = computed<'admin' | 'leader'>(() => (member.value ? 'leader' : 'admin'))
const explainerKind = computed(() => nodeKindOf(home.value))

// ─── Children payload for the list ───
const listPayload = computed(() => {
  if (!home.value) return {}
  if (isClass.value) return { students: enrichedStudents.value }
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
          <header ref="identityEl" class="identity" :style="switching && identityHoldPx ? { minHeight: `${identityHoldPx}px` } : undefined">
            <!-- While a different node loads, VALUES blank (never the old
                 node's identity) but every box keeps its size — the switch
                 settles once, when the new node's data lands. -->
            <div class="identity-text">
              <span class="schools-kicker">{{ switching ? NBSP : labelWord }}</span>
              <h1 class="identity-name arsenal">{{ switching ? NBSP : home.node.name }}</h1>
              <div class="identity-badges">
                <span v-if="stateBadge" class="state-badge" :class="switching ? 'tone-grey' : `tone-${stateBadge.tone}`">{{ switching ? NBSP : stateBadge.word }}</span>
              </div>
              <p v-if="isClass && home.teachers?.length" class="identity-teachers">
                <template v-if="switching">{{ NBSP }}</template>
                <template v-else>
                  Taught by
                  <template v-for="(t, i) in home.teachers" :key="t.user_id">
                    <strong>{{ t.name }}</strong><span v-if="t.is_lead" class="lead-tag"> (lead)</span><span v-if="i < home.teachers.length - 1">, </span>
                  </template>
                </template>
              </p>
            </div>

            <!-- Lens/insight nav — same corner, every level -->
            <div class="verbs">
              <router-link v-if="insightsLink" :to="insightsLink" class="verb-btn verb-btn-secondary">See insights</router-link>
            </div>
          </header>

          <!-- ACTION BAR — the verbs, across the top of the node page
               (founder-ruled 2026-07-19: rows are links, verbs live here). -->
          <!-- Verbs hold their space but go inert while another node loads —
               a mid-switch click must never act on the PREVIOUS node. -->
          <NodeActionBar v-if="!isClass && home.node" :node="home.node" :member="member" :style="switching ? { visibility: 'hidden' } : undefined" @changed="fetchHome" @minted="ledgerEl?.load()" />

          <!-- STATS ROW -->
          <div class="stats-updated"><UpdatedStamp /></div>
          <div class="stats-row">
            <div v-for="s in stats" :key="s.word" class="stat-card schools-card">
              <span class="stat-value frost-mono-nums">{{ switching ? NBSP : s.value }}</span>
              <span class="stat-word">{{ s.word }}</span>
            </div>
          </div>

          <!-- NOTICING INVITATIONS — the pack's rules over the payload just
               loaded. Gentle, dismissible, never modal (self-explaining
               dashboard §5). Hidden mid-switch: they'd be the old node's. -->
          <NoticingInvitations
            v-if="!switching && !isLoading && home.node"
            :home="home"
            :persona="explainerPersona"
            :member="member"
            :node-id="home.node.id"
          />

          <!-- CLASS TEACHING CARDS — the density the old class page had
               (Course Journey · Belt distribution · practice benchmark),
               in the same card grammar as the stats row. -->
          <div v-if="isClass" class="class-cards" :class="{ 'is-switching': switching }">
            <!-- CLASS PRACTICE leads — the class practising together IS the
                 primary metric (founder ruling). Students are the bonus layer
                 below. -->
            <div class="schools-card class-card">
              <span class="schools-kicker">Class practice</span>
              <template v-if="classPractice?.totalSessions">
                <p class="class-practice-headline frost-mono-nums">
                  {{ classPractice.weekSessions }}<span class="class-practice-unit"> {{ classPractice.weekSessions === 1 ? 'session' : 'sessions' }} this week</span>
                </p>
                <p class="class-card-note">
                  Last class session {{ classPractice.lastSessionAt ? timeAgo(classPractice.lastSessionAt) : '—' }}.<br />
                  {{ classPractice.hours }}h practised together over {{ classPractice.totalSessions }} {{ classPractice.totalSessions === 1 ? 'session' : 'sessions' }}.
                </p>
              </template>
              <p v-else class="class-card-note">No class practice yet — the teacher's Play as class button starts the first session.</p>
            </div>
            <div class="schools-card class-card">
              <span class="schools-kicker">Course journey</span>
              <!-- The bar runs in LEGOs on both sides. journey.done is the
                   CLASS's own play-as-class position as a LEGO ordinal
                   (source 'class-play'); only classes that have never played
                   together fall back to the students' average (the server's
                   'estimate' journey is a seed count — a different unit, so
                   it never drives this bar). -->
              <JourneyBar
                v-if="journey && journey.source === 'class-play'"
                :done="journey.done"
                :total="Math.max(journey.total, journey.done)"
                label="Course Journey"
              />
              <JourneyBar v-else-if="journey" :done="classAvgLegos" :total="Math.max(journey.total, classAvgLegos)" label="Course Journey" />
              <p class="class-card-note">
                <template v-if="journey && journey.source === 'class-play'">
                  The class has travelled {{ journey.done }} of {{ journey.total }} LEGOs together.
                  Students average {{ classAvgLegos }} LEGOs on their own.<br />
                </template>
                <template v-else>{{ classAvgLegos }} LEGOs mastered on average across the class.<br /></template>
                <template v-if="nextBeltInfo">{{ nextBeltInfo.remaining }} more to {{ nextBeltInfo.name }} belt.</template>
                <template v-else>Reached Black belt — top of the ladder.</template>
              </p>
            </div>
            <div class="schools-card class-card">
              <span class="schools-kicker">Belt distribution</span>
              <template v-if="enrichedStudents.length">
                <BeltStrip :distribution="beltDistribution" :height="8" />
                <div class="belt-legend">
                  <div v-for="row in beltDistributionOrdered" :key="row.belt" class="belt-legend-item">
                    <BeltDot :belt="row.belt" :size="18" ring />
                    <span class="belt-legend-count frost-mono-nums">{{ row.count }}</span>
                    <span class="belt-legend-label">{{ row.belt }}</span>
                  </div>
                </div>
              </template>
              <p v-else class="class-card-note">No students in this class yet.</p>
            </div>
            <div class="schools-card class-card">
              <span class="schools-kicker">Practice min/student/week</span>
              <Bench v-if="benchmark" :data="benchmark" unit="m" />
              <p v-else class="class-card-note">Not enough practice recorded yet.</p>
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
            <!-- The body holds its pre-load height while rows re-fetch (node
                 switch, lens change or refresh) — no collapse-to-spinner,
                 one settle when the new rows land. -->
            <div
              ref="childrenBodyEl"
              class="children-body"
              :style="isLoading && childrenHoldPx ? { minHeight: `${childrenHoldPx}px` } : undefined"
            >
              <div v-if="isLoading" class="children-loading">Loading…</div>
              <NodeChildrenList v-else :lens="lens" :payload="listPayload">
                <template #empty>
                  {{ isClass ? 'No students in this class yet.' : (member ? 'Nothing below this yet.' : 'Nothing below this yet — use "Quick actions" to add a school or group.') }}
                </template>
              </NodeChildrenList>
            </div>
          </section>

          <!-- HOW THIS WORKS — the self-explaining dashboard's reference
               entry: one quiet link, persona-scoped to exactly here. -->
          <HowThisWorks :persona="explainerPersona" :kind="explainerKind" />

          <!-- WAYS IN — the link ledger (founder scope-add 2026-07-20):
               every link minted anywhere in this subtree, with copy /
               revoke / re-mint. The management face of the link system. -->
          <WaysInLedger v-if="!isClass && home.node" ref="ledgerEl" :node-id="home.node.id" />
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

.stats-updated { display: flex; justify-content: flex-end; min-height: 14px; margin-bottom: 4px; }
.stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: var(--space-3); }
.stat-card { display: flex; flex-direction: column; gap: 2px; padding: var(--space-4); }
.stat-value { font-size: clamp(22px, 2.6vw, 30px); font-weight: var(--font-semibold); color: var(--ink-primary, #2C2622); line-height: 1.1; }
.stat-word { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3, #8A8078); }

.class-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--space-3); }
.class-card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); }
.class-card .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.class-card-note { margin: 0; font-size: var(--text-sm); color: var(--schools-fg-2, #555); line-height: 1.5; }
.class-practice-headline { margin: 0; font-size: 28px; font-weight: 700; color: var(--schools-fg-1, #222); line-height: 1.1; }
.class-practice-unit { font-size: var(--text-sm); font-weight: 500; color: var(--schools-fg-2, #555); }
.belt-legend { display: flex; gap: var(--space-4); flex-wrap: wrap; }
.belt-legend-item { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.belt-legend-count { font-weight: var(--font-semibold); font-size: var(--text-sm); color: var(--ink-primary, #2C2622); }
.belt-legend-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--schools-fg-3, #8A8078); }

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
.children-body { display: flex; flex-direction: column; }
.children-loading { padding: var(--space-6); text-align: center; color: var(--schools-fg-3, #8A8078); font-size: var(--text-sm); margin: auto 0; }

/* Mid-switch, the class cards blank their values (they'd be the previous
   node's) but keep their boxes — kickers stay, bodies go invisible. */
.class-cards.is-switching .class-card > :not(.schools-kicker) { visibility: hidden; }
</style>
