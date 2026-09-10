<script setup lang="ts">
/**
 * Pill — one of the five shapes (design §3.2). A small filled pill with a
 * dot, in one of four tones, and it means exactly one thing: a STATUS. It is
 * never a filter; that is a Chip.
 *
 * The dot and the border carry the tone; the text stays ink so it is
 * readable in every tone. The four colours resolve from --intel-* on the
 * intelligence surface, the same four the chart theme reads, so a pill and
 * a chart cannot disagree. No hex here, ever.
 */
export type PillTone = 'good' | 'watch' | 'alarm' | 'quiet'

withDefaults(defineProps<{ tone?: PillTone }>(), { tone: 'quiet' })
</script>

<template>
  <span class="intel-pill" :class="`tone-${tone}`" data-intel-shape="pill">
    <span class="dot" aria-hidden="true"></span>
    <slot />
  </span>
</template>

<style scoped>
.intel-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 3px 8px;
  border-radius: var(--schools-radius-pill);
  border: 1px solid var(--pill-tone);
  background: var(--schools-card);
  font-size: 12px;
  line-height: 1.3;
  color: var(--schools-fg-2);
  white-space: nowrap;
}
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--pill-tone); flex: none; }
.tone-good  { --pill-tone: var(--intel-good); }
.tone-watch { --pill-tone: var(--intel-watch); }
.tone-alarm { --pill-tone: var(--intel-alarm); color: var(--intel-alarm); }
.tone-quiet { --pill-tone: var(--intel-quiet); }
</style>
