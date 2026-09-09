<script setup lang="ts">
/**
 * AdminTopBar — dark top bar for the /admin surface.
 *
 * Sibling of SchoolsTopBar but dark instead of white. Signals
 * "admin / elevated tooling" mode. Uses Arsenal display +
 * Open Sans body to match the new schools design system.
 *
 * Active-tab indicator is yellow (--schools-gold), distinct from
 * the red used on the schools surface.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'

type AdminTab = { label: string; to: string; match: (path: string) => boolean }

const route = useRoute()

const tabs: AdminTab[] = [
  {
    label: 'Setup',
    to: '/admin/setup',
    match: (p) => p === '/admin' || p.startsWith('/admin/setup') || p.startsWith('/admin/schools'),
  },
  {
    label: 'Access',
    to: '/admin/access',
    match: (p) => p === '/admin/access',
  },
  {
    label: 'Demo Schools',
    to: '/admin/demo-schools',
    match: (p) => p.startsWith('/admin/demo-schools'),
  },
  {
    label: 'Users',
    to: '/admin/users',
    match: (p) => p.startsWith('/admin/users'),
  },
  {
    label: 'Stats',
    to: '/admin/stats',
    match: (p) => p.startsWith('/admin/stats'),
  },
  {
    label: 'Try Links',
    to: '/admin/try-links',
    match: (p) => p === '/admin/try-links',
  },
  {
    label: 'Methodology',
    to: '/admin/methodology',
    match: (p) => p.startsWith('/admin/methodology'),
  },
  {
    label: 'Onboarding',
    to: '/admin/onboarding',
    match: (p) => p.startsWith('/admin/onboarding'),
  },
  {
    label: 'Insights',
    to: '/admin/insights',
    match: (p) => p.startsWith('/admin/insights'),
  },
]

function isActive(tab: AdminTab): boolean {
  return tab.match(route.path)
}

const showTabs = computed(() => route.path.startsWith('/admin'))
</script>

<template>
  <header class="admin-topbar">
    <div class="left">
      <router-link to="/" class="back-link" aria-label="Back to app">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>Back to App</span>
      </router-link>

      <router-link to="/admin/setup" class="brand">
        <span class="brand-mark">S</span>
        <span class="brand-text">SSi Admin</span>
      </router-link>
    </div>

    <nav v-if="showTabs" class="tabs" aria-label="Admin sections">
      <router-link
        v-for="t in tabs"
        :key="t.to"
        :to="t.to"
        :class="['tab', { active: isActive(t) }]"
      >
        {{ t.label }}
      </router-link>
    </nav>
  </header>
</template>

<style scoped>
.admin-topbar {
  height: calc(54px + env(safe-area-inset-top, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #050508;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex: none;
  font-family: 'Open Sans', 'Trebuchet MS', system-ui, Arial, sans-serif;
  color: #fff;
  position: sticky;
  top: 0;
  z-index: 60;
  padding-top: env(safe-area-inset-top, 0px);
}

.left {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
}

/* ─────────────── Back link ─────────────── */
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 5px;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  text-decoration: none;
  transition: color 160ms ease, background 160ms ease;
}

.back-link:hover {
  color: var(--schools-gold, #FEC902);
  background: rgba(255, 255, 255, 0.04);
}

.back-link svg {
  transition: transform 160ms ease;
}

.back-link:hover svg {
  transform: translateX(-2px);
}

/* ─────────────── Brand wordmark ─────────────── */
.brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  color: inherit;
  flex: none;
}

.brand-mark {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--schools-red, #DB1E17);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Arsenal', 'Georgia', serif;
  font-weight: 400;
  font-size: 15px;
  line-height: 1;
}

.brand-text {
  font-family: 'Arsenal', 'Georgia', serif;
  font-size: 17px;
  line-height: 1;
  letter-spacing: 0.005em;
  color: #fff;
}

/* ─────────────── Tabs ─────────────── */
.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
}

.tab {
  position: relative;
  padding: 8px 14px 9px;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.6);
  background: transparent;
  border-radius: 6px;
  white-space: nowrap;
  transition: color 160ms ease-out, background 160ms ease-out;
}

.tab:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.06);
}

.tab.active {
  color: #fff;
}

.tab.active::after {
  content: '';
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 2px;
  height: 2px;
  background: var(--schools-gold, #FEC902);
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(254, 201, 2, 0.4);
}

/* ─────────────── Responsive ─────────────── */
@media (max-width: 1024px) {
  .admin-topbar {
    height: auto;
    flex-direction: column;
    align-items: stretch;
    padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px;
    gap: 8px;
  }
  .tabs {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .tabs::-webkit-scrollbar { display: none; }
  .tab { flex-shrink: 0; }
}

@media (max-width: 640px) {
  .back-link span { display: none; }
  .admin-topbar { padding: calc(8px + env(safe-area-inset-top, 0px)) 12px 8px; }
}
</style>
