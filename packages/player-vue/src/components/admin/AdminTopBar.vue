<script setup lang="ts">
/**
 * AdminTopBar — the ONE bar over SSi's internal surfaces: the ten questions
 * under /intel and the organisation tree, the people list and the tools
 * under /admin.
 *
 * THE DARK BAR DIED HERE (design §3.3; Tom's ruling 2026-09-10: "share"). A
 * black bar with a gold indicator above a putty-and-white page shared
 * nothing with the page under it, and it was the single largest source of
 * "disjointed". This is the schools top bar's own vocabulary — white on
 * putty, brand red active tab, Arsenal wordmark, Open Sans tabs — so the
 * internal surfaces and the org dashboard are one visual family. It uses the
 * existing --schools-* tokens and introduces no hex value of its own.
 *
 * WHAT IS IN IT, and why nothing else. The ten questions, grouped as
 * Learners, Content and Business, every one of them one tap from every page
 * of the surface — the tap-count rule the design makes checkable and
 * AdminTopBar.test.ts walks. Organisations is the org tree, which stays
 * exactly as it is and which question 10 links into. People is the list you
 * find one person in. Tools is the door for the chores that are not
 * questions: release notes, the invites audit list, the methodology papers
 * and the Handbook. Below 1180px the same destinations collapse into one menu
 * whose trigger names the CURRENT section, so "where am I" survives.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NavMoreMenu, { type NavMenuGroup, type NavMenuItem } from '@/components/shared/NavMoreMenu.vue'
import RefreshButton from '@/components/shared/RefreshButton.vue'
import ViewAsPicker from '@/components/admin/ViewAsPicker.vue'
import { QUESTIONS, QUESTION_GROUPS, questionPath, type Question } from '@/intel/questions'

const route = useRoute()

// Icon paths: 24px grid, stroked — meaning at a glance in a menu.
const ICONS: Record<string, string[]> = {
  tree: ['M3 21h18', 'M5 21V7l7-4 7 4v14', 'M9 21v-6h6v6'],
  people: ['M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  notes: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h8'],
  access: ['M21 2l-9.6 9.6', 'M15.5 7.5l3 3', 'M11 13a4 4 0 1 1-5.66 5.66A4 4 0 0 1 11 13z'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  question: ['M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
}

/** A question as a menu item, so the collapsed menu carries the same list. */
function questionItem(q: Question): NavMenuItem {
  return {
    label: q.tab,
    to: questionPath(q),
    desc: q.question,
    iconPaths: ICONS.question,
    match: (p) => p === questionPath(q),
  }
}

/** The ten, grouped — one group per design group, in the design's order. */
const questionGroups: NavMenuGroup[] = QUESTION_GROUPS.map((group) => ({
  label: group,
  items: QUESTIONS.filter((q) => q.group === group).map(questionItem),
}))

/** The scope pickers: the two trees you find a named thing in. */
const scopeTabs: NavMenuItem[] = [
  {
    label: 'Organisations',
    to: '/admin/structure',
    desc: 'The organisation tree — groups, schools, classes, ways in',
    iconPaths: ICONS.tree,
    match: (p) =>
      p === '/admin' || p.startsWith('/admin/structure') || p.startsWith('/admin/groups')
      || p.startsWith('/admin/schools') || p.startsWith('/admin/classes'),
  },
  {
    label: 'People',
    to: '/admin/users',
    desc: 'Find one person by name, email or support id',
    iconPaths: ICONS.people,
    match: (p) => p.startsWith('/admin/users'),
  },
]

/** The chores that are not questions, behind one door. */
const toolGroups: NavMenuGroup[] = [
  {
    label: 'Tools',
    items: [
      { label: 'Release notes', to: '/admin/release-notes', desc: "Curate the What's New panel in Settings", iconPaths: ICONS.notes, match: (p) => p.startsWith('/admin/release-notes') },
      { label: 'Invites audit', to: '/admin/invites', desc: 'Every code ever minted — make new ones from a node in Organisations', iconPaths: ICONS.access, match: (p) => p.startsWith('/admin/invites') },
      { label: 'Methodology', to: '/admin/methodology', desc: 'Measuring-progress papers and demos', iconPaths: ICONS.book, match: (p) => p.startsWith('/admin/methodology') },
      { label: 'Handbook', to: '/admin/handbook', desc: 'Everything the org dashboard can do, compiled from the code', iconPaths: ICONS.book, match: (p) => p.startsWith('/admin/handbook') },
    ],
  },
]

/** Collapsed: everything, one menu, questions first. */
const allGroups: NavMenuGroup[] = [...questionGroups, { label: 'Find', items: scopeTabs }, ...toolGroups]

function isActive(item: NavMenuItem): boolean {
  return item.match ? item.match(route.path) : route.path.startsWith(item.to)
}

// The collapsed trigger names the CURRENT section — identity over chrome.
const currentSectionLabel = computed(() => {
  const all = allGroups.flatMap((g) => g.items)
  return all.find(isActive)?.label ?? 'Menu'
})
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

      <router-link to="/intel/pulse" class="brand arsenal">
        <span class="brand-mark">S</span>
        <span class="brand-text">SSi</span>
      </router-link>
    </div>

    <div class="right">
      <!-- Wide: the ten questions in their groups, the two scope pickers, and
           the Tools door. Every question is a direct link — one tap. -->
      <nav class="tabs" aria-label="The ten questions">
        <div v-for="g in questionGroups" :key="g.label" class="tab-group">
          <span class="group-name">{{ g.label }}</span>
          <router-link
            v-for="item in g.items"
            :key="item.to"
            :to="item.to"
            :class="['tab', { active: isActive(item) }]"
            :title="item.desc"
          >{{ item.label }}</router-link>
        </div>
        <span class="divider" aria-hidden="true"></span>
        <router-link
          v-for="item in scopeTabs"
          :key="item.to"
          :to="item.to"
          :class="['tab', { active: isActive(item) }]"
          :title="item.desc"
        >{{ item.label }}</router-link>
        <NavMoreMenu :groups="toolGroups" trigger-label="Tools" trigger-class="tab" align="right" />
      </nav>

      <!-- Narrow: everything in one menu; the trigger names the current section. -->
      <nav class="tabs-collapsed" aria-label="Sections">
        <NavMoreMenu :groups="allGroups" :trigger-label="currentSectionLabel" trigger-class="tab" align="right" />
      </nav>

      <ViewAsPicker />
      <RefreshButton />
    </div>
  </header>
</template>

<style scoped>
.admin-topbar {
  min-height: calc(54px + env(safe-area-inset-top, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* Top inset keeps controls out of the status bar; left/right insets cover
     landscape notches — the standing safe-area rule. */
  padding: env(safe-area-inset-top, 0px) max(20px, env(safe-area-inset-right, 0px)) 0 max(20px, env(safe-area-inset-left, 0px));
  background: var(--schools-card);
  border-bottom: 1px solid var(--schools-border);
  flex: none;
  font-family: 'Open Sans', 'Trebuchet MS', system-ui, Arial, sans-serif;
  color: var(--schools-fg);
  position: sticky;
  top: 0;
  z-index: 60;

  --nvm-trigger-color: var(--schools-fg-2);
  --nvm-trigger-hover-bg: var(--schools-bg);
  --nvm-active-color: var(--schools-fg);
}

.left { display: flex; align-items: center; gap: 14px; min-width: 0; flex: none; }
.right { display: flex; align-items: center; gap: 6px; min-width: 0; }

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--schools-radius-sm);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--schools-fg-3);
  text-decoration: none;
}
.back-link:hover { color: var(--schools-red); background: var(--schools-bg); }

.brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  color: var(--schools-fg);
  flex: none;
}
.brand-mark {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: var(--schools-red);
  color: var(--schools-card);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  line-height: 1;
}
.brand-text { font-size: 17px; line-height: 1; white-space: nowrap; }

.tabs { display: flex; align-items: center; gap: 4px; min-width: 0; flex-wrap: wrap; }
.tabs-collapsed { display: none; align-items: center; }

.tab-group { display: flex; align-items: center; gap: 2px; }
.group-name {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--schools-red);
  padding: 0 4px 0 10px;
}
.divider { width: 1px; height: 22px; background: var(--schools-border); margin: 0 6px; }

.tab,
.tabs :deep(.tab),
.tabs-collapsed :deep(.tab) {
  padding: 6px 10px 7px;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  color: var(--schools-fg-2);
  background: transparent;
  border-radius: var(--schools-radius-md);
  white-space: nowrap;
  transition: color 120ms ease-out, background 120ms ease-out;
}
.tab:hover { color: var(--schools-fg); background: var(--schools-bg); }
.tab.active,
.tabs :deep(.tab.is-active),
.tabs-collapsed :deep(.tab.is-active) {
  color: var(--schools-card);
  background: var(--schools-red);
}
.tab.active:hover { background: var(--schools-red-deep); }

@media (max-width: 1180px) {
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
