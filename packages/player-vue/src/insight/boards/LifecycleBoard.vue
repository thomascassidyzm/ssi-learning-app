<script setup lang="ts">
// ============================================================================
// boards/LifecycleBoard.vue — Lens B · "Where is each learner in the journey?"
//
// THE COMPANY QUESTION, as one board: free / paid / at-risk / likely-to-convert
// are segments of a single lifecycle (signed-up → activated → engaged → PAID,
// with the curvature of weekly activity routing free learners into at-risk
// (falling) vs convert-ready (rising)).
//
// Widgets: stat ×4 (the segment headcounts), funnel (the lifecycle), table ×2
// (the at-risk win-back list + the convert-ready upsell list). Every panel
// terminates in a graded, owned action — this is a to-do list, not a mirror.
//
// Seeded synthetic data renders BY DEFAULT (no ?demo): a preview of exactly what
// this surfaces once real learners + Paddle rows arrive. NO hardcoded hex.
// ============================================================================
import { computed } from 'vue'
import InsightWidget from '../InsightWidget.vue'
import type { AnyInsightSpec, ResolvedInsight, StatData, DataQuery } from '../spec'
import {
  lifecycleSegments,
  lifecycleFunnel,
  funnelBiggestLeak,
  lifecycleAtRisk,
  lifecycleConvertReady,
} from '../data/demoLifecycle'

const segs = lifecycleSegments()
const funnel = lifecycleFunnel()
const leak = funnelBiggestLeak()
const atRisk = lifecycleAtRisk()
const convertReady = lifecycleConvertReady()

// ── Helper to wrap data as a (never-loading) ResolvedInsight ─────────────────
function resolved<T>(data: T): ResolvedInsight {
  return { data: data as ResolvedInsight['data'], isLoading: false, error: null }
}

// ── 4 segment stat tiles ─────────────────────────────────────────────────────
function stat(label: string, value: number, delta?: number, deltaWindow?: string, deltaTone?: StatData['deltaTone']): StatData {
  return { kind: 'stat', label, value, unit: '', delta, deltaWindow, deltaTone }
}
const resolvedFree = computed(() => resolved(stat('Free learners', segs.free)))
const resolvedPaid = computed(() => resolved(stat('Paying', segs.paid, segs.paidDelta, 'new this week', 'good')))
const resolvedAtRisk = computed(() => resolved(stat('At risk', segs.atRisk, segs.atRiskDelta, 'newly at-risk', 'alarm')))
const resolvedConvert = computed(() => resolved(stat('Convert-ready', segs.convertReady, segs.convertDelta, 'new this week', 'good')))

const resolvedFunnel = computed(() => resolved(funnel))
const resolvedRiskTable = computed(() => resolved(atRisk))
const resolvedConvertTable = computed(() => resolved(convertReady))

// ── Specs (authored; Lens B · world frame) ───────────────────────────────────
const q = (metric: string): DataQuery => ({ metric, frame: 'world' })

const specFree = computed<AnyInsightSpec>(() => ({
  widget: 'stat', query: q('lifecycle.free'), frame: 'world',
  title: 'How many free learners?', story: 'The top of the funnel — the pool every payer and evangelist comes from.', tag: 'segment · free',
  actions: [{ tier: 'investigate', text: 'Of these, how many are engaged vs dormant? (see convert-ready)', owner: 'growth' }],
}))
const specPaid = computed<AnyInsightSpec>(() => ({
  widget: 'stat', query: q('lifecycle.paid'), frame: 'world',
  title: 'How many paying?', story: 'Revenue. Small today — Paddle is only just live — so every payer counts and every churn hurts.', tag: 'segment · paid',
  actions: [{ tier: 'try', text: 'Watch paid at-risk closely — losing a payer costs more than gaining a free one', owner: 'growth' }],
}))
const specAtRisk = computed<AnyInsightSpec>(() => ({
  widget: 'stat', query: q('lifecycle.atRisk'), frame: 'world',
  title: 'How many at risk?', story: 'Learners whose weekly activity is bending DOWN — the leading alarm. Catch them before they go quiet for good.', tag: 'segment · at-risk',
  actions: [{ tier: 'try', text: 'Trigger a win-back nudge to the at-risk list below', owner: 'marketing' }],
}))
const specConvert = computed<AnyInsightSpec>(() => ({
  widget: 'stat', query: q('lifecycle.convertReady'), frame: 'world',
  title: 'How many ready to convert?', story: 'Free learners practising hard AND still climbing — the warmest upgrade audience you have.', tag: 'segment · convert',
  actions: [{ tier: 'try', text: 'Send the upgrade offer to the convert-ready list below', owner: 'marketing' }],
}))

const specFunnel = computed<AnyInsightSpec>(() => ({
  widget: 'funnel', query: q('lifecycle.funnel'), frame: 'world',
  title: 'Where do learners fall away on the way to paying?',
  story: `Signed up → activated → engaged → paid. The biggest leak is at "${leak.label}" — fix that stage and the whole funnel widens.`,
  tag: 'funnel · lifecycle',
  annotate: [{ at: 'stage', stage: leak.stage, note: 'Biggest drop — the leak to fix first.', tone: 'alarm' }],
  actions: [
    { tier: 'investigate', text: `Open the cohort that dropped at "${leak.label}" and find the common cause`, owner: 'growth' },
    { tier: 'together', text: 'Set one funnel-widening experiment for the leakiest stage this month', owner: 'you+claude' },
  ],
}))

const specRiskTable = computed<AnyInsightSpec>(() => ({
  widget: 'table', query: q('lifecycle.atRisk.list'), frame: 'world',
  title: 'Who is slipping away?',
  story: 'Decelerating learners, paid first (a payer churning costs most). σ is how far their week is below their own normal — the bigger the drop, the more urgent.',
  tag: 'table · win-back',
  actions: [
    { tier: 'try', text: 'Send a personal "we miss you" nudge to the paid rows today', owner: 'marketing' },
    { tier: 'investigate', text: 'If many share a course or seed band, it may be a content cliff, not disengagement', owner: 'popty' },
  ],
}))
const specConvertTable = computed<AnyInsightSpec>(() => ({
  widget: 'table', query: q('lifecycle.convertReady.list'), frame: 'world',
  title: 'Who is ready to pay?',
  story: 'Free learners with high days-active AND a rising trajectory — they\'re getting value and reaching for more. The cleanest upgrade audience there is.',
  tag: 'table · upsell',
  actions: [
    { tier: 'try', text: 'Offer these learners the upgrade at the moment they hit their belt — not generically', owner: 'marketing' },
    { tier: 'together', text: 'Draft a "you\'re flying — go further" upgrade message keyed off rate, not position', owner: 'you+claude' },
  ],
}))
</script>

<template>
  <div class="lc">
    <!-- ── Board header ── -->
    <header class="lc-head">
      <div class="lc-eyebrow">Lens B · Company</div>
      <h1 class="lc-title">Learner lifecycle</h1>
      <p class="lc-sub">
        Free · paid · at-risk · ready-to-convert — segments of one journey. The rate of
        change leads: a learner bending down is at risk before they've gone; a free
        learner bending up is your next payer.
      </p>
    </header>

    <!-- ── Segment headcounts ── -->
    <section class="lc-kpis" aria-label="Lifecycle segments">
      <InsightWidget :spec="specFree" :resolved="resolvedFree" />
      <InsightWidget :spec="specConvert" :resolved="resolvedConvert" />
      <InsightWidget :spec="specPaid" :resolved="resolvedPaid" />
      <InsightWidget :spec="specAtRisk" :resolved="resolvedAtRisk" />
    </section>

    <!-- ── The lifecycle funnel ── -->
    <section class="lc-full" aria-label="Lifecycle funnel">
      <InsightWidget :spec="specFunnel" :resolved="resolvedFunnel" />
    </section>

    <!-- ── The two action lists ── -->
    <section class="lc-split" aria-label="Action lists">
      <InsightWidget :spec="specConvertTable" :resolved="resolvedConvertTable" />
      <InsightWidget :spec="specRiskTable" :resolved="resolvedRiskTable" />
    </section>

    <p class="lc-preview-note">
      Seeded synthetic cohort — a live preview of what this surfaces once learners + Paddle rows arrive.
    </p>
  </div>
</template>

<style scoped>
.lc {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding: 32px 28px 48px;
  max-width: 1280px;
  margin: 0 auto;
  font-family: var(--font-mono);
}
.lc-head {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(44, 38, 34, 0.10);
}
.lc-eyebrow {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.lc-title {
  font-family: var(--font-display);
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--ink-primary);
  margin: 0;
}
.lc-sub {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--ink-secondary);
  margin: 0;
  line-height: 1.5;
  max-width: 64rem;
}

/* 4 segment tiles */
.lc-kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}
.lc-full { display: grid; grid-template-columns: 1fr; }

/* convert-ready + at-risk side by side */
.lc-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}

.lc-preview-note {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--ink-faint);
  margin: 0;
  text-align: center;
}

@media (max-width: 1000px) {
  .lc-kpis { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 900px) {
  .lc { padding: 20px 16px 36px; gap: 18px; }
  .lc-split { grid-template-columns: 1fr; }
}
</style>
