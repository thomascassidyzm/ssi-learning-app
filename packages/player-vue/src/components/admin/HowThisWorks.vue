<script setup lang="ts">
// HowThisWorks — the self-explaining dashboard's reference surface
// (docs/self-explaining-dashboard.md §6). One quiet text link; tap → an
// inline card with the persona×place explanation from the compiled pack.
// Static data, zero requests, nothing opens uninvited.
//
// Founder ruling 2026-07-29: this button is THE single surfacing point for
// every invitation at this persona×place — the panel lists the walks AND the
// current noticing invitations, and the button carries a subtle throb on
// first visit, re-arming when the noticing rules surface something not yet
// seen (howThisWorksThrob.ts). The throb stops the moment the panel opens;
// nothing ever auto-plays.
import { ref, computed, watch } from 'vue'
import pack from '@/explainer/pack.json'
import { walksFor, startWalk } from '@/walkthrough/useWalkthrough'
import type { Invitation } from '@/explainer/evaluateRules'
import { shouldThrob, markSeen } from '@/explainer/howThisWorksThrob'

const props = withDefaults(defineProps<{
  persona: 'admin' | 'leader'
  kind: string
  /** Current undismissed noticing invitations — drives the panel list + the re-arm signal. */
  invitations?: Invitation[]
  /** Node id for per-node seen state; empty while the payload loads. */
  nodeId?: string
  /** Auth uid where the mount knows it; 'anon' keeps the state per-device. */
  viewerId?: string
}>(), { invitations: () => [], nodeId: '', viewerId: 'anon' })

// Quiet per-persona×place "Show me" links into the walkthrough pack
// (docs/walkthrough-engine-scout.md §3.4) — launched by tap only, never auto.
const walks = computed(() => walksFor(props.persona, 'node-home', props.kind))

const open = ref(false)
const text = computed<string | null>(() => {
  const byKind = (pack.explanations as Record<string, Record<string, string>>)[props.persona]
  return byKind?.[props.kind] ?? byKind?.group ?? null
})

const invKeys = computed(() => props.invitations.map((inv) => inv.key))

// Armed = subtle throb on the link. Re-checked whenever the node or its
// invitation set changes; disarmed (and persisted seen) on open.
const throbbing = ref(false)
watch(
  [() => props.nodeId, invKeys],
  () => {
    if (!props.nodeId) { throbbing.value = false; return }
    throbbing.value = shouldThrob(props.viewerId, props.nodeId, invKeys.value)
  },
  { immediate: true },
)

function toggle(): void {
  open.value = !open.value
  if (open.value && props.nodeId) {
    markSeen(props.viewerId, props.nodeId, invKeys.value)
    throbbing.value = false
  }
}

// Markdown-lite: paragraphs + **bold**. The pack is repo-authored (compiled,
// reviewed) content, but escape anyway so the renderer never trusts input.
const html = computed(() => {
  if (!text.value) return ''
  const escaped = text.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\n/g, ' ')}</p>`)
    .join('')
})
</script>

<template>
  <div v-if="text" class="htw">
    <button type="button" class="htw-toggle" :class="{ 'is-armed': throbbing && !open }" @click="toggle">
      <span v-if="throbbing && !open" class="htw-dot" aria-hidden="true"></span>
      {{ open ? 'Close' : 'How this works' }}
    </button>
    <transition name="htw-fade">
      <div v-if="open" class="htw-card schools-card">
        <span class="schools-kicker">How this works</span>
        <!-- eslint-disable-next-line vue/no-v-html — pack content is compiled repo data, escaped above -->
        <div class="htw-body" v-html="html"></div>
        <div v-if="invitations.length" class="htw-invitations">
          <div v-for="inv in invitations" :key="inv.key" class="htw-invitation">
            <span class="htw-invitation-text">{{ inv.text }}</span>
            <button v-if="inv.walk" type="button" class="htw-walk-link" :data-walk-cta="inv.walk" @click="startWalk(inv.walk)">{{ inv.ctaLabel }}</button>
            <router-link v-else-if="inv.to" :to="inv.to" class="htw-walk-link">{{ inv.ctaLabel }}</router-link>
          </div>
        </div>
        <div v-if="walks.length" class="htw-walks">
          <button
            v-for="w in walks" :key="w.id" type="button" class="htw-walk-link"
            :data-walk-offer="w.id"
            @click="startWalk(w.id)"
          >Show me — {{ w.title }}</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.htw { display: flex; flex-direction: column; gap: var(--space-3); }
.htw-toggle {
  align-self: flex-end; background: none; border: none; cursor: pointer; padding: 2px 4px;
  display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: var(--text-xs); color: var(--schools-fg-3, #8A8078);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(44, 38, 34, 0.25);
}
.htw-toggle:hover { color: var(--schools-fg-2, #555); }
/* Armed = discoverable but never attention-trapping (founder acceptance test):
   the link darkens one step and carries a small soft-pulsing dot. */
.htw-toggle.is-armed { color: var(--schools-fg-2, #555); }
.htw-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: var(--schools-red, #DB1E17);
  animation: htw-throb 2.6s ease-in-out infinite;
}
@keyframes htw-throb {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .htw-dot { animation: none; opacity: 0.55; }
}
.htw-card { padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
.htw-card .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--schools-red, #DB1E17);
}
.htw-body { font-size: var(--text-sm); color: var(--schools-fg-2, #555); line-height: 1.6; }
.htw-body :deep(p) { margin: 0 0 10px; }
.htw-body :deep(p:last-child) { margin-bottom: 0; }
.htw-body :deep(strong) { color: var(--ink-primary, #2C2622); font-weight: var(--font-semibold); }
.htw-invitations { display: flex; flex-direction: column; gap: var(--space-2); }
.htw-invitation {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-3);
  padding-left: var(--space-2);
  border-left: 2px solid rgba(var(--tone-amber, 194 132 58), 0.55);
}
.htw-invitation-text { font-size: var(--text-xs); color: var(--schools-fg-2, #555); line-height: 1.5; }
.htw-walks { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; }
.htw-walk-link {
  background: none; border: none; cursor: pointer; padding: 2px 0;
  font: inherit; font-size: var(--text-xs); color: var(--schools-red, #DB1E17);
  text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(219, 30, 23, 0.3);
  white-space: nowrap;
}
.htw-walk-link:hover { text-decoration-color: currentColor; }
.htw-fade-enter-active, .htw-fade-leave-active { transition: opacity 0.15s ease; }
.htw-fade-enter-from, .htw-fade-leave-to { opacity: 0; }
</style>
