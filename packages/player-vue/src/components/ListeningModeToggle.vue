<script setup lang="ts">
/**
 * ListeningModeToggle — a dumb, self-contained segmented control for the
 * listening modes (Immersion / Drill / Progression).
 *
 * Built from first principles after the inline version proved unfixable:
 *  - PURE PRESENTATIONAL. It owns no side effects (no warmScene, no audio, no
 *    watchers). Clicking just emits the new value; the parent decides what to do
 *    and is responsible for deferring any heavy work off the render path.
 *  - The highlight is driven straight off the `modelValue` prop, so it reflects
 *    the selection the instant the prop updates — nothing else can race it.
 *  - Its OWN backdrop-filter makes it its own compositing layer (exactly like
 *    the sibling .view-tabs, which always paints correctly), so iOS Safari
 *    repaints the active fill immediately instead of dropping the paint until a
 *    relayout.
 *  - @click.stop so the tap never bubbles to the overlay's tap-to-play surface.
 */
defineProps<{
  modes: { key: string; label: string; desc?: string }[]
  modelValue: string
}>()

defineEmits<{ (e: 'update:modelValue', value: string): void }>()
</script>

<template>
  <div class="lmt" role="group" aria-label="Listening mode">
    <button
      v-for="m in modes"
      :key="m.key"
      type="button"
      class="lmt-btn"
      :class="{ active: modelValue === m.key }"
      :aria-pressed="modelValue === m.key"
      :title="m.desc"
      @click.stop="$emit('update:modelValue', m.key)"
    >{{ m.label }}</button>
  </div>
</template>

<style scoped>
/* Mirrors the proven .view-tabs recipe: own backdrop-filter (own paint layer),
 * a solid ink fill for the active button, white text. No layout tricks, no
 * separate thumb, no theme variables for the fill. */
.lmt {
  display: flex;
  flex: 0 1 auto;
  max-width: 24rem;
  margin-inline: auto;
  min-width: 0;
  gap: 0.2rem;
  padding: 0.2rem;
  border: 1px solid var(--border-medium);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.lmt-btn {
  flex: 1;
  min-width: 5.5rem;
  padding: 0.35rem 0.75rem;
  background: transparent;
  border: 0;
  border-radius: 999px;
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}

.lmt-btn:hover:not(.active) {
  color: var(--text-primary);
}

.lmt-btn.active {
  background: #2C2622;
  color: #ffffff;
  font-weight: 600;
}
</style>
