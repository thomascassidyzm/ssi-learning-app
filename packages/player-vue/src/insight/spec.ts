// ============================================================================
// THE INSIGHT ENGINE — SPINE CONTRACT (spec.ts)
// Spine = A's typed generic binding · B's vision fidelity · C's frozen-spec ergonomics.
//
// This is the single sequential artifact. It is FROZEN before the 18-way fan-out.
// After it lands, every unit of work is a NEW file; nothing here is edited again
// (window/entity/order are strings/open so adding one is a resolver edit, never a spec edit).
//
// Imported READ-ONLY by every widget (types), every resolver (DataQuery / variant types)
// and every board (InsightSpec). spec.ts has NO runtime dependencies — it typechecks alone.
// ============================================================================

// ---- shared vocabulary (Measuring Progress; one theory of measurement) ----
export type Frame = 'self' | 'group' | 'world' | 'content'   // self/group => Lens A · world/content => Lens B
export type Order = 'level' | 'velocity' | 'acceleration'    // read curvature, not level
export type Tone = 'neutral' | 'good' | 'warn' | 'alarm'     // -> Frostwell tonal triplet in theme.ts; never a hex on the spec

export type WidgetKind =
  | 'stat' | 'time-series' | 'ranked-bar' | 'sovereign-comparison'
  | 'distribution' | 'scatter' | 'funnel' | 'flow' | 'cohort-grid'
  | 'map' | 'table' | 'narrative-card' | 'treemap'

// WidgetName === WidgetKind. Some callers (boards, the dispatcher's naming convention)
// speak in "names"; the registry + specs speak in "kinds". They are the same string set,
// aliased so the two vocabularies can co-exist without drift.
export type WidgetName = WidgetKind

// entity/window are STRINGS, not enums (C): the registry owns their meaning, so adding
// '90d' or a new entity is a one-line resolver change and spec.ts stays frozen for the fan-out.
export type Entity = string   // 'learner' | 'course' | 'lego' | 'seed' | 'cohort' | 'region' | 'class' | 'build' | a concrete id
export type Window = string   // '1d' | '7d' | '30d' | '90d' | 'all' (parsed in the resolver)

// ---- Annotation: Claude marks the point/row/stage that IS the story (A's discriminated union) ----
// Discriminated by `at` so the WRONG target shape for a widget is a COMPILE error — a funnel
// cannot be handed a `cell`. Each widget reads only the `at` shapes it can draw; a shape it
// doesn't understand simply isn't drawn (degrade, never throw).
export type Annotation =
  | { at: 'point'; series?: string; x: string | number; note: string; tone: Tone }    // time-series / scatter datum
  | { at: 'datum'; key: string; note: string; tone: Tone }                             // bar / treemap / map / distribution bin id
  | { at: 'stage'; stage: string; note: string; tone: Tone }                           // funnel stage
  | { at: 'node'; node: string; note: string; tone: Tone }                             // flow/Sankey node
  | { at: 'cell'; x: string; y: string; note: string; tone: Tone }                     // cohort-grid cell
  | { at: 'row'; rowId: string; note: string; tone: Tone }                             // table row
  | { at: 'region'; region: string; note: string; tone: Tone }                         // map region
  | { at: 'band'; min: number; max: number; axis?: 'x' | 'y'; note: string; tone: Tone } // threshold band

// ---- Action: graded (confidence x stakes), always owned, terminating & drillable ----
export type ActionTier = 'try' | 'investigate' | 'together'
export type ActionOwner = 'popty' | 'growth' | 'product' | 'marketing' | 'you' | 'you+claude'
export interface Action {
  tier: ActionTier
  text: string
  owner: ActionOwner
  drill?: DataQuery   // click re-scopes: SAME lens, narrower entity (the host re-fetches & swaps the spec)
}

// ---- Sovereignty: first-class on the spec (B), enforced once on the wrapper (§7) ----
export interface Sovereignty {
  visibility: 'comparison' | 'identified'  // learner-facing => 'comparison' (anonymised); admin => 'identified' (named)
  kFloor: number                            // suppress any band whose population < kFloor (default 5). A band of one cannot leak.
}

// ---- DataQuery: the composition Claude emits ({metric}x{entity}x{dims}x{frame}x{order}x{filter}) ----
export interface DataQuery {
  metric: string                        // MUST be a registered MetricId (registry key)
  entity?: Entity
  entityId?: string                     // sovereign focus / drill target (a course_code, a lego id)
  frame?: Frame
  order?: Order
  course?: string                       // course_code filter
  window?: Window
  dimensions?: Record<string, string>   // region/device/build/cohort group-by axes
  filter?: Record<string, string | number>
}

// =====================================================================
// PER-WIDGET DATA CONTRACTS — ONE interface per widget, discriminated by `kind`.
// The resolver's return type === the widget's `data` prop type (bound via the registry).
// Every shape is RENDERABLE-FROM-ZERO (empty arrays / 0 values); a resolver NEVER throws.
// =====================================================================
export interface StatData {
  kind: 'stat'
  label: string; value: number; unit?: string
  delta?: number; deltaWindow?: string; deltaTone?: Tone           // curvature read ("up from 2.4%")
  donut?: { name: string; value: number; tone?: Tone }[]           // optional donut variant (build-sha spread)
}
export interface TimeSeriesData {
  kind: 'time-series'
  x: string[]
  series: { name: string; points: number[]; tone?: Tone }[]
  yLabel?: string
}
export interface RankedBarData {
  kind: 'ranked-bar'
  bars: { id: string; label: string; value: number; tone?: Tone; muted?: boolean }[]  // muted = contaminated source (e.g. Croatian)
  unit?: string; horizontal?: boolean
}
export interface SovereignComparisonData {     // the 'standing' widget — Lens A
  kind: 'sovereign-comparison'
  windowLabel: string                          // "last 30 days"
  groupLabel: string                           // "Welsh learners"
  top: { id: string; label: string; value: number }[]   // label = initials when visibility==='comparison'
  self?: { label: string; value: number }
  average: number; percentile?: number; unit?: string
  bandCount: number                            // population behind the comparison; wrapper suppresses if < kFloor
  named: boolean                               // resolver sets true ONLY for admin identified-visibility; wrapper is the 2nd gate
}
export interface DistributionData {
  kind: 'distribution'
  bins: { id: string; x0: number; x1: number; count: number; tone?: Tone }[]
  unit?: string; mean?: number
}
export interface ScatterData {                 // difficulty x execution plane
  kind: 'scatter'
  points: { id: string; x: number; y: number; tone?: Tone }[]
  xLabel: string; yLabel: string; xMax?: number; yMax?: number
}
export interface FunnelData {
  kind: 'funnel'
  stages: { id: string; label: string; value: number; tone?: Tone }[]
}
export interface FlowData {                     // Sankey
  kind: 'flow'
  nodes: { id: string; label: string; tone?: Tone }[]
  links: { source: string; target: string; value: number }[]
}
export interface CohortGridData {               // heatmap (retention cohorts OR friction map)
  kind: 'cohort-grid'
  xLabels: string[]; yLabels: string[]
  cells: { x: string; y: string; value: number }[]
  min: number; max: number; unit?: string
}
export interface MapData {
  kind: 'map'
  regions: { region: string; label?: string; value: number; tone?: Tone }[]   // ISO country (ip_country)
  unit?: string
}
export interface TableData {
  kind: 'table'
  columns: { key: string; label: string; align?: 'left' | 'right'; format?: 'number' | 'minutes' | 'percent' | 'text' }[]
  rows: { id: string; cells: Record<string, string | number>; tone?: Tone }[]
}
export interface NarrativeCardData {            // the .disc discover card — pure HTML, NO chart (B's honest asymmetry)
  kind: 'narrative-card'
  moved: string                                // "▲ moved this week · by acceleration"
  headline?: string                            // gallery .disc .story — the bold display-font finding headline (e.g. "Welsh skip-back on S0014L02 jumped 40%")
  // story + actions ride on the InsightSpec itself; this carries only the framing line + an optional metric
  metricLabel?: string; metricValue?: string
}
export interface TreemapData {
  kind: 'treemap'
  nodes: { id: string; name: string; value: number; tone?: Tone; muted?: boolean }[]
  unit?: string
}

// THE UNION — discriminated by `kind`.
export type WidgetData =
  | StatData | TimeSeriesData | RankedBarData | SovereignComparisonData
  | DistributionData | ScatterData | FunnelData | FlowData | CohortGridData
  | MapData | TableData | NarrativeCardData | TreemapData

// Map a widget kind -> its data variant. Lets a spec literal AND a resolver be checked at compile time (A).
export type DataForKind<K extends WidgetKind> = Extract<WidgetData, { kind: K }>

// ---- InsightSpec — what Claude emits / a board hardcodes. Generic over kind (A) ----
export interface InsightSpec<K extends WidgetKind = WidgetKind> {
  widget: K
  query: DataQuery              // resolved by the registry -> DataForKind<K>
  frame: Frame                  // ROUTES Lens A (self/group) vs Lens B (world/content); boards filter on this so A & B never share a screen
  title: string                 // the question ("Where do trial users fall away?")
  story?: string                // the one-line read
  annotate?: Annotation[]
  actions?: Action[]            // graded footer — every spec is expected to terminate in >=1 action
  sovereignty?: Sovereignty     // REQUIRED when widget==='sovereign-comparison' OR frame is self/group
  tag?: string                  // widget label shown in .fig-tag (defaults to the kind)
}
// Tagged union so widget + data co-vary at the board call-site.
export type AnyInsightSpec = { [K in WidgetKind]: InsightSpec<K> }[WidgetKind]

// The resolved bundle the host hands to the wrapper (C: host fetches, wrapper is pure).
export interface ResolvedInsight {
  data: WidgetData
  isLoading: boolean
  error: string | null
}

// =====================================================================
// COMPOSITE WIDGET DATA — RateCompare ("entity vs average" rate widget)
//
// NOT part of the WidgetData union and NOT a registry kind: RateCompare is a
// hand-composed board widget (headline + bar + trend + distribution), the way
// the Health strip composes several panels, rather than a single dispatcher
// kind. Its data type lives here (the documented home for widget data types) so
// the component + the demo data file share one contract. The frozen spine union
// above is untouched, so the 18-way invariants still hold.
//
// Design principle: RATE IS PRIMARY. Every interesting metric is a rate; the
// entity, the average cohort, and the metric are all swappable. Position (e.g.
// furthest LEGO) rides along as `contextLine` — secondary, never the hero.
//
// PRIVACY (non-negotiable): an entity is compared ONLY to an aggregate/average,
// NEVER to another named entity. The widget exposes the selected entity ("You")
// and the chosen average, plus an ANONYMISED distribution summary of the cohort
// — the other entities are an unlabelled SHAPE only. No other entity's name,
// label, or identity is ever carried in this contract.
// =====================================================================
export interface RateSeries {
  label: string
  value: number          // the headline rate for this entity / average
  trend: number[]        // 8 periods, oldest -> newest
}
// An ANONYMISED summary of where the entity sits in its cohort. Carries the
// shape of the field (quartile band + the raw values for an optional histogram)
// but NO identities — never a per-entity label. The only two marked points are
// the entity ("You") and the average; everything else is an unlabelled point.
export interface RateDistribution {
  values: number[]       // every cohort value, UNLABELLED + sorted asc (an anonymous shape)
  min: number
  q1: number
  median: number
  q3: number
  max: number
  entityValue: number    // where "You" sits on the strip
  averageValue: number   // where the chosen average sits on the strip
  percentile: number     // 0..100 — the entity's rank within the cohort
}
export interface RateComparisonData {
  metricLabel: string    // "Rate of progress"
  unit: string           // "LEGOs"
  per: string            // "week"  -> rendered as "LEGOs / week"
  entity: RateSeries
  average: RateSeries
  deltaPct: number       // signed % the entity is above (+) / below (-) the average
  percentile: number     // 0..100 — the entity's rank within the cohort
  contextLine?: string   // secondary position context — the furthest LEGO's own content ("dw i eisiau" — "I want"), never raw S/L ids
  distribution: RateDistribution  // anonymised cohort shape — entity + average marked, NO other names
  // ── Voice: every card speaks AS the selected entity (founder ruling 2026-07-19) ──
  // `subject` = how the card names the entity; `subjectIsViewer` is true ONLY when
  // the entity is the viewer's own learner identity — the sole case the card may
  // say "You". `levelNoun` ("class") + `cohortLabel` ("classes in Gaelcholáiste
  // Luimnigh") anchor the cohort copy. All optional; an absent subject falls back
  // to entity.label — never to "You". `distribution.values` are the entity's
  // SIBLINGS at its level within the ancestor scope (entity excluded), never the
  // entity's own members.
  subject?: string
  subjectIsViewer?: boolean
  levelNoun?: string
  cohortLabel?: string
}
