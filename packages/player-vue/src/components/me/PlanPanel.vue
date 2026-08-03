<script setup lang="ts">
/**
 * PlanPanel — the reasonable plan: THIRTY HOURS, and the route is yours.
 *
 * Founder ruling 2026-08-03 (project_ssi_reasonability_adherence): the unit is
 * 30 hours; the RHYTHM is the free variable. "An hour a day for 30 days is
 * do-able. 6 hours a day for 5 days is also do-able for people who have a real
 * burn." Tiny-daily is the psychologically HARDEST route despite sounding
 * easiest — maximum decision points, minimum evidence per session — so the
 * surface says so gently, and never makes anyone wrong for choosing it.
 *
 * Once a route is chosen, the whole ask collapses to one thing: press play.
 *
 * WHAT IS ABSENT, DELIBERATELY: no streak, no days-since, no deadline, no
 * countdown, nothing that can be missed. The chosen route has no clock attached
 * to it — it is a shape the learner can see themselves in, not a contract.
 * Progress is stated only as what is already behind them.
 */
import { ref, computed, onMounted } from 'vue'

const props = defineProps<{ plan: { hoursDone: number; targetHours: number; source: 'real' | 'mock' } }>()

const STORAGE_KEY = 'ssi-plan-cadence'

interface Route {
  id: string
  name: string
  shape: string
  blurb: string
}

// Every route adds up to the same thirty hours. Same mountain, different paths.
const routes: Route[] = [
  {
    id: 'burn',
    name: 'A real burn',
    shape: '6 hours a day, 5 days',
    blurb: 'Fast and hard. Clear the whole thing inside a week and come out the other side talking.',
  },
  {
    id: 'hour-a-day',
    name: 'An hour a day',
    shape: '1 hour a day, 30 days',
    blurb: 'The steady one. A month of proper sessions and you are through.',
  },
  {
    id: 'weekends',
    name: 'Weekends only',
    shape: '3 hours a day, both weekend days',
    blurb: 'Five weekends. Nothing at all to do midweek, and no guilt about it.',
  },
  {
    id: 'half-hour',
    name: 'Half an hour a day',
    shape: '30 minutes a day, 60 days',
    blurb: 'Slow and easy. Two months at a pace that fits around everything else.',
  },
  {
    id: 'gentle',
    name: 'A gentle quarter hour',
    shape: '15 minutes a day, 120 days',
    blurb:
      'The gentlest-sounding route, and honestly the toughest to hold on to — small days are easy to do and just as easy to let slide, so there are a lot more days to say yes to. Plenty of people get there this way all the same.',
  },
]

const chosenId = ref<string | null>(null)
const picking = ref(true)

const chosen = computed(() => routes.find((r) => r.id === chosenId.value) ?? null)

onMounted(() => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved && routes.some((r) => r.id === saved)) {
      chosenId.value = saved
      picking.value = false
    }
  } catch {
    /* storage unavailable — the learner simply picks again, no error shown */
  }
})

function choose(id: string) {
  chosenId.value = id
  picking.value = false
  try {
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* nothing to say to the learner about this */
  }
}

function reopen() {
  picking.value = true
}

const hoursLabel = computed(() => {
  const h = props.plan.hoursDone
  if (h <= 0) return '0'
  return h < 10 ? h.toFixed(1).replace(/\.0$/, '') : String(Math.round(h))
})

// Look how far — never how far short. This reads the same at 2 hours and at 29.
const behindYou = computed(() => {
  const h = props.plan.hoursDone
  if (h <= 0) return 'Nothing on the clock yet, which is fine — the first go is the whole trick.'
  if (h < 1) return 'You have started. That is the bit most people never do.'
  return `That is ${hoursLabel.value} of the thirty already behind you, and nothing can take them back.`
})

// The ONE quiet supporting line about the thirty. Never a headline claim.
const thirtyLine = computed(() =>
  props.plan.hoursDone >= props.plan.targetHours
    ? 'You are past thirty hours now — this is the part where it starts being fun.'
    : 'It tends to start being genuinely fun somewhere around the thirty-hour mark.'
)

// Covered ground only. No remainder is drawn, no percentage is spoken.
const coveredPct = computed(() => {
  const t = props.plan.targetHours || 30
  return Math.max(0, Math.min(100, (props.plan.hoursDone / t) * 100))
})
</script>

<template>
  <section class="panel">
    <h2 class="title">How you want to do it</h2>

    <div class="hero">
      <span class="hero-number">{{ hoursLabel }}</span>
      <span class="hero-label">hours in</span>
    </div>
    <p class="behind">{{ behindYou }}</p>

    <div class="trail" role="img" :aria-label="`${hoursLabel} hours done so far`">
      <div class="trail-covered" :style="{ width: `${coveredPct}%` }"></div>
    </div>

    <p class="intro">
      Thirty hours is the stretch that matters. How you climb it is completely up to you — same
      mountain, different routes up.
    </p>

    <div v-if="picking" class="routes">
      <button
        v-for="route in routes"
        :key="route.id"
        type="button"
        class="route"
        :class="{ 'route-on': route.id === chosenId }"
        :aria-pressed="route.id === chosenId"
        @click="choose(route.id)"
      >
        <span class="route-name">{{ route.name }}</span>
        <span class="route-shape">{{ route.shape }}</span>
        <span class="route-blurb">{{ route.blurb }}</span>
      </button>
    </div>

    <div v-else-if="chosen" class="chosen">
      <span class="chosen-kicker">Your route</span>
      <p class="chosen-name">{{ chosen.name }}</p>
      <p class="chosen-shape">{{ chosen.shape }}</p>
      <p class="chosen-job">From here you have one job, and it is a small one: press play.</p>
      <button type="button" class="change" @click="reopen">
        Fancy a different route? Pick again any time.
      </button>
    </div>

    <p class="thirty">{{ thirtyLine }}</p>

    <p v-if="plan.source === 'mock'" class="sample">Sample data — not your real numbers yet.</p>
  </section>
</template>

<style scoped>
.panel {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex;
  flex-direction: column;
  gap: var(--space-3, 12px);
}
.title {
  margin: 0;
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-secondary, #6B635C);
}
.hero { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.hero-number {
  font-size: 44px;
  font-weight: var(--font-semibold, 600);
  line-height: 1;
  color: var(--ink-primary, #2C2622);
  font-variant-numeric: tabular-nums;
}
.hero-label { font-size: var(--text-base, 15px); color: var(--ink-secondary, #6B635C); }
.behind {
  margin: 0;
  font-size: var(--text-sm, 13px);
  line-height: 1.55;
  color: var(--ink-secondary, #6B635C);
}
.trail {
  height: 4px;
  border-radius: 2px;
  background: rgba(44, 38, 34, 0.08);
  overflow: hidden;
}
.trail-covered {
  height: 100%;
  border-radius: 2px;
  background: var(--accent-belt, #7C6A58);
  transition: width 600ms ease;
}
.intro {
  margin: 0;
  font-size: var(--text-base, 15px);
  line-height: 1.5;
  color: var(--ink-primary, #2C2622);
}
.routes { display: flex; flex-direction: column; gap: var(--space-2, 8px); }
.route {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: var(--space-3, 12px);
  border: 1px solid rgba(44, 38, 34, 0.1);
  border-radius: var(--radius-md, 12px);
  background: transparent;
  cursor: pointer;
  font: inherit;
}
.route:hover { border-color: var(--accent-belt, #7C6A58); }
.route-on { border-color: var(--accent-belt, #7C6A58); }
.route-name {
  font-size: var(--text-base, 15px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
}
.route-shape { font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); }
.route-blurb {
  font-size: var(--text-xs, 12px);
  line-height: 1.55;
  color: var(--ink-tertiary, #8A8078);
}
.chosen {
  border-left: 2px solid var(--accent-belt, #7C6A58);
  padding-left: var(--space-3, 12px);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.chosen-kicker {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-tertiary, #8A8078);
}
.chosen-name {
  margin: 0;
  font-size: var(--text-base, 15px);
  font-weight: var(--font-semibold, 600);
  color: var(--ink-primary, #2C2622);
}
.chosen-shape { margin: 0; font-size: var(--text-sm, 13px); color: var(--ink-secondary, #6B635C); }
.chosen-job {
  margin: var(--space-2, 8px) 0 0;
  font-size: var(--text-base, 15px);
  line-height: 1.5;
  color: var(--ink-primary, #2C2622);
}
.change {
  margin-top: var(--space-2, 8px);
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078);
  text-decoration: underline;
}
.thirty {
  margin: 0;
  font-size: var(--text-xs, 12px);
  line-height: 1.55;
  color: var(--ink-tertiary, #8A8078);
}
.sample {
  margin: 0;
  font-size: var(--text-xs, 12px);
  color: var(--ink-tertiary, #8A8078);
  font-style: italic;
}
</style>
