<script setup lang="ts">
// NodeInsightsView — THE LENS's admin door: the Insight Engine scoped to the
// node it was opened from ("See insights" on node home). Mounted at the old
// analytics URLs (/admin/schools/:id/analytics, /admin/groups/:id/analytics —
// the URLs live, the old-school page died) and at /admin/classes/:id/insights.
//
// The page is a thin identity wrapper: WHOSE numbers you're looking at (the
// most-specific-context law) + a way back to node home + the door to the full
// Stats boards. The engine itself (NodeRateEngine) owns the pickers, the
// fetch, the refresh registration and the widget. Deep-linkable: ?course= and
// ?compare= mirror the engine state.
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAdminClient } from '@/composables/useAdminClient'
import NodeRateEngine, { type EngineState } from '@/insight/NodeRateEngine.vue'
import UpdatedStamp from '@/components/shared/UpdatedStamp.vue'

const route = useRoute()
const router = useRouter()
const { getAuthToken } = useAdminClient()

const nodeId = computed(() => String(route.params.id || ''))

// ?course= / ?compare= are the deep link; the engine resolves defaults and
// reflects them back here so a copied URL reproduces the exact view. Local
// refs + ONE coalesced replace — two separate query-setters raced each other
// (the second replace read the pre-first-replace query and clobbered it).
const course = ref<string | null>(typeof route.query.course === 'string' ? route.query.course : null)
const compare = ref<string | null>(typeof route.query.compare === 'string' ? route.query.compare : null)
watch([course, compare], ([c, cmp]) => {
  void router.replace({ query: { ...route.query, course: c || undefined, compare: cmp || undefined } })
})
watch(
  () => [route.query.course, route.query.compare],
  ([qc, qcmp]) => {
    course.value = typeof qc === 'string' ? qc : null
    compare.value = typeof qcmp === 'string' ? qcmp : null
  },
)

const state = ref<EngineState | null>(null)

const kicker = computed(() => {
  const label = state.value?.node.label
  return label ? `Insights · ${label}` : 'Insights'
})
const title = computed(() => state.value?.node.name || '…')
const isClass = computed(() => state.value?.node.kind === 'class')
const subtitle = computed(() =>
  isClass.value
    ? 'How this class is moving, compared with the average you choose. Rate leads; position is just context.'
    : 'How everyone below this is moving, compared with the average you choose. Rate leads; position is just context.')

// Back to this node's home — the same URL family the engine was opened from.
const homeLink = computed(() => {
  const p = route.path
  if (p.includes('/admin/classes/')) return `/admin/classes/${nodeId.value}`
  if (p.includes('/admin/schools/')) return `/admin/schools/${nodeId.value}`
  return `/admin/groups/${nodeId.value}`
})
</script>

<template>
  <div class="niv">
    <header class="niv-head">
      <div class="niv-title-block">
        <span class="schools-kicker">{{ kicker }}</span>
        <h1 class="niv-title arsenal">{{ title }}</h1>
        <p class="niv-sub">{{ subtitle }}</p>
      </div>
      <div class="niv-side">
        <UpdatedStamp />
        <nav class="niv-links">
          <router-link :to="homeLink" class="niv-link">← Back to {{ isClass ? 'class' : 'group' }} home</router-link>
          <router-link to="/admin/stats" class="niv-link">All boards →</router-link>
        </nav>
      </div>
    </header>

    <NodeRateEngine
      v-model:course="course"
      v-model:compare="compare"
      :node-id="nodeId"
      :get-token="getAuthToken"
      @state="state = $event"
    />
  </div>
</template>

<style scoped>
.niv { display: flex; flex-direction: column; gap: 20px; max-width: 1100px; margin: 0 auto; }
.niv-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.niv-title-block { min-width: 0; }
.schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}
.niv-title {
  font-family: var(--font-display);
  font-size: clamp(26px, 3.4vw, 38px);
  font-weight: 400;
  line-height: 1.05;
  letter-spacing: -0.015em;
  color: var(--ink-primary, #2C2622);
  margin: 6px 0 8px;
}
.niv-sub {
  font-size: 14.5px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  max-width: 56ch;
  margin: 0;
}
.niv-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.niv-links { display: flex; gap: 14px; flex-wrap: wrap; }
.niv-link {
  font-size: var(--text-sm, 13px);
  font-weight: var(--font-medium, 500);
  color: var(--schools-fg-2, #555);
  text-decoration: none;
}
.niv-link:hover { color: var(--schools-red, #DB1E17); }
@media (max-width: 720px) {
  .niv-side { align-items: flex-start; }
}
</style>
