<script setup lang="ts">
// The mission card — small, unobtrusive, collapsible, never blocks the UI.
// Renders nothing when no mission is running; the engine owns all state.
import { ref } from 'vue'
import { useMission } from './useMission'

const { activeMission, status, nudgeVisible, exitMission } = useMission()
const collapsed = ref(false)
</script>

<template>
  <aside v-if="activeMission && status !== 'idle'" class="mission-card" :class="{ collapsed }" aria-live="polite">
    <!-- User-facing wording is "guided look", never "mission" — mission framing
         is deprecated in learner/teacher-facing copy (founder ruling,
         2026-07-30). The module's internal names/route params stay. -->
    <button v-if="collapsed" type="button" class="mission-pill" @click="collapsed = false">
      {{ status === 'complete' ? '✓' : '◦' }} Guided look
    </button>

    <div v-else class="mission-body">
      <div class="mission-head">
        <span class="mission-kicker">{{ status === 'complete' ? 'Nicely spotted' : 'Guided look' }}</span>
        <button type="button" class="mission-min" aria-label="Minimise guided look" @click="collapsed = true">–</button>
      </div>

      <template v-if="status === 'active'">
        <h3 class="mission-title">{{ activeMission.title }}</h3>
        <p class="mission-text">{{ activeMission.brief }}</p>
        <p v-if="nudgeVisible && activeMission.nudge" class="mission-nudge">{{ activeMission.nudge.text }}</p>
        <button type="button" class="mission-exit" @click="exitMission">Back to dashboard</button>
      </template>

      <template v-else>
        <p class="mission-text">{{ activeMission.closing.note }}</p>
        <div class="mission-actions">
          <a
            v-if="activeMission.closing.link"
            class="mission-link"
            :href="activeMission.closing.link.href"
            target="_blank"
            rel="noopener"
          >{{ activeMission.closing.link.label }} →</a>
          <button type="button" class="mission-done" @click="exitMission">Done</button>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.mission-card {
  position: fixed;
  /* Bottom-LEFT: the schools tables carry their row actions ("View →") on
     the right edge, so a right-hand card can sit exactly over the click the
     mission is waiting for. */
  left: 16px;
  /* Standing rule: bottom chrome clears the home indicator. */
  bottom: calc(16px + env(safe-area-inset-bottom, 0px));
  z-index: 60;
  max-width: 320px;
}

.mission-pill {
  border: 1px solid var(--schools-border-strong);
  background: var(--schools-card);
  color: var(--schools-fg);
  border-radius: var(--schools-radius-pill);
  box-shadow: var(--schools-shadow-md);
  padding: 8px 14px;
  font-size: 0.85rem;
  cursor: pointer;
}

.mission-body {
  background: var(--schools-card);
  border: 1px solid var(--schools-border);
  border-radius: var(--schools-radius-lg);
  box-shadow: var(--schools-shadow-lg);
  padding: 14px 16px;
}

.mission-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.mission-kicker {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
}

.mission-min {
  border: none;
  background: none;
  color: var(--schools-fg-3);
  font-size: 1rem;
  line-height: 1;
  padding: 0 4px;
  cursor: pointer;
}

.mission-title {
  margin: 0 0 4px;
  font-size: 1rem;
  color: var(--schools-fg);
}

.mission-text {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--schools-fg-2);
}

.mission-nudge {
  margin: 10px 0 0;
  padding: 8px 10px;
  font-size: 0.84rem;
  line-height: 1.4;
  color: var(--schools-fg-2);
  background: var(--schools-pastel);
  border-radius: var(--schools-radius-md);
}

.mission-exit {
  margin-top: 10px;
  border: none;
  background: none;
  padding: 0;
  font-size: 0.78rem;
  color: var(--schools-fg-3);
  cursor: pointer;
  text-decoration: underline;
}

.mission-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.mission-link {
  font-size: 0.86rem;
  color: var(--schools-fg);
  text-decoration: underline;
}

.mission-done {
  border: 1px solid var(--schools-border-strong);
  background: var(--schools-card);
  color: var(--schools-fg);
  border-radius: var(--schools-radius-pill);
  padding: 6px 14px;
  font-size: 0.84rem;
  cursor: pointer;
}
</style>
