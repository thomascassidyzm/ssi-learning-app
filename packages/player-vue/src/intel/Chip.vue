<script setup lang="ts">
/**
 * Chip — one of the five shapes (design §3.2). A small pill, outlined when
 * off and filled when on, and it means exactly one thing: a FILTER or lens
 * state. It is never a status; that is a Pill.
 *
 * A lens over the rows is a chip, never a separate page, and the active lens
 * lives in the URL — so a chip is a link to the same page with the lens set,
 * which is what makes a pasted address reproduce the exact view.
 */
import type { RouteLocationRaw } from 'vue-router'

withDefaults(defineProps<{
  /** The page address with this lens applied. */
  to: RouteLocationRaw
  on?: boolean
}>(), { on: false })
</script>

<template>
  <router-link :to="to" class="intel-chip" :class="{ on }" data-intel-shape="chip" :aria-pressed="on">
    <slot />
  </router-link>
</template>

<style scoped>
.intel-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 11px 4px;
  border-radius: var(--schools-radius-pill);
  border: 1px solid var(--schools-border-strong);
  background: transparent;
  font-size: 12.5px;
  color: var(--schools-fg-2);
  text-decoration: none;
  white-space: nowrap;
}
.intel-chip:hover { color: var(--schools-fg); background: var(--schools-bg); }
.intel-chip.on { background: var(--schools-fg); border-color: var(--schools-fg); color: var(--schools-card); }
</style>
