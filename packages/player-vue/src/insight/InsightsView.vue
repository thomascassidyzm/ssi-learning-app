<script setup lang="ts">
// ============================================================================
// InsightsView.vue — /admin/insights. The DISCOVERY feed — "what Claude
// surfaced": the proactive nightly read of what moved, what's anomalous, what's
// worth a human's eye, each with graded owned actions.
//
// The explorable BOARDS you drive yourself (Lifecycle, Rate compare, Course
// Scoreboard, Content Friction, Coverage, Health) live on /admin/stats.
//
// Frostwell Courtyard canon · desktop-first.
// ============================================================================
import DiscoveryFeed from './DiscoveryFeed.vue'
</script>

<template>
  <div class="insights-view">
    <!-- ── Frostwell page header ── -->
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Insight Engine · Discovery</span>
        <h1 class="arsenal">Insights</h1>
        <p class="subtitle">
          What Claude surfaced — the proactive read of what moved this week, what's
          anomalous, and what's worth your eye. Each finding carries its interpretation
          and a graded, owned action. Drive the data yourself on the
          <router-link to="/admin/stats" class="inline-link">Stats</router-link> boards —
          including
          <router-link to="/admin/stats?board=vad" class="inline-link">Voice &amp; pause</router-link>,
          the VAD / prosody read by class and school.
        </p>
      </div>
    </header>

    <!-- ── Discovery feed (nightly deep-run) ── -->
    <DiscoveryFeed />
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

.inline-link {
  color: rgba(var(--tone-red), 1);
  text-decoration: none;
  border-bottom: 1px solid rgba(var(--tone-red), 0.4);
}
.inline-link:hover { border-bottom-color: rgba(var(--tone-red), 1); }
</style>
