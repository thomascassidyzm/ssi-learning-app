<script setup lang="ts">
/**
 * IntelTopBar — the ten questions, in one white bar on the putty canvas.
 *
 * The dark admin bar dies here (design §3.3): a black bar with a gold
 * indicator above a putty-and-white page shares nothing with the page under
 * it, and it was the single largest source of "disjointed". This is the
 * schools bar's vocabulary — white surface, brand red active indicator, Arsenal
 * name, Open Sans tabs — using the existing --schools-* tokens and no new hex
 * values.
 *
 * Every one of the ten is one tap from here, which is the design's own
 * checkable rule and what IntelTopBar.tapCount.test.ts walks.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { QUESTIONS, QUESTION_GROUPS, questionPath, type Question } from './questions'

const route = useRoute()

const grouped = computed(() =>
  QUESTION_GROUPS.map((group) => ({
    group,
    items: QUESTIONS.filter((q) => q.group === group),
  })),
)

function isActive(q: Question): boolean {
  return route.path === questionPath(q)
}
</script>

<template>
  <header class="intel-topbar">
    <div class="left">
      <router-link to="/admin/structure" class="back-link">Admin</router-link>
      <span class="brand arsenal">What's happening</span>
    </div>

    <nav class="tabs" aria-label="The ten questions">
      <div v-for="g in grouped" :key="g.group" class="tab-group">
        <span class="group-name">{{ g.group }}</span>
        <router-link
          v-for="q in g.items"
          :key="q.slug"
          :to="questionPath(q)"
          class="tab"
          :class="{ active: isActive(q), unbuilt: !q.built }"
          :title="q.question"
        >{{ q.tab }}</router-link>
      </div>
    </nav>
  </header>
</template>

<style scoped>
.intel-topbar {
  min-height: calc(54px + env(safe-area-inset-top, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  /* Top inset keeps controls out of the status bar; left/right cover landscape
     notches — the standing safe-area rule. */
  padding: calc(env(safe-area-inset-top, 0px) + 6px) max(20px, env(safe-area-inset-right, 0px)) 6px max(20px, env(safe-area-inset-left, 0px));
  background: var(--schools-card, #ffffff);
  border-bottom: 1px solid var(--schools-border, rgba(15, 18, 18, .10));
  position: sticky;
  top: 0;
  z-index: 60;
  flex: none;
}

.left { display: flex; align-items: baseline; gap: 14px; min-width: 0; }

.back-link {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
  text-decoration: none;
}
.back-link:hover { color: var(--schools-red); }

.brand { font-size: 19px; color: var(--schools-fg); white-space: nowrap; }

.tabs { display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
.tab-group { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 2px; }

.group-name {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red);
  padding-left: 8px;
}

.tab {
  padding: 5px 8px 6px;
  font-size: 13px;
  color: var(--schools-fg-2);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  white-space: nowrap;
}
.tab:hover { color: var(--schools-fg); }
.tab.active { color: var(--schools-fg); border-bottom-color: var(--schools-red); font-weight: 600; }
.tab.unbuilt { color: var(--schools-fg-3); }
</style>
