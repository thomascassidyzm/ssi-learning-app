<script setup lang="ts">
// Invites — one primitive, one surface (docs/invites-redesign/DESIGN.md).
// Replaces the creation/list halves of /admin/access, /admin/demos and
// /admin/try-links: one create card (org / direct / demo modes) + one live
// list aggregated across invite_codes, entitlement_codes, email_access_grants
// and try_links.
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import InviteCreateCard from '@/components/admin/invites/InviteCreateCard.vue'
import WalkOffer from '@/components/admin/WalkOffer.vue'
import DemoOrgsPanel from '@/components/admin/invites/DemoOrgsPanel.vue'
import UnifiedInviteList from '@/components/admin/invites/UnifiedInviteList.vue'

const route = useRoute()
const router = useRouter()

const demoOrgsPanelRef = ref<InstanceType<typeof DemoOrgsPanel> | null>(null)
const inviteListRef = ref<InstanceType<typeof UnifiedInviteList> | null>(null)

const isDemoMode = computed(() => route.query.mode === 'demo')

function onCreated(): void {
  inviteListRef.value?.refresh()
  demoOrgsPanelRef.value?.refresh()
}
</script>

<template>
  <div class="admin-invites">
    <header class="page-header">
      <div class="title-block">
        <span class="schools-kicker">Access</span>
        <h1 class="arsenal">Invites</h1>
        <p class="subtitle">
          One primitive — who × where × what × limits; every link that lets someone in, real or demo.
        </p>
      </div>
      <WalkOffer persona="admin" place="admin-invites" />
    </header>

    <InviteCreateCard @created="onCreated" />

    <DemoOrgsPanel v-if="isDemoMode" ref="demoOrgsPanelRef" />
    <button
      v-else
      type="button"
      class="demo-summary-link"
      @click="router.replace({ query: { ...route.query, mode: 'demo' } })"
    >Manage demo organisations →</button>

    <UnifiedInviteList ref="inviteListRef" />
  </div>
</template>

<style scoped>
.admin-invites {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.page-header { margin-bottom: 22px; }

.title-block .schools-kicker {
  font-family: var(--font-mono, 'Spline Sans Mono', monospace);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red, #DB1E17);
}

.title-block h1 {
  font-family: var(--font-display);
  font-size: clamp(30px, 4vw, 44px);
  font-weight: 400;
  line-height: 1.04;
  letter-spacing: -0.015em;
  color: var(--ink-primary, #2C2622);
  margin: 8px 0 10px;
}

.subtitle {
  font-size: 16px;
  line-height: 1.55;
  color: var(--ink-secondary, #5b534c);
  max-width: 64ch;
  margin: 0;
}

.demo-summary-link {
  align-self: flex-start;
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--schools-fg-2);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}

.demo-summary-link:hover { color: var(--schools-red); text-decoration: underline; }
</style>
