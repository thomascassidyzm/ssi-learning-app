<script setup lang="ts">
// ============================================================================
// FILE 3 — InsightWidget.vue
//   THE SINGLE DISPATCHER + THE FOUR-BEHAVIOURS WRAPPER (pure, presentation-only)
//
// PROPS (exactly two — C's host-fetches / wrapper-pure lever):
//   spec:     AnyInsightSpec      // the Claude/board-emitted directive
//   resolved: ResolvedInsight     // { data, isLoading, error } — the HOST already called resolveMetric()
//
// The wrapper NEVER touches Supabase. It is trivially testable/storybookable with a literal
// `resolved`. A board's useInsightSpec(spec) composable does query -> resolveMetric ->
// { data, isLoading, error } and hands the bundle in.
//
// DISPATCH (zero shared edit to add a widget): import.meta.glob bundles widgets/*.vue into the
// admin chunk; spec.widget is mapped to a PascalCase file name. Dropping widgets/Treemap.vue on
// disk makes 'treemap' dispatchable with NO edit to this file, registry.ts, or spec.ts.
//
// THE FOUR BEHAVIOURS are defined ONCE here, inherited by every widget. Behaviours read ONLY
// spec fields (annotate/actions/sovereignty/frame) and the typed `data` envelope — never widget
// internals — so the wrapper owns them universally and widgets stay render-only.
// ============================================================================
import { computed, defineAsyncComponent, type Component } from 'vue'
import type { AnyInsightSpec, ResolvedInsight, Action, Annotation, SovereignComparisonData } from './spec'
import { frameTag, tone } from './theme'

const props = defineProps<{
  spec: AnyInsightSpec
  resolved: ResolvedInsight
}>()

const emit = defineEmits<{
  (e: 'interrogate', payload: { spec: AnyInsightSpec; query: AnyInsightSpec['query'] }): void
  (e: 'act', payload: { action: Action; spec: AnyInsightSpec }): void
  (e: 'drill', payload: { query: NonNullable<Action['drill']> }): void
}>()

// ---- DISPATCH BY NAMING CONVENTION ----------------------------------------
// Vite statically bundles every widget into the admin chunk at build time.
const widgetModules = import.meta.glob('./widgets/*.vue')
const pascal = (k: string) => k.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join('') // 'time-series' -> 'TimeSeries'

const ResolvedWidget = computed<Component | null>(() => {
  const key = `./widgets/${pascal(props.spec.widget)}.vue`
  const loader = widgetModules[key] as (() => Promise<unknown>) | undefined
  if (!loader) return null   // missing/misnamed file — render the empty/error state, never crash
  return defineAsyncComponent(loader as () => Promise<Component>)
})

// ---- chrome routing --------------------------------------------------------
const tagClass = computed(() => frameTag(props.spec.frame))                 // 'a' (Lens A / blue) | 'b' (Lens B / red)
const tagLabel = computed(() => props.spec.tag ?? props.spec.widget)

// ---- BEHAVIOUR 1: ANNOTATABLE ---------------------------------------------
// Pass spec.annotate straight to the widget; ALSO render each note as a tone-coloured caption,
// so the read travels even when a widget can't callout the mark.
const annotations = computed<Annotation[]>(() => props.spec.annotate ?? [])

// ---- BEHAVIOUR 3: SOVEREIGN (wrapper gate; the resolver is the first gate) -------------------
const sovereignty = computed(() => props.spec.sovereignty ?? { visibility: 'comparison' as const, kFloor: 5 })
const isSovereignFrame = computed(() =>
  props.spec.frame === 'self' || props.spec.frame === 'group' || props.spec.widget === 'sovereign-comparison',
)
// When the comparison band is below the k-floor, suppress it entirely (a band of one cannot leak).
const sovereignSuppressed = computed(() => {
  if (!isSovereignFrame.value) return false
  const d = props.resolved.data
  if (d.kind !== 'sovereign-comparison') return false
  return (d as SovereignComparisonData).bandCount < sovereignty.value.kFloor
})
// Names render ONLY when admin identified-visibility AND the resolver flagged the data named.
const sovereignNamed = computed(() => {
  const d = props.resolved.data
  if (d.kind !== 'sovereign-comparison') return false
  return sovereignty.value.visibility === 'identified' && (d as SovereignComparisonData).named === true
})
const sovereignCaption = computed(() => {
  if (!isSovereignFrame.value) return ''
  return sovereignNamed.value
    ? `identified · admin visibility · k≥${sovereignty.value.kFloor}`
    : `vs aggregate · anonymised · k≥${sovereignty.value.kFloor}`
})
// Only the sovereign-comparison widget receives :named — every other widget's API stays
// exactly { data, annotations } (no stray DOM attribute falls through on the 12 others).
const sovereignProps = computed<{ named?: boolean }>(() =>
  props.spec.widget === 'sovereign-comparison' ? { named: sovereignNamed.value } : {},
)

// ---- state gates (wrapper renders loading/error/empty so widgets only ever see good data) ----
const isEmpty = computed(() => {
  const d = props.resolved.data
  if (!d) return true
  switch (d.kind) {
    case 'time-series': return d.series.length === 0
    case 'ranked-bar': return d.bars.length === 0
    case 'distribution': return d.bins.length === 0
    case 'scatter': return d.points.length === 0
    case 'funnel': return d.stages.length === 0
    case 'flow': return d.nodes.length === 0
    case 'cohort-grid': return d.cells.length === 0
    case 'map': return d.regions.length === 0
    case 'table': return d.rows.length === 0
    case 'treemap': return d.nodes.length === 0
    case 'sovereign-comparison': return d.top.length === 0 && !d.self
    case 'stat':
    case 'narrative-card':
    default: return false   // stat/narrative are renderable from zero
  }
})
const showWidget = computed(() =>
  !props.resolved.isLoading && !props.resolved.error && !isEmpty.value && !sovereignSuppressed.value && !!ResolvedWidget.value,
)

// ---- BEHAVIOUR 2: INTERROGABLE --------------------------------------------
function onInterrogate() {
  emit('interrogate', { spec: props.spec, query: props.spec.query })
}

// ---- BEHAVIOUR 4: ACTION-TERMINATED & DRILLABLE ---------------------------
const actions = computed<Action[]>(() => props.spec.actions ?? [])
const tierClass: Record<Action['tier'], string> = { try: 'try', investigate: 'invest', together: 'together' }
function onAct(action: Action) {
  emit('act', { action, spec: props.spec })
  if (action.drill) emit('drill', { query: action.drill })
}

// caption colour for an annotation note
function noteColor(t: Annotation['tone']) { return tone(t) }
</script>

<template>
  <article class="fig">
    <!-- ---- head: title + why? + frame tag ---- -->
    <header class="fig-head">
      <span class="fig-q">{{ spec.title }}</span>
      <!-- BEHAVIOUR 2: a single quiet why? — the wrapper owns it, no widget renders its own -->
      <button class="why-btn" type="button" @click="onInterrogate">why? ↗</button>
      <span class="fig-tag" :class="tagClass">{{ tagLabel }}</span>
    </header>

    <!-- ---- chart body: loading / error / empty / sovereign-suppressed / the widget ---- -->
    <div class="fig-body">
      <div v-if="resolved.isLoading" class="fig-state">
        <span class="spinner" /> Loading…
      </div>
      <div v-else-if="resolved.error" class="fig-state is-error">
        {{ resolved.error }}
      </div>
      <div v-else-if="sovereignSuppressed" class="fig-state is-private">
        Too few to compare privately — a band of fewer than {{ sovereignty.kFloor }} stays unshown.
      </div>
      <div v-else-if="isEmpty" class="fig-state">
        No data in this window yet.
      </div>
      <component
        v-else-if="showWidget"
        :is="ResolvedWidget"
        :data="resolved.data"
        :annotations="annotations"
        v-bind="sovereignProps"
      />
      <div v-else class="fig-state is-error">
        Widget “{{ spec.widget }}” not found.
      </div>
    </div>

    <!-- BEHAVIOUR 1: tone-coloured annotation captions (the read travels regardless of widget callout) -->
    <p
      v-for="(a, i) in annotations"
      :key="i"
      v-show="showWidget"
      class="read read-note"
      :style="{ color: noteColor(a.tone) }"
    >{{ a.note }}</p>

    <!-- the one-line story read -->
    <p v-if="spec.story && showWidget" class="read">{{ spec.story }}</p>

    <!-- BEHAVIOUR 3: sovereign caption -->
    <p v-if="sovereignCaption && showWidget" class="read read-sov">{{ sovereignCaption }}</p>

    <!-- BEHAVIOUR 4: graded actions footer (try / investigate / together + owner) -->
    <footer v-if="actions.length" class="fig-actions">
      <button
        v-for="(a, i) in actions"
        :key="i"
        class="act"
        type="button"
        @click="onAct(a)"
      >
        <span class="tier" :class="tierClass[a.tier]">{{ a.tier }}</span>
        <span class="act-text">{{ a.text }}</span>
        <span class="own">· {{ a.owner }}</span>
      </button>
    </footer>
  </article>
</template>

<style scoped>
/* Frostwell chrome — ports the gallery .fig markup. Tokens only, NO hardcoded hex. */
.fig {
  background: var(--card-bg, #fff);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: 18px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.05), 0 16px 44px rgba(44, 38, 34, 0.08);
  display: flex;
  flex-direction: column;
}

.fig-head {
  padding: 18px 22px 12px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.07);
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.fig-q {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 18px;
  color: var(--ink-primary);
}

/* BEHAVIOUR 2: the quiet why? affordance — gallery styling (mono 11px, --ink-3) */
.why-btn {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-muted);
  border: 1px solid rgba(44, 38, 34, 0.12);
  background: transparent;
  border-radius: 999px;
  padding: 2px 9px;
  cursor: pointer;
}
.why-btn:hover {
  color: var(--ink-primary);
  border-color: rgba(44, 38, 34, 0.22);
}

.fig-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #fff;
  background: var(--ink-primary);
  padding: 3px 8px;
  border-radius: 5px;
  margin-left: auto;
}
/* Lens routing: self/group -> blue (A) ; world/content -> red (B) */
.fig-tag.a { background: rgba(var(--tone-blue), 1); }
.fig-tag.b { background: rgba(var(--tone-red), 1); }

.fig-body {
  padding: 18px 22px;
  min-height: 80px;
}

.fig-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 140px;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-muted);
  text-align: center;
}
.fig-state.is-error { color: rgba(var(--tone-red), 1); }
.fig-state.is-private { color: var(--ink-secondary); }
.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(44, 38, 34, 0.18);
  border-top-color: var(--ink-secondary);
  border-radius: 50%;
  animation: insight-spin 0.7s linear infinite;
}
@keyframes insight-spin { to { transform: rotate(360deg); } }

/* BEHAVIOUR 1: annotation read captions */
.read {
  padding: 0 22px 14px;
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--ink-secondary);
}
.read-note {
  padding-top: 2px;
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.read-sov {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--ink-muted);
}

/* BEHAVIOUR 4: graded actions footer (gallery .act / .tier / .own) */
.fig-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  padding: 4px 22px 20px;
}
.act {
  display: flex;
  align-items: center;
  gap: 9px;
  border: 1px solid rgba(44, 38, 34, 0.12);
  background: var(--card-bg, #fff);
  border-radius: 10px;
  padding: 9px 13px;
  font-size: 14px;
  color: var(--ink-primary);
  cursor: pointer;
  text-align: left;
}
.act:hover { border-color: rgba(44, 38, 34, 0.24); }
.act .tier {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 7px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.act .tier.try { background: rgba(var(--tone-green), 0.16); color: rgba(var(--tone-green), 1); }
.act .tier.invest { background: rgba(var(--tone-gold), 0.20); color: rgba(var(--tone-gold), 1); }
.act .tier.together { background: rgba(var(--tone-blue), 0.18); color: rgba(var(--tone-blue), 1); }
.act .own {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-muted);
}
</style>
