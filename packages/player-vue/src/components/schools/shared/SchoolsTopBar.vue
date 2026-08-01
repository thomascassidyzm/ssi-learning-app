<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { usePlayAsClassContext } from '@/composables/schools/usePlayAsClassContext'
import PlayAsClassIdentity from './PlayAsClassIdentity.vue'
import RefreshButton from '@/components/shared/RefreshButton.vue'

type NavTab = {
  label: string
  to: string
  routeName?: string
  /** When set, the tab is active only if the route's ?lens matches too —
   * distinguishes the Schools tab (node home, schools lens) from plain
   * node-home navigation. */
  lens?: string
}

const route = useRoute()
const router = useRouter()
const { currentUser, isGovtAdmin, isSchoolAdmin, clear: clearSchoolContext } = useSchoolContext()

// Play-as-class: while a class session is live, a SLIM in-nav chip names the
// class (school demoted inside it) so a teacher always knows WHICH class is
// on screen. The section tabs and hamburger STAY — the schools top nav
// persists on every screen a schools user reaches, including inside the
// player (founder ruling, 2026-07-30; the old mode dropped them and swelled
// the bar, which read as the player "taking over"). Only the self-practice
// Learn launcher is dropped: mid-class-session it's the one affordance that
// would be actively confusing, and the chip's End session takes its place.
const { isPlayingAsClass, className, exitClassSession } = usePlayAsClassContext()

const auth = inject<any>('auth', null)

const tabs = computed<NavTab[]>(() => {
  // Until the school context resolves (ctx.loadFromAuth is async), the role
  // is unknown — render NO tabs rather than the teacher fallback set. The
  // wrong-role flash was real and measurable: for the first ~0.5s after a
  // cold boot a school_admin saw the teacher tabs (no Classes/Teachers/
  // Settings), so an early click landed on a tab set that then changed
  // under the pointer.
  if (!currentUser.value) return []
  if (isGovtAdmin.value) {
    // THE VIEW (docs/THE-VIEW.md) is the ONE frame for hierarchy leaders —
    // the tabs point at the node surface (node home with the schools lens +
    // node insights), never the retired pre-hierarchy flat views. The old
    // tab set landed a group leader on the flat All-schools list and a
    // teacher-scoped Analytics that showed 'No classes yet' to a leader
    // whose dashboard showed 23 practising classes (founder-found on prod,
    // 2026-07-29).
    const groupId = currentUser.value.group_id
    if (groupId) {
      return [
        { label: 'Schools',  to: `/org/${groupId}?lens=schools`, routeName: 'org-node-home', lens: 'schools' },
        { label: 'Insights', to: `/org/${groupId}/insights`, routeName: 'org-node-insights' },
      ]
    }
    // Legacy leaders with no group (region_code-only govt_admin rows) have
    // no node to scope to — they keep the flat views until migrated (same
    // fallback DashboardView documents for its node-home redirect).
    return [
      { label: 'Schools',   to: '/schools/all',       routeName: 'schools-list' },
      { label: 'Analytics', to: '/schools/analytics', routeName: 'analytics' },
    ]
  }
  if (isSchoolAdmin.value) {
    // Settings lives in the user menu (account-shaped, not a daily
    // destination) — fewer tabs means the school name keeps its space.
    //
    // THE VIEW convergence, third persona (founder ruling, 2026-07-30: "it's
    // better to have consistency - they should also have the hierarchical
    // LHS WHERE YOU ARE menu"): a school leader's Dashboard IS their school's
    // node home (/org/:schoolId — the endpoint bridges the school id
    // to its node), and Insights the node insights — same door govt_admin
    // went through (2026-07-29). Teachers tab retired: teachers ARE the
    // school node's children, and Invite teacher lives on the node's verb
    // bar. Classes and Students stay flat for now — Play-as-Class and
    // student management have no node-surface equivalent yet.
    const schoolId = currentUser.value.school_id
    if (schoolId) {
      return [
        { label: 'Dashboard', to: `/org/${schoolId}`, routeName: 'org-node-home' },
        { label: 'Classes',   to: '/schools/classes',   routeName: 'classes' },
        { label: 'Students',  to: '/schools/students',  routeName: 'students' },
        { label: 'Insights',  to: `/org/${schoolId}/insights`, routeName: 'org-node-insights' },
        { label: 'Upgrade',   to: '/schools/upgrade',   routeName: 'schools-upgrade' },
      ]
    }
    // Legacy school_admin rows with no resolvable school keep the flat set
    // (same fallback shape as the no-group govt_admin above).
    return [
      { label: 'Dashboard', to: '/schools',           routeName: 'schools-dashboard' },
      { label: 'Classes',   to: '/schools/classes',   routeName: 'classes' },
      { label: 'Students',  to: '/schools/students',  routeName: 'students' },
      { label: 'Teachers',  to: '/schools/teachers',  routeName: 'teachers' },
      // "Insights" is the one word for the Insight Engine door everywhere
      // (govt tabs, node "See insights") — the destination is already THE
      // LENS's teacher wrapper, only the label was still the old generation.
      { label: 'Insights',  to: '/schools/analytics', routeName: 'analytics' },
      { label: 'Upgrade',   to: '/schools/upgrade',   routeName: 'schools-upgrade' },
    ]
  }
  // Teacher (default) — a school-employed teacher's billing is the school
  // admin's job, so no Upgrade tab. A GROUPLESS teacher (the derived tutor,
  // THE-MODEL §1.3/I5: no school_id) has nobody else to bill them, so they
  // need their own reachable Upgrade tab — same UpgradeView, whose tutor
  // lane (isSchoolLane false) already resolves their own teacher-billing
  // record via /api/teacher/me. Structure-gated, never on the 'tutor' label.
  const teacherTabs: NavTab[] = [
    { label: 'Dashboard', to: '/schools',           routeName: 'schools-dashboard' },
    { label: 'Students',  to: '/schools/students',  routeName: 'students' },
    // Same "Insights" unification as the school_admin set above.
    { label: 'Insights',  to: '/schools/analytics', routeName: 'analytics' },
  ]
  if (!currentUser.value.school_id) {
    teacherTabs.push({ label: 'Upgrade', to: '/schools/upgrade', routeName: 'schools-upgrade' })
  }
  return teacherTabs
})

function isActive(tab: NavTab): boolean {
  if (tab.routeName && route.name === tab.routeName) {
    if (tab.lens !== undefined) return route.query.lens === tab.lens
    return true
  }
  // /schools/classes/:id should keep "Classes" tab highlighted
  if (tab.to === '/schools/classes' && route.path.startsWith('/schools/classes')) return true
  return false
}

const displayName = computed(() => currentUser.value?.display_name || 'You')
const initials = computed(() =>
  displayName.value.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'SS',
)
const roleLabel = computed(() => {
  if (isGovtAdmin.value) return 'Govt Admin'
  if (isSchoolAdmin.value) return 'School Admin'
  return 'Teacher'
})
const roleAvatarColor = computed(() => {
  if (isGovtAdmin.value) return 'var(--schools-role-govt)'
  if (isSchoolAdmin.value) return 'var(--schools-role-admin)'
  return 'var(--schools-role-teacher)'
})
const schoolLabel = computed(() => currentUser.value?.school_name || '')

// Brand block. The "Schools" tail is a CLAIM about the surface, so it must not
// appear on the org/workplace lane (founder ruling 2026-08-02: an org is not a
// schools feature). A group leader sitting on the top-level node surface
// (/org/:id) gets the bare wordmark, pointing home at their own node instead
// of the /schools dashboard they have no business being sent to. Everywhere
// else — the whole schools lane, teachers included — is untouched.
const onOrgSurface = computed(
  () => isGovtAdmin.value && (route.path === '/org' || route.path.startsWith('/org/')),
)
const brandTail = computed(() => (onOrgSurface.value ? '' : 'Schools'))
const brandTo = computed(() => {
  if (!onOrgSurface.value) return '/schools'
  const groupId = currentUser.value?.group_id
  return groupId ? `/org/${groupId}` : '/'
})
const brandAria = computed(() =>
  onOrgSurface.value ? 'SaySomethingin' : 'SaySomethingin · Schools',
)

// User menu
const menuOpen = ref(false)
function toggleMenu() { menuOpen.value = !menuOpen.value }
function closeMenu() { menuOpen.value = false }

// Mobile nav (hamburger → drawer). Below the breakpoint the desktop tab bar is
// hidden; the same tabs live in this collapsible menu instead.
const mobileNavOpen = ref(false)
function toggleMobileNav() { mobileNavOpen.value = !mobileNavOpen.value }
function closeMobileNav() { mobileNavOpen.value = false }

async function signOut() {
  closeMenu()
  try {
    await auth?.signOut?.()
  } catch (err) {
    console.error('[SchoolsTopBar] sign-out failed', err)
  }
  // auth.signOut() clears the role cache + entitlements but not this
  // school-context singleton — without this, hasSchoolContext stays true on
  // the stale ex-user's data, so SchoolsContainer's showLogin/showDashboard
  // gates never agree on a state until a hard reload wipes it clean.
  clearSchoolContext()
  router.push('/schools')
}

// click-outside (closes both the user menu and the mobile nav drawer)
function onDocClick(e: MouseEvent) {
  const root = document.querySelector('.schools-topbar')
  if (root && !root.contains(e.target as Node)) {
    closeMenu()
    closeMobileNav()
  }
}
// Esc closes any open menu/drawer
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeMenu()
    closeMobileNav()
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKeydown)
}
</script>

<template>
  <header class="schools-topbar">
    <div class="left">
      <button
        type="button"
        class="nav-toggle"
        aria-label="Menu"
        aria-haspopup="true"
        :aria-expanded="mobileNavOpen"
        @click="toggleMobileNav"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
          <path v-if="!mobileNavOpen" d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path v-else d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>

      <router-link :to="brandTo" class="brand" :aria-label="brandAria">
        <img class="brand-logo" src="/ssi-web-logo.svg" alt="SaySomethingin" />
        <span v-if="brandTail" class="brand-tail">{{ brandTail }}</span>
      </router-link>

      <!-- Play-as-class: the class name is the MOST SPECIFIC ACTIVE CONTEXT —
           a slim chip inside the bar (school demoted inside it), sitting where
           the school label normally does. The tabs stay alongside it. -->
      <PlayAsClassIdentity
        v-if="isPlayingAsClass"
        :class-name="className"
        :school-name="schoolLabel"
        @exit="exitClassSession"
      />

      <!-- WHERE AM I: the school name is the identity of this surface — it
           stays visible at every width (truncating, full name in the
           tooltip) instead of being a throwaway label that mobile hid.
           While playing-as, the chip above carries both class AND school, so
           the standalone label yields its space to the chip. -->
      <span v-if="!isPlayingAsClass && schoolLabel" class="context-name" :title="schoolLabel">{{ schoolLabel }}</span>

      <nav class="tabs" aria-label="Schools sections">
        <router-link
          v-for="t in tabs"
          :key="t.to"
          :to="t.to"
          :class="['tab', { active: isActive(t) }]"
        >
          {{ t.label }}
        </router-link>
      </nav>

      <nav v-if="mobileNavOpen" class="mobile-nav" aria-label="Schools sections">
        <router-link
          v-for="t in tabs"
          :key="t.to"
          :to="t.to"
          :class="['mobile-nav-item', { active: isActive(t) }]"
          @click="closeMobileNav"
        >
          {{ t.label }}
        </router-link>
      </nav>
    </div>

    <div class="right">
      <!-- The ONE universal refresh affordance — renders only on surfaces that
           registered a loader, spins while fetching. Same button, same spot on
           every dashboard (consistency law §1.12). -->
      <RefreshButton />

      <!-- Self-practice launcher is dropped while a class session is live — the
           bar's job in this mode is to name the class and offer the exit. -->
      <router-link
        v-if="!isPlayingAsClass"
        to="/schools/play"
        class="learn-btn"
        title="Learn — your own practice"
        aria-label="Learn — your own practice"
      >
        <svg class="learn-btn__icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 1.2 10 6 2.5 10.8Z" fill="currentColor" />
        </svg>
        <span class="learn-btn__label">Learn</span>
      </router-link>

      <div class="user-menu">
        <button type="button" class="user-trigger" @click="toggleMenu">
          <span class="avatar" :style="{ background: roleAvatarColor }">{{ initials }}</span>
          <span class="identity">
            <span class="identity-name">{{ displayName }}</span>
            <span class="identity-role">{{ roleLabel }}</span>
          </span>
          <span class="caret">▾</span>
        </button>
        <div v-if="menuOpen" class="user-menu-pop">
          <router-link v-if="isSchoolAdmin" to="/schools/settings" class="menu-item" @click="closeMenu">School settings</router-link>
          <!-- Roles are additive facets of ONE account — leaving the schools
               surface is a NAVIGATION, not an identity sign-out. Before this
               existed, the only exit in the menu was "Sign out", which reads
               as "sign out of the teacher identity" but kills the whole
               session (founder incident, 2026-07-18). -->
          <router-link to="/" class="menu-item" @click="closeMenu">My player</router-link>
          <button type="button" class="menu-item" @click="signOut">Sign out</button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.schools-topbar {
  /* iOS PWA (standalone, black-translucent status bar) renders this shell
     UNDER the status bar / notch. Grow the bar by the top safe-area inset and
     pad the controls down out of that zone, so the hamburger + Learn escape +
     avatar stay tappable in portrait; left/right insets cover landscape
     notches. env() is 0 on desktop and non-notched devices, so this is a
     no-op there. The 54px control-row height is preserved (border-box) by
     adding the inset to height, not eating into it. Standing rule — always
     keep fixed shell chrome out of the phone safe areas (see CLAUDE.md). */
  height: calc(54px + env(safe-area-inset-top, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: env(safe-area-inset-top, 0px) max(24px, env(safe-area-inset-right, 0px)) 0 max(24px, env(safe-area-inset-left, 0px));
  background: #fff;
  border-bottom: 1px solid var(--schools-border);
  flex: none;
  font-family: var(--font-body);
}

.left { display: flex; align-items: center; gap: 20px; min-width: 0; flex: 1; }
.right { display: flex; align-items: center; gap: 12px; flex: none; }

/* Identity: bold, truncating, never hidden — the full name lives in the
   title tooltip. Tabs and buttons keep their natural size; this is the ONE
   element that gives up width. */
.context-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--schools-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 0 1 auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: inherit;
  flex: none;
}
.brand-logo {
  display: block;
  height: 28px;
  width: auto;
}
.brand-tail {
  font-family: var(--font-display);
  font-size: 17px;
  line-height: 1;
  color: var(--schools-red);
}

.tabs {
  display: flex;
  gap: 4px;
  align-items: center;
  flex: none;
}
.tab {
  padding: 8px 14px;
  font-size: 13.5px;
  font-weight: 500;
  text-decoration: none;
  color: var(--schools-fg);
  background: transparent;
  border-radius: 6px;
  white-space: nowrap;
  transition: background 120ms ease-out, color 120ms ease-out;
}
.tab:hover { background: #f6f5f1; }
.tab.active {
  color: #fff;
  background: var(--schools-red);
}
.tab.active:hover { background: var(--schools-red-deep); }

.divider {
  width: 1px;
  height: 24px;
  background: var(--schools-border);
}

.learn-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  color: #fff;
  background: var(--schools-red);
  border-radius: 999px;
  white-space: nowrap;
  flex: none;
  transition: background 120ms ease-out;
}
.learn-btn:hover { background: var(--schools-red-deep); }
.learn-btn__icon { flex: none; }

/* Icon-only below 480px — still a real >=44px tap target, not just padding
   trimmed down to the icon's own 12px (the old rule shrank this to ~28px,
   under the accessibility floor). */
@media (max-width: 480px) {
  .learn-btn__label { display: none; }
  .learn-btn { width: 44px; height: 44px; padding: 0; }
}

.user-menu { position: relative; flex: none; }
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 5px 8px 5px 5px;
  min-height: 44px;
  border: 1px solid var(--schools-border);
  background: #fff;
  border-radius: 30px;
  cursor: pointer;
  font-family: var(--font-body);
  flex: none;
  box-sizing: border-box;
}
.user-trigger:hover { border-color: var(--schools-border-strong); }

.avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex: none;
}

.identity {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.2;
  gap: 1px;
  min-width: 0;
  max-width: 140px;
}
.identity-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--schools-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.identity-role {
  font-size: 10.5px;
  color: var(--schools-fg-2);
  white-space: nowrap;
}
.caret { font-size: 10px; color: var(--schools-fg-3); margin-right: 4px; }

.user-menu-pop {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  width: 160px;
  z-index: 50;
  background: #fff;
  border: 1px solid var(--schools-border);
  border-radius: 10px;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}
.menu-item {
  display: block;
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--schools-fg);
  text-align: left;
  background: #fff;
  border: none;
  cursor: pointer;
  font-family: var(--font-body);
  text-decoration: none;
  box-sizing: border-box;
}
.menu-item:hover { background: #fafaf6; }

/* Hamburger toggle — hidden on desktop, shown below the breakpoint. 44px is
   the accessibility tap-target floor; the previous 38px also had no
   flex-shrink guard, so at phone widths it shrank well below that. */
.nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  margin-left: -6px;
  border: 1px solid var(--schools-border);
  background: #fff;
  border-radius: 8px;
  color: var(--schools-fg);
  cursor: pointer;
  flex: none;
}
.nav-toggle:hover { border-color: var(--schools-border-strong); background: #f6f5f1; }

/* Mobile drawer — the same tabs, stacked under the bar. */
.mobile-nav {
  position: absolute;
  top: calc(100% + 6px);
  left: 12px;
  right: 12px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  padding: 6px;
  background: #fff;
  border: 1px solid var(--schools-border);
  border-radius: 12px;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.2);
}
.mobile-nav-item {
  padding: 11px 12px;
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  color: var(--schools-fg);
  border-radius: 8px;
  white-space: nowrap;
}
.mobile-nav-item:hover { background: #f6f5f1; }
.mobile-nav-item.active {
  color: #fff;
  background: var(--schools-red);
}

@media (max-width: 768px) {
  .tabs { display: none; }
  .nav-toggle { display: inline-flex; }
  .schools-topbar { padding: env(safe-area-inset-top, 0px) max(16px, env(safe-area-inset-right, 0px)) 0 max(16px, env(safe-area-inset-left, 0px)); position: relative; }
  /* Only the hamburger + brand remain in .left once the tab bar is gone —
     the desktop 32px gap (sized for a row of tabs) left far too little
     width for .right on a phone, which is what let items overlap. */
  .left { gap: 10px; }
}

/* Phone widths (320-430px measured in the audit). Shrinks the wordmark and
   drops the user-menu's name/role text so every element keeps its natural,
   un-shrunk size and nothing overlaps — verified against 320/375/430px
   bounding boxes. */
@media (max-width: 430px) {
  .schools-topbar { padding: env(safe-area-inset-top, 0px) max(10px, env(safe-area-inset-right, 0px)) 0 max(10px, env(safe-area-inset-left, 0px)); gap: 8px; }
  .left { gap: 10px; }
  .right { gap: 8px; }
  /* Identity beats brand on a phone: the wordmark goes, the school name
     stays (the hamburger's Dashboard link covers "home"). */
  .brand { display: none; }
  .identity { display: none; }
  .user-trigger { gap: 0; padding: 5px; }
  .caret { margin-right: 0; }
}
</style>
