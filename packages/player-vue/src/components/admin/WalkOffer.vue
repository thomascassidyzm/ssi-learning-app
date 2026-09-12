<script setup lang="ts">
// WalkOffer — the quiet "Show me" affordance (archive/docs-retired-2026-08-24/walkthrough-engine-scout.md
// §3.4). One text link per walk that matches the host's persona × place ×
// kind, styled like HowThisWorks' toggle. Nothing renders when no walk
// matches; nothing EVER auto-plays — a walk runs only because the user
// tapped one of these or a noticing invitation.
import { computed, watch } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { walksFor, startWalk, claimDeferredWalk, type WalkPersona } from '@/walkthrough/useWalkthrough'

const { t } = useI18n()

const props = defineProps<{ persona: WalkPersona; place: string; kind?: string }>()

const offers = computed(() => walksFor(props.persona, props.place, props.kind))

// A walk asked for from the Handbook starts here, on its own page, once this
// mount knows where it stands (job #302). One tap, on the Handbook, is the
// only thing that ever puts a walk in that queue.
watch(
  [() => props.persona, () => props.place, () => props.kind],
  ([persona, place, kind]) => { claimDeferredWalk(persona, place, kind) },
  { immediate: true },
)
</script>

<template>
  <div v-if="offers.length" class="walk-offer">
    <button
      v-for="w in offers" :key="w.id" type="button" class="walk-offer-link"
      :data-walk-offer="w.id"
      @click="startWalk(w.id)"
    >{{ t('org.ui.walkOffer.showMe', 'Show me — {title}').replace('{title}', w.title) }}</button>
  </div>
</template>

<style scoped>
.walk-offer { display: flex; flex-direction: column; gap: 2px; align-items: flex-end; }
.walk-offer-link {
  background: none; border: none; cursor: pointer; padding: 2px 4px;
  font: inherit; font-size: var(--text-xs, 12px); color: var(--schools-fg-3, #8A8078);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(44, 38, 34, 0.25);
}
.walk-offer-link:hover { color: var(--schools-fg-2, #555); }
</style>
