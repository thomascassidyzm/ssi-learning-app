<script setup lang="ts">
/**
 * AdminMethodology — "Measuring progress" landing.
 *
 * A small, growable home for methodology papers and interactive demos that
 * explain what the dashboards measure and why. Entries open self-contained
 * HTML pages served from /public/docs (outside the SPA), so they're plain
 * links with target=_blank rather than router views.
 */

interface Paper {
  title: string
  blurb: string
  href: string
  tag: string
  status: string
}

const papers: Paper[] = [
  {
    title: 'Measuring progress',
    blurb:
      'Metrics & adaptation — the model behind the dashboards: rate-of-change as the signal, contextual difficulty and the consolidate / defer / drill budget, the sovereign comparison model (entity vs aggregate, never a named peer), the two clocks, and CEFR as a pilot-coupled best-fit. Three live figures; built to be argued with.',
    href: '/docs/metrics-vision.html',
    tag: 'Interactive · position paper',
    status: 'Draft — for discussion',
  },
  {
    title: 'The Insight Engine',
    blurb:
      'For the first time we can both capture the data and interrogate it — neither was possible before. An engine where a new insight is a composition, not a project: a semantic substrate, a plain-language query surface, and Claude as the analyst-in-the-box (explain + discover). It reads the Measuring Progress model rather than competing with it, and is future-proof for VAD. One live figure; built to be argued with.',
    href: '/docs/insight-engine.html',
    tag: 'Interactive · position paper',
    status: 'Draft — for discussion',
  },
  {
    title: 'Example insights',
    blurb:
      'Eight visually distinct widgets the engine would produce — value treemap, conversion funnel, curriculum-friction heatmap, course-flow Sankey, the difficulty×execution scatter, a build-health donut, a Discover card, and the entity-standing celebration — rendered with realistic SSi data, charted with ECharts and themed to the house palette. Each is a mock-up of a Claude-emitted spec: a question, a configured widget, and what you could do about it.',
    href: '/docs/insight-examples.html',
    tag: 'Interactive · gallery',
    status: 'Mock-up — for discussion',
  },
  {
    title: 'The Listening Pod',
    blurb:
      'How Layer 2 acquisition works: a scene-based conversation that fades its own scaffolding sentence by sentence. The stage-through (breakdown → translation → 2× → eternal hold), the chunking-vs-explainer choice, and the lap that grows as you go. Three live figures; the open question for Aran is the granularity.',
    href: '/docs/pod-methodology.html',
    tag: 'Interactive · position paper',
    status: 'Draft — for discussion',
  },
  {
    title: 'Anyone Can Teach',
    blurb:
      'The claim that a self-sequencing, self-pacing, self-assessing engine lets the human teaching role decompose into presence, psychological safety, and alongsideness — independent of subject expertise. Sri Lanka 2023, the honest 30/100-hour update, the class as a first-class learner, and Zenjin as the second instance.',
    href: '/methodology/anyone-can-teach.html',
    tag: 'Working paper',
    status: 'Draft — for Tom\'s edit',
  },
]
</script>

<template>
  <div class="admin-methodology">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Methodology</span>
        <h1 class="arsenal">Open discussions</h1>
        <p class="subtitle">
          Components of the SSi methodology, worked through in the open between Tom and
          Aran — papers and interactive demos, drafts built to be argued with. Each card
          is a self-contained piece, not a single doctrine.
        </p>
      </div>
    </header>

    <div class="paper-grid">
      <a
        v-for="p in papers"
        :key="p.href"
        :href="p.href"
        target="_blank"
        rel="noopener"
        class="schools-card paper-card"
      >
        <div class="paper-head">
          <span class="paper-tag">{{ p.tag }}</span>
          <span class="paper-status">{{ p.status }}</span>
        </div>
        <h2 class="arsenal paper-title">{{ p.title }}</h2>
        <p class="paper-blurb">{{ p.blurb }}</p>
        <span class="paper-cta">
          Open
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" />
          </svg>
        </span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.admin-methodology { max-width: 1100px; }

.page-header { margin-bottom: 28px; }
.schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.page-header h1 {
  font-size: clamp(30px, 4vw, 44px);
  line-height: 1.04;
  letter-spacing: -0.015em;
  color: var(--ink-primary, #2C2622);
  margin: 8px 0 10px;
}
.subtitle {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  max-width: 60ch;
  margin: 0;
}
.subtitle code {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 13px;
  background: rgba(44, 38, 34, 0.06);
  padding: 1px 6px;
  border-radius: 5px;
}

.paper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 18px;
}

.paper-card {
  display: flex;
  flex-direction: column;
  padding: 22px 24px 20px;
  text-decoration: none;
  color: inherit;
  border-radius: var(--schools-radius-lg, 12px);
  transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease;
  cursor: pointer;
}
.paper-card:hover {
  transform: translateY(-2px);
  border-color: rgba(219, 30, 23, 0.28);
}

.paper-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.paper-tag {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fff;
  background: var(--ink-primary, #2C2622);
  padding: 3px 8px;
  border-radius: 5px;
}
.paper-status {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  color: var(--ink-muted, #8A8078);
}

.paper-title {
  font-size: 26px;
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--ink-primary, #2C2622);
  margin: 0 0 8px;
}
.paper-blurb {
  font-size: 15px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  margin: 0 0 20px;
  flex: 1;
}
.paper-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 14px;
  color: var(--schools-red, #DB1E17);
}
.paper-card:hover .paper-cta svg { transform: translate(2px, -2px); }
.paper-cta svg { transition: transform 160ms ease; }
</style>
