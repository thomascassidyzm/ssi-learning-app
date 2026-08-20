<script setup lang="ts">
// NodeInsightsView — THE LENS's admin door: the Insight Engine scoped to the
// node it was opened from ("See insights" on node home). Mounted at the old
// analytics URLs (/admin/schools/:id/analytics, /admin/groups/:id/analytics —
// the URLs live, the old-school page died) and at /admin/classes/:id/insights.
//
// Founder ruling (pass A, 2026-07-19): insights is a LENS on the node, not a
// separate place — so the page keeps the node-home chrome: the WHERE-YOU-ARE
// map rail (you-are-here lit) and the same identity header. No "← Back" link
// pattern; the rail is the way around, and the verbs corner offers Overview
// (node home) the same way node home offers See insights.
//
// The engine (NodeRateEngine) owns the pickers, the fetch, the refresh
// registration and the widget. Deep-linkable: ?course= / ?compare= / ?window=
// / ?measure= mirror the engine state.
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import NodeRateEngine, { type EngineState } from '@/insight/NodeRateEngine.vue'
import NodeMapRail from '@/components/admin/NodeMapRail.vue'
import NodeMapRailSkeleton from '@/components/admin/NodeMapRailSkeleton.vue'
import WalkOffer from '@/components/admin/WalkOffer.vue'
import { cacheNodeHome, cachedNodeHome, cachedRail, dropCachedNode } from '@/composables/admin/nodeHomeCache'
import { isMemberNodeSurface } from '@/composables/nodeSurfacePaths'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'
import VadPanel from '@/insight/VadPanel.vue'
import { fetchVadScope, type VadScopePayload } from '@/insight/data/vadScope'
import { summariseVad, type VadSummary } from '@/insight/data/vadUptake'

const route = useRoute()
const router = useRouter()
const { getAuthToken } = useAdminClient()

const nodeId = computed(() => String(route.params.id || ''))

// ?course= / ?compare= / ?window= / ?measure= are the deep link; the engine
// resolves defaults and reflects them back here so a copied URL reproduces
// the exact view. Local refs + ONE coalesced replace — separate query-setters
// raced each other (the second replace read the pre-first-replace query and
// clobbered it).
const course = ref<string | null>(typeof route.query.course === 'string' ? route.query.course : null)
const compare = ref<string | null>(typeof route.query.compare === 'string' ? route.query.compare : null)
const window_ = ref<string | null>(typeof route.query.window === 'string' ? route.query.window : null)
const measure = ref<string | null>(typeof route.query.measure === 'string' ? route.query.measure : null)
watch([course, compare, window_, measure], ([c, cmp, w, m]) => {
  void router.replace({
    query: { ...route.query, course: c || undefined, compare: cmp || undefined, window: w || undefined, measure: m || undefined },
  })
})
watch(
  () => [route.query.course, route.query.compare, route.query.window, route.query.measure],
  ([qc, qcmp, qw, qm]) => {
    course.value = typeof qc === 'string' ? qc : null
    compare.value = typeof qcmp === 'string' ? qcmp : null
    window_.value = typeof qw === 'string' ? qw : null
    measure.value = typeof qm === 'string' ? qm : null
  },
)

const state = ref<EngineState | null>(null)

// ─── The node-home chrome: same rail + identity data, same endpoint the
// node home reads. One light fetch per node; the org map doesn't churn, so
// no refresh registration (the engine owns the refresh protocol here).
// WHERE-YOU-ARE stability (founder finding 2026-07-30): seed from
// nodeHomeCache so the hop from node home paints the rail synchronously —
// no vanish, no re-appear; the fetch reconciles silently in the background. ───
// The cache keys on the ROUTE id (a school route's :id is the school id,
// not the payload's node.id), so homeFor tracks which route id `home` holds.
const home = ref<any | null>(cachedNodeHome(nodeId.value))
const homeFor = ref(home.value ? nodeId.value : '')
watch(nodeId, async (id) => {
  home.value = cachedNodeHome(id)
  homeFor.value = home.value ? id : ''
  if (!id) return
  try {
    const token = await getAuthToken()
    const resp = await fetch(`/api/groups/${id}/home`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (resp.ok) {
      home.value = await resp.json()
      homeFor.value = id
      cacheNodeHome(id, home.value)
    } else {
      // Access lost or node gone — a cached rail must not outlive it.
      dropCachedNode(id)
      home.value = null
      homeFor.value = ''
    }
  } catch {
    // Network hiccup: keep whatever we have; the engine still renders.
  }
}, { immediate: true })

// The rail renders from the freshest thing we hold: the full payload, else
// the session's rail snapshot (reload rehydration), else the cold skeleton.
const rail = computed(() => {
  const h = home.value
  if (h?.node && homeFor.value === nodeId.value) {
    return { ancestors: h.ancestors || [], node: h.node, siblings: h.siblings || [], children: h.children || [], kind: h.kind }
  }
  return cachedRail(nodeId.value)
})

const isClass = computed(() =>
  home.value?.kind === 'class' || state.value?.node.kind === 'class')

// Same identity words as NodeHomeView — one grammar, every lens.
const labelWord = computed(() => {
  const n = home.value?.node
  if (!n) return state.value?.node.label ? state.value.node.label[0].toUpperCase() + state.value.node.label.slice(1) : ''
  if (isClass.value) return 'Class'
  if (n.commercial || n.hasSchool) return 'School'
  return n.label ? n.label[0].toUpperCase() + n.label.slice(1) : 'Group'
})
const title = computed(() => home.value?.node?.name || rail.value?.node?.name || state.value?.node.name || '…')
const subtitle = computed(() =>
  isClass.value
    ? 'How this class is moving, compared with the average you choose.'
    : 'How everyone below this is moving, compared with the average you choose.')

// ─── VOICE & PAUSE, scoped to this node ────────────────────────────────────
// Founder ruling 2026-08-20, verbatim: "the VAD data should follow the same
// hierarchy of visibility that all data follows — students < teachers < school
// leaders < group leaders — as long as the hierarchy is legitimate, the data
// should be viewable." Until now every VAD surface was admin-gated, so a group
// leader looking at their own programme had no route to any of it.
//
// It lands HERE rather than on a new page because insights is already the lens
// on this node, and this is an insight about this node. The authz is entirely
// server-side (GET /api/org/vad → api/_utils/vadVisibility.ts); this component
// asks for the node it is already showing and renders whatever comes back. A
// caller outside the scope gets a 403 the panel states plainly — it does not
// hide the section, because a silent disappearance reads as "no data".
//
// The node's :id may be a group, a school or a class; the endpoint resolves all
// three with the same precedence as the node-home endpoint, so nothing is
// guessed client-side.
const vad = ref<VadScopePayload | null>(null)
const vadLoading = ref(true)
const vadError = ref<string | null>(null)

watch(nodeId, async (id) => {
  vad.value = null
  vadError.value = null
  if (!id) { vadLoading.value = false; return }
  vadLoading.value = true
  try {
    vad.value = await fetchVadScope({ groupId: id }, await getAuthToken())
  } catch (e: unknown) {
    vadError.value = e instanceof Error ? e.message : 'Could not read the voice & pause data.'
  } finally {
    vadLoading.value = false
  }
}, { immediate: true })

const vadSummary = computed<VadSummary | null>(() => {
  const v = vad.value
  if (!v) return null
  return summariseVad(v.scope.learnerIds, v.names, v.metricsByLearner, v.prosodyByLearner, v.prosodyAvailable)
})
const vadScopeLabel = computed(() => vad.value?.scope.label || title.value)
// Class rows only make sense above a class; a class scope IS one class.
const vadClasses = computed(() => (vad.value?.scope.kind === 'class' ? [] : vad.value?.scope.classes ?? []))

// The per-learner page is admin-only (the member surface has no equivalent —
// its teacher-relevant content lives flat on the class node home, founder
// ruling 2026-07-19). So a leader's rows are not clickable rather than
// clickable into a 403.
function openVadLearner(learnerId: string) {
  if (!member.value) void router.push(`/admin/users/${learnerId}`)
}

// Overview = this node's home — the same URL family the lens was opened from.
// Member mount (/org/:id/insights — a leader inside the /schools
// shell) goes back to the member node home; admin mounts keep their family.
const member = computed(() => isMemberNodeSurface(route.path))
const homeLink = computed(() => {
  const p = route.path
  if (member.value) return `/org/${nodeId.value}`
  if (p.includes('/admin/classes/')) return `/admin/classes/${nodeId.value}`
  if (p.includes('/admin/schools/')) return `/admin/schools/${nodeId.value}`
  return `/admin/groups/${nodeId.value}`
})
</script>

<template>
  <div class="niv">
    <div class="node-layout">
      <!-- MAP RAIL — the same where-you-are spine as node home. The column
           ALWAYS renders (the main pane must never jump into it); a genuine
           cold load gets the quiet skeleton, never flashing text. -->
      <aside class="rail-col schools-card">
        <NodeMapRail
          v-if="rail"
          :ancestors="(rail.ancestors as any) || []"
          :node="rail.node"
          :siblings="(rail.siblings as any) || []"
          :children="rail.kind === 'class' || isClass ? [] : ((rail.children as any) || [])"
          :kind="rail.kind"
        />
        <NodeMapRailSkeleton v-else />
      </aside>

      <div class="main-col">
        <!-- IDENTITY HEADER — same grammar as node home; insights is a lens -->
        <header class="identity">
          <div class="identity-text">
            <span class="schools-kicker">{{ labelWord }} · Insights</span>
            <h1 class="identity-name arsenal">{{ title }}</h1>
            <p class="niv-sub">{{ subtitle }}</p>
          </div>
          <div class="niv-side">
            <UpdatedStamp />
            <WalkOffer :persona="member ? 'leader' : 'admin'" place="node-insights" />
            <div class="verbs">
              <router-link :to="homeLink" class="verb-btn verb-btn-secondary" data-walk="insights-overview">Overview</router-link>
              <router-link v-if="!member" to="/admin/stats" class="verb-btn verb-btn-secondary">All boards</router-link>
            </div>
          </div>
        </header>

        <NodeRateEngine
          v-model:course="course"
          v-model:compare="compare"
          v-model:window="window_"
          v-model:measure="measure"
          :node-id="nodeId"
          :get-token="getAuthToken"
          @state="state = $event"
        />

        <!-- VOICE & PAUSE — the same renderer the admin board uses, scoped to
             this node by the server. Uptake first, denominators everywhere:
             a learner with no mic data is absent here, never a zero. -->
        <section class="vad-section">
          <header class="vad-section-head">
            <span class="schools-kicker">Attention · voice</span>
            <h2 class="vad-section-title arsenal">Voice &amp; pause</h2>
            <p class="vad-section-sub">
              What the microphone is actually giving us below this point — how many
              learners have mic-derived data at all, and for those who do, how the
              adaptive pause is settling and how they sound.
            </p>
          </header>
          <VadPanel
            :summary="vadSummary"
            :scope-label="vadScopeLabel"
            :is-loading="vadLoading"
            :error="vadError"
            :classes="vadClasses"
            :names="vad?.names"
            :metrics-by-learner="vad?.metricsByLearner"
            :prosody-by-learner="vad?.prosodyByLearner"
            :truncated="vad?.truncated"
            @open-learner="openVadLearner"
          />
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.niv { display: flex; flex-direction: column; gap: 20px; }

/* Same layout skeleton as NodeHomeView — the lens keeps the node's shape. */
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
.niv-sub {
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  max-width: 56ch;
  margin: 0;
}
.niv-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
/* ---- Voice & pause section ---------------------------------------------- */
.vad-section { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
.vad-section-head { display: flex; flex-direction: column; gap: 4px; }
.vad-section-title {
  font-family: var(--font-display); font-size: clamp(20px, 2.2vw, 26px); font-weight: 400;
  line-height: 1.1; letter-spacing: -0.01em; color: var(--ink-primary, #2C2622); margin: 4px 0 0;
}
.vad-section-sub {
  font-size: 14px; line-height: 1.55; color: var(--ink-secondary, #5b534c);
  max-width: 60ch; margin: 0;
}

.verbs { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.verb-btn {
  display: inline-flex; align-items: center; padding: 10px 16px; font: inherit; font-size: var(--text-sm);
  font-weight: var(--font-semibold); border-radius: var(--radius-lg); border: 1px solid transparent;
  cursor: pointer; text-decoration: none;
}
.verb-btn-secondary { background: rgba(44, 38, 34, 0.06); color: var(--schools-fg, #0F1212); }
.verb-btn-secondary:hover { background: rgba(44, 38, 34, 0.12); }
@media (max-width: 720px) {
  .niv-side { align-items: flex-start; }
}
</style>
