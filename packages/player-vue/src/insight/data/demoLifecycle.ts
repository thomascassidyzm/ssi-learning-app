// ============================================================================
// DEMO — the LEARNER LIFECYCLE board (LifecycleBoard.vue). A front-end-only
// synthetic population aggregated into the shapes the board's widgets consume.
// No SQL/RPC/Supabase. Seeded (mulberry32) so the preview is stable.
//
// THE COMPANY QUESTION: free / paid / at-risk / likely-to-convert. These aren't
// four dashboards — they're SEGMENTS of one learner lifecycle:
//   signed-up → activated → engaged (free) → PAID
//                     │            │
//                     │            ├─ rising curvature  → LIKELY TO CONVERT
//                     └─ falling curvature ───────────── → AT RISK
//
// Per Measuring Progress: the curvature (acceleration) of weekly activity is the
// LEADING ALARM — a learner bending DOWN is at risk a week before they've gone;
// a free learner bending UP and still climbing is the convert candidate.
//
// When real learners + Paddle rows arrive, a resolver replaces these generators
// with the same shapes — the board doesn't change.
// ============================================================================

import type { FunnelData, TableData, Tone } from '../spec'

// ── Seeded PRNG (mulberry32) — mirrors demo.ts ──────────────────────────────
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
const SEED = 0x11fec9c1
const rand = mulberry32(SEED)
const ui = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1))
const uf = (min: number, max: number) => min + rand() * (max - min)
const round = (v: number, dp = 1) => { const f = 10 ** dp; return Math.round(v * f) / f }

// ── Course + learner naming (schools-flavoured, synthetic — never real) ──────
const COURSES = [
  'spa_for_eng', 'fra_for_eng', 'deu_for_eng', 'ita_for_eng',
  'cym_s_for_eng', 'por_for_eng', 'nld_for_eng', 'gle_for_eng',
]
const COURSE_WEIGHTS = [100, 70, 40, 33, 26, 15, 14, 6]
const FIRST = ['Amara', 'Bjørn', 'Carmen', 'Dafydd', 'Elif', 'Federico', 'Gráinne', 'Hana', 'Idris', 'Júlia', 'Kasia', 'Liam', 'Mei', 'Noor', 'Owain', 'Priya', 'Quentin', 'Rhian', 'Sofia', 'Tomas', 'Una', 'Vikram', 'Wen', 'Yusuf', 'Zara']
const LAST = ['Okafor', 'Halvorsen', 'Ruiz', 'Pugh', 'Demir', 'Bruno', 'Walsh', 'Kobayashi', 'Mbeki', 'Costa', 'Nowak', 'Devlin', 'Lin', 'Haddad', 'Pryce', 'Sharma', 'Dubois', 'Evans', 'Marín', 'Novak', 'Ferns', 'Rao', 'Chen', 'Aydın', 'Khan']

function weightedIndex(weights: number[]): number {
  const total = weights.reduce((s, w) => s + w, 0)
  let r = rand() * total
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i }
  return weights.length - 1
}

// ── Lifecycle segment ────────────────────────────────────────────────────────
export type Segment = 'paid' | 'convertReady' | 'atRisk' | 'engagedFree' | 'casualFree' | 'lapsed'

interface Learner {
  name: string
  course: string
  paid: boolean
  daysActive: number     // current week's days-active (0..7) — 0 = gone quiet
  curvature: number      // σ vs own noise: + rising, − decelerating (the leading alarm)
  weeksActive: number    // tenure
  furthestSeed: number   // progress (position context)
  lastActiveDays: number // days since last session
  segment: Segment
}

const TOTAL = 512

function buildPopulation(): Learner[] {
  const out: Learner[] = []
  for (let i = 0; i < TOTAL; i++) {
    const course = COURSES[weightedIndex(COURSE_WEIGHTS)]
    const name = `${FIRST[ui(0, FIRST.length - 1)]} ${LAST[ui(0, LAST.length - 1)]}`
    const weeksActive = ui(1, 16)
    const furthestSeed = Math.max(1, Math.round(weeksActive * uf(2, 9)))

    // ~7.5% convert to paid (a believable early funnel); paid skew to engaged.
    const paid = rand() < 0.075
    // Current activity + its curvature (the trajectory). Paid + convert-ready
    // skew positive; at-risk skews sharply negative.
    const roll = rand()
    let daysActive: number
    let curvature: number
    if (paid) {
      daysActive = ui(2, 6)
      curvature = round(uf(-1.2, 1.8), 1) // mostly fine; a few paid decelerating = churn risk
    } else if (roll < 0.14) {
      // rising free engager — the convert candidate
      daysActive = ui(4, 7)
      curvature = round(uf(0.9, 3.2), 1)
    } else if (roll < 0.26) {
      // decelerating — the at-risk
      daysActive = ui(0, 3)
      curvature = round(uf(-3.4, -1.2), 1)
    } else if (roll < 0.5) {
      daysActive = ui(2, 5)
      curvature = round(uf(-0.6, 0.8), 1) // engaged-steady free
    } else {
      daysActive = ui(0, 2)
      curvature = round(uf(-0.8, 0.4), 1) // casual / dormant free
    }

    const lastActiveDays = daysActive >= 3 ? ui(0, 2) : daysActive >= 1 ? ui(2, 8) : ui(9, 40)

    // Segment assignment.
    let segment: Segment
    if (paid) segment = 'paid'
    else if (lastActiveDays > 21) segment = 'lapsed'
    else if (curvature <= -1.2 && daysActive <= 3) segment = 'atRisk'
    else if (curvature >= 0.9 && daysActive >= 4) segment = 'convertReady'
    else if (daysActive >= 2) segment = 'engagedFree'
    else segment = 'casualFree'

    out.push({ name, course, paid, daysActive, curvature, weeksActive, furthestSeed, lastActiveDays, segment })
  }
  return out
}

const POP = buildPopulation()
const count = (pred: (l: Learner) => boolean) => POP.filter(pred).length

// ── Headline segment counts (+ a curvature-style delta for each tile) ────────
export interface LifecycleSegments {
  total: number
  free: number
  paid: number
  atRisk: number
  convertReady: number
  // last-week deltas (illustrative trend so the tiles carry a read)
  paidDelta: number
  atRiskDelta: number
  convertDelta: number
}

export function lifecycleSegments(): LifecycleSegments {
  const paid = count((l) => l.paid)
  const atRisk = count((l) => l.segment === 'atRisk') + count((l) => l.paid && l.curvature <= -1.2)
  const convertReady = count((l) => l.segment === 'convertReady')
  return {
    total: POP.length,
    free: POP.length - paid,
    paid,
    atRisk,
    convertReady,
    paidDelta: 4,        // +4 new payers this week
    atRiskDelta: 7,      // +7 newly at-risk (alarm)
    convertDelta: 5,     // +5 newly convert-ready
  }
}

// ── The lifecycle funnel: signed-up → activated → engaged → paid ─────────────
export function lifecycleFunnel(): FunnelData {
  const signedUp = POP.length
  const activated = count((l) => l.furthestSeed >= 3)            // got past the first seeds
  const engaged = count((l) => l.daysActive >= 2 && l.lastActiveDays <= 14) // returning
  const paid = count((l) => l.paid)
  return {
    kind: 'funnel',
    stages: [
      { id: 'signed_up', label: 'Signed up', value: signedUp, tone: 'neutral' },
      { id: 'activated', label: 'Activated (past first seeds)', value: activated, tone: 'neutral' },
      { id: 'engaged', label: 'Engaged (returning)', value: engaged, tone: 'good' },
      { id: 'paid', label: 'Paid', value: paid, tone: 'good' },
    ],
  }
}

// Where the biggest proportional drop is (for the funnel annotation).
export function funnelBiggestLeak(): { stage: string; label: string } {
  const f = lifecycleFunnel().stages
  let worst = { stage: f[1].id, label: f[1].label, drop: 0 }
  for (let i = 1; i < f.length; i++) {
    const prev = f[i - 1].value || 1
    const drop = 1 - f[i].value / prev
    if (drop > worst.drop) worst = { stage: f[i].id, label: f[i].label, drop }
  }
  return { stage: worst.stage, label: worst.label }
}

// ── AT RISK: decelerating learners (paid first = churn risk), worst σ on top ─
const RISK_COLS: TableData['columns'] = [
  { key: 'learner', label: 'Learner', align: 'left' },
  { key: 'course', label: 'Course', align: 'left' },
  { key: 'tier', label: 'Tier', align: 'left' },
  { key: 'trend', label: 'Weekly activity (σ vs own)', align: 'left' },
  { key: 'last', label: 'Last active', align: 'right', format: 'text' },
]

function lastActiveLabel(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days}d ago`
  return `${Math.round(days / 7)}w ago`
}

export function lifecycleAtRisk(limit = 10): TableData {
  const risky = POP
    .filter((l) => l.curvature <= -1.2 && (l.paid || l.daysActive <= 3))
    .sort((a, b) => (Number(b.paid) - Number(a.paid)) || (a.curvature - b.curvature))
    .slice(0, limit)
  return {
    kind: 'table',
    columns: RISK_COLS,
    rows: risky.map((l, i) => ({
      id: `risk:${i}`,
      tone: (l.paid ? 'alarm' : 'warn') as Tone,
      cells: {
        learner: l.name,
        course: l.course,
        tier: l.paid ? 'Paid' : 'Free',
        trend: `▼ ${l.curvature.toFixed(1)}σ`,
        last: lastActiveLabel(l.lastActiveDays),
      },
    })),
  }
}

// ── LIKELY TO CONVERT: free + high activity + rising, hottest first ──────────
const CONVERT_COLS: TableData['columns'] = [
  { key: 'learner', label: 'Learner', align: 'left' },
  { key: 'course', label: 'Course', align: 'left' },
  { key: 'days', label: 'Days active / wk', align: 'right', format: 'number' },
  { key: 'trend', label: 'Trajectory (σ)', align: 'left' },
  { key: 'pos', label: 'Furthest LEGO', align: 'right', format: 'text' },
]

export function lifecycleConvertReady(limit = 10): TableData {
  const hot = POP
    .filter((l) => !l.paid && l.curvature >= 0.9 && l.daysActive >= 4)
    .sort((a, b) => (b.daysActive - a.daysActive) || (b.curvature - a.curvature))
    .slice(0, limit)
  return {
    kind: 'table',
    columns: CONVERT_COLS,
    rows: hot.map((l, i) => ({
      id: `conv:${i}`,
      tone: 'good' as Tone,
      cells: {
        learner: l.name,
        course: l.course,
        days: l.daysActive,
        trend: `▲ +${l.curvature.toFixed(1)}σ`,
        pos: `S${String(l.furthestSeed).padStart(4, '0')}`,
      },
    })),
  }
}
