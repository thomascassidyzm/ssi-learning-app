// ============================================================================
// DEMO ONLY — generated in-memory, never touches the database. Active only with ?demo.
//
// The synthetic population behind the "Rate compare" board (RatesBoard.vue):
// ONE reusable widget that compares an ENTITY's rate to an AVERAGE rate, where
// the METRIC, the ENTITY (and its level), and the AVERAGE cohort are all
// swappable. RATE IS PRIMARY — position is only secondary `contextLine` context.
//
// Determinism: a seeded mulberry32 PRNG (mirrors demo.ts) so every synthetic
// entity, its headline rate, and its 8-period trend are stable across reloads.
// Each (metric, entityLevel) pair gets its own derived seed so the populations
// don't collide. getRateComparison() is total: it NEVER throws and always
// returns a well-formed RateComparisonData (a clearly-labelled empty shape if a
// selection is unknown), exactly like a resolver on the real path would.
//
// PRIVACY (non-negotiable): the comparison is entity-vs-AGGREGATE only. Internal
// synthetic names exist purely to seed the populations + drive the entity picker
// (listEntities), but getRateComparison NEVER returns any other entity's name —
// the cohort leaves only as an ANONYMISED distribution summary (a quartile band
// + unlabelled values), with just the entity ("You") and the average marked.
// ============================================================================

import type {
  RateComparisonData,
  RateSeries,
  RateDistribution,
} from '../spec'

// ── Seeded PRNG (mulberry32) — same shape as demo.ts ────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 0..1 hash from a string (so each metric/level/id maps to a fixed seed offset). */
function strHash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const round = (v: number, dp = 1): number => {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

// ── Entity levels & average cohorts ─────────────────────────────────────────
export type EntityLevel = 'learner' | 'class' | 'school' | 'course'

export interface HeroRate {
  id: string
  label: string
  unit: string
  per: string
  description: string
  entityLevels: EntityLevel[]
  /** swappable comparison cohorts — the average dropdown's options for this metric */
  averages: string[]
  /** rounding precision for this metric's values */
  dp: number
  /** plausible value range [min, max] the synthetic entities are drawn from */
  range: [number, number]
  /** does a furthest-LEGO position context line make sense for this metric? */
  hasPosition: boolean
}

// The comparison cohort ESCALATES outward from the most LOCAL group the student
// belongs to: class → year → school → region → country → global → all course
// participants. The class average is the default (most relevant), and the teacher
// can widen the lens. We never hold ages / peer attributes, so there is no "peer
// cohort" distinct from the school — we can't compute one. Same set every metric.
export const AVERAGE_ESCALATION = [
  'class avg', 'year avg', 'school avg', 'region avg', 'country avg', 'global avg', 'all course participants',
]

// THE 6 HERO RATES. progressPace LEADS — it's the headline rate.
export const HERO_RATES: HeroRate[] = [
  {
    id: 'progressPace',
    label: 'Rate of progress',
    unit: 'LEGOs',
    per: 'week',
    description:
      'New LEGOs reached per week — the headline rate. Rate of progress matters more than position: a learner three seeds back but climbing fast is healthier than one parked far ahead.',
    entityLevels: ['learner', 'class', 'school', 'course'],
    averages: AVERAGE_ESCALATION,
    dp: 1,
    range: [1.5, 16],
    hasPosition: true,
  },
  {
    id: 'appMinutesDay',
    label: 'App-minutes',
    unit: 'min',
    per: 'day',
    description:
      'Active minutes in the app per day — the dosage rate. Flow rate, not a vanity total: minutes/day is what actually predicts whether progress keeps coming.',
    entityLevels: ['learner', 'class', 'school'],
    averages: AVERAGE_ESCALATION,
    dp: 1,
    range: [4, 38],
    hasPosition: false,
  },
  {
    id: 'newLegosHr',
    label: 'New LEGOs introduced',
    unit: 'LEGOs',
    per: 'hour',
    description:
      'New LEGOs introduced per active hour — the introduction rate (efficiency of new exposure). High means the session keeps reaching for new material; low means it dwells.',
    entityLevels: ['learner', 'class', 'course'],
    averages: AVERAGE_ESCALATION,
    dp: 1,
    range: [3, 22],
    hasPosition: true,
  },
  {
    id: 'repeatsRatio',
    label: 'Repeats',
    unit: 'repeat:new',
    per: 'session',
    description:
      'Repeats per new item each session — the consolidation rate. Higher means more reinforcement before moving on; very low can mean rushing, very high can mean stalling.',
    entityLevels: ['learner', 'class', 'course'],
    averages: AVERAGE_ESCALATION,
    dp: 2,
    range: [0.8, 4.2],
    hasPosition: false,
  },
  {
    id: 'interactionsMin',
    label: 'Interactions',
    unit: 'cycles',
    per: 'minute',
    description:
      'Prompt-response cycles per active minute — the engagement rate. A dense, healthy curve is a learner working through cycles; a thin one is time in the app without the work.',
    entityLevels: ['learner', 'class', 'school'],
    averages: AVERAGE_ESCALATION,
    dp: 1,
    range: [3.5, 6.2],
    hasPosition: false,
  },
  {
    id: 'daysActiveWk',
    label: 'Days active',
    unit: 'days',
    per: 'week',
    description:
      'Distinct active days per week — the consistency rate. Spreading the same minutes across more days beats one long binge: consistency is the strongest predictor of staying the course.',
    entityLevels: ['learner', 'class', 'school'],
    averages: AVERAGE_ESCALATION,
    dp: 1,
    range: [1.5, 6.5],
    hasPosition: true,
  },
]

const HERO_BY_ID = new Map(HERO_RATES.map((m) => [m.id, m]))

// ── Synthetic entity names per level (schools-flavoured; reuse demo.ts idioms) ─
const LEARNER_NAMES = [
  'Saoirse Ní Bhraonáin', 'Cian Ó Dónaill', 'Aoife Nic Gabhann', 'Oisín Ó Briain',
  'Niamh Ní Cheallaigh', 'Fionn Mac Cárthaigh', 'Caoimhe Ní Mhurchú', 'Tadhg Ó Sé',
  'Méabh Ní Laoire', 'Daithí Ó Conghaile', 'Róisín Ní Dhomhnaill', 'Eoin Mac Aodha',
  'Sadhbh Ní Riain', 'Conor Ó Flaithearta',
]

// Two demo directions for the Irish-government showcase:
//   · "— Sínis"   classes  = Chinese for Irish speakers (Gaelscoileanna, MFL
//                            taught through Irish)
//   · "Gaeilge"   classes  = Irish for English speakers (English-medium schools)
// MY_CLASSES (TeacherInsightsView.vue) must be a VERBATIM subset of this list so
// the teacher's picker resolves each class to a real synthetic population.
const CLASS_NAMES = [
  'Gaelscoil Cholmcille · Rang a 5 — Sínis', 'Gaelscoil Cholmcille · Rang a 6 — Sínis',
  'Gaelscoil na Fuinseoige · Rang a 5 — Sínis', 'Gaelcholáiste Luimnigh · Rang a 1 — Sínis',
  'Coláiste Éinde · 1st Year Gaeilge', 'Coláiste Éinde · 2nd Year Gaeilge',
  'Scoil Bhríde · 5th Class Gaeilge', 'Coláiste Mhuire · 1st Year Gaeilge',
  'St Kieran’s College · 2nd Year Gaeilge', 'Scoil Mhuire gan Smál · 6th Class Gaeilge',
]

const SCHOOL_NAMES = [
  'Gaelscoil Cholmcille', 'Coláiste Éinde', 'Scoil Bhríde', 'Gaelscoil na Fuinseoige',
  'Coláiste Mhuire', 'Gaelcholáiste Luimnigh', 'St Kieran’s College',
  'Scoil Mhuire gan Smál', 'Coláiste Iognáid', 'Gaelscoil Riada',
]

const COURSE_NAMES = [
  'Chinese for Irish speakers', 'Irish for English speakers',
  'French for Irish speakers', 'Spanish for Irish speakers',
  'German for Irish speakers', 'Polish for Irish speakers',
]

function namesForLevel(level: EntityLevel): string[] {
  switch (level) {
    case 'learner': return LEARNER_NAMES
    case 'class': return CLASS_NAMES
    case 'school': return SCHOOL_NAMES
    case 'course': return COURSE_NAMES
  }
}

// ── A single synthetic entity within a (metric, level) population ────────────
export interface RateEntity {
  id: string
  label: string
  value: number
  trend: number[]   // 8 periods, oldest -> newest
  context?: string  // optional position context (furthest LEGO), present only when hasPosition
}

// Build an 8-period trend ending near `target`, with a believable shape.
// shape: 'rising' (clear leader), 'stalled' (flat-to-falling), 'steady' (gentle drift).
function buildTrend(
  rand: () => number,
  target: number,
  shape: 'rising' | 'stalled' | 'steady',
  dp: number,
): number[] {
  const N = 8
  const pts: number[] = []
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1) // 0 -> 1
    let base: number
    if (shape === 'rising') {
      // starts ~55% of target, climbs to target
      base = target * (0.55 + 0.45 * t)
    } else if (shape === 'stalled') {
      // starts a bit above target, sags down to target (lost momentum)
      base = target * (1.35 - 0.35 * t)
    } else {
      // steady: hovers around target with a gentle drift
      base = target * (0.92 + 0.16 * t)
    }
    const jitter = base * (rand() - 0.5) * 0.16
    pts.push(Math.max(0, round(base + jitter, dp)))
  }
  return pts
}

// A furthest-LEGO position context line (secondary). Deterministic from the seed.
function positionContext(rand: () => number): string {
  const seed = 4 + Math.floor(rand() * 60)   // S4 .. S63
  const lego = 1 + Math.floor(rand() * 4)     // L01 .. L04
  return `Furthest LEGO · S${seed} · L${String(lego).padStart(2, '0')}`
}

// Build the full population of named entities for a (metric, level).
// Deterministic: seed derives from the metric id + level so each pair is stable
// and distinct. Plants a clear LEADER (rising) and a clear STALLED entity.
function buildEntities(metric: HeroRate, level: EntityLevel): RateEntity[] {
  const seed = strHash(`${metric.id}::${level}`)
  const rand = mulberry32(seed)
  const names = namesForLevel(level)

  // ~8–14 entities (clamped to the available names for this level).
  const count = Math.min(names.length, 8 + Math.floor(rand() * 7))
  const [lo, hi] = metric.range

  // Pick a leader index and a (different) stalled index up front.
  const leaderIdx = Math.floor(rand() * count)
  let stalledIdx = Math.floor(rand() * count)
  if (stalledIdx === leaderIdx) stalledIdx = (stalledIdx + 1) % count

  const entities: RateEntity[] = []
  for (let i = 0; i < count; i++) {
    let value: number
    let shape: 'rising' | 'stalled' | 'steady'
    if (i === leaderIdx) {
      value = round(hi * (0.92 + rand() * 0.08), metric.dp)  // near the top of the range
      shape = 'rising'
    } else if (i === stalledIdx) {
      value = round(lo * (1.0 + rand() * 0.25), metric.dp)   // near the bottom — barely moving
      shape = 'stalled'
    } else {
      value = round(lo + rand() * (hi - lo) * 0.82, metric.dp)
      shape = rand() < 0.4 ? 'rising' : 'steady'
    }
    entities.push({
      id: `demo:${metric.id}:${level}:${i}`,
      label: names[i],
      value,
      trend: buildTrend(rand, value, shape, metric.dp),
      context: metric.hasPosition ? positionContext(rand) : undefined,
    })
  }

  // Sort by value desc — the cohort centrepiece reads as a league table.
  entities.sort((a, b) => b.value - a.value)
  return entities
}

// Memoise per (metric, level) so repeated reads (dropdown changes) are cheap
// and identical — same preview every time.
const POP_CACHE = new Map<string, RateEntity[]>()
function population(metricId: string, level: EntityLevel): RateEntity[] {
  const metric = HERO_BY_ID.get(metricId)
  if (!metric) return []
  const key = `${metricId}::${level}`
  let pop = POP_CACHE.get(key)
  if (!pop) {
    pop = buildEntities(metric, level)
    POP_CACHE.set(key, pop)
  }
  return pop
}

// ── Average cohorts ─────────────────────────────────────────────────────────
// Each named average is COMPUTED from the (metric, level) population, then
// nudged by a stable per-average factor so the escalation cohorts genuinely
// differ — broader pools drift a touch higher here (a believable "the wider
// world is a little ahead" demo shape). All derived from the same seeded
// numbers → deterministic. Class avg = the local baseline (1.0).
const AVERAGE_FACTORS: Record<string, number> = {
  'class avg': 1.0,
  'year avg': 1.04,
  'school avg': 1.09,
  'region avg': 1.06,
  'country avg': 1.12,
  'global avg': 1.15,
  'all course participants': 1.18,
}

function rawMean(pop: RateEntity[]): number {
  if (!pop.length) return 0
  return pop.reduce((s, e) => s + e.value, 0) / pop.length
}

function averageValue(metric: HeroRate, pop: RateEntity[], averageId: string): number {
  const factor = AVERAGE_FACTORS[averageId] ?? 1.0
  return round(rawMean(pop) * factor, metric.dp)
}

// Average trend = the period-wise mean of every entity's trend, scaled by the
// same factor so the average line tracks the cohort but reads as the chosen cohort.
function averageTrend(metric: HeroRate, pop: RateEntity[], averageId: string): number[] {
  if (!pop.length) return new Array(8).fill(0)
  const factor = AVERAGE_FACTORS[averageId] ?? 1.0
  const N = pop[0].trend.length || 8
  const out: number[] = []
  for (let p = 0; p < N; p++) {
    let sum = 0
    for (const e of pop) sum += e.trend[p] ?? 0
    out.push(round((sum / pop.length) * factor, metric.dp))
  }
  return out
}

// ── Anonymised distribution summary ─────────────────────────────────────────
// Reduce the population to a privacy-safe SHAPE: the sorted (unlabelled) values
// + a quartile band, with the entity ("You") and the average marked. NO entity
// names leave this function — the cohort is an anonymous field of points.
function linearQuantile(sortedAsc: number[], q: number): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  if (n === 1) return sortedAsc[0]
  const pos = (n - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo)
}

function buildDistribution(
  metric: HeroRate,
  pop: RateEntity[],
  entityValue: number,
  averageValue: number,
  percentile: number,
): RateDistribution {
  // Sorted, UNLABELLED values — the anonymous shape of the field.
  const values = pop.map((e) => e.value).sort((a, b) => a - b)
  return {
    values,
    min: values.length ? values[0] : 0,
    q1: round(linearQuantile(values, 0.25), metric.dp),
    median: round(linearQuantile(values, 0.5), metric.dp),
    q3: round(linearQuantile(values, 0.75), metric.dp),
    max: values.length ? values[values.length - 1] : 0,
    entityValue,
    averageValue,
    percentile,
  }
}

// ── Public list helpers (the board's dropdowns read these) ──────────────────

/** Entity options for a (metric, level): { value: id, label } sorted by value desc. */
export function listEntities(
  metricId: string,
  level: EntityLevel,
): { value: string; label: string }[] {
  return population(metricId, level).map((e) => ({ value: e.id, label: e.label }))
}

/** The valid average-cohort ids for a metric (for the Average dropdown). */
export function listAverages(metricId: string): string[] {
  return HERO_BY_ID.get(metricId)?.averages ?? []
}

/** The valid entity levels for a metric (for the level switch). */
export function listEntityLevels(metricId: string): EntityLevel[] {
  return HERO_BY_ID.get(metricId)?.entityLevels ?? []
}

// A clearly-labelled empty shape so the component renders an empty state, never throws.
function emptyComparison(metric?: HeroRate): RateComparisonData {
  return {
    metricLabel: metric?.label ?? 'Rate',
    unit: metric?.unit ?? '',
    per: metric?.per ?? '',
    entity: { label: '—', value: 0, trend: [] },
    average: { label: '—', value: 0, trend: [] },
    deltaPct: 0,
    percentile: 0,
    contextLine: undefined,
    distribution: {
      values: [],
      min: 0,
      q1: 0,
      median: 0,
      q3: 0,
      max: 0,
      entityValue: 0,
      averageValue: 0,
      percentile: 0,
    },
  }
}

// ============================================================================
// getRateComparison — the one read the board makes. Total + deterministic.
// ============================================================================
export function getRateComparison(
  metricId: string,
  entityLevel: EntityLevel,
  entityId: string,
  averageId: string,
): RateComparisonData {
  const metric = HERO_BY_ID.get(metricId)
  if (!metric) return emptyComparison()

  const pop = population(metricId, entityLevel)
  if (!pop.length) return emptyComparison(metric)

  // Resolve the entity (fall back to the leader = first, since pop is value-desc).
  const entity = pop.find((e) => e.id === entityId) ?? pop[0]

  // Resolve the average (fall back to the metric's first listed average).
  const resolvedAverageId = metric.averages.includes(averageId)
    ? averageId
    : metric.averages[0] ?? 'course avg'

  const avgValue = averageValue(metric, pop, resolvedAverageId)
  const avgTrend = averageTrend(metric, pop, resolvedAverageId)

  const deltaPct = avgValue > 0
    ? Math.round(((entity.value - avgValue) / avgValue) * 100)
    : 0

  // Percentile: share of the cohort the entity is at-or-above (0..100).
  const atOrBelow = pop.filter((e) => e.value <= entity.value).length
  const percentile = Math.round((atOrBelow / pop.length) * 100)

  const entitySeries: RateSeries = {
    label: entity.label,
    value: entity.value,
    trend: entity.trend,
  }
  const averageSeries: RateSeries = {
    label: resolvedAverageId,
    value: avgValue,
    trend: avgTrend,
  }

  // PRIVACY: the cohort leaves only as an anonymised shape — no other names.
  const distribution = buildDistribution(metric, pop, entity.value, avgValue, percentile)

  return {
    metricLabel: metric.label,
    unit: metric.unit,
    per: metric.per,
    entity: entitySeries,
    average: averageSeries,
    deltaPct,
    percentile,
    contextLine: entity.context,
    distribution,
  }
}
