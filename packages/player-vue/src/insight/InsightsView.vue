<script setup lang="ts">
// ============================================================================
// InsightsView.vue — the /admin/insights host.
//
// A board switcher. The Insight Engine ships three hand-authored boards today:
//   · Course Scoreboard   (Lens B · company — which courses create value)
//   · Content Friction    (Lens B · quality — where the curriculum stalls everyone)
//   · Health strip        (Lens B · ops — is audio breaking, is my fix live)
//
// Each board owns its own data fetch, its own InsightSpecs, and its own internal
// header; this host only renders the Frostwell page header + a segmented switcher
// and mounts the selected board. Boards are lazily imported so the heavy ECharts
// widget chunk only loads when a board is actually shown.
//
// Frostwell Courtyard canon · schools-surface idiom · desktop-first. No hardcoded
// hex — colours come from schools-tokens / design-tokens via the board components
// and the centralised ECharts theme.
// ============================================================================
import { ref, computed, defineAsyncComponent, type Component } from 'vue'
import DiscoveryFeed from './DiscoveryFeed.vue'

// Lazy board imports — keep the ECharts widget graph out of the initial admin chunk
// until a board is selected.
const CourseScoreboard = defineAsyncComponent(() => import('./boards/CourseScoreboard.vue'))
const ContentFrictionBoard = defineAsyncComponent(() => import('./boards/ContentFrictionBoard.vue'))
const HealthStrip = defineAsyncComponent(() => import('./boards/HealthStrip.vue'))
const DifficultyTurnsBoard = defineAsyncComponent(() => import('./boards/DifficultyTurnsBoard.vue'))
const CoverageBoard = defineAsyncComponent(() => import('./boards/CoverageBoard.vue'))
const RatesBoard = defineAsyncComponent(() => import('./boards/RatesBoard.vue'))
const LifecycleBoard = defineAsyncComponent(() => import('./boards/LifecycleBoard.vue'))

type BoardId = 'lifecycle' | 'rates' | 'scoreboard' | 'friction' | 'difficulty' | 'coverage' | 'health'

interface BoardTab {
  id: BoardId
  label: string
  blurb: string
  component: Component
}

const boards: BoardTab[] = [
  {
    id: 'lifecycle',
    label: 'Lifecycle',
    blurb: 'Free · paid · at-risk · ready-to-convert',
    component: LifecycleBoard,
  },
  {
    id: 'rates',
    label: 'Rate compare',
    blurb: 'Any metric as a rate — entity vs average',
    component: RatesBoard,
  },
  {
    id: 'scoreboard',
    label: 'Course Scoreboard',
    blurb: 'Which courses are creating real learner value',
    component: CourseScoreboard,
  },
  {
    id: 'friction',
    label: 'Content Friction',
    blurb: 'Where the curriculum stalls everyone',
    component: ContentFrictionBoard,
  },
  {
    id: 'difficulty',
    label: 'Difficulty turns',
    blurb: "Who's struggling, who just turned",
    component: DifficultyTurnsBoard,
  },
  {
    id: 'coverage',
    label: 'Coverage',
    blurb: 'Each class as a learner — pace, dosage, efficiency',
    component: CoverageBoard,
  },
  {
    id: 'health',
    label: 'Health strip',
    blurb: 'Is audio breaking, is my fix live',
    component: HealthStrip,
  },
]

const activeBoard = ref<BoardId>('lifecycle')

const activeComponent = computed<Component>(() => {
  const found = boards.find(b => b.id === activeBoard.value)
  return (found ?? boards[0]).component
})

function selectBoard(id: BoardId) {
  activeBoard.value = id
}
</script>

<template>
  <div class="insights-view">
    <!-- ── Frostwell page header ── -->
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Insight Engine</span>
        <h1 class="arsenal">Insights</h1>
        <p class="subtitle">
          Claude-directed analytics over a fixed widget library. Each board is a
          composition — a question, a configured widget, and what you could do about
          it. Pick a lens; the widgets carry the read, the annotation, and the graded
          actions.
        </p>
      </div>
    </header>

    <!-- ── Discovery feed (nightly deep-run) — sits above the boards ── -->
    <DiscoveryFeed />

    <!-- ── Board switcher (segmented) ── -->
    <nav class="board-switch" role="tablist" aria-label="Insight boards">
      <button
        v-for="b in boards"
        :key="b.id"
        type="button"
        role="tab"
        :aria-selected="activeBoard === b.id"
        :class="['board-tab', { active: activeBoard === b.id }]"
        @click="selectBoard(b.id)"
      >
        <span class="board-tab-label">{{ b.label }}</span>
        <span class="board-tab-blurb">{{ b.blurb }}</span>
      </button>
    </nav>

    <!-- ── Active board ── -->
    <section class="board-host" aria-live="polite">
      <component :is="activeComponent" :key="activeBoard" />
    </section>
  </div>
</template>

<style scoped>
.insights-view {
  max-width: 1320px;
  margin: 0 auto;
}

/* ── Page header (Frostwell) ── */
.page-header {
  margin-bottom: 22px;
}

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
  max-width: 64ch;
  margin: 0;
}

/* ── Board switcher ── */
.board-switch {
  display: flex;
  gap: 10px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  border-bottom: 1px solid rgba(var(--tone-blue, 44, 38, 34), 0.10);
  padding-bottom: 18px;
}

.board-tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 12px 18px;
  min-width: 220px;
  text-align: left;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--schools-radius-lg, 12px);
  cursor: pointer;
  transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
}

.board-tab:hover {
  transform: translateY(-2px);
  border-color: rgba(var(--tone-red), 0.30);
}

.board-tab.active {
  border-color: rgba(var(--tone-red), 0.55);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.08);
}

.board-tab-label {
  font-family: var(--font-display, 'Arsenal', serif);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink-primary, #2C2622);
}

.board-tab.active .board-tab-label {
  color: rgba(var(--tone-red), 1);
}

.board-tab-blurb {
  font-size: 11.5px;
  letter-spacing: 0.01em;
  color: var(--ink-muted, #8A8078);
}

/* ── Board host ── */
.board-host {
  min-height: 320px;
}

/* ── Responsive — desktop-first, degrade gracefully ── */
@media (max-width: 860px) {
  .board-switch {
    flex-direction: column;
  }

  .board-tab {
    width: 100%;
    min-width: 0;
  }
}
</style>
