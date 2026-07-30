<script setup lang="ts">
// WalkOffer — the quiet "Show me" affordance (docs/walkthrough-engine-scout.md
// §3.4). One text link per walk that matches the host's persona × place ×
// kind, styled like HowThisWorks' toggle. Nothing renders when no walk
// matches; nothing EVER auto-plays — a walk runs only because the user
// tapped one of these or a noticing invitation.
import { computed } from 'vue'
import { walksFor, startWalk, type WalkPersona } from '@/walkthrough/useWalkthrough'

const props = defineProps<{ persona: WalkPersona; place: string; kind?: string }>()

const offers = computed(() => walksFor(props.persona, props.place, props.kind))
</script>

<template>
  <div v-if="offers.length" class="walk-offer">
    <button
      v-for="w in offers" :key="w.id" type="button" class="walk-offer-link"
      :data-walk-offer="w.id"
      @click="startWalk(w.id)"
    >Show me — {{ w.title }}</button>
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
