<script setup lang="ts">
// NodeHomeView — THE VIEW's one recursive NODE HOME (docs/THE-VIEW.md).
// The same page at every level of the org tree: MAP RAIL · IDENTITY HEADER ·
// STATS ROW · CHILDREN LIST (lenses are filters, not pages) · VERBS.
// Mounted at /admin/groups/:id, /admin/schools/:id and /admin/classes/:id —
// one endpoint (/api/groups/:id/home) resolves whichever id it's given.
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import UpgradeView from '@/views/schools/UpgradeView.vue'
import NodeMapRail from '@/components/admin/NodeMapRail.vue'
import NodeMapRailSkeleton from '@/components/admin/NodeMapRailSkeleton.vue'
import NodeChildrenList from '@/components/admin/NodeChildrenList.vue'
import { cacheNodeHome, cachedNodeHome, cachedRail, dropCachedNode } from '@/composables/admin/nodeHomeCache'
import NodeActionBar from '@/components/admin/NodeActionBar.vue'
import WaysInLedger from '@/components/admin/WaysInLedger.vue'
import HowThisWorks from '@/components/admin/HowThisWorks.vue'
import YourAccount from '@/components/admin/YourAccount.vue'
import NoticingInvitations from '@/components/admin/NoticingInvitations.vue'
import { nodeKindOf } from '@/explainer/evaluateRules'
import { useNoticingInvitations } from '@/explainer/useNoticingInvitations'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import JourneyBar from '@/components/schools/shared/JourneyBar.vue'
import BeltStrip from '@/components/schools/shared/BeltStrip.vue'
import BeltDot from '@/components/schools/shared/BeltDot.vue'
import Bench from '@/components/schools/shared/Bench.vue'
import { deriveBelt, BELTS, type Belt } from '@/composables/schools/belts'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'
import { isMemberNodeSurface, nodeInsightsPath } from '@/composables/nodeSurfacePaths'
import { derivePreset } from '@/composables/nodeTerminology'
import { timeAgo } from '@/composables/admin/adminUtils'

const route = useRoute()
const router = useRouter()
const { getClient, getAuthToken } = useAdminClient()

// Member mount (/org/:id — a leader inside the /schools shell) vs the
// admin mount. Same page, same endpoint; the server scopes a leader to their
// subtree, and links/verbs stay within member scope (nodeSurfacePaths.ts).
const member = computed(() => isMemberNodeSurface(route.path))

// ─── Org platform trial/upgrade (founder-specced 2026-08-01, group-leader
// lane) — a govt_admin viewing their own org on the member surface. Entirely
// separate from the per-school platform gate SchoolsContainer already enforces
// (that one explicitly exempts govt_admin — a group leader's cross-school VIEW
// isn't gated by any one school's billing); this is the ORG's OWN billing,
// read from /api/org/subscription (leaderGroupId — server-derived from the
// caller's own govt_admins row, never a route param). FAILS OPEN: an
// unresolved/errored read leaves orgGate null, so nothing renders and nothing
// blocks. ───
const { isGovtAdmin, isSchoolAdmin } = useSchoolContext()
const isOrgLeaderView = computed(() => member.value && isGovtAdmin.value)
const orgGate = ref<{ active: boolean; trial_days_remaining: number } | null>(null)
const orgGateLoaded = ref(false)

async function fetchOrgGate(): Promise<void> {
  try {
    const token = await getAuthToken()
    const resp = await fetch('/api/org/subscription', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const data = await resp.json().catch(() => ({}))
    orgGate.value = data?.gate ?? null
  } catch {
    // Fail open — no banner, no wall, the node home just renders normally.
  } finally {
    orgGateLoaded.value = true
  }
}

watch(isOrgLeaderView, (v) => { if (v && !orgGateLoaded.value) void fetchOrgGate() }, { immediate: true })

// Expired wall: the org's OWN trial/subscription has lapsed. Still lets the
// leader pay in-app rather than dead-ending — same pattern as the per-school
// wall in SchoolsContainer.vue (embeds UpgradeView, never a mailto).
const showOrgExpiredWall = computed(
  () => isOrgLeaderView.value && orgGateLoaded.value && orgGate.value !== null && !orgGate.value.active,
)
// Always-visible trial banner (founder ruling: upgradeable at ANY point during
// the trial, not only at expiry).
const showOrgTrialBanner = computed(
  () => isOrgLeaderView.value && !showOrgExpiredWall.value && !!orgGate.value?.active && orgGate.value.trial_days_remaining > 0,
)

const isLoading = ref(true)
const error = ref<string | null>(null)
// WHERE-YOU-ARE stability (founder finding 2026-07-30): hopping back from a
// sibling view of the SAME node (Insights) seeds from nodeHomeCache, so the
// page — rail included — paints synchronously with the values the sibling
// fetched seconds ago, then the fresh fetch reconciles silently. Keyed by
// route id + lens, so a different node or lens never shows cached values.
const initialLens = typeof route.query.lens === 'string' ? route.query.lens : ''
const home = ref<any | null>(cachedNodeHome(String(route.params.id || ''), initialLens))

// ─── Layout stability across node switches (founder bug 2026-07-20: "3-4
// up and down page wobbles" per rail switch). The rules while a load runs:
// hold every section's GEOMETRY, never show the WRONG node's VALUES.
// · switching (node id changed): value slots blank to nbsp but keep their
//   boxes; the children list keeps its previous height via min-height.
// · same-node refresh / lens change: identity+stats keep their (still
//   correct) numbers — stale-while-refreshing; only the children body holds.
const loadedId = ref(home.value ? String(route.params.id || '') : '')
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

const ALL_LENSES = [
  { value: 'children', label: 'Directly below' },
  { value: 'groups', label: 'All groups' },
  { value: 'schools', label: 'All schools' },
  { value: 'teachers', label: 'All teachers' },
  { value: 'classes', label: 'All classes' },
]

const isClass = computed(() => home.value?.kind === 'class')

// ─── The dressing (founder ruling 2026-08-02: ed-speak is VOCABULARY, not
// structure). Derived from the payload: a subtree without school DNA renders
// in the neutral vocabulary — group / group leader / learner — and never
// shows a school/teacher/class word or lens. ───
const preset = computed(() => derivePreset(home.value))
const neutral = computed(() => preset.value === 'neutral')

// Neutral trees have nothing for the school/teacher/class lenses to filter.
const LENSES = computed(() => (neutral.value ? ALL_LENSES.slice(0, 2) : ALL_LENSES))
const lens = computed(() => {
  if (isClass.value) return 'students'
  const q = typeof route.query.lens === 'string' ? route.query.lens : ''
  return LENSES.value.some((l) => l.value === q) ? q : 'children'
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
    if (!resp.ok) {
      // Access lost or node gone — a cached rail must not outlive it.
      dropCachedNode(id)
      throw new Error(data.error || 'Failed to load')
    }
    home.value = data
    loadedId.value = id
    cacheNodeHome(id, data, activeLens)
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

// ─── School-admin first run, on the surface they ACTUALLY land on.
// Nav unification (2026-07-30) redirects a school-scoped school_admin from
// /schools to /org/:schoolId — so DashboardView's two first-run affordances
// (the guided-setup banner and the confirm-your-school's-name card) became
// unreachable for every real school admin. Chepstow's head (3 classes, 0
// pupils ever, name_confirmed=false, 2026-08-06) is the live case: no way to
// the wizard, and no way to fix a name someone else guessed for her — THE
// VIEW's Rename verb is `!member`, so she has no rename either.
//
// Both mirror DashboardView's predicates and reuse its data: currentSchool is
// already warm here because SchoolsContainer prefetches it on mount, and this
// node home lives inside that container. No new fetch, no new surface. ───
// useSchoolData() resolves the schools Supabase client eagerly and THROWS if
// it isn't set yet. On the member surface SchoolsContainer sets it in its own
// setup, before this child route component mounts — but the admin mounts set
// it conditionally, so an unset client must degrade to "no first-run cards"
// (which is the correct behaviour there anyway) rather than blow up the whole
// node page.
const schoolData = (() => {
  try { return useSchoolData() } catch { return null }
})()
const currentSchool = computed(() => schoolData?.currentSchool.value ?? null)

// Strictly the leader's OWN school node on the member surface — never a class
// node, never a group, never the ssi_admin read-view mount.
const isOwnSchoolNode = computed(
  () => member.value
    && isSchoolAdmin.value
    && !!currentSchool.value
    && String(route.params.id || '') === currentSchool.value.id,
)

// Not onboarded yet = ZERO PUPILS, not zero classes (a throwaway day-one
// class must not cost a head the wizard forever). One enrolled student
// retires it, so a school that IS running is never nagged. Gated on a loaded
// payload so it can't flash a false "get started" mid-fetch.
const showSetupBanner = computed(
  () => isOwnSchoolNode.value
    && !isLoading.value
    && !!home.value?.node
    && (home.value?.node?.rollup?.learnerCount ?? 0) === 0,
)

const showConfirmName = computed(
  () => isOwnSchoolNode.value && currentSchool.value?.name_confirmed === false,
)

const schoolNameDraft = ref('')
const isSavingSchoolName = ref(false)
const schoolNameError = ref<string | null>(null)
watch(currentSchool, (school) => {
  if (school && !schoolNameDraft.value) schoolNameDraft.value = school.school_name || ''
}, { immediate: true })

async function saveSchoolName(): Promise<void> {
  const name = schoolNameDraft.value.trim()
  const schoolId = currentSchool.value?.id
  if (!name || !schoolId || !schoolData) return
  isSavingSchoolName.value = true
  schoolNameError.value = null
  const ok = await schoolData.confirmSchoolName(schoolId, name)
  isSavingSchoolName.value = false
  if (ok) {
    // The node's identity header carries the same name — refetch both so the
    // page doesn't keep showing the old one after a successful save.
    await Promise.all([schoolData.fetchSchools(), fetchHome()])
  } else {
    schoolNameError.value = 'Could not save — try again.'
  }
}

watch(
  [() => route.params.id, () => route.query.lens],
  () => { void fetchHome() },
  { immediate: true },
)

// The rail's data source, in freshness order: this route id's loaded payload;
// the cache (instant continuity hopping back from Insights, node switches to
// already-visited nodes, and reload rehydration via sessionStorage); the
// previous payload (continuity ruling: keep the old tree until arrival).
// Null only on a genuinely cold first visit — the skeleton, never a text flash.
const rail = computed(() => {
  const id = String(route.params.id || '')
  const h = home.value
  const own = h?.node
    ? { ancestors: h.ancestors || [], node: h.node, siblings: h.siblings || [], children: h.children || [], kind: h.kind }
    : null
  if (own && loadedId.value === id) return own
  return cachedRail(id) || own
})

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
// A root within the caller's own scope — the level where a missing group
// leader is a real gap worth naming, rather than normal for a child node.
const isRootNode = computed(() => !(home.value?.ancestors?.length))
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
  // Neutral dressing: no class/teacher words — practice, groups, learners.
  if (neutral.value) {
    return [
      { value: `${home.value?.practiceHours ?? 0}h`, word: 'Practice hours' },
      { value: r.childGroupCount ?? 0, word: 'Groups' },
      { value: r.learnerCount ?? 0, word: 'Learners' },
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
// Neutral dressing gets its own 'org' explanation — no school-speak.
const explainerKind = computed(() => (neutral.value ? 'org' : nodeKindOf(home.value)))

// ONE evaluation of the noticing rules feeds both surfaces: the on-page
// invitation cards and the How-this-works panel + throb (founder ruling
// 2026-07-29: How-this-works is the single surfacing point).
const explainerNodeId = computed(() => String(home.value?.node?.id ?? ''))
// The dressing kind goes in too: a neutral org is structurally a group, but
// its invitations must speak the neutral vocabulary — 'org' rules only, never
// the class/teacher-worded ones (founder ruling 2026-08-02).
const { invitations, dismiss: dismissInvitation } = useNoticingInvitations({
  home,
  persona: explainerPersona,
  member,
  nodeId: explainerNodeId,
  kind: explainerKind,
})

// Viewer identity for the throb's per-user seen state — the auth uid once the
// session resolves; 'anon' until then (per-device, the accepted idiom here).
const viewerId = ref('anon')
void (async () => {
  try {
    const { data } = await getClient().auth.getSession()
    if (data?.session?.user?.id) viewerId.value = data.session.user.id
  } catch { /* keep 'anon' */ }
})()

// ─── Children payload for the list ───
const listPayload = computed(() => {
  if (!home.value) return {}
  if (isClass.value) return { students: enrichedStudents.value }
  if (lens.value === 'children') return { children: home.value.children || [] }
  return home.value
})
</script>

<template>
  <!-- ORG EXPIRED WALL — the org's own trial/subscription has lapsed. Pay
       in-app rather than dead-ending (same pattern as SchoolsContainer's
       per-school wall). Replaces the whole node home for this leader. -->
  <div v-if="showOrgExpiredWall" class="org-expired">
    <div class="org-expired-card schools-card">
      <span class="org-expired-pill">● Trial ended</span>
      <h1 class="arsenal org-expired-headline">Your organisation's free trial has ended</h1>
      <p class="org-expired-lede">
        Subscribe below to keep every member, group and team in your organisation. Your data is safe — nothing is deleted.
      </p>
      <UpgradeView />
    </div>
  </div>

  <div v-else class="node-home">
    <!-- ORG TRIAL BANNER — always-visible upgrade entry point DURING the
         trial (founder ruling: upgradeable at any point, not only at
         expiry). -->
    <div v-if="showOrgTrialBanner" class="org-trial-banner schools-card">
      <span class="org-trial-copy">
        {{ orgGate?.trial_days_remaining }} day{{ orgGate?.trial_days_remaining === 1 ? '' : 's' }} left in your organisation's free trial — every language included.
      </span>
      <router-link to="/org/upgrade" class="org-trial-cta">Upgrade →</router-link>
    </div>

    <div v-if="isLoading && !home && !rail" class="node-loading">
      <div class="loading-spinner"></div>
      <p>Loading…</p>
    </div>
    <div v-else-if="error && !home" class="node-loading"><p>{{ error }}</p></div>

    <template v-else-if="home || rail">
      <div class="node-layout">
        <!-- MAP RAIL — always the whole column; a cold load without cached
             ancestry gets the quiet skeleton, never a text flash and never
             the main pane sliding into this column. -->
        <aside class="rail-col schools-card">
          <NodeMapRail
            v-if="rail"
            :ancestors="(rail.ancestors as any) || []"
            :node="rail.node"
            :siblings="(rail.siblings as any) || []"
            :children="rail.kind === 'class' ? [] : ((rail.children as any) || [])"
            :kind="rail.kind"
          />
          <NodeMapRailSkeleton v-else />
        </aside>

        <div v-if="!home" class="main-col">
          <div class="node-loading">
            <div class="loading-spinner"></div>
            <p>Loading…</p>
          </div>
        </div>
        <div v-else class="main-col">
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
              <!-- WHO LEADS THIS GROUP. Until 2026-08-06 a node named its
                   leader nowhere: leadership lived only in govt_admins, which
                   no lens reads, so the creator of an org governed a group
                   that showed no manager at all. When there is genuinely no
                   leader on a root, SAY SO rather than rendering nothing —
                   an absent line and an absent leader looked identical. -->
              <p v-else-if="!isClass && home.leaders?.length" class="identity-teachers">
                <template v-if="switching">{{ NBSP }}</template>
                <template v-else>
                  Led by
                  <template v-for="(l, i) in home.leaders" :key="l.user_id">
                    <strong>{{ l.name }}</strong><span v-if="i < home.leaders.length - 1">, </span>
                  </template>
                </template>
              </p>
              <p v-else-if="!isClass && isRootNode" class="identity-teachers identity-noleader">
                <template v-if="switching">{{ NBSP }}</template>
                <template v-else>No group leader yet</template>
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
          <NodeActionBar v-if="!isClass && home.node" :node="home.node" :member="member" :preset="preset" :style="switching ? { visibility: 'hidden' } : undefined" @changed="fetchHome" @minted="ledgerEl?.load()" />

          <!-- SCHOOL-ADMIN FIRST RUN — the two affordances that used to live
               on /schools (DashboardView) and became unreachable when
               school-scoped admins were redirected here (2026-07-30).
               Own school node only; never a class, group, or the admin view. -->
          <div v-if="showConfirmName" class="schools-card first-run-card">
            <h3 class="arsenal first-run-title">Confirm your school's name</h3>
            <p class="first-run-note">This is what your teachers and students will see.</p>
            <div class="first-run-row">
              <input
                v-model="schoolNameDraft"
                type="text"
                class="frost-input"
                placeholder="e.g. Ysgol y Garnedd"
                :disabled="isSavingSchoolName"
                @keyup.enter="saveSchoolName"
              />
              <button
                class="btn-primary-sm"
                :disabled="isSavingSchoolName || !schoolNameDraft.trim()"
                @click="saveSchoolName"
              >{{ isSavingSchoolName ? 'Saving…' : 'Save' }}</button>
            </div>
            <p v-if="schoolNameError" class="first-run-error">{{ schoolNameError }}</p>
          </div>

          <router-link v-if="showSetupBanner" to="/schools/setup" class="schools-card setup-banner">
            <span class="setup-banner-copy">
              <span class="setup-banner-kicker">Get started</span>
              Set up your school in four quick steps — name it, invite your
              teachers, choose your courses and get your pupils into a class.
            </span>
            <span class="setup-banner-cta">Start setup →</span>
          </router-link>

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
            :invitations="invitations"
            @dismiss="dismissInvitation"
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
                  {{ isClass ? 'No students in this class yet.' : (neutral ? 'Nothing below this yet — add a group or invite people with the buttons above.' : (member ? 'Nothing below this yet.' : 'Nothing below this yet — use the buttons above to add a school or group.')) }}
                </template>
              </NodeChildrenList>
            </div>
          </section>

          <!-- HOW THIS WORKS — the self-explaining dashboard's reference
               entry: one quiet link, persona-scoped to exactly here. -->
          <HowThisWorks
            :persona="explainerPersona"
            :kind="explainerKind"
            :invitations="invitations"
            :node-id="explainerNodeId"
            :viewer-id="viewerId"
          />

          <!-- WAYS IN — the link ledger (founder scope-add 2026-07-20):
               every link minted anywhere in this subtree, with copy /
               revoke / re-mint. The management face of the link system. -->
          <WaysInLedger v-if="!isClass && home.node" ref="ledgerEl" :node-id="home.node.id" />

          <!-- YOUR ACCOUNT — the leader's own sign-in and their own device
               (founder ruling 2026-08-06). Ways in is how OTHER people get
               in; this is how YOU get back in. Member surface only: on the
               admin mount an ssi_admin is looking at someone else's node,
               and their own account is not what this page is about. -->
          <YourAccount v-if="member && !isClass && home.node" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.node-home { display: flex; flex-direction: column; gap: var(--space-5); }

/* Org trial banner — always-visible upgrade entry point during the trial. */
.org-trial-banner {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  flex-wrap: wrap; padding: var(--space-4); margin-bottom: var(--space-4);
  border: 1px solid rgba(219, 30, 23, 0.18);
}
.org-trial-copy { font-size: var(--text-sm); color: var(--schools-fg-1, #222); }
.org-trial-cta {
  display: inline-flex; align-items: center; padding: 8px 16px; font-size: var(--text-sm);
  font-weight: var(--font-semibold); border-radius: var(--radius-lg);
  background: var(--schools-red, #DB1E17); color: #fff; text-decoration: none; white-space: nowrap;
}
.org-trial-cta:hover { background: var(--schools-red-deep, #b21611); }

/* School-admin first run — same card grammar as the trial banner above. */
.first-run-card { padding: var(--space-4); margin-bottom: var(--space-4); }
.first-run-title { font-size: var(--text-base); margin: 0 0 4px; }
.first-run-note { font-size: var(--text-sm); color: var(--schools-fg-3, #8A8078); margin: 0 0 var(--space-3); }
.first-run-row { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.first-run-row .frost-input { flex: 1 1 220px; }
.first-run-error { font-size: var(--text-sm); color: var(--schools-red, #DB1E17); margin: var(--space-2) 0 0; }
.setup-banner {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  flex-wrap: wrap; padding: var(--space-4); margin-bottom: var(--space-4);
  text-decoration: none; color: inherit;
}
.setup-banner-copy { font-size: var(--text-sm); color: var(--schools-fg-1, #222); max-width: 60ch; }
.setup-banner-kicker {
  display: block; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--schools-fg-3, #8A8078); margin-bottom: 2px;
}
.setup-banner-cta {
  display: inline-flex; align-items: center; padding: 8px 16px; font-size: var(--text-sm);
  font-weight: var(--font-semibold); border-radius: var(--radius-lg);
  background: var(--schools-red, #DB1E17); color: #fff; white-space: nowrap;
}
.setup-banner:hover .setup-banner-cta { background: var(--schools-red-deep, #b21611); }

/* Org expired wall — replaces the whole node home; pay in-app, no dead-end. */
.org-expired {
  display: flex; align-items: center; justify-content: center; min-height: 60vh; padding: var(--space-5);
}
.org-expired-card { max-width: 480px; width: 100%; padding: var(--space-6); text-align: center; }
.org-expired-pill {
  display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; margin-bottom: var(--space-4);
  background: #fff5e5; border: 1px solid #f4d28a; color: #7a5418; border-radius: 30px;
  font-size: 11.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
}
.org-expired-headline { font-size: 28px; line-height: 1.15; margin: 0 0 var(--space-3); }
.org-expired-lede { font-size: var(--text-sm); line-height: 1.55; color: var(--schools-fg-2, #555); margin: 0 0 var(--space-4); }
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
.identity-noleader { font-style: italic; }
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
