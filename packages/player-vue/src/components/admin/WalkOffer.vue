<script setup lang="ts">
// WalkOffer — the quiet "Show me" affordance (archive/docs-retired-2026-08-24/walkthrough-engine-scout.md
// §3.4). One text link per clip that shows a capability standing on THIS
// page; nothing renders when none does, and nothing EVER auto-plays — a walk
// runs only because the user tapped one of these or a noticing invitation.
//
// PER-PAGE, DERIVED FROM THE PACK (job #5, 2026-09-16). Tom: "putting the
// clips on the relevant page as well should be good — Show me can be a list
// of clips that are relevant to each page — the handbook is the compendium of
// everything." The Teachers page had five of these by hand; this is that same
// list, everywhere, computed rather than placed.
//
// Membership is the compiler-derived anchor → route map, not the authored
// `place`: the anchor is on this page or it is not. The 2026-09-16 audit
// (#984·G) found 39 of 80 school-leader entries whose place resolves to a
// route their anchor is not on, so a list keyed on place would offer clips
// for controls that are not here. `place` survives as the fallback for an
// anchor no routed view reaches, and as what claimDeferredWalk keys on.
//
// Ordered by the page's own moment order — setting up, every lesson, when
// something looks wrong — so the first thing offered is the first thing a
// reader standing here is likely to want.
import { computed, getCurrentInstance, ref, watch } from 'vue'
import { useI18n } from '@/composables/useI18n'
import { walksFor, walkById, startWalk, claimDeferredWalk, type WalkPersona, type Walk } from '@/walkthrough/useWalkthrough'
import { showMeOnPage } from '@/walkthrough/handbook'

const { t } = useI18n()

const props = defineProps<{ persona: WalkPersona; place: string; kind?: string }>()

// More than a handful is a list to scan rather than an offer to take, so it
// folds behind one chip. Five is what the Teachers page carried by hand.
const COLLAPSE_ABOVE = 5

// WHERE THIS MOUNT IS STANDING, read off the global `$route` the router
// installs rather than through useRoute(). A dozen unit tests mount their
// host with a partial vue-router mock, and a named import of useRoute turns
// every one of them red for a component that only wants to know its own
// path — the global degrades to undefined instead, which is exactly the
// "no routed view reaches this" case the place fallback already handles.
const inst = getCurrentInstance()
const matchedPaths = computed(() => {
  const r = (inst?.proxy as { $route?: { matched?: Array<{ path: string }> } } | null | undefined)?.$route
  return (r?.matched ?? []).map((m) => m.path)
})

const offers = computed<Walk[]>(() => {
  const ids = showMeOnPage(matchedPaths.value, props.persona, props.place)
  const walks = ids.map((id) => walkById(id)).filter((w): w is Walk => !!w)
  // A page whose anchors carry no clip for this reader still offers whatever
  // its place offers — the old behaviour, unchanged, rather than nothing.
  return walks.length ? walks : walksFor(props.persona, props.place, props.kind)
})

const expanded = ref(false)
const collapsed = computed(() => offers.value.length > COLLAPSE_ABOVE && !expanded.value)

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
      v-if="collapsed"
      type="button" class="walk-offer-chip" data-walk-offer-list
      :aria-expanded="false"
      @click="expanded = true"
    >{{ t('org.ui.walkOffer.showMeCount', 'Show me — {n}').replace('{n}', String(offers.length)) }}</button>
    <template v-else>
      <button
        v-for="w in offers" :key="w.id" type="button" class="walk-offer-link"
        :data-walk-offer="w.id"
        @click="startWalk(w.id)"
      >{{ t('org.ui.walkOffer.showMe', 'Show me — {title}').replace('{title}', w.title) }}</button>
    </template>
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
/* Collapsed: one chip, the same quiet register, with the count so the reader
   knows whether it is worth a tap. Phone-first — a list of twelve underlined
   links down the right of a phone is the overwhelm this exists to avoid. */
.walk-offer-chip {
  background: var(--schools-card, #fff); cursor: pointer;
  border: 1px solid var(--schools-border-strong, rgba(15, 18, 18, .18)); border-radius: 999px;
  padding: 4px 12px; font: inherit; font-size: var(--text-xs, 12px); color: var(--schools-fg-2, #555);
  max-width: 100%;
}
.walk-offer-chip:hover { color: var(--schools-fg, #0F1212); }
</style>
