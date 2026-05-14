<script setup lang="ts">
/**
 * BrainScreen — "Your brain on {language}".
 *
 * Vertical-passage inventory of every word/phrase the learner has
 * reached, belt-grouped, script-like. Tap a line to open the tombola
 * for that LEGO — staggered vertical [left | LEGO | right] derived
 * from the LEGO's USE phrases, shuffle to roll to a new combination
 * and auto-play the phrase audio.
 *
 * No PIXI, no force-sim, no canvas — the v2 "growing brain map" was
 * the wow without the meaningful. The vertical passage is meaningful
 * and the tombola is the wow, kept on its own surface.
 *
 * Entry points (unchanged): the ProgressModal "View Full Progress"
 * button and the "Your brain on X" library tile both route through
 * PlayerContainer.navigate('brain').
 */
import { ref, toRef } from 'vue'
import BrainInventory from './BrainInventory.vue'
import TombolaDrawer from './TombolaDrawer.vue'
import { useBrainInventory, type InventoryLego } from '../composables/useBrainInventory'

const props = defineProps<{
  courseCode: string
  /** Display name for the header — e.g. "Italian". */
  languageName: string
  /** Internal learner id (learners.id, not auth uid). */
  learnerId: string | null
}>()

const emit = defineEmits<{
  close: []
}>()

const courseCodeRef = toRef(props, 'courseCode')
const learnerIdRef = toRef(props, 'learnerId')
const { data, isLoading, error } = useBrainInventory(courseCodeRef, learnerIdRef)

const focusedLego = ref<InventoryLego | null>(null)

function handleSelect(lego: InventoryLego) {
  focusedLego.value = lego
}

function handleTombolaClose() {
  focusedLego.value = null
}
</script>

<template>
  <div class="brain-screen">
    <header class="brain-header">
      <button
        type="button"
        class="brain-back"
        aria-label="Back"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <div class="brain-title-block">
        <h1 class="brain-title">Your brain on {{ data?.languageName || languageName }}</h1>
        <p v-if="data" class="brain-subtitle">
          {{ data.totalCount }} things you can say
        </p>
      </div>
    </header>

    <!-- Loading state -->
    <div v-if="isLoading && !data" class="brain-state">
      <div class="brain-spinner" aria-hidden="true" />
      <p class="brain-state-text">Building your brain…</p>
    </div>

    <!-- Error -->
    <div v-else-if="error && !data" class="brain-state">
      <p class="brain-state-text">Couldn't load your brain right now.</p>
    </div>

    <!-- Empty -->
    <div v-else-if="data && data.totalCount === 0" class="brain-state">
      <p class="brain-state-text">
        Your {{ data.languageName }} brain is empty.<br>
        Start a session to grow it.
      </p>
      <button
        type="button"
        class="brain-cta"
        @click="emit('close')"
      >
        Back to player
      </button>
    </div>

    <!-- The inventory -->
    <BrainInventory
      v-else-if="data"
      :data="data"
      :focused-lego-id="focusedLego?.legoId ?? null"
      @select="handleSelect"
    />

    <!-- Tombola drill-in (modal-style overlay) -->
    <TombolaDrawer
      :course-code="courseCode"
      :lego="focusedLego"
      @close="handleTombolaClose"
    />
  </div>
</template>

<style scoped>
.brain-screen {
  position: relative;
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  background: #f0ece7;
  /* Scroll container for the inventory list */
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 1.5rem);
  font-family: var(--font-body, system-ui);
}

.brain-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: calc(env(safe-area-inset-top, 0px) + 0.75rem) 1rem 0.75rem;
  background: linear-gradient(to bottom,
    rgba(240, 236, 231, 1) 0%,
    rgba(240, 236, 231, 1) 80%,
    rgba(240, 236, 231, 0) 100%
  );
}

.brain-back {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  color: rgba(44, 38, 34, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(44, 38, 34, 0.08);
  -webkit-tap-highlight-color: transparent;
}

.brain-back:hover {
  background: rgba(255, 255, 255, 0.85);
}

.brain-back svg {
  width: 18px;
  height: 18px;
}

.brain-title-block {
  flex: 1;
  min-width: 0;
}

.brain-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  color: rgba(44, 38, 34, 0.95);
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brain-subtitle {
  margin: 0.1rem 0 0;
  font-size: 0.85rem;
  color: rgba(44, 38, 34, 0.55);
}

.brain-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 4rem 1.5rem;
  color: rgba(44, 38, 34, 0.65);
  text-align: center;
}

.brain-state-text {
  margin: 0;
  font-size: 1rem;
  line-height: 1.5;
  max-width: 26ch;
}

.brain-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(44, 38, 34, 0.15);
  border-top-color: rgba(44, 38, 34, 0.55);
  border-radius: 50%;
  animation: brain-spinner 0.8s linear infinite;
}

.brain-cta {
  padding: 0.7rem 1.25rem;
  border-radius: 999px;
  background: var(--ssi-red, #c23a3a);
  color: #ffffff;
  border: 0;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(194, 58, 58, 0.25);
}

@keyframes brain-spinner {
  to { transform: rotate(360deg); }
}
</style>
