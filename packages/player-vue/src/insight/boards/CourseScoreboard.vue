<script setup lang="ts">
// ============================================================================
// boards/CourseScoreboard.vue — Lens B · "Which courses are doing well?"
//
// Widgets: stat (x2 KPI header), treemap (course value), ranked-bar (lifetime
//          hours), time-series (new learners per week)
// Metrics: courseValue, retention
// Frame:   'world' / 'content'  (Lens B — company view)
//
// Mount contract:
//   1. Resolve courseValue metric → CourseValueData (treemap + rich rows)
//   2. Resolve retention metric  → TimeSeriesData (wraps RetentionResolverResult)
//   3. Call analytics_growth RPC for new-learners-per-week time-series
//   4. Compose InsightSpec literals (story + actions + annotate authored here,
//      no LLM call)
//   5. Render via <InsightWidget :spec :resolved> — the wrapper owns chrome
//
// NO hardcoded hex. NO Supabase writes. NEVER throws from template (all empty
// guards live in the resolvers).
// ============================================================================

import { ref, computed, onMounted } from 'vue'
import InsightWidget from '../InsightWidget.vue'
import { resolveMetric } from '../registry'
import { useAdminClient } from '@/composables/useAdminClient'
import type {
  AnyInsightSpec,
  ResolvedInsight,
  StatData,
  RankedBarData,
  TimeSeriesData,
  TreemapData,
  DataQuery,
} from '../spec'
import type { CourseValueData } from '../data/courseValue'
import { isInsightDemo, demoCourseValue, demoRetention, demoGrowthRows } from '../data/demo'

// ── Supabase client ─────────────────────────────────────────────────────────
const { getClient } = useAdminClient()

// ── Loading/error state ──────────────────────────────────────────────────────
const isLoading = ref(true)
const loadError = ref<string | null>(null)

// ── Raw resolved data ────────────────────────────────────────────────────────
const courseValueData = ref<CourseValueData | null>(null)
const retentionTsData = ref<TimeSeriesData | null>(null)
const growthRows = ref<{ period_start: string; new_users: number }[]>([])

// ── ResolvedInsight builders — always well-formed (never throws) ─────────────

// Stat 1: total active learners (reach sum from courseValue)
const resolvedStat1 = computed<ResolvedInsight>(() => {
  if (isLoading.value) return { data: zeroStat('Total active learners'), isLoading: true, error: null }
  if (loadError.value) return { data: zeroStat('Total active learners'), isLoading: false, error: loadError.value }

  const rows = courseValueData.value?.rows ?? []
  const totalActive = rows.reduce((s, r) => s + r.reach, 0)
  const totalEnrolled = rows.reduce((s, r) => s + r.enrolled, 0)

  const data: StatData = {
    kind: 'stat',
    label: 'Active learners (last 30 d)',
    value: totalActive,
    unit: '',
    delta: totalEnrolled > 0 ? Math.round((totalActive / totalEnrolled) * 100) : 0,
    deltaWindow: '% of enrolled',
    deltaTone: totalActive > 0 ? 'good' : 'neutral',
  }
  return { data, isLoading: false, error: null }
})

// Stat 2: new learners this month (from growth rows, latest period)
const resolvedStat2 = computed<ResolvedInsight>(() => {
  if (isLoading.value) return { data: zeroStat('New this month'), isLoading: true, error: null }
  if (loadError.value) return { data: zeroStat('New this month'), isLoading: false, error: loadError.value }

  const rows = growthRows.value
  // Sum new_users across weeks that fall in the current calendar month
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const newThisMonth = rows
    .filter(r => r.period_start?.startsWith(thisMonth))
    .reduce((s, r) => s + (Number(r.new_users) || 0), 0)

  // Prior month comparison (delta)
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`
  const newLastMonth = rows
    .filter(r => r.period_start?.startsWith(lastMonth))
    .reduce((s, r) => s + (Number(r.new_users) || 0), 0)

  const delta = newLastMonth > 0 ? newThisMonth - newLastMonth : undefined

  const data: StatData = {
    kind: 'stat',
    label: 'New learners this month',
    value: newThisMonth,
    unit: '',
    delta,
    deltaWindow: 'vs last month',
    deltaTone: delta != null && delta > 0 ? 'good' : delta != null && delta < 0 ? 'warn' : 'neutral',
  }
  return { data, isLoading: false, error: null }
})

// Treemap: course value (LTV-proxy, sized by reach × stickiness × retention)
const resolvedTreemap = computed<ResolvedInsight>(() => {
  if (isLoading.value) return { data: { kind: 'treemap', nodes: [] } as TreemapData, isLoading: true, error: null }
  if (loadError.value) return { data: { kind: 'treemap', nodes: [] } as TreemapData, isLoading: false, error: loadError.value }
  const data: TreemapData = courseValueData.value ?? { kind: 'treemap', nodes: [], unit: 'LTV-proxy' }
  return { data, isLoading: false, error: null }
})

// RankedBar: courses by lifetime hours (enrolled × median stickiness hours)
const resolvedRankedBar = computed<ResolvedInsight>(() => {
  if (isLoading.value) return { data: { kind: 'ranked-bar', bars: [] } as RankedBarData, isLoading: true, error: null }
  if (loadError.value) return { data: { kind: 'ranked-bar', bars: [] } as RankedBarData, isLoading: false, error: loadError.value }

  const rows = courseValueData.value?.rows ?? []
  const bars = rows.map(r => ({
    id: r.courseCode,
    label: r.courseCode,
    // Total learner-hours = enrolled × median stickiness hours per learner
    value: Math.round(r.enrolled * r.stickinessHours * 10) / 10,
    tone: r.ltvProxy > 0 ? (r.ltvProxy >= (courseValueData.value?.rows[0]?.ltvProxy ?? 0) * 0.6 ? 'good' as const : 'neutral' as const) : 'neutral' as const,
    muted: r.reach === 0,
  }))

  const data: RankedBarData = {
    kind: 'ranked-bar',
    bars,
    unit: 'hrs',
    horizontal: true,
  }
  return { data, isLoading: false, error: null }
})

// TimeSeries: new learners per week (from analytics_growth)
const resolvedTimeSeries = computed<ResolvedInsight>(() => {
  if (isLoading.value) return {
    data: { kind: 'time-series', x: [], series: [], yLabel: 'New learners' } as TimeSeriesData,
    isLoading: true,
    error: null,
  }
  if (loadError.value) return {
    data: { kind: 'time-series', x: [], series: [], yLabel: 'New learners' } as TimeSeriesData,
    isLoading: false,
    error: loadError.value,
  }

  const rows = growthRows.value.slice().sort((a, b) =>
    a.period_start.localeCompare(b.period_start),
  )

  // Format ISO date to "06 Jan"
  const fmt = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    } catch { return iso }
  }

  const x = rows.map(r => fmt(r.period_start))
  const points = rows.map(r => Number(r.new_users) || 0)

  const data: TimeSeriesData = {
    kind: 'time-series',
    x,
    series: [{ name: 'New learners / week', points, tone: 'neutral' }],
    yLabel: 'New learners',
  }
  return { data, isLoading: false, error: null }
})

// ── Spec literals (authored; no LLM call) ────────────────────────────────────

// The top-value course for annotation (computed from courseValueData)
const topCourse = computed(() => courseValueData.value?.rows[0]?.courseCode ?? '')
const topCourseHours = computed(() => {
  const rows = courseValueData.value?.rows ?? []
  if (!rows.length) return 0
  return Math.round(rows[0].enrolled * rows[0].stickinessHours)
})

// Stat 1 spec
const specStat1 = computed<AnyInsightSpec>(() => ({
  widget: 'stat',
  query: { metric: 'courseValue', frame: 'world' } as DataQuery,
  frame: 'world',
  title: 'How many learners are active right now?',
  story: 'Reach across all courses in the last 30 days — the denominator every other number here rides on.',
  tag: 'stat · active',
  actions: [
    {
      tier: 'try',
      text: 'Check whether this is growing week-on-week',
      owner: 'you',
    },
    {
      tier: 'investigate',
      text: 'If active / enrolled ratio is below 25%, triage inactive courses',
      owner: 'popty',
    },
  ],
}))

// Stat 2 spec
const specStat2 = computed<AnyInsightSpec>(() => {
  const delta = (resolvedStat2.value.data as StatData).delta
  const isUp = delta != null && delta > 0
  return {
    widget: 'stat',
    query: { metric: 'retention', frame: 'world' } as DataQuery,
    frame: 'world',
    title: 'How many new learners joined this month?',
    story: isUp
      ? 'New-learner intake is ahead of last month — growth is compounding.'
      : 'New-learner intake is flat or falling — worth reviewing acquisition channels.',
    tag: 'stat · new',
    annotate: delta != null && Math.abs(delta) > 5
      ? [{
          at: 'datum' as const,
          key: 'New learners this month',
          note: isUp ? 'Intake is ahead of last month.' : 'Intake is behind last month.',
          tone: isUp ? 'good' as const : 'warn' as const,
        }]
      : [],
    actions: [
      {
        tier: 'try',
        text: 'Share the new-learner count with the growth team weekly',
        owner: 'marketing',
      },
      {
        tier: 'investigate',
        text: 'Cross-reference with the time-series below to spot the source week',
        owner: 'you',
      },
    ],
  }
})

// Treemap spec
const specTreemap = computed<AnyInsightSpec>(() => ({
  widget: 'treemap',
  query: { metric: 'courseValue', frame: 'content' } as DataQuery,
  frame: 'content',
  title: 'Which courses generate the most learner value?',
  story: 'Tile area = LTV-proxy (reach × stickiness × retention). Bigger and greener = more value per enrolled learner.',
  tag: 'treemap · LTV',
  annotate: topCourse.value
    ? [{
        at: 'datum' as const,
        key: topCourse.value,
        note: `${topCourse.value} leads — highest composite score.`,
        tone: 'good' as const,
      }]
    : [],
  actions: [
    {
      tier: 'try',
      text: 'Share the top course\'s approach with teams building lower-value courses',
      owner: 'popty',
    },
    {
      tier: 'investigate',
      text: 'Muted tiles (grey) = courses with zero recent activity — audit or archive',
      owner: 'you',
    },
    {
      tier: 'together',
      text: 'Reweight content investment toward high-LTV courses',
      owner: 'popty',
    },
  ],
}))

// RankedBar spec
const specRankedBar = computed<AnyInsightSpec>(() => ({
  widget: 'ranked-bar',
  query: { metric: 'courseValue', frame: 'content' } as DataQuery,
  frame: 'content',
  title: 'Which courses have accumulated the most learner-hours?',
  story: 'Enrolled × median stickiness hours. High bars mean learners stay and practise — the real signal of a healthy course.',
  tag: 'ranked-bar · hours',
  annotate: topCourse.value
    ? [{
        at: 'datum' as const,
        key: topCourse.value,
        note: `${topCourse.value}: ~${topCourseHours.value} total learner-hours accumulated.`,
        tone: 'good' as const,
      }]
    : [],
  actions: [
    {
      tier: 'try',
      text: 'Use this as a proxy for content maturity — mature courses deserve more pod investment',
      owner: 'popty',
    },
    {
      tier: 'investigate',
      text: 'Low-bar courses with large enrolments are stalling learners — check friction map',
      owner: 'you',
    },
    {
      tier: 'together',
      text: 'Identify the first 10-hour course and use it as a case study for onboarding',
      owner: 'you+claude',
    },
  ],
}))

// TimeSeries spec
const specTimeSeries = computed<AnyInsightSpec>(() => {
  // Find the week with the most new learners for annotation
  const rows = growthRows.value.slice().sort((a, b) =>
    a.period_start.localeCompare(b.period_start),
  )
  const peakRow = rows.reduce<typeof rows[number] | null>((best, r) =>
    best == null || r.new_users > best.new_users ? r : best, null)
  const fmt = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    } catch { return iso }
  }
  const peakLabel = peakRow ? fmt(peakRow.period_start) : ''
  const peakCount = peakRow ? Number(peakRow.new_users) : 0

  return {
    widget: 'time-series',
    query: { metric: 'retention', frame: 'world', window: '12w' } as DataQuery,
    frame: 'world',
    title: 'Are new learners arriving week on week?',
    story: 'Weekly new-learner intake. A rising line here is the clearest leading indicator of platform growth.',
    tag: 'time-series · growth',
    annotate: peakLabel && peakCount > 0
      ? [{
          at: 'point' as const,
          series: 'New learners / week',
          x: peakLabel,
          note: `Peak: ${peakCount} new learners in one week.`,
          tone: 'good' as const,
        }]
      : [],
    actions: [
      {
        tier: 'try',
        text: 'Note which weeks spike — correlate with outreach or media mentions',
        owner: 'marketing',
      },
      {
        tier: 'investigate',
        text: 'Flat lines here mean acquisition is stalled — revisit referral and community channels',
        owner: 'growth',
      },
      {
        tier: 'together',
        text: 'Set a weekly new-learner target and make this chart the team\'s north star',
        owner: 'you+claude',
      },
    ],
  }
})

// ── Helper: zero StatData so loading/error slots have a well-formed shape ────
function zeroStat(label: string): StatData {
  return { kind: 'stat', label, value: 0, unit: '' }
}

// ── Data fetch on mount ──────────────────────────────────────────────────────
onMounted(async () => {
  // ── DEMO MODE (?demo): populate the same refs from in-memory synthetic data.
  // Never calls Supabase. Real path below is untouched without the flag.
  if (isInsightDemo()) {
    courseValueData.value = demoCourseValue()
    retentionTsData.value = demoRetention() as unknown as TimeSeriesData
    growthRows.value = demoGrowthRows()
    isLoading.value = false
    return
  }

  try {
    const client = getClient()

    const [cvResult, retResult, growthResult] = await Promise.allSettled([
      resolveMetric(client, { metric: 'courseValue', frame: 'content' }),
      resolveMetric(client, { metric: 'retention', frame: 'world', window: '12w' }),
      client.rpc('analytics_growth', { p_period: 'week', p_count: 16 }),
    ])

    if (cvResult.status === 'fulfilled') {
      courseValueData.value = cvResult.value as CourseValueData
    } else {
      console.warn('[CourseScoreboard] courseValue failed:', cvResult.reason)
    }

    if (retResult.status === 'fulfilled') {
      retentionTsData.value = retResult.value as TimeSeriesData
    } else {
      console.warn('[CourseScoreboard] retention failed:', retResult.reason)
    }

    if (growthResult.status === 'fulfilled') {
      const { data, error: growthErr } = growthResult.value as { data: unknown; error: unknown }
      if (!growthErr && Array.isArray(data)) {
        growthRows.value = data as { period_start: string; new_users: number }[]
      } else if (growthErr) {
        console.warn('[CourseScoreboard] analytics_growth RPC error:', growthErr)
      }
    } else {
      console.warn('[CourseScoreboard] analytics_growth threw:', growthResult.reason)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    loadError.value = msg
    console.error('[CourseScoreboard] mount error:', e)
  } finally {
    isLoading.value = false
  }
})

// ── Drillable: course click re-scopes to a single course ─────────────────────
function onDrill(payload: { query: { metric: string; entityId?: string } }) {
  // Phase 4 will wire this to a narrowed board; for now emit is sufficient.
  console.log('[CourseScoreboard] drill ->', payload.query)
}
</script>

<template>
  <div class="scoreboard">
    <!-- ── Board header ── -->
    <header class="scoreboard-head">
      <div class="scoreboard-eyebrow">Lens B · Company</div>
      <h1 class="scoreboard-title">Course Scoreboard</h1>
      <p class="scoreboard-sub">Which courses are creating real learner value, and where is growth coming from?</p>
    </header>

    <!-- ── KPI stat row ── -->
    <section class="scoreboard-kpis" aria-label="Key performance indicators">
      <InsightWidget
        :spec="specStat1"
        :resolved="resolvedStat1"
        @drill="onDrill"
      />
      <InsightWidget
        :spec="specStat2"
        :resolved="resolvedStat2"
        @drill="onDrill"
      />
    </section>

    <!-- ── Course value treemap (full width) ── -->
    <section class="scoreboard-full" aria-label="Course value map">
      <InsightWidget
        :spec="specTreemap"
        :resolved="resolvedTreemap"
        @drill="onDrill"
      />
    </section>

    <!-- ── Ranked bar + time-series (side-by-side on desktop) ── -->
    <section class="scoreboard-split" aria-label="Hours and growth">
      <InsightWidget
        :spec="specRankedBar"
        :resolved="resolvedRankedBar"
        @drill="onDrill"
      />
      <InsightWidget
        :spec="specTimeSeries"
        :resolved="resolvedTimeSeries"
        @drill="onDrill"
      />
    </section>
  </div>
</template>

<style scoped>
/* ── Board shell ── */
.scoreboard {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 32px 28px 48px;
  max-width: 1280px;
  margin: 0 auto;
  font-family: var(--font-mono);
}

/* ── Board header ── */
.scoreboard-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.10);
}

.scoreboard-eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--ink-muted);
}

.scoreboard-title {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 0;
}

.scoreboard-sub {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-secondary);
  margin: 0;
  line-height: 1.5;
}

/* ── KPI pair — two equal-width stat cards ── */
.scoreboard-kpis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

/* ── Full-width treemap ── */
.scoreboard-full {
  display: grid;
  grid-template-columns: 1fr;
}

/* ── Split: ranked-bar (narrower) + time-series (wider) ── */
.scoreboard-split {
  display: grid;
  grid-template-columns: 5fr 7fr;
  gap: 20px;
  align-items: start;
}

/* ── Responsive: stack everything on narrower admin panes ── */
@media (max-width: 900px) {
  .scoreboard {
    padding: 20px 16px 36px;
    gap: 18px;
  }

  .scoreboard-kpis {
    grid-template-columns: 1fr;
  }

  .scoreboard-split {
    grid-template-columns: 1fr;
  }
}
</style>
