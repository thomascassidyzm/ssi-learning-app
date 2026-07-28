<script setup lang="ts">
// NoticingInvitations — the self-explaining dashboard's noticing surface
// (docs/self-explaining-dashboard.md §5). Renders the pack's declarative
// rules, evaluated over the home payload the page ALREADY fetched, as gentle
// tappable invitations. Never modal, never forced, dismissible (14 days per
// rule × node), never more than 3 at once. Invitations, not missions.
import { ref, computed } from 'vue'
import pack from '@/explainer/pack.json'
import { evaluateRules, type NoticingRule } from '@/explainer/evaluateRules'
import { startWalk } from '@/walkthrough/useWalkthrough'

const props = defineProps<{
  home: unknown
  persona: 'admin' | 'leader'
  member: boolean
  nodeId: string
}>()

const DISMISS_KEY = 'ssi-noticing-dismissed'
const DISMISS_DAYS = 14

function readDismissed(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '{}') } catch { return {} }
}
const dismissed = ref(readDismissed())

function dismiss(key: string): void {
  const map = readDismissed()
  map[`${props.nodeId}:${key}`] = Date.now()
  // Prune expired entries while we're here so the map never grows unbounded.
  const cutoff = Date.now() - DISMISS_DAYS * 86400000
  for (const k of Object.keys(map)) if (map[k] < cutoff) delete map[k]
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify(map)) } catch { /* storage unavailable */ }
  dismissed.value = map
}

const invitations = computed(() => {
  const all = evaluateRules(pack.rules as NoticingRule[], props.home, props.persona, props.member)
  const cutoff = Date.now() - DISMISS_DAYS * 86400000
  return all
    .filter((inv) => !(dismissed.value[`${props.nodeId}:${inv.key}`] > cutoff))
    .slice(0, 3)
})
</script>

<template>
  <transition-group v-if="invitations.length" name="notice" tag="div" class="noticing">
    <div v-for="inv in invitations" :key="inv.key" class="notice-card schools-card">
      <span class="notice-text">{{ inv.text }}</span>
      <span class="notice-actions">
        <button v-if="inv.walk" type="button" class="notice-cta notice-cta-walk" :data-walk-cta="inv.walk" @click="startWalk(inv.walk)">{{ inv.ctaLabel }}</button>
        <router-link v-else-if="inv.to" :to="inv.to" class="notice-cta">{{ inv.ctaLabel }}</router-link>
        <button type="button" class="notice-dismiss" aria-label="Dismiss" @click="dismiss(inv.key)">×</button>
      </span>
    </div>
  </transition-group>
</template>

<style scoped>
.noticing { display: flex; flex-direction: column; gap: var(--space-2); }
.notice-card {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid rgba(var(--tone-amber, 194 132 58), 0.55);
}
.notice-text { font-size: var(--text-sm); color: var(--schools-fg-2, #555); line-height: 1.5; }
.notice-actions { display: inline-flex; align-items: center; gap: var(--space-2); flex-shrink: 0; }
.notice-cta {
  font-size: var(--text-xs); font-weight: var(--font-semibold); color: var(--schools-red, #DB1E17);
  text-decoration: none; white-space: nowrap;
}
.notice-cta:hover { text-decoration: underline; text-underline-offset: 3px; }
.notice-cta-walk { background: none; border: none; cursor: pointer; padding: 0; font: inherit; font-size: var(--text-xs); font-weight: var(--font-semibold); }
.notice-dismiss {
  background: none; border: none; cursor: pointer; padding: 0 4px; line-height: 1;
  font-size: 16px; color: var(--schools-fg-3, #8A8078);
}
.notice-dismiss:hover { color: var(--schools-fg, #0F1212); }
.notice-enter-active, .notice-leave-active { transition: opacity 0.15s ease; }
.notice-enter-from, .notice-leave-to { opacity: 0; }
</style>
