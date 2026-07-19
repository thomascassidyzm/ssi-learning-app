<script setup lang="ts">
/**
 * AdminTopBar — dark top bar for the /admin surface.
 *
 * Sibling of SchoolsTopBar but dark instead of white. Signals
 * "admin / elevated tooling" mode. Uses Arsenal display +
 * Open Sans body to match the new schools design system.
 *
 * Information hierarchy (2026-07-17 redesign): the bar shows only the
 * everyday sections as flat tabs (Structure / Invites / Users / Stats /
 * Insights — the four admin ideas, numbers being two surfaces); the
 * rest live in a grouped "More" menu (NavMoreMenu) where each entry
 * carries an icon + one-line description — nine flat labels conveyed
 * nothing and crowded out the context bar below. The bar is ONE row at
 * every width: below 980px the tabs collapse into a single menu whose
 * trigger shows the CURRENT section name, so "where am I" survives the
 * collapse instead of losing to the chrome.
 *
 * Invites unification (2026-07-17, same day): Demos, Try Links and Access
 * folded into one /admin/invites surface (docs/invites-redesign/DESIGN.md)
 * — one create card (org / direct / demo) + one live list. The three old
 * More-menu entries collapse to a single "Invites" item.
 *
 * Active-tab indicator is yellow (--schools-gold), distinct from
 * the red used on the schools surface.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NavMoreMenu, { type NavMenuGroup, type NavMenuItem } from '@/components/shared/NavMoreMenu.vue'
import RefreshButton from '@/components/shared/RefreshButton.vue'

const route = useRoute()

// Icon paths: 24px grid, stroked — meaning at a glance in the menu.
const ICONS: Record<string, string[]> = {
  setup: ['M3 21h18', 'M5 21V7l7-4 7 4v14', 'M9 21v-6h6v6'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  stats: ['M18 20V10', 'M12 20V4', 'M6 20v-6'],
  insights: ['M9 18h6', 'M10 22h4', 'M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.4 1 2.3h6c0-.9.4-1.8 1-2.3A7 7 0 0 0 12 2z'],
  onboarding: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  access: ['M21 2l-9.6 9.6', 'M15.5 7.5l3 3', 'M11 13a4 4 0 1 1-5.66 5.66A4 4 0 0 1 11 13z'],
  methodology: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
}

// The everyday ideas stay flat on the bar (2026-07-18 §1.10 revision — "the
// invites page dies": ways-in now lives ON the node in Structure, one tap
// away, not a destination you have to find first. /admin/invites is demoted
// to a hidden audit list in the More menu below — never a flat tab again.
const primaryTabs: NavMenuItem[] = [
  {
    label: 'Structure',
    to: '/admin/structure',
    desc: 'The org tree — groups, schools, staff, ways in',
    iconPaths: ICONS.setup,
    match: (p) => p === '/admin' || p.startsWith('/admin/structure') || p.startsWith('/admin/setup') || p.startsWith('/admin/schools'),
  },
  {
    label: 'Users',
    to: '/admin/users',
    desc: 'Find and manage any user',
    iconPaths: ICONS.users,
    match: (p) => p.startsWith('/admin/users'),
  },
  {
    label: 'Stats',
    to: '/admin/stats',
    desc: 'Lifecycle, rates and ops boards',
    iconPaths: ICONS.stats,
    match: (p) => p.startsWith('/admin/stats'),
  },
  {
    label: 'Insights',
    to: '/admin/insights',
    desc: 'Insight Engine discovery feed',
    iconPaths: ICONS.insights,
    match: (p) => p.startsWith('/admin/insights'),
  },
]

// Everything else collapses into the grouped More menu.
const moreGroups: NavMenuGroup[] = [
  {
    label: 'Provisioning',
    items: [
      {
        label: 'Onboarding',
        to: '/admin/onboarding',
        desc: 'Onboarding message series',
        iconPaths: ICONS.onboarding,
        match: (p) => p.startsWith('/admin/onboarding'),
      },
      {
        label: 'Invites (audit)',
        to: '/admin/invites',
        desc: 'Every code ever minted — read-only; make new ones from a node in Structure',
        iconPaths: ICONS.access,
        match: (p) => p.startsWith('/admin/invites'),
      },
    ],
  },
  {
    label: 'Platform',
    items: [
      {
        label: 'Methodology',
        to: '/admin/methodology',
        desc: 'Measuring-progress papers and demos',
        iconPaths: ICONS.methodology,
        match: (p) => p.startsWith('/admin/methodology'),
      },
    ],
  },
]

// Collapsed (narrow) menu: the same destinations, one menu, sections first.
const allGroups: NavMenuGroup[] = [{ label: 'Sections', items: primaryTabs }, ...moreGroups]

function isActive(tab: NavMenuItem): boolean {
  return tab.match ? tab.match(route.path) : route.path.startsWith(tab.to)
}

// The collapsed trigger names the CURRENT section — identity over chrome.
const currentSectionLabel = computed(() => {
  const all = [...primaryTabs, ...moreGroups.flatMap((g) => g.items)]
  return all.find(isActive)?.label ?? 'Menu'
})

const showTabs = computed(() => route.path.startsWith('/admin'))
</script>

<template>
  <header class="admin-topbar">
    <div class="left">
      <router-link to="/" class="back-link" aria-label="Back to app">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>App</span>
      </router-link>

      <router-link to="/admin/structure" class="brand">
        <span class="brand-mark">S</span>
        <span class="brand-text">SSi Admin</span>
      </router-link>
    </div>

    <div class="right">
      <template v-if="showTabs">
        <!-- Wide: flat everyday tabs + grouped More -->
        <nav class="tabs" aria-label="Admin sections">
          <router-link
            v-for="t in primaryTabs"
            :key="t.to"
            :to="t.to"
            :class="['tab', { active: isActive(t) }]"
          >
            {{ t.label }}
          </router-link>
          <NavMoreMenu :groups="moreGroups" trigger-label="More" trigger-class="tab" align="right" />
        </nav>

        <!-- Narrow: everything in one grouped menu; trigger names the current section -->
        <nav class="tabs-collapsed" aria-label="Admin sections">
          <NavMoreMenu :groups="allGroups" :trigger-label="currentSectionLabel" trigger-class="tab" align="right" />
        </nav>
      </template>

      <!-- The ONE universal refresh affordance — same button, same spot as the
           schools surface (consistency law §1.12). Renders only where a loader
           is registered. -->
      <RefreshButton />
    </div>
  </header>
</template>

<style scoped>
.admin-topbar {
  height: calc(54px + env(safe-area-inset-top, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* Top inset keeps controls out of the status bar; left/right insets cover
     landscape notches (standing rule — always avoid phone safe areas). */
  padding: env(safe-area-inset-top, 0px) max(24px, env(safe-area-inset-right, 0px)) 0 max(24px, env(safe-area-inset-left, 0px));
  background: #050508;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex: none;
  font-family: 'Open Sans', 'Trebuchet MS', system-ui, Arial, sans-serif;
  color: #fff;
  position: sticky;
  top: 0;
  z-index: 60;

  /* NavMoreMenu trigger on the dark surface */
  --nvm-trigger-color: rgba(255, 255, 255, 0.6);
  --nvm-trigger-hover-bg: rgba(255, 255, 255, 0.06);
  --nvm-active-color: #fff;
}

.right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.left {
  display: flex;
  align-items: center;
  gap: 18px;
  min-width: 0;
  flex: none;
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
  white-space: nowrap;
}

/* ─────────────── Tabs ─────────────── */
.tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.tabs-collapsed {
  display: none;
  align-items: center;
}

.tab,
.tabs :deep(.tab),
.tabs-collapsed :deep(.tab) {
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

.tab.active,
.tabs :deep(.tab.is-active),
.tabs-collapsed :deep(.tab) {
  color: #fff;
}

.tab.active::after,
.tabs :deep(.tab.is-active)::after,
.tabs-collapsed :deep(.tab.is-active)::after {
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

/* ─────────────── Responsive: ONE row at every width ─────────────── */
@media (max-width: 980px) {
  .tabs { display: none; }
  .tabs-collapsed { display: flex; }
}

@media (max-width: 640px) {
  .admin-topbar { padding-left: max(12px, env(safe-area-inset-left, 0px)); padding-right: max(12px, env(safe-area-inset-right, 0px)); }
  .back-link span { display: none; }
  .brand-text { display: none; }
  .left { gap: 8px; }
}
</style>
