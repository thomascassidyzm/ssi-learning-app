<script setup lang="ts">
// NodeMapRailSkeleton — the rail column's GENUINE-cold-load state (first ever
// visit to a node this session, nothing cached). Quiet grey bars in the rail's
// own geometry — never explainer text, never an empty column (founder finding
// 2026-07-30: intermediate text flashing in the WHERE-YOU-ARE column read as a
// fake page load). Warm hops render the real rail from nodeHomeCache instead.
</script>

<template>
  <div class="rail-skel" aria-hidden="true">
    <span class="schools-kicker rail-skel-kicker">Where you are</span>
    <div class="rail-skel-bar" style="width: 62%"></div>
    <div class="rail-skel-bar is-here" style="width: 78%"></div>
    <div class="rail-skel-bar is-deep" style="width: 54%"></div>
    <div class="rail-skel-bar is-deep" style="width: 60%"></div>
  </div>
</template>

<style scoped>
.rail-skel { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.rail-skel-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.rail-skel-bar {
  height: 14px; border-radius: 6px;
  background: rgba(44, 38, 34, 0.08);
  animation: rail-skel-pulse 1.4s ease-in-out infinite;
}
.rail-skel-bar.is-here { background: rgba(var(--tone-red, 219 30 23), 0.10); }
.rail-skel-bar.is-deep { margin-left: 14px; }
@keyframes rail-skel-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
  .rail-skel-bar { animation: none; }
}
</style>
