// ============================================================================
// DEMO ONLY — generated in-memory, never touches the database. Active only with ?demo.
//
// A front-end-only synthetic population (~500 fake learners across ~12 real
// course codes) aggregated into the EXACT processed shapes the three Insight
// boards consume. No SQL, no RPC, no Supabase writes. Selecting /admin/insights
// without ?demo leaves every board on its real RPC path, untouched.
//
// Determinism: a seeded mulberry32 PRNG (NOT Math.random) so the numbers are
// stable across reloads — the same preview every time.
// ============================================================================

import type {
  TreemapData,
  TimeSeriesData,
  CohortGridData,
  StatData,
  TableData,
  Tone,
} from '../spec'
import type { CourseValueData, CourseValueRow } from './courseValue'
import type { RetentionResolverResult } from './retention'
import type { HealthPayload, HealthFailureTrendPoint, HealthVersionStat, HealthDeviceStat } from './health'

// ── Demo flag helper ────────────────────────────────────────────────────────
// True when the URL carries ?demo or ?demo=1 (or any value). Cheap, no caching:
// the boards read it once in their mount path.
export const isInsightDemo = (): boolean => {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).has('demo')
}

// ── Seeded PRNG (mulberry32) — stable across reloads ────────────────────────
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

// One fixed seed for the whole population → one stable preview.
const SEED = 0x5e1ec7ed
const rand = mulberry32(SEED)

/** Uniform float in [min, max). */
function uf(min: number, max: number): number {
  return min + rand() * (max - min)
}
/** Uniform int in [min, max] inclusive. */
function ui(min: number, max: number): number {
  return Math.floor(uf(min, max + 1))
}
/** Weighted pick: returns the index, weights need not be normalised. */
function weightedIndex(weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

// ── Real course codes + display names + Pareto popularity weights ───────────
interface DemoCourse {
  code: string
  name: string
  /** relative popularity weight (Pareto-ish: Spanish/French dominate) */
  weight: number
}

const COURSES: DemoCourse[] = [
  { code: 'spa_for_eng', name: 'Spanish for English speakers', weight: 100 },
  { code: 'fra_for_eng', name: 'French for English speakers',  weight: 72 },
  { code: 'deu_for_eng', name: 'German for English speakers',  weight: 41 },
  { code: 'ita_for_eng', name: 'Italian for English speakers', weight: 34 },
  { code: 'cym_s_for_eng', name: 'Welsh (South) for English speakers', weight: 26 },
  { code: 'nld_for_eng', name: 'Dutch for English speakers',   weight: 18 },
  { code: 'por_for_eng', name: 'Portuguese for English speakers', weight: 15 },
  { code: 'zho_for_eng', name: 'Chinese for English speakers',  weight: 11 },
  { code: 'jpn_for_eng', name: 'Japanese for English speakers', weight: 9 },
  { code: 'kor_for_eng', name: 'Korean for English speakers',   weight: 6 },
  { code: 'gle_for_eng', name: 'Irish for English speakers',    weight: 4 },
  { code: 'eus_for_eng', name: 'Basque for English speakers',   weight: 2 },
]

// Six regions (ISO country codes) with weights — GB/US dominate.
const REGIONS = ['GB', 'US', 'ES', 'FR', 'DE', 'AU'] as const
const REGION_WEIGHTS = [38, 28, 12, 10, 8, 4]

// Device / build mix. One build (an older one) carries an elevated failure rate.
const DEVICES = ['iOS Safari', 'Android Chrome', 'Desktop Chrome', 'Desktop Safari'] as const
const DEVICE_WEIGHTS = [42, 31, 19, 8]

const BUILDS = [
  { sha: 'a1b9f4c2', weight: 64, badAudio: false },  // current — dominant, clean
  { sha: '7e3d018a', weight: 26, badAudio: false },  // prior — clean
  { sha: '4419c0de', weight: 10, badAudio: true },   // older — skewed audio failures
]

const TOTAL_LEARNERS = 500

// 12 signup cohort weeks (oldest → newest), ISO Mondays ending near "today".
function cohortWeeks(count: number): string[] {
  const weeks: string[] = []
  // Anchor on a fixed recent Monday so the preview is stable regardless of run date.
  const anchor = new Date('2026-05-25T00:00:00Z') // a Monday
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(anchor)
    d.setUTCDate(d.getUTCDate() - i * 7)
    weeks.push(d.toISOString().slice(0, 10))
  }
  return weeks
}
const COHORT_WEEKS = cohortWeeks(12)

// ── The population ──────────────────────────────────────────────────────────
interface Learner {
  courseIdx: number
  regionIdx: number
  deviceIdx: number
  buildIdx: number
  cohortIdx: number       // 0..11 (signup week)
  /** total in-app practice hours accumulated */
  hours: number
  /** active in the last 30 days */
  active30d: boolean
  /** returned in the rolling 30d window (retention numerator) */
  returned: boolean
}

function buildPopulation(): Learner[] {
  const courseWeights = COURSES.map((c) => c.weight)
  const learners: Learner[] = []

  for (let i = 0; i < TOTAL_LEARNERS; i++) {
    const courseIdx = weightedIndex(courseWeights)
    const regionIdx = weightedIndex(REGION_WEIGHTS)
    const deviceIdx = weightedIndex(DEVICE_WEIGHTS)
    const buildIdx = weightedIndex(BUILDS.map((b) => b.weight))
    const cohortIdx = ui(0, COHORT_WEEKS.length - 1)

    // Older cohorts have had longer to accumulate hours; minority languages
    // skew slightly lower (smaller, newer communities).
    const ageWeeks = COHORT_WEEKS.length - cohortIdx
    const courseFactor = 0.6 + (COURSES[courseIdx].weight / 100) * 0.8
    const baseHours = uf(0.2, 2.2) * ageWeeks * courseFactor
    const hours = Math.round(baseHours * 10) / 10

    // Retention decays with cohort age but stays realistic. Newer cohorts are
    // "hotter" (recently acquired), older ones settle to a loyal core.
    const retainProb = Math.max(0.12, 0.62 - cohortIdx * 0.02)
    const active30d = rand() < (0.35 + retainProb * 0.5)
    const returned = active30d && rand() < retainProb

    learners.push({
      courseIdx, regionIdx, deviceIdx, buildIdx, cohortIdx,
      hours, active30d, returned,
    })
  }
  return learners
}

const POPULATION = buildPopulation()

// ── Tone helpers (mirror the resolvers so the look matches the real path) ───
function ltvTone(ltv: number, maxLtv: number): Tone {
  if (maxLtv === 0) return 'neutral'
  const r = ltv / maxLtv
  if (r >= 0.6) return 'good'
  if (r >= 0.25) return 'neutral'
  if (r > 0) return 'warn'
  return 'neutral'
}
function failTone(rateFraction: number): Tone {
  if (rateFraction >= 0.05) return 'alarm'
  if (rateFraction >= 0.02) return 'warn'
  return 'good'
}
function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ============================================================================
// demoCourseValue() → CourseValueData  (treemap + rich rows)
// value ≈ reach × stickiness × retention, internally coherent.
// ============================================================================
export function demoCourseValue(): CourseValueData {
  const rows: CourseValueRow[] = COURSES.map((course, idx) => {
    const cohort = POPULATION.filter((l) => l.courseIdx === idx)
    const enrolled = cohort.length
    const reach = cohort.filter((l) => l.active30d).length
    const activeHours = cohort.filter((l) => l.active30d).map((l) => l.hours)
    const stickinessHours = Math.round(median(activeHours) * 10) / 10
    const returned = cohort.filter((l) => l.returned).length
    const retentionPct = reach > 0 ? Math.round((returned / reach) * 1000) / 10 : 0
    const ltvProxy = Math.round(reach * stickinessHours * (retentionPct / 100) * 10) / 10
    return {
      courseCode: course.code,
      reach,
      enrolled,
      stickinessHours,
      retentionPct,
      ltvProxy,
    }
  })

  rows.sort((a, b) => b.ltvProxy - a.ltvProxy)
  const maxLtv = rows[0]?.ltvProxy ?? 0

  const nodes: TreemapData['nodes'] = rows.map((r) => ({
    id: r.courseCode,
    name: r.courseCode,
    value: r.ltvProxy,
    tone: ltvTone(r.ltvProxy, maxLtv),
    muted: r.reach === 0,
  }))

  return { kind: 'treemap', nodes, unit: 'LTV-proxy', rows }
}

// ============================================================================
// demoRetention() → RetentionResolverResult (primary time-series + cohort grid)
// The board reads it as TimeSeriesData; the extra `cohorts` field is inert there.
// ============================================================================
function fmtWeek(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  } catch {
    return iso
  }
}

export function demoRetention(): RetentionResolverResult {
  const x = COHORT_WEEKS.map(fmtWeek)

  // Days-active per week: gently rising then plateauing (engagement maturing).
  const daysPoints: number[] = []
  const w7Points: number[] = []
  const w30Points: number[] = []
  for (let i = 0; i < COHORT_WEEKS.length; i++) {
    const t = i / (COHORT_WEEKS.length - 1)
    const days = 2.1 + t * 1.6 + uf(-0.18, 0.18)
    const w7 = 41 + t * 14 + uf(-3, 3)
    const w30 = 24 + t * 9 + uf(-2.5, 2.5)
    daysPoints.push(Math.round(days * 10) / 10)
    w7Points.push(Math.round(w7 * 10) / 10)
    w30Points.push(Math.round(w30 * 10) / 10)
  }

  const primary: TimeSeriesData = {
    kind: 'time-series',
    x,
    series: [
      { name: 'Days active / week', points: daysPoints, tone: 'neutral' },
      { name: '7-day return %',     points: w7Points,   tone: 'good'    },
      { name: '30-day return %',    points: w30Points,  tone: 'neutral' },
    ],
    yLabel: 'Rate / days',
  }

  // Cohort heatmap: realistic retention decay W1 > W2 > W4 > W8 per cohort week.
  const xLabels = ['W1', 'W2', 'W4', 'W8']
  const yLabels = COHORT_WEEKS.map(fmtWeek)
  const cells: CohortGridData['cells'] = []
  for (let ci = 0; ci < COHORT_WEEKS.length; ci++) {
    const y = fmtWeek(COHORT_WEEKS[ci])
    const w1 = 100
    const w2 = 58 + uf(-6, 6)
    const w4 = 38 + uf(-5, 5)
    const w8 = 24 + uf(-4, 4)
    // Newer cohorts (higher ci) can't have full W8 maturity yet — taper later cols.
    const maturity = ci / (COHORT_WEEKS.length - 1)
    cells.push({ x: 'W1', y, value: Math.round(w1) })
    cells.push({ x: 'W2', y, value: Math.round(w2) })
    cells.push({ x: 'W4', y, value: maturity > 0.66 ? Math.round(w4 * 0.85) : Math.round(w4) })
    cells.push({ x: 'W8', y, value: maturity > 0.4 ? Math.round(w8 * (1 - (maturity - 0.4))) : Math.round(w8) })
  }
  const allVals = cells.map((c) => c.value)
  const cohorts: CohortGridData = {
    kind: 'cohort-grid',
    xLabels,
    yLabels,
    cells,
    min: Math.min(...allVals),
    max: Math.max(...allVals),
    unit: '%',
  }

  return { primary, cohorts }
}

// ============================================================================
// demoGrowthRows() → analytics_growth shape: {period_start, new_users}[]
// 16 weeks of new-learner intake, gently rising with a visible spike.
// ============================================================================
export function demoGrowthRows(): { period_start: string; new_users: number }[] {
  const weeks = cohortWeeks(16)
  return weeks.map((iso, i) => {
    const t = i / (weeks.length - 1)
    let base = 6 + t * 22 + uf(-3, 3)
    // A media-mention spike around week 11.
    if (i === 11) base += 28
    return { period_start: iso, new_users: Math.max(0, Math.round(base)) }
  })
}

// ============================================================================
// demoCourseList() → the dropdown shape ContentFrictionBoard.courseOptions uses.
// { value: course_code, label: 'Display (code)' }
// ============================================================================
export function demoCourseList(): { value: string; label: string }[] {
  return COURSES.map((c) => ({ value: c.code, label: `${c.name} (${c.code})` }))
}

// ============================================================================
// demoFriction(courseCode) → CohortGridData (seed-band × friction-dimension)
// Friction hotspots concentrated on a couple of seed bands per course; the
// hot band is deterministic per course code so reselecting is stable.
// ============================================================================
const SEED_BANDS = ['S1–20', 'S21–40', 'S41–60', 'S61–80', 'S81–100', 'S101+'] as const
const FRICTION_DIMS = ['Drop-off', 'Spike-rate', 'Skip-back', 'Audio-failed'] as const

/** Stable 0..1 hash from a string (so each course has a fixed friction signature). */
function strHash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

export function demoFriction(courseCode: string): CohortGridData {
  const h = strHash01(courseCode)
  // Pick a hot band index (concentrated friction) per course.
  const hotBand = Math.floor(h * SEED_BANDS.length) % SEED_BANDS.length
  const secondBand = (hotBand + 2) % SEED_BANDS.length
  // Audio-failed concentrates on a different band (skewed to one build's content).
  const audioBand = (hotBand + 1) % SEED_BANDS.length

  const cells: CohortGridData['cells'] = []
  for (let di = 0; di < FRICTION_DIMS.length; di++) {
    const dim = FRICTION_DIMS[di]
    for (let bi = 0; bi < SEED_BANDS.length; bi++) {
      let v = uf(4, 28) // background friction
      if (dim === 'Audio-failed') {
        // Low everywhere except its one concentrated band.
        v = bi === audioBand ? uf(60, 92) : uf(0, 14)
      } else {
        if (bi === hotBand) v = uf(72, 100)
        else if (bi === secondBand) v = uf(45, 66)
      }
      cells.push({ x: SEED_BANDS[bi], y: dim, value: Math.round(v) })
    }
  }

  return {
    kind: 'cohort-grid',
    xLabels: [...SEED_BANDS],
    yLabels: [...FRICTION_DIMS],
    cells,
    min: 0,
    max: 100,
    unit: 'friction score (normalised)',
  }
}

// ============================================================================
// demoHealth() → HealthPayload (the processed shape HealthStrip consumes)
// ~3% audio-failure rate overall, skewed to the older build + one device.
// ============================================================================
export function demoHealth(days = 30): HealthPayload {
  // Per-day trend: hovering around ~2.6% with a small bump mid-window.
  const failureTrend: HealthFailureTrendPoint[] = []
  let totalPlays = 0
  let totalFailures = 0
  const today = new Date('2026-06-03T00:00:00Z')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(d.getUTCDate() - i)
    const day = d.toISOString().slice(0, 10)
    const plays = ui(1400, 2600)
    // base ~2.4%, with a bump in the middle third (a bad-build window).
    const mid = i > days * 0.33 && i < days * 0.6
    const rate = (mid ? uf(0.035, 0.052) : uf(0.018, 0.03))
    const failures = Math.round(plays * rate)
    totalPlays += plays
    totalFailures += failures
    failureTrend.push({
      day,
      plays,
      failures,
      failRatePct: Math.round((failures / plays) * 10000) / 100,
    })
  }

  const overallFailRatePct = Math.round((totalFailures / totalPlays) * 10000) / 100

  // Build-SHA spread (learner counts) + per-build fail rate — older build is dirty.
  const activeLearners = POPULATION.filter((l) => l.active30d)
  const learnersByBuild = BUILDS.map(
    (b, bi) => activeLearners.filter((l) => l.buildIdx === bi).length,
  )
  const totalActive = learnersByBuild.reduce((s, n) => s + n, 0) || 1

  const buildShaSpread: HealthVersionStat[] = BUILDS.map((b, bi) => {
    const learners = learnersByBuild[bi]
    const plays = learners * ui(40, 80)
    const rate = b.badAudio ? uf(0.09, 0.13) : uf(0.01, 0.022)
    const failures = Math.round(plays * rate)
    return {
      version: b.sha,
      plays,
      failures,
      failRatePct: Math.round(rate * 10000) / 100,
    }
  })

  // Device spread (learner counts) + per-device fail rate — iOS Safari is worst.
  const learnersByDevice = DEVICES.map(
    (_d, di) => activeLearners.filter((l) => l.deviceIdx === di).length,
  )
  const deviceFailBase = [0.041, 0.026, 0.012, 0.015] // iOS Safari highest
  const deviceSpread: HealthDeviceStat[] = DEVICES.map((device, di) => ({
    device,
    learners: learnersByDevice[di],
    failRatePct: Math.round((deviceFailBase[di] + uf(-0.004, 0.004)) * 10000) / 100,
  }))

  // delta: second half vs first half of the trend (matches the resolver logic).
  let deltaPct = 0
  if (failureTrend.length >= 2) {
    const m = Math.floor(failureTrend.length / 2)
    const avgPct = (rows: HealthFailureTrendPoint[]) => {
      const p = rows.reduce((s, r) => s + r.plays, 0)
      const f = rows.reduce((s, r) => s + r.failures, 0)
      return p > 0 ? (f / p) * 100 : 0
    }
    deltaPct = Math.round((avgPct(failureTrend.slice(m)) - avgPct(failureTrend.slice(0, m))) * 100) / 100
  }

  // Donut: learner-share per build, tone by that build's fail rate.
  const donut: StatData['donut'] = BUILDS.map((b, bi) => ({
    name: b.sha,
    value: Math.round((learnersByBuild[bi] / totalActive) * 1000) / 10,
    tone: failTone(buildShaSpread[bi].failRatePct / 100),
  }))

  const stat: StatData = {
    kind: 'stat',
    label: 'Audio failure rate',
    value: overallFailRatePct,
    unit: '%',
    delta: deltaPct,
    deltaWindow: `${days}d`,
    deltaTone: deltaPct > 0 ? 'alarm' : deltaPct < 0 ? 'good' : 'neutral',
    donut,
  }

  return {
    stat,
    failureTrend,
    buildShaSpread,
    cacheHitRate: 0.91, // warm prefetcher
    deviceSpread,
    totalPlays,
    totalFailures,
    overallFailRatePct,
  }
}

// ============================================================================
// demoDifficultyTurns() → TableData (the B4 curvature sensor, who's struggling /
// just turned). Mirrors the difficultyTurns resolver's EXACT shape so the demo
// and real paths render identically through InsightWidget/Table.vue:
//   columns: learner · unit · signal · z (vs own noise, σ)
//   rows:    { id, tone: 'alarm'|'good', cells: { learner, unit, signal, z } }
//   order:   struggling (alarm) first, then easing (good); within each, |z| desc.
//
// Determinism comes from a board-local fixed-seed PRNG (not the population RNG),
// so the demo turns list is stable across reloads independent of mount order.
// ============================================================================
const DT_COLUMNS: TableData['columns'] = [
  { key: 'learner', label: 'Learner', align: 'left' },
  { key: 'unit', label: 'LEGO', align: 'left' },
  { key: 'signal', label: 'Signal', align: 'left' },
  { key: 'z', label: 'vs own noise (σ)', align: 'right', format: 'number' },
]

const DT_SIGNAL_LABEL: Record<'struggling' | 'easing', string> = {
  struggling: 'Struggling ↑',
  easing: 'Easing ↓',
}

// Named demo learners (synthetic — never a real person).
const DT_LEARNERS = [
  'Amara Okafor', 'Bjørn Halvorsen', 'Carmen Ruiz', 'Dafydd Pugh',
  'Elif Demir', 'Federico Bruno', 'Gráinne Walsh', 'Hana Kobayashi',
  'Idris Mbeki', 'Júlia Costa', 'Kasia Nowak', 'Liam Devlin',
  'Mei Lin', 'Noor Haddad',
] as const

// Plausible LEGO ids (S{seed}L{lego}) — a spread across the early-mid course.
const DT_LEGOS = [
  'S0007L01', 'S0014L02', 'S0021L03', 'S0031L01', 'S0042L02',
  'S0048L04', 'S0055L01', 'S0063L02', 'S0071L03', 'S0084L01',
  'S0096L02', 'S0102L01', 'S0118L03', 'S0127L02',
] as const

export function demoDifficultyTurns(): TableData {
  // Board-local PRNG so this list is stable regardless of other demo calls.
  const dr = mulberry32(0xb4d1ff)

  const STRUGGLING_COUNT = 7  // alarm rows
  const EASING_COUNT = 4      // good rows  → 11 rows total (in the 8–14 band)

  interface Turn { state: 'struggling' | 'easing'; learner: string; unit: string; z: number }
  const turns: Turn[] = []
  const used = new Set<number>()

  function pick<T>(arr: readonly T[]): T {
    // sample without replacement on the learner/lego index space for variety
    let idx = Math.floor(dr() * arr.length)
    let guard = 0
    while (used.has(idx) && guard++ < arr.length) idx = (idx + 1) % arr.length
    used.add(idx)
    return arr[idx]
  }

  for (let i = 0; i < STRUGGLING_COUNT + EASING_COUNT; i++) {
    const state: Turn['state'] = i < STRUGGLING_COUNT ? 'struggling' : 'easing'
    // struggling: latency bending UP past own noise → positive σ (1.6–4.4)
    // easing:     latency settling back DOWN        → negative σ (-3.4 to -1.4)
    const z = state === 'struggling'
      ? Math.round((1.6 + dr() * 2.8) * 10) / 10
      : Math.round((-(1.4 + dr() * 2.0)) * 10) / 10
    turns.push({
      state,
      learner: DT_LEARNERS[i % DT_LEARNERS.length],
      unit: DT_LEGOS[i % DT_LEGOS.length],
      z,
    })
  }

  // Same ordering discipline as the resolver: struggling first, then easing;
  // within each group, biggest |σ| first (the loudest turn at the top).
  const rank: Record<Turn['state'], number> = { struggling: 0, easing: 1 }
  turns.sort((a, b) => (rank[a.state] - rank[b.state]) || (Math.abs(b.z) - Math.abs(a.z)))

  return {
    kind: 'table',
    columns: DT_COLUMNS,
    rows: turns.map((t) => ({
      id: `demo:${t.learner}:${t.unit}`,
      tone: (t.state === 'struggling' ? 'alarm' : 'good') as Tone,
      cells: {
        learner: t.learner,
        unit: t.unit,
        signal: DT_SIGNAL_LABEL[t.state],
        z: t.z,
      },
    })),
  }
}

