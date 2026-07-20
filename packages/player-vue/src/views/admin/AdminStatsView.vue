<script setup lang="ts">
// ============================================================================
// AdminStatsView.vue — /admin/stats. The explorable Insight-Engine BOARDS.
//
// The graphs: Lifecycle (the company question — free/paid/at-risk/convert) leads,
// then the rate / course / content / coverage / ops lenses. Each board is a
// composition — a question, a configured widget, and a graded action.
//
// The proactive "what Claude surfaced" DISCOVERY feed lives separately on
// /admin/insights — this view is the boards you drive yourself.
//
// Boards are lazily imported so the ECharts widget graph only loads when a board
// is actually selected. Frostwell Courtyard canon; desktop-first.
// ============================================================================
import { ref, computed, defineAsyncComponent, type Component } from 'vue'
import { useDashboardRefresh } from '@/composables/useDashboardRefresh'

const LifecycleBoard = defineAsyncComponent(() => import('@/insight/boards/LifecycleBoard.vue'))
const RatesBoard = defineAsyncComponent(() => import('@/insight/boards/RatesBoard.vue'))
const CourseScoreboard = defineAsyncComponent(() => import('@/insight/boards/CourseScoreboard.vue'))
const ContentFrictionBoard = defineAsyncComponent(() => import('@/insight/boards/ContentFrictionBoard.vue'))
const DifficultyTurnsBoard = defineAsyncComponent(() => import('@/insight/boards/DifficultyTurnsBoard.vue'))
const CoverageBoard = defineAsyncComponent(() => import('@/insight/boards/CoverageBoard.vue'))
const HealthStrip = defineAsyncComponent(() => import('@/insight/boards/HealthStrip.vue'))

type BoardId = 'lifecycle' | 'rates' | 'scoreboard' | 'friction' | 'difficulty' | 'coverage' | 'health'

interface BoardTab {
  id: BoardId
  label: string
  blurb: string
  component: Component
}

const boards: BoardTab[] = [
  { id: 'lifecycle', label: 'Lifecycle', blurb: 'Free · paid · at-risk · ready-to-convert', component: LifecycleBoard },
  { id: 'rates', label: 'Rate compare', blurb: 'Any metric as a rate — entity vs average', component: RatesBoard },
  { id: 'scoreboard', label: 'Course Scoreboard', blurb: 'Which courses are creating real learner value', component: CourseScoreboard },
  { id: 'friction', label: 'Content Friction', blurb: 'Where the curriculum stalls everyone', component: ContentFrictionBoard },
  { id: 'difficulty', label: 'Difficulty turns', blurb: "Who's struggling, who just turned", component: DifficultyTurnsBoard },
  { id: 'coverage', label: 'Coverage', blurb: 'Each class as a learner — pace, dosage, efficiency', component: CoverageBoard },
  { id: 'health', label: 'Health strip', blurb: 'Is audio breaking, is my fix live', component: HealthStrip },
]

const activeBoard = ref<BoardId>('lifecycle')
const activeComponent = computed<Component>(() => (boards.find(b => b.id === activeBoard.value) ?? boards[0]).component)
function selectBoard(id: BoardId) { activeBoard.value = id }

// The ONE refresh protocol on the board view: each board owns its own async
// fetch (no page-level data here, and no polling to remove), so the universal
// refresh remounts the active board via a key nonce — a clean, board-agnostic
// re-fetch. No "Updated" stamp here: we can't observe the board's async fetch
// completing, so a stamp would be dishonest (see docs/the-view/refresh audit).
const boardNonce = ref(0)
const { registerRefresh } = useDashboardRefresh()
registerRefresh(() => { boardNonce.value++ }, { immediate: false })
</script>

<template>
  <div class="stats-view">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Insight Engine</span>
        <h1 class="arsenal">Stats</h1>
        <p class="subtitle">
          The lenses on the data — each board is a composition: a question, a configured
          widget, and what you could do about it. Lifecycle leads; the rest drill by
          rate, course, content and ops.
        </p>
      </div>
    </header>

    <nav class="board-switch" role="tablist" aria-label="Stats boards">
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

    <section class="board-host" aria-live="polite">
      <component :is="activeComponent" :key="`${activeBoard}:${boardNonce}`" />
    </section>
  </div>
</template>

<style scoped>
.stats-view {
  max-width: 1320px;
  margin: 0 auto;
}
.page-header { margin-bottom: 22px; }
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
.board-tab.active .board-tab-label { color: rgba(var(--tone-red), 1); }
.board-tab-blurb {
  font-size: 11.5px;
  letter-spacing: 0.01em;
  color: var(--ink-muted, #8A8078);
}
.board-host { min-height: 320px; }

@media (max-width: 860px) {
  .board-switch { flex-direction: column; }
  .board-tab { width: 100%; min-width: 0; }
}
</style>
