<script setup lang="ts">
/**
 * MethodologyView — landing page for the /methodology explainer section.
 *
 * Indexes the available explainer pages, each describing one principle from
 * docs/methodology/metrics-architecture.md and (where data is available)
 * rendering a working visualisation using real anonymised learner data.
 *
 * Status of each page is one of:
 *   - 'live'        — page exists, data is flowing, fully demonstrative.
 *   - 'preview'     — page exists, partial data only.
 *   - 'placeholder' — listed for completeness; build pending data or wiring.
 *
 * This is admin-gated for now. Pages may individually move to public over
 * time — see metrics-architecture.md §9.
 */
import { RouterLink } from 'vue-router'
import FrostCard from '@/components/schools/shared/FrostCard.vue'

type PageStatus = 'live' | 'preview' | 'placeholder'

interface Page {
  to: string
  title: string
  blurb: string
  specRef: string         // section in metrics-architecture.md
  status: PageStatus
}

const pages: Page[] = [
  {
    to: '/methodology/empirical-baseline',
    title: 'Empirical baseline',
    blurb: 'The 30-hour and 100-hour observations as a population histogram, drawn from real learner data. The empirical ground truth that anchors the whole architecture.',
    specRef: '§2',
    status: 'live',
  },
  {
    to: '/methodology/difficulty-execution',
    title: 'Difficulty × Execution',
    blurb: 'The two-axis coordinate every learner inhabits. Difficulty is queryable today; execution is cold-started until VAD opt-in grows. Page will go live once the behavioural execution proxy is implemented.',
    specRef: '§4',
    status: 'placeholder',
  },
  {
    to: '/methodology/self-assessment-calibration',
    title: 'Self-assessment calibration',
    blurb: "Comparing phase-pill click confidence against execution. Reveals overconfident vs underconfident learners — opposite coaching responses. Awaits phase-pill telemetry wiring (Phase 1a).",
    specRef: '§5',
    status: 'placeholder',
  },
  {
    to: '/methodology/no-asr-prosody',
    title: 'No ASR — what prosody actually measures',
    blurb: 'Why SSi refuses speech recognition, and what classical DSP (F0, envelope, formants, tempo) measures instead. Live demo of feature extraction once the prosody pipeline ships.',
    specRef: '§6',
    status: 'placeholder',
  },
  {
    to: '/methodology/lego-mastery',
    title: 'Per-LEGO mastery progression',
    blurb: 'How a single LEGO travels through acquisition → consolidating → confident → mastered. Visualises the spaced-rep + adaptation engine for one learner, one phrase.',
    specRef: '§3 Principle 1 + §8',
    status: 'placeholder',
  },
  {
    to: '/methodology/listening-layers',
    title: 'Listening Layers',
    blurb: 'Layer 1 (reactivation) and Layer 2 (acquisition) listening — the pods system. Port from the popty listening-playground over time.',
    specRef: 'docs/methodology/listening-layers.md',
    status: 'placeholder',
  },
]

function statusLabel(s: PageStatus): string {
  switch (s) {
    case 'live': return 'Live'
    case 'preview': return 'Preview'
    case 'placeholder': return 'Planned'
  }
}
</script>

<template>
  <div class="methodology-landing">
    <header class="page-head">
      <div class="title-block">
        <span class="kicker">Internal methodology</span>
        <h1 class="page-title">How SSi measures learning</h1>
        <p class="page-sub">
          Working visualisations of the principles laid out in the metrics
          architecture spec, using real anonymised learner data. Each page is
          a piece of the spec made answerable: if we can't render it, we
          don't yet understand it.
        </p>
      </div>
    </header>

    <FrostCard variant="panel" class="primer">
      <span class="primer-kicker">Read first</span>
      <p>
        These pages illustrate the design decisions documented in
        <code>docs/methodology/metrics-architecture.md</code>. They are
        scoped to admin users now and may open to learners over time as
        each page becomes a useful public surface in its own right.
      </p>
      <p class="primer-pillars">
        <strong>Two axes</strong> · difficulty × execution.
        <strong>No ASR</strong> · prosody from classical DSP.
        <strong>Discovered, not imposed</strong> · CEFR-like levels emerge
        from the population.
        <strong>Seventeen years</strong> · empirical ground truth, not theory.
        <strong>Self-assessment</strong> · phase-pill clicks as a confidence signal.
      </p>
    </FrostCard>

    <section class="pages-section">
      <header class="section-head">
        <h2 class="section-title">Explainer pages</h2>
        <p class="section-sub">
          One per principle. Live pages use real learner data; placeholders
          are wired but waiting for the data they need.
        </p>
      </header>

      <div class="pages-grid">
        <RouterLink
          v-for="page in pages"
          :key="page.to"
          :to="page.status === 'placeholder' ? '' : page.to"
          :class="['page-card', `is-status-${page.status}`]"
          :tabindex="page.status === 'placeholder' ? -1 : 0"
          :aria-disabled="page.status === 'placeholder'"
        >
          <div class="page-card-head">
            <span class="page-card-spec">{{ page.specRef }}</span>
            <span :class="['page-card-status', `status-${page.status}`]">
              {{ statusLabel(page.status) }}
            </span>
          </div>
          <h3 class="page-card-title">{{ page.title }}</h3>
          <p class="page-card-blurb">{{ page.blurb }}</p>
        </RouterLink>
      </div>
    </section>
  </div>
</template>

<style scoped>
.methodology-landing {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

/* ---------------- Page header ---------------- */
.page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.title-block { display: flex; flex-direction: column; gap: 6px; max-width: 760px; }

.kicker {
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-fg-2, #5a615f);
}

.page-title {
  font-family: 'Arsenal', serif;
  font-size: 36px;
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin: 0;
}

.page-sub {
  margin: 6px 0 0;
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--schools-fg-2, #5a615f);
}

/* ---------------- Read-first primer ---------------- */
.primer { padding: 22px 26px; display: flex; flex-direction: column; gap: 10px; }

.primer-kicker {
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-fg-2, #5a615f);
}

.primer p {
  margin: 0;
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  color: var(--schools-fg, #0F1212);
}

.primer code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
}

.primer-pillars { color: var(--schools-fg-2, #5a615f); font-size: 13.5px; }
.primer-pillars strong { color: var(--schools-fg, #0F1212); font-weight: 600; }

/* ---------------- Pages section ---------------- */
.section-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }

.section-title {
  font-family: 'Arsenal', serif;
  font-size: 22px;
  margin: 0;
  letter-spacing: -0.005em;
}

.section-sub {
  margin: 0;
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 13px;
  color: var(--schools-fg-2, #5a615f);
}

.pages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.page-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px 20px 20px;
  background: #fff;
  border: 1px solid var(--schools-border, #e4e2dc);
  border-radius: 14px;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.page-card:hover {
  transform: translateY(-1px);
  border-color: #c9c6bd;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.04);
}

.page-card.is-status-placeholder {
  cursor: not-allowed;
  opacity: 0.62;
}

.page-card.is-status-placeholder:hover {
  transform: none;
  border-color: var(--schools-border, #e4e2dc);
  box-shadow: none;
}

.page-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }

.page-card-spec {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11.5px;
  color: var(--schools-fg-2, #5a615f);
}

.page-card-status {
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 999px;
}

.status-live    { background: rgba(46, 160, 67, 0.12); color: #1d6a2c; }
.status-preview { background: rgba(254, 201, 2, 0.18); color: #7a5b00; }
.status-placeholder { background: rgba(0, 0, 0, 0.05); color: var(--schools-fg-2, #5a615f); }

.page-card-title {
  font-family: 'Arsenal', serif;
  font-size: 19px;
  margin: 0;
  line-height: 1.2;
}

.page-card-blurb {
  margin: 0;
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--schools-fg-2, #5a615f);
}
</style>
