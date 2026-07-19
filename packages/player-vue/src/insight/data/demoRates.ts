// ============================================================================
// DEMO ONLY — generated in-memory, never touches the database.
//
// The synthetic population behind the "Rate compare" board (RatesBoard.vue):
// ONE reusable widget that compares an ENTITY's rate to an AVERAGE rate, where
// the METRIC, the ENTITY (and its level), and the AVERAGE cohort are all
// swappable. RATE IS PRIMARY — position is only secondary `contextLine` context.
//
// VOICE (founder ruling 2026-07-19): every card speaks AS the selected entity —
// "You" never appears here (an admin board's entity is never the viewer). The
// comparison cohort is the entity's SIBLINGS at its own level within an
// ANCESTOR scope (class → sibling classes in its school), NEVER the entity's
// own members, and the compare-to options name the ancestor explicitly
// ("Gaelcholáiste Luimnigh avg"), defaulting to the nearest one.
//
// Determinism: a seeded mulberry32 PRNG (mirrors demo.ts). Every entity's value
// + trend derive ONLY from (metric, level, label), so the same entity carries
// the same numbers whichever scope it's compared within.
//
// PRIVACY (non-negotiable): the comparison is entity-vs-AGGREGATE only. The
// cohort leaves only as an ANONYMISED distribution summary (sibling values,
// unlabelled) — no other entity's name ever leaves getRateComparison.
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

// ── Entity levels & hero rates ──────────────────────────────────────────────
export type EntityLevel = 'learner' | 'class' | 'school' | 'course'

export interface HeroRate {
  id: string
  label: string
  unit: string
  per: string
  description: string
  entityLevels: EntityLevel[]
  /** rounding precision for this metric's values */
  dp: number
  /** plausible value range [min, max] the synthetic entities are drawn from */
  range: [number, number]
  /** does a furthest-LEGO position context line make sense for this metric? */
  hasPosition: boolean
}

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
    dp: 1,
    range: [1.5, 6.5],
    hasPosition: true,
  },
]

const HERO_BY_ID = new Map(HERO_RATES.map((m) => [m.id, m]))

// ── Time windows (the windows+measures contract, frozen 2026-07-19) ────────
// Same four windows the real engine offers: chip value/label, the trend point
// count + spacing, and the honest chart caption. `term` is the default
// (continuity with the old 90-day default).
export interface WindowOption { value: string; label: string }
export const WINDOW_OPTIONS: WindowOption[] = [
  { value: 'week', label: 'This week' },
  { value: '4w', label: 'Last 4 weeks' },
  { value: 'term', label: 'This term' },
  { value: 'all', label: 'All time' },
]
export const DEFAULT_WINDOW = 'term'

interface WindowMeta {
  trendPoints: number
  trendPeriodDays: 1 | 7 | 30
  trendLabel: string
  windowLabel: string
}
const WINDOW_META: Record<string, WindowMeta> = {
  week: { trendPoints: 7, trendPeriodDays: 1, trendLabel: 'Daily · this week', windowLabel: 'This week' },
  '4w': { trendPoints: 4, trendPeriodDays: 7, trendLabel: 'Weekly · last 4 weeks', windowLabel: 'Last 4 weeks' },
  term: { trendPoints: 12, trendPeriodDays: 7, trendLabel: 'Weekly · this term', windowLabel: 'This term' },
  all: { trendPoints: 12, trendPeriodDays: 30, trendLabel: 'Monthly · last 12 months', windowLabel: 'All time' },
}
function windowMeta(window: string): WindowMeta {
  return WINDOW_META[window] ?? WINDOW_META[DEFAULT_WINDOW]
}

// ── The synthetic org (the Irish-government showcase) ───────────────────────
// Two demo directions:
//   · "— Sínis"  classes = Chinese for Irish speakers (Gaelscoileanna, MFL
//                          taught through Irish)
//   · "Gaeilge"  classes = Irish for English speakers (English-medium schools)
// Every class label embeds its school ("<School> · <Class>"), which IS the
// hierarchy: siblings share the school prefix. Every school carries 2–4
// classes so sibling cohorts are real (the "1st of 3" read).
const ORG_NAME = 'An Roinn Oideachais pilot'

const CLASS_NAMES = [
  'Gaelscoil Cholmcille · Rang a 4 — Sínis', 'Gaelscoil Cholmcille · Rang a 5 — Sínis',
  'Gaelscoil Cholmcille · Rang a 6 — Sínis',
  'Gaelscoil na Fuinseoige · Rang a 4 — Sínis', 'Gaelscoil na Fuinseoige · Rang a 5 — Sínis',
  'Gaelcholáiste Luimnigh · Rang a 1 — Sínis', 'Gaelcholáiste Luimnigh · Rang a 2 — Sínis',
  'Gaelcholáiste Luimnigh · Rang a 3 — Sínis',
  'Coláiste Éinde · 1st Year Gaeilge', 'Coláiste Éinde · 2nd Year Gaeilge',
  'Coláiste Éinde · 3rd Year Gaeilge',
  'Scoil Bhríde · 4th Class Gaeilge', 'Scoil Bhríde · 5th Class Gaeilge',
  'Coláiste Mhuire · 1st Year Gaeilge', 'Coláiste Mhuire · 2nd Year Gaeilge',
  'St Kieran’s College · 1st Year Gaeilge', 'St Kieran’s College · 2nd Year Gaeilge',
  'Scoil Mhuire gan Smál · 5th Class Gaeilge', 'Scoil Mhuire gan Smál · 6th Class Gaeilge',
  'Coláiste Iognáid · 2nd Year Gaeilge', 'Coláiste Iognáid · 3rd Year Gaeilge',
  'Gaelscoil Riada · Rang a 5 — Sínis', 'Gaelscoil Riada · Rang a 6 — Sínis',
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

// Every demo learner sits in ONE home class (the founder-walk class) so the
// learner level has a real ancestor chain: class → school → course.
const LEARNER_HOME_CLASS = 'Gaelcholáiste Luimnigh · Rang a 1 — Sínis'
const LEARNER_NAMES = [
  'Saoirse Ní Bhraonáin', 'Cian Ó Dónaill', 'Aoife Nic Gabhann', 'Oisín Ó Briain',
  'Niamh Ní Cheallaigh', 'Fionn Mac Cárthaigh', 'Caoimhe Ní Mhurchú', 'Tadhg Ó Sé',
  'Méabh Ní Laoire', 'Daithí Ó Conghaile', 'Róisín Ní Dhomhnaill', 'Eoin Mac Aodha',
  'Sadhbh Ní Riain', 'Conor Ó Flaithearta',
]

function namesForLevel(level: EntityLevel): string[] {
  switch (level) {
    case 'learner': return LEARNER_NAMES
    case 'class': return CLASS_NAMES
    case 'school': return SCHOOL_NAMES
    case 'course': return COURSE_NAMES
  }
}

// ── Hierarchy helpers (the label IS the tree) ───────────────────────────────
const schoolOfClass = (classLabel: string): string => classLabel.split(' · ')[0] ?? classLabel
const shortClassName = (classLabel: string): string => classLabel.split(' · ')[1] ?? classLabel
const courseOfClass = (classLabel: string): string =>
  classLabel.includes('Sínis') ? 'Chinese for Irish speakers' : 'Irish for English speakers'

// ── Deterministic per-entity numbers ────────────────────────────────────────
// An entity's value + trend derive ONLY from (metric, level, label): the same
// entity reads identically in every scope it appears in.

// Build an N-period trend ending near `target`, with a believable shape.
function buildTrend(
  rand: () => number,
  target: number,
  shape: 'rising' | 'stalled' | 'steady',
  dp: number,
  points = 8,
): number[] {
  const N = points
  const pts: number[] = []
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1) // 0 -> 1
    let base: number
    if (shape === 'rising') {
      base = target * (0.55 + 0.45 * t)          // climbs to target
    } else if (shape === 'stalled') {
      base = target * (1.35 - 0.35 * t)          // sags down to target
    } else {
      base = target * (0.92 + 0.16 * t)          // gentle drift around target
    }
    const jitter = base * (rand() - 0.5) * 0.16
    pts.push(Math.max(0, round(base + jitter, dp)))
  }
  return pts
}

interface EntityNumbers { value: number; trend: number[]; rand: () => number }

function entityNumbers(
  metric: HeroRate, level: EntityLevel, label: string, trendPoints = 8,
): EntityNumbers {
  const rand = mulberry32(strHash(`${metric.id}::${level}::${label}`))
  const [lo, hi] = metric.range
  const roll = rand()
  const value = round(lo + rand() * (hi - lo), metric.dp)
  const shape = roll < 0.3 ? 'rising' : roll < 0.85 ? 'steady' : 'stalled'
  return { value, trend: buildTrend(rand, value, shape, metric.dp, trendPoints), rand }
}

// Unlabelled synthetic siblings for scopes wider than the named roster (e.g.
// learners across the whole school). Values + trends only — no names exist.
function syntheticSiblings(
  metric: HeroRate, seedKey: string, count: number, trendPoints = 8,
): EntityNumbers[] {
  const rand = mulberry32(strHash(`${metric.id}::synthetic::${seedKey}`))
  const [lo, hi] = metric.range
  const out: EntityNumbers[] = []
  for (let i = 0; i < count; i++) {
    const roll = rand()
    const value = round(lo + rand() * (hi - lo), metric.dp)
    const shape = roll < 0.3 ? 'rising' : roll < 0.85 ? 'steady' : 'stalled'
    out.push({ value, trend: buildTrend(rand, value, shape, metric.dp, trendPoints), rand })
  }
  return out
}

// ── Position context: the furthest LEGO's own CONTENT, never raw S/L ids ────
// (position-is-LEGO ruling: admin surfaces render what the LEGO says, exactly
// like the learner surfaces' formatFurthestPoint does.)
const LEGO_CONTENT: Record<string, [string, string][]> = {
  'Chinese for Irish speakers': [
    ['我想学', 'ba mhaith liom foghlaim'],
    ['我们可以说', 'is féidir linn a rá'],
    ['明天再试', 'bain triail eile as amárach'],
    ['你想不想', 'ar mhaith leat'],
    ['说一点中文', 'beagán Sínise a labhairt'],
  ],
  'Irish for English speakers': [
    ['ba mhaith liom', 'I would like'],
    ['tá mé ag foghlaim', 'I am learning'],
    ['an féidir linn', 'can we'],
    ['abair é sin arís', 'say that again'],
    ['gach lá', 'every day'],
  ],
}

function positionContext(rand: () => number, course: string): string {
  const pool = LEGO_CONTENT[course] ?? LEGO_CONTENT['Irish for English speakers']
  const [target, known] = pool[Math.floor(rand() * pool.length)]
  return `Furthest LEGO · "${target}" — "${known}"`
}

// ── Ancestor chain: the compare-to options for one entity ───────────────────
// Value = the scope KIND (stable across entity switches); label NAMES the
// ancestor explicitly, so the defaulted selection is always visible (never an
// empty control). Nearest ancestor first = the default.
export interface AverageOption { value: string; label: string }

interface Scope {
  kind: string            // 'class' | 'school' | 'course' | 'org' | 'all'
  label: string           // "Gaelcholáiste Luimnigh avg"
  cohortLabel: string     // "classes in Gaelcholáiste Luimnigh"
  siblings: () => EntityNumbers[]   // the entity's siblings (entity EXCLUDED)
}

function scopesFor(
  metric: HeroRate, level: EntityLevel, label: string, trendPoints = 8,
): Scope[] {
  switch (level) {
    case 'learner': {
      const school = schoolOfClass(LEARNER_HOME_CLASS)
      const course = courseOfClass(LEARNER_HOME_CLASS)
      return [
        {
          kind: 'class',
          label: `${shortClassName(LEARNER_HOME_CLASS)} avg`,
          cohortLabel: `learners in ${shortClassName(LEARNER_HOME_CLASS)}`,
          siblings: () => LEARNER_NAMES.filter((n) => n !== label)
            .map((n) => entityNumbers(metric, 'learner', n, trendPoints)),
        },
        {
          kind: 'school',
          label: `${school} avg`,
          cohortLabel: `learners in ${school}`,
          siblings: () => syntheticSiblings(metric, `learner-school:${school}`, 42, trendPoints),
        },
        {
          kind: 'course',
          label: `${course} avg`,
          cohortLabel: `learners on ${course}`,
          siblings: () => syntheticSiblings(metric, `learner-course:${course}`, 120, trendPoints),
        },
      ]
    }
    case 'class': {
      const school = schoolOfClass(label)
      const course = courseOfClass(label)
      return [
        {
          kind: 'school',
          label: `${school} avg`,
          cohortLabel: `classes in ${school}`,
          siblings: () => CLASS_NAMES
            .filter((c) => c !== label && schoolOfClass(c) === school)
            .map((c) => entityNumbers(metric, 'class', c, trendPoints)),
        },
        {
          kind: 'course',
          label: `${course} avg`,
          cohortLabel: `classes on ${course}`,
          siblings: () => CLASS_NAMES
            .filter((c) => c !== label && courseOfClass(c) === course)
            .map((c) => entityNumbers(metric, 'class', c, trendPoints)),
        },
      ]
    }
    case 'school':
      return [
        {
          kind: 'org',
          label: `${ORG_NAME} avg`,
          cohortLabel: `schools in ${ORG_NAME}`,
          siblings: () => SCHOOL_NAMES.filter((s) => s !== label)
            .map((s) => entityNumbers(metric, 'school', s, trendPoints)),
        },
      ]
    case 'course':
      return [
        {
          kind: 'all',
          label: 'All SSi courses avg',
          cohortLabel: 'all SSi courses',
          siblings: () => COURSE_NAMES.filter((c) => c !== label)
            .map((c) => entityNumbers(metric, 'course', c, trendPoints)),
        },
      ]
  }
}

// ── Public list helpers (the board's dropdowns read these) ──────────────────

/** Entity options for a (metric, level): { value: id, label } in roster order. */
export function listEntities(
  metricId: string,
  level: EntityLevel,
): { value: string; label: string }[] {
  const metric = HERO_BY_ID.get(metricId)
  if (!metric || !metric.entityLevels.includes(level)) return []
  return namesForLevel(level).map((label, i) => ({
    value: `demo:${metricId}:${level}:${i}`,
    label,
  }))
}

/** The compare-to options for one entity = its ANCESTOR chain, nearest first. */
export function listAverages(
  metricId: string,
  level: EntityLevel,
  entityId: string,
): AverageOption[] {
  const metric = HERO_BY_ID.get(metricId)
  if (!metric || !metric.entityLevels.includes(level)) return []
  const label = entityLabelFor(metricId, level, entityId)
  if (!label) return []
  return scopesFor(metric, level, label).map((s) => ({ value: s.kind, label: s.label }))
}

/** The valid entity levels for a metric (for the level switch). */
export function listEntityLevels(metricId: string): EntityLevel[] {
  return HERO_BY_ID.get(metricId)?.entityLevels ?? []
}

function entityLabelFor(metricId: string, level: EntityLevel, entityId: string): string | null {
  const opts = listEntities(metricId, level)
  if (!opts.length) return null
  return (opts.find((o) => o.value === entityId) ?? opts[0]).label
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

// Period-wise mean of sibling trends.
function meanTrend(trends: number[][], dp: number): number[] {
  const nonEmpty = trends.filter((t) => t.length > 0)
  if (nonEmpty.length === 0) return new Array(8).fill(0)
  const N = Math.min(...nonEmpty.map((t) => t.length))
  const out: number[] = []
  for (let p = 0; p < N; p++) {
    let sum = 0
    for (const t of nonEmpty) sum += t[t.length - N + p] ?? 0
    out.push(round(sum / nonEmpty.length, dp))
  }
  return out
}

// ============================================================================
// getRateComparison — the one read the board makes. Total + deterministic.
// `averageId` is a scope KIND from listAverages ('school', 'course', …);
// anything unknown falls back to the NEAREST ancestor (the default).
// `window` is one of WINDOW_OPTIONS ('week'|'4w'|'term'|'all'); it shapes the
// trend's point count + spacing (coherent per window×measure) and rides back
// on the response as windowLabel/trendLabel/trendPeriodDays, mirroring the
// real engine's contract.
// ============================================================================
export function getRateComparison(
  metricId: string,
  entityLevel: EntityLevel,
  entityId: string,
  averageId: string,
  window: string = DEFAULT_WINDOW,
): RateComparisonData {
  const metric = HERO_BY_ID.get(metricId)
  if (!metric) return emptyComparison()
  const label = entityLabelFor(metricId, entityLevel, entityId)
  if (!label) return emptyComparison(metric)

  const meta = windowMeta(window)
  const scopes = scopesFor(metric, entityLevel, label, meta.trendPoints)
  const scope = scopes.find((s) => s.kind === averageId) ?? scopes[0]

  const self = entityNumbers(metric, entityLevel, label, meta.trendPoints)
  const siblings = scope.siblings()

  const values = siblings.map((s) => s.value).sort((a, b) => a - b)
  const avgValue = values.length
    ? round(values.reduce((a, b) => a + b, 0) / values.length, metric.dp)
    : 0
  const avgTrend = meanTrend(siblings.map((s) => s.trend), metric.dp)

  const deltaPct = avgValue > 0
    ? Math.round(((self.value - avgValue) / avgValue) * 100)
    : 0
  // Percentile within the sibling cohort (share of siblings at-or-below).
  const percentile = values.length
    ? Math.round((values.filter((v) => v <= self.value).length / values.length) * 100)
    : 0

  const course = entityLevel === 'course' ? label
    : entityLevel === 'school' ? 'Chinese for Irish speakers'
    : courseOfClass(entityLevel === 'class' ? label : LEARNER_HOME_CLASS)

  const subject = entityLevel === 'class' ? shortClassName(label) : label
  const entitySeries: RateSeries = { label: subject, value: self.value, trend: self.trend }
  const averageSeries: RateSeries = { label: scope.label, value: avgValue, trend: avgTrend }

  const distribution: RateDistribution = {
    values,
    min: values.length ? values[0] : 0,
    q1: round(linearQuantile(values, 0.25), metric.dp),
    median: round(linearQuantile(values, 0.5), metric.dp),
    q3: round(linearQuantile(values, 0.75), metric.dp),
    max: values.length ? values[values.length - 1] : 0,
    entityValue: self.value,
    averageValue: avgValue,
    percentile,
  }

  return {
    metricLabel: metric.label,
    unit: metric.unit,
    per: metric.per,
    entity: entitySeries,
    average: averageSeries,
    deltaPct,
    percentile,
    contextLine: metric.hasPosition ? positionContext(self.rand, course) : undefined,
    distribution,
    // Voice: the card speaks AS this entity — never "You" on an admin board.
    subject,
    subjectIsViewer: false,
    levelNoun: entityLevel,
    cohortLabel: scope.cohortLabel,
    // Time window: mirrors the real engine's contract (windowLabel/trendLabel/
    // trendPeriodDays), so the demo board previews the honest chart caption.
    windowLabel: meta.windowLabel,
    trendLabel: meta.trendLabel,
    trendPeriodDays: meta.trendPeriodDays,
  }
}
