<script setup lang="ts">
// ============================================================================
// DiscoveryFeed.vue — the nightly Discovery deep-run, at the top of /admin/insights.
//
// The SSi Machine runs scripts/insight-discovery.cjs once a night via the
// com.ssi.insight-discovery launchd agent (scripts/insight-discovery-cron.sh),
// building an aggregate digest from real telemetry (school-demo students
// excluded), asking Claude to surface findings, and persisting the result to
// insight_discoveries.
//
// This component READS the latest row via the god-gated get_latest_insight_discovery
// RPC and PRESENTS Claude's findings as tone-graded cards. It does NOT re-resolve
// widget data or touch the analytics RPCs — it shows the finding TEXT only.
//
// A stale generated_at (2+ missed nightly runs) surfaces as a loud banner
// above the cards, never just a quiet "days ago" buried in the sub-line — the
// job silently died once (June→July 2026) with nothing anywhere to catch it.
//
// Frostwell Courtyard canon · no hardcoded hex (tones come from theme.ts /
// the --tone-* surface tokens) · desktop-first.
// ============================================================================
import { onMounted, ref, computed } from 'vue'
import { useAdminClient } from '@/composables/useAdminClient'
import { tone as toneColor } from './theme'
import type { Tone } from './spec'

interface FeedAction {
  tier?: string
  owner?: string
  text?: string
}
interface Finding {
  widget?: string
  frame?: string
  title?: string
  story?: string
  tone?: Tone
  metric?: string
  annotate?: string
  actions?: FeedAction[]
}
interface DiscoveryRow {
  generated_at: string
  window_days: number | null
  source: string
  digest: Record<string, unknown> | null
  findings: Finding[]
}

const { getClient } = useAdminClient()

const isLoading = ref(true)
const errored = ref(false)
const row = ref<DiscoveryRow | null>(null)

const findings = computed<Finding[]>(() =>
  Array.isArray(row.value?.findings) ? row.value!.findings : [],
)

const excludedDemo = computed<number | null>(() => {
  const d = row.value?.digest as Record<string, unknown> | null | undefined
  const n = d && typeof d.excluded_school_demo_learners === 'number'
    ? (d.excluded_school_demo_learners as number)
    : null
  return n
})

const relativeTime = computed<string>(() => {
  if (!row.value?.generated_at) return ''
  const then = new Date(row.value.generated_at).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.round((Date.now() - then) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
})

// The generation job is nightly — two missed nights (36h) means the cron is
// dead, not just running a bit late. This must be obvious on sight, not
// buried in the quiet sub-line, so a silent cron death is never invisible again.
const STALE_THRESHOLD_MS = 36 * 60 * 60 * 1000
const staleSinceMs = computed<number | null>(() => {
  if (!row.value?.generated_at) return null
  const then = new Date(row.value.generated_at).getTime()
  return Number.isNaN(then) ? null : Date.now() - then
})
const isStale = computed<boolean>(() => (staleSinceMs.value ?? 0) > STALE_THRESHOLD_MS)
const absoluteGeneratedAt = computed<string>(() => {
  if (!row.value?.generated_at) return ''
  const d = new Date(row.value.generated_at)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
})

const headerLine = computed<string>(() => {
  const n = findings.value.length
  const noun = n === 1 ? 'finding' : 'findings'
  const excl = excludedDemo.value != null
    ? ` · real self-serve learners, ${excludedDemo.value} school demos excluded`
    : ' · real self-serve learners, school demos excluded'
  return `${relativeTime.value} · ${n} ${noun}${excl}`
})

// Tone → an inline colour from the Frostwell theme (never a hex literal here).
function stripeColor(t?: Tone): string {
  return toneColor(t ?? 'neutral')
}
function toneLabel(t?: Tone): string {
  switch (t) {
    case 'good': return 'good'
    case 'warn': return 'watch'
    case 'alarm': return 'alarm'
    default: return 'note'
  }
}

function actionChip(a: FeedAction): string {
  const tier = a.tier || 'note'
  const owner = a.owner || '—'
  return `[${tier} · ${owner}] ${a.text || ''}`
}

onMounted(async () => {
  try {
    const client = getClient()
    const { data, error } = await client.rpc('get_latest_insight_discovery', {
      p_source: 'real',
    })
    if (error) {
      console.error('[DiscoveryFeed] RPC error', error)
      errored.value = true
    } else {
      const first = Array.isArray(data) ? data[0] : data
      row.value = (first as DiscoveryRow) ?? null
    }
  } catch (e) {
    console.error('[DiscoveryFeed] unexpected error', e)
    errored.value = true
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <section class="discovery-feed" aria-label="Discovery feed">
    <!-- stale generation banner — the nightly cron missed 2+ runs; make it impossible to miss -->
    <div v-if="!isLoading && row && isStale" class="disc-stale-banner" role="alert">
      <span class="disc-stale-badge">Generation stale</span>
      <span class="disc-stale-text">
        Last generated {{ absoluteGeneratedAt }} ({{ relativeTime }}) — expected nightly. Check the
        <code>insight-discovery</code> cron.
      </span>
    </div>

    <!-- loading -->
    <div v-if="isLoading" class="disc-quiet">Loading the latest discovery run…</div>

    <!-- empty / errored — quiet, non-alarming -->
    <div v-else-if="errored || !row || findings.length === 0" class="disc-quiet">
      No discovery run yet — the nightly pass will populate this.
    </div>

    <!-- populated -->
    <template v-else>
      <header class="disc-header">
        <span class="disc-kicker">Discovery</span>
        <h2 class="disc-title">What Claude surfaced</h2>
        <p class="disc-sub">{{ headerLine }}</p>
      </header>

      <div class="disc-cards">
        <article
          v-for="(f, i) in findings"
          :key="i"
          class="disc-card"
          :style="{ '--stripe': stripeColor(f.tone) }"
        >
          <span class="disc-stripe" aria-hidden="true" />
          <div class="disc-body">
            <div class="disc-meta">
              <span class="disc-badge" :style="{ color: stripeColor(f.tone) }">
                {{ toneLabel(f.tone) }}
              </span>
              <span v-if="f.metric" class="disc-tag">{{ f.metric }}</span>
              <span v-if="f.widget" class="disc-tag">{{ f.widget }}</span>
            </div>

            <h3 class="disc-card-title">{{ f.title }}</h3>
            <p v-if="f.story" class="disc-story">{{ f.story }}</p>
            <p v-if="f.annotate" class="disc-annotate">{{ f.annotate }}</p>

            <ul v-if="f.actions && f.actions.length" class="disc-actions">
              <li v-for="(a, j) in f.actions" :key="j" class="disc-chip">
                {{ actionChip(a) }}
              </li>
            </ul>
          </div>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.discovery-feed {
  margin-bottom: 28px;
}

/* stale generation banner — loud, on purpose */
.disc-stale-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
  padding: 12px 16px;
  background: rgba(219, 30, 23, 0.06);
  border: 1px solid var(--schools-red, #DB1E17);
  border-radius: var(--schools-radius-lg, 12px);
}
.disc-stale-badge {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
  background: rgba(219, 30, 23, 0.12);
  border-radius: 5px;
  padding: 3px 8px;
  flex-shrink: 0;
}
.disc-stale-text {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 12.5px;
  color: var(--ink-primary, #2C2622);
}
.disc-stale-text code {
  font-size: 11.5px;
  background: rgba(44, 38, 34, 0.08);
  border-radius: 4px;
  padding: 1px 5px;
}

/* quiet states */
.disc-quiet {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 13px;
  color: var(--ink-muted, #8A8078);
  padding: 18px 20px;
  background: var(--schools-card, #fff);
  border: 1px dashed rgba(44, 38, 34, 0.14);
  border-radius: var(--schools-radius-lg, 12px);
}

/* header */
.disc-header {
  margin-bottom: 14px;
}
.disc-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.disc-title {
  font-family: var(--font-display, 'Arsenal', serif);
  font-size: clamp(22px, 2.4vw, 28px);
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--ink-primary, #2C2622);
  margin: 6px 0 4px;
}
.disc-sub {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 12.5px;
  color: var(--ink-muted, #8A8078);
  margin: 0;
}

/* cards */
.disc-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.disc-card {
  display: flex;
  background: var(--schools-card, #fff);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--schools-radius-lg, 12px);
  overflow: hidden;
}
.disc-stripe {
  flex: 0 0 4px;
  background: var(--stripe);
}
.disc-body {
  padding: 16px 18px;
  min-width: 0;
}
.disc-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.disc-badge {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 600;
}
.disc-tag {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--ink-muted, #8A8078);
  background: var(--paper-2, #efece4);
  border-radius: 5px;
  padding: 2px 7px;
}
.disc-card-title {
  font-family: var(--font-display, 'Arsenal', serif);
  font-size: 16px;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: var(--ink-primary, #2C2622);
  margin: 0 0 6px;
}
.disc-story {
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--ink-secondary, #5b534c);
  margin: 0 0 6px;
}
.disc-annotate {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-muted, #8A8078);
  margin: 0 0 10px;
}
.disc-actions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.disc-chip {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--ink-secondary, #5b534c);
  background: var(--paper-2, #efece4);
  border-radius: 7px;
  padding: 7px 10px;
}

/* desktop-first — collapse to one column on narrow viewports */
@media (max-width: 860px) {
  .disc-cards {
    grid-template-columns: 1fr;
  }
}
</style>
