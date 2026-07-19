<script setup lang="ts">
/**
 * MethodologyContainer — layout for the /methodology explainer pages.
 *
 * The top-level router guard (router/index.ts beforeEach) only defers on an
 * unresolved role cache; useAdminGate is this container's own reactive
 * gate — same shape as AdminContainer, so a cold-cache non-admin deep link
 * is denied before any child page renders, and a mid-session downgrade
 * revokes access live (Trinity audit, docs/trinity/admin.md). Mirrors the
 * AdminContainer pattern otherwise: dark top bar signals "internal tooling"
 * mode, schools-tokens + schools-design.css provide the visual language so
 * everything looks native to the rest of the admin surface.
 *
 * Pages explain the metrics architecture from
 * docs/methodology/metrics-architecture.md using real (anonymised) learner
 * data — spec by demonstration. See §9 of the methodology spec for the
 * audience framing.
 */
import { computed } from 'vue'
import { useRoute, RouterLink, RouterView } from 'vue-router'
import { useAdminGate } from '@/composables/useAdminGate'
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'

const route = useRoute()
const { isCheckingAccess, isDenied } = useAdminGate()

type MethodologyTab = { label: string; to: string; match: (path: string) => boolean }

const tabs: MethodologyTab[] = [
  {
    label: 'Overview',
    to: '/methodology',
    match: (p) => p === '/methodology' || p === '/methodology/',
  },
  {
    label: 'Empirical baseline',
    to: '/methodology/empirical-baseline',
    match: (p) => p === '/methodology/empirical-baseline',
  },
]

function isActive(tab: MethodologyTab): boolean {
  return tab.match(route.path)
}

const showTabs = computed(() => route.path.startsWith('/methodology'))
</script>

<template>
  <div class="methodology-container schools-surface">
    <header class="methodology-topbar">
      <div class="left">
        <RouterLink to="/admin" class="back-link" aria-label="Back to admin">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span>Back to Admin</span>
        </RouterLink>
        <RouterLink to="/methodology" class="brand">
          <span class="brand-mark">M</span>
          <span class="brand-text">Methodology</span>
        </RouterLink>
      </div>

      <nav v-if="showTabs" class="tabs" aria-label="Methodology sections">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="tab"
          :class="{ 'is-active': isActive(tab) }"
        >
          {{ tab.label }}
        </RouterLink>
      </nav>
    </header>

    <div v-if="isCheckingAccess || isDenied" class="methodology-loading">
      <div class="loading-spinner"></div>
      <p>Loading…</p>
    </div>
    <main v-else class="methodology-main">
      <RouterView v-slot="{ Component }">
        <transition name="page" mode="out-in">
          <component :is="Component" />
        </transition>
      </RouterView>
    </main>
  </div>
</template>

<style scoped>
.methodology-container {
  /* Owns its scroll: body carries overflow:hidden app-wide (Android bounce
     fix in style.css) — same pattern as AdminContainer (founder pass A). */
  height: 100vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  background: var(--schools-bg, #f6f5f1);
  color: var(--schools-fg, #0F1212);
}

/* ================================================================
 * TOP BAR — Dark, mirroring AdminTopBar but scoped to methodology
 * ================================================================ */
.methodology-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 28px;
  background: #050508;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-wrap: wrap;
}

.left {
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 32px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 12.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.55);
  text-decoration: none;
  transition: color 160ms ease;
}

.back-link:hover {
  color: var(--schools-gold, #FEC902);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: #fff;
}

.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--schools-gold, #FEC902);
  color: #050508;
  font-family: 'Arsenal', serif;
  font-weight: 700;
  font-size: 16px;
}

.brand-text {
  font-family: 'Arsenal', serif;
  font-size: 17px;
  letter-spacing: 0.01em;
}

/* Tabs */
.tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  flex-wrap: wrap;
}

.tab {
  padding: 6px 14px 7px;
  font-family: 'Open Sans', system-ui, sans-serif;
  font-size: 12.5px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
  text-decoration: none;
  border-radius: 999px;
  transition: background 160ms ease, color 160ms ease;
}

.tab:hover {
  color: #fff;
}

.tab.is-active {
  background: #fff;
  color: #050508;
}

/* ================================================================
 * MAIN CONTENT — putty parchment
 * ================================================================ */
.methodology-main {
  flex: 1;
  padding: 28px 32px 48px;
  max-width: 1280px;
  margin: 0 auto;
  width: 100%;
}

/* Access-gate loading state (cold load with no cached role yet) */
.methodology-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 16px;
  color: rgba(255, 255, 255, 0.5);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(255, 255, 255, 0.15);
  border-top-color: var(--schools-gold, #FEC902);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Page transition */
.page-enter-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.page-leave-active {
  transition: opacity 0.15s ease;
}
.page-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.page-leave-to {
  opacity: 0;
}

@media (max-width: 1024px) {
  .methodology-main {
    padding: 24px 20px 40px;
  }
}

@media (max-width: 768px) {
  .methodology-topbar {
    padding: 12px 16px;
  }
  .methodology-main {
    padding: 20px 16px 32px;
  }
}
</style>
