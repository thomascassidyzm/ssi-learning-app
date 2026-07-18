<script setup lang="ts">
// The one create surface — three modes over the same WHO x WHERE x WHAT x
// LIMITS primitive (docs/invites-redesign/DESIGN.md). Deep-linkable via
// ?mode=org|direct|demo (+ ?sub= for direct's code/email/preview variant).
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import OrgInviteForm from './OrgInviteForm.vue'
import DirectAccessForm from './DirectAccessForm.vue'
import DemoOrgCreateForm from './DemoOrgCreateForm.vue'

type Mode = 'org' | 'direct' | 'demo'

const emit = defineEmits<{ created: [] }>()

const route = useRoute()
const router = useRouter()

function normalizeMode(v: unknown): Mode {
  return v === 'direct' || v === 'demo' ? v : 'org'
}

const mode = computed<Mode>(() => normalizeMode(route.query.mode))

function setMode(m: Mode): void {
  router.replace({ query: { ...route.query, mode: m } })
}

const initialSub = computed(() => (typeof route.query.sub === 'string' ? route.query.sub : undefined))
const initialWho = computed(() => (typeof route.query.who === 'string' ? route.query.who : undefined))
</script>

<template>
  <div class="schools-card create-panel">
    <div class="panel-head">
      <span class="schools-kicker">Create invite</span>
      <div class="mode-toggle" role="tablist">
        <button
          type="button" role="tab" class="mode-btn"
          :class="{ 'is-active': mode === 'org' }"
          :aria-selected="mode === 'org'"
          @click="setMode('org')"
        >Into an organisation</button>
        <button
          type="button" role="tab" class="mode-btn"
          :class="{ 'is-active': mode === 'direct' }"
          :aria-selected="mode === 'direct'"
          @click="setMode('direct')"
        >Direct access</button>
        <button
          type="button" role="tab" class="mode-btn"
          :class="{ 'is-active': mode === 'demo' }"
          :aria-selected="mode === 'demo'"
          @click="setMode('demo')"
        >New demo org</button>
      </div>
    </div>

    <OrgInviteForm v-if="mode === 'org'" :initial-who="initialWho" @created="emit('created')" />
    <DirectAccessForm v-else-if="mode === 'direct'" :initial-sub="initialSub" @created="emit('created')" />
    <DemoOrgCreateForm v-else @created="emit('created')" />
  </div>
</template>

<style scoped>
.create-panel {
  padding: 0;
  overflow: hidden;
}

.panel-head {
  padding: var(--space-4) var(--space-6) var(--space-3);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.mode-toggle {
  display: inline-flex;
  background: rgba(44, 38, 34, 0.05);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  padding: 3px;
  gap: 2px;
  flex-wrap: wrap;
}

.mode-btn {
  font: inherit;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  padding: 6px 14px;
  border: none;
  background: transparent;
  border-radius: var(--radius-full);
  color: var(--schools-fg-3);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.mode-btn:hover { color: var(--schools-fg); }

.mode-btn.is-active {
  background: var(--schools-red);
  color: #fff;
  box-shadow: 0 1px 2px rgba(44, 38, 34, 0.10), 0 4px 12px rgba(194, 58, 58, 0.20);
}

@media (max-width: 768px) {
  .panel-head { flex-direction: column; align-items: stretch; }
  .mode-toggle { justify-content: center; }
}
</style>
