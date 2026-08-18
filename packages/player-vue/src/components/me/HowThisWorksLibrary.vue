<script setup lang="ts">
/**
 * HowThisWorksLibrary — the Library's own How-this-works section (A-159), and
 * since the hub pass the app's SINGLE DOOR into "what is this and how do I
 * use it".
 *
 * Same protocol as every other How-this-works surface in the app: one quiet
 * text link carrying a soft-pulsing dot until it is opened once, seen-state in
 * localStorage, pulse stops on open, nothing ever opens uninvited, nothing ever
 * auto-plays, and the dot respects prefers-reduced-motion.
 *
 * The order is practical first: the panel opens on the walkthroughs — what to
 * actually do, shown on the real page over the learner's own data by the
 * walkthrough engine. The methodology prose sits underneath, still collapsed,
 * as the "why this works" layer for the curious.
 *
 * The hub adds two things on top of that, and nothing else:
 *   - CHIPS, one per topic, so the whole of what the app can show you is
 *     readable in a glance rather than as a stack of sentences;
 *   - SEARCH, which pops up over everything and lists every walk it can talk
 *     you through, narrowing as you type. Its list is walksFor() filtered the
 *     same way the chips are, so search can never surface a walk this learner
 *     is not offered.
 *
 * The two prose sections are the existing profile ones, reused unchanged —
 * "Using the app" is HOW_THIS_WORKS_LEARNER wearing a non-duplicating label,
 * since this panel is itself called How this works.
 */
import { ref, computed, nextTick } from 'vue'
import { walksFor, searchWalks, walkTopic, startWalk } from '@/walkthrough/useWalkthrough'
import { shouldThrob, markSeen } from '@/explainer/learnerThrob'
import HowThisWorksLearner from '@/components/me/HowThisWorksLearner.vue'
import WhyThisWorks from '@/components/me/WhyThisWorks.vue'

const SECTION_ID = 'library-how-this-works' as const

const props = withDefaults(defineProps<{
  /** Auth uid where the mount knows it; 'anon' keeps the state per-device. */
  viewerId?: string
  /** Guests are offered the sign-in walk; signed-in learners are not. */
  isGuest?: boolean
}>(), { viewerId: 'anon', isGuest: false })

const kind = computed(() => (props.isGuest ? 'guest' : 'signed-in'))

// Offer filtering rides the engine's own persona × place × kind, so which
// walks a learner sees is a fact about the pack, never a list held here.
const walks = computed(() => walksFor('learner', 'library', kind.value))

const open = ref(false)
const throbbing = ref(shouldThrob(props.viewerId, SECTION_ID))

const searchOpen = ref(false)
const query = ref('')
const queryInput = ref<HTMLInputElement | null>(null)
const results = computed(() => searchWalks('learner', 'library', kind.value, query.value))

function toggle(): void {
  open.value = !open.value
  if (open.value) {
    markSeen(props.viewerId, SECTION_ID)
    throbbing.value = false
  }
}

async function openSearch(): Promise<void> {
  query.value = ''
  searchOpen.value = true
  await nextTick()
  queryInput.value?.focus()
}
</script>

<template>
  <section class="hl">
    <button type="button" class="hl-toggle" :class="{ 'is-armed': throbbing && !open }" @click="toggle">
      <span v-if="throbbing && !open" class="hl-dot" aria-hidden="true"></span>
      {{ open ? 'Close' : 'How this works' }}
    </button>
    <transition name="hl-fade">
      <div v-if="open" class="hl-card">
        <span class="hl-kicker">How this works</span>
        <p class="hl-intro">Take a look round the app, right here on your own page.</p>

        <div v-if="walks.length" class="hl-chips">
          <button
            v-for="w in walks" :key="w.id" type="button" class="hl-chip"
            :data-walk-offer="w.id"
            @click="startWalk(w.id)"
          >{{ walkTopic(w) }}</button>
          <button type="button" class="hl-search-trigger" @click="openSearch()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            Search
          </button>
        </div>

        <div class="hl-prose">
          <HowThisWorksLearner :viewer-id="viewerId" link-label="Using the app" />
          <WhyThisWorks :viewer-id="viewerId" />
        </div>
      </div>
    </transition>

    <!-- Search pops up OVER everything, and lists everything it can show you. -->
    <transition name="hl-pop">
      <div v-if="searchOpen" class="hl-pop" role="dialog" aria-label="How this works — search">
        <div class="hl-pop-scrim" @click="searchOpen = false"></div>
        <div class="hl-pop-panel">
          <div class="hl-pop-bar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              ref="queryInput" v-model="query" type="search" class="hl-pop-input"
              placeholder="What would you like to know?"
              @keydown.esc="searchOpen = false"
            />
            <button type="button" class="hl-pop-close" aria-label="Close search" @click="searchOpen = false">&#x2715;</button>
          </div>
          <div v-if="results.length" class="hl-pop-list">
            <button
              v-for="w in results" :key="w.id" type="button" class="hl-pop-result"
              :data-walk-offer="w.id"
              @click="searchOpen = false; startWalk(w.id)"
            >
              <span class="hl-pop-result-title">{{ w.title }}</span>
              <span class="hl-pop-result-topic">{{ walkTopic(w) }}</span>
            </button>
          </div>
          <p v-else class="hl-pop-empty">Nothing on that one yet — try another word.</p>
        </div>
      </div>
    </transition>
  </section>
</template>

<style scoped>
.hl { display: flex; flex-direction: column; gap: var(--space-3, 12px); }
.hl-toggle {
  align-self: flex-end; background: none; border: none; cursor: pointer; padding: 2px 4px;
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(44, 38, 34, 0.25);
}
.hl-toggle:hover, .hl-toggle.is-armed { color: var(--ink-secondary, #6B635C); }
/* Armed = discoverable but never attention-trapping: a small soft-pulsing dot. */
.hl-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: var(--schools-red, #DB1E17);
  animation: hl-throb 2.6s ease-in-out infinite;
}
@keyframes hl-throb {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .hl-dot { animation: none; opacity: 0.55; }
}
.hl-card {
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  padding: var(--space-5, 20px);
  display: flex; flex-direction: column; gap: var(--space-4, 16px);
}
.hl-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.hl-intro {
  margin: 0;
  font-size: var(--text-base, 15px); color: var(--ink-primary, #2C2622); line-height: 1.55;
}

/* ── Chips: the whole of what this can show you, in a glance ── */
.hl-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.hl-chip, .hl-search-trigger {
  background: none; cursor: pointer;
  border: 1px solid rgba(219, 30, 23, 0.28);
  border-radius: 999px; padding: 5px 12px;
  font: inherit; font-size: var(--text-sm, 13px); line-height: 1.3;
  color: var(--schools-red, #DB1E17);
}
.hl-chip:hover, .hl-search-trigger:hover { border-color: currentColor; }
.hl-search-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  color: var(--ink-tertiary, #8A8078); border-color: rgba(44, 38, 34, 0.18);
}
.hl-search-trigger svg { width: 13px; height: 13px; }

/* The methodology layer sits behind the doing, still collapsed. */
.hl-prose {
  display: flex; flex-direction: column; gap: var(--space-3, 12px);
  padding-top: var(--space-3, 12px);
  border-top: 1px solid rgba(44, 38, 34, 0.08);
}
.hl-fade-enter-active, .hl-fade-leave-active { transition: opacity 0.15s ease; }
.hl-fade-enter-from, .hl-fade-leave-to { opacity: 0; }

/* ── Search popup ── */
.hl-pop { position: fixed; inset: 0; z-index: 900; display: flex; justify-content: center; }
.hl-pop-scrim { position: absolute; inset: 0; background: rgba(28, 24, 21, 0.42); }
.hl-pop-panel {
  position: relative; width: min(520px, calc(100% - 32px));
  margin-top: calc(12vh + env(safe-area-inset-top, 0px));
  max-height: calc(76vh - env(safe-area-inset-bottom, 0px));
  display: flex; flex-direction: column;
  background: var(--bg-elevated, #fff);
  border-radius: var(--radius-lg, 16px);
  box-shadow: 0 18px 48px rgba(28, 24, 21, 0.22);
  overflow: hidden;
}
.hl-pop-bar {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid rgba(44, 38, 34, 0.08);
  color: var(--ink-tertiary, #8A8078);
}
.hl-pop-bar > svg { width: 16px; height: 16px; flex-shrink: 0; }
.hl-pop-input {
  flex: 1; min-width: 0; background: none; border: none; outline: none;
  font: inherit; font-size: var(--text-base, 15px); color: var(--ink-primary, #2C2622);
}
.hl-pop-input::-webkit-search-cancel-button { display: none; }
.hl-pop-close {
  background: none; border: none; cursor: pointer; padding: 4px;
  font-size: 13px; color: var(--ink-tertiary, #8A8078); line-height: 1;
}
.hl-pop-list { overflow-y: auto; padding: 6px; }
.hl-pop-result {
  width: 100%; display: flex; flex-direction: column; gap: 2px; text-align: left;
  background: none; border: none; cursor: pointer;
  padding: 10px 12px; border-radius: var(--radius-md, 10px); font: inherit;
}
.hl-pop-result:hover { background: rgba(219, 30, 23, 0.06); }
.hl-pop-result-title { font-size: var(--text-base, 15px); color: var(--ink-primary, #2C2622); }
.hl-pop-result-topic {
  font-size: var(--text-xs, 12px); color: var(--ink-tertiary, #8A8078);
}
.hl-pop-empty {
  margin: 0; padding: 18px 16px;
  font-size: var(--text-sm, 13px); color: var(--ink-tertiary, #8A8078);
}
.hl-pop-enter-active, .hl-pop-leave-active { transition: opacity 0.15s ease; }
.hl-pop-enter-from, .hl-pop-leave-to { opacity: 0; }
</style>
