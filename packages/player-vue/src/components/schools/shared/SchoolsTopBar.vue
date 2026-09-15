<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { useUserMessages } from '@/composables/useUserMessages'
import { usePlayAsClassContext } from '@/composables/schools/usePlayAsClassContext'
import { leaderRoleLabel } from '@/composables/nodeTerminology'
import PlayAsClassIdentity from './PlayAsClassIdentity.vue'
import ReportBugModal from '@/components/schools/ReportBugModal.vue'
import { useUserRole } from '@/composables/useUserRole'
import RefreshButton from '@/components/shared/RefreshButton.vue'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

type NavTab = {
  label: string
  to: string
  routeName?: string
  /** When set, the tab is active only if the route's ?lens matches too —
   * distinguishes the Schools tab (node home, schools lens) from plain
   * node-home navigation. */
  lens?: string
}

import { institutionalPurchaseAvailable } from '@/platform/paymentRoute'

// Seat purchase is web-only (platform/paymentRoute). In a store build the
// /schools/upgrade route is not compiled in, and in a store SHELL it must not
// be offered at all — so the tab that points at it asks the seam, not the build
// constant. One declaration, three tab sets.
const upgradeTab = computed<NavTab[]>(() =>
  institutionalPurchaseAvailable()
    ? [{ label: t('schools.ui.topBar.tabUpgrade', 'Upgrade'), to: '/schools/upgrade', routeName: 'schools-upgrade' }]
    : []
)
const route = useRoute()
const router = useRouter()
const { currentUser, isGovtAdmin, isSchoolAdmin, clear: clearSchoolContext } = useSchoolContext()
// There is no Learn button in the nav for ANY school role. Own-account play
// lives one step away, as My player in the avatar menu (Tom, 2026-09-14
// 14:50Z, job #675: "We have the My Player as a dropdown menu, correctly
// already, so we can deprecate the Learn next to the User Avatar? THat would
// make it a lot simpler"). This extends job #662, which had done it for a
// teacher only and left leaders with the button.
// The inbox badge (job #684): ONE unread count for the whole account menu,
// read from the inbox — a Support reply is a message in it, so the old
// ?peek=1 dot on the Support entry is gone rather than doubled. Refreshed on
// mount and on focus, never on a timer: listing never marks anything read.
// Never while viewing-as (job #681): the routes refuse a tagged request, and
// a glance at someone else's dashboard must reach nothing of theirs.
const { unread: inboxUnread, unreadBadge: inboxBadge, refresh: refreshInbox } = useUserMessages()
const { isViewingAs } = useUserRole()
function peekInbox(): void {
  if (!isViewingAs.value && document.visibilityState === 'visible') void refreshInbox()
}
onMounted(() => { peekInbox(); window.addEventListener('focus', peekInbox) })
onBeforeUnmount(() => { window.removeEventListener('focus', peekInbox) })
watch(isViewingAs, (on) => { if (!on) peekInbox() })

// Play-as-class: while a class session is live, a SLIM in-nav chip names the
// class (school demoted inside it) so a teacher always knows WHICH class is
// on screen. The section tabs and hamburger STAY — the schools top nav
// persists on every screen a schools user reaches, including inside the
// player (founder ruling, 2026-07-30; the old mode dropped them and swelled
// the bar, which read as the player "taking over"). Only the self-practice
// Learn launcher is dropped: mid-class-session it's the one affordance that
// would be actively confusing, and the chip's End session takes its place.
const { isPlayingAsClass, isOnPlayerRoute, className, exitClassSession } = usePlayAsClassContext()

const auth = inject<any>('auth', null)

// REPORT A BUG (Tom's ruling, 2026-09-14): a bug or a suggestion, filed from
// the dashboard itself "because the bug might be with the dashboard side of
// things" — the same postbox as the player's Settings, with source and the
// page in view attached. HIDDEN UNDER VIEW-AS: an ssi_admin looking as a
// persona writes nothing (jobs #606/#615/#618), and hiding the door is
// simpler than attributing a report to the real admin through a persona
// screen. The route refuses a view-as header too. The thank-you toast is
// the whole reply — one way, no thread.
const bugModalOpen = ref(false)
const bugToast = ref(false)
let bugToastTimer: ReturnType<typeof setTimeout> | null = null
function openBugReport(): void {
  closeMenu()
  bugModalOpen.value = true
}
function onBugSent(): void {
  bugToast.value = true
  if (bugToastTimer) clearTimeout(bugToastTimer)
  bugToastTimer = setTimeout(() => { bugToast.value = false }, 3500)
}
onBeforeUnmount(() => { if (bugToastTimer) clearTimeout(bugToastTimer) })

// HANDBOOK (founder ruling 2026-09-07) — the map of everything the dashboard
// can do. It lives in the user menu, not the tabs, by the bar's own rule:
// tabs are daily destinations and a handbook is a once-a-term thing, the same
// reason Settings sits here. Leaders read it in their own lane so they are
// never shown a /schools URL.
const handbookTo = computed(() => {
  const node = currentUser.value?.group_id || currentUser.value?.school_id
  return node && String(route.path).startsWith('/org') ? `/org/${node}/handbook` : '/schools/handbook'
})

const tabs = computed<NavTab[]>(() => {
  // Until the school context resolves (ctx.loadFromAuth is async), the role
  // is unknown — render NO tabs rather than the teacher fallback set. The
  // wrong-role flash was real and measurable: for the first ~0.5s after a
  // cold boot a school_admin saw the teacher tabs (no Classes/Teachers/
  // Settings), so an early click landed on a tab set that then changed
  // under the pointer.
  if (!currentUser.value) return []
  if (isGovtAdmin.value) {
    // THE VIEW (archive/docs-retired-2026-08-24/THE-VIEW.md) is the ONE frame for hierarchy leaders —
    // the tabs point at the node surface (node home with the schools lens +
    // node insights), never the retired pre-hierarchy flat views. The old
    // tab set landed a group leader on the flat All-schools list and a
    // teacher-scoped Analytics that showed 'No classes yet' to a leader
    // whose dashboard showed 23 practising classes (founder-found on prod,
    // 2026-07-29).
    const groupId = currentUser.value.group_id
    if (groupId) {
      // 'Organisation', not 'Schools' (founder ruling 2026-08-02: ed-speak is
      // a dressing, and the top bar can't see the subtree to pick one — so it
      // makes no school claim). Lands on the node home, whose lens chips give
      // an education-dressed leader All-schools in one tap.
      return [
        { label: t('schools.ui.topBar.tabOrganisation', 'Organisation'), to: `/org/${groupId}`, routeName: 'org-node-home' },
        { label: t('schools.ui.topBar.tabInsights', 'Insights'), to: `/org/${groupId}/insights`, routeName: 'org-node-insights' },
      ]
    }
    // Legacy leaders with no group (region_code-only govt_admin rows) have
    // no node to scope to — they keep the flat views until migrated (same
    // fallback DashboardView documents for its node-home redirect).
    return [
      { label: t('schools.ui.topBar.tabSchools', 'Schools'),   to: '/schools/all',       routeName: 'schools-list' },
      { label: t('schools.ui.topBar.tabAnalytics', 'Analytics'), to: '/schools/analytics', routeName: 'analytics' },
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
        { label: t('schools.ui.topBar.tabDashboard', 'Dashboard'), to: `/org/${schoolId}`, routeName: 'org-node-home' },
        { label: t('schools.ui.topBar.tabClasses', 'Classes'),   to: '/schools/classes',   routeName: 'classes' },
        { label: t('schools.ui.topBar.tabStudents', 'Students'),  to: '/schools/students',  routeName: 'students' },
        { label: t('schools.ui.topBar.tabInsights', 'Insights'),  to: `/org/${schoolId}/insights`, routeName: 'org-node-insights' },
        ...upgradeTab.value,
      ]
    }
    // Legacy school_admin rows with no resolvable school keep the flat set
    // (same fallback shape as the no-group govt_admin above).
    return [
      { label: t('schools.ui.topBar.tabDashboard', 'Dashboard'), to: '/schools',           routeName: 'schools-dashboard' },
      { label: t('schools.ui.topBar.tabClasses', 'Classes'),   to: '/schools/classes',   routeName: 'classes' },
      { label: t('schools.ui.topBar.tabStudents', 'Students'),  to: '/schools/students',  routeName: 'students' },
      { label: t('schools.ui.topBar.tabTeachers', 'Teachers'),  to: '/schools/teachers',  routeName: 'teachers' },
      // "Insights" is the one word for the Insight Engine door everywhere
      // (govt tabs, node "See insights") — the destination is already THE
      // LENS's teacher wrapper, only the label was still the old generation.
      { label: t('schools.ui.topBar.tabInsights', 'Insights'),  to: '/schools/analytics', routeName: 'analytics' },
      ...upgradeTab.value,
    ]
  }
  // Teacher (default) — a school-employed teacher's billing is the school
  // admin's job, so no Upgrade tab. A GROUPLESS teacher (the derived tutor,
  // THE-MODEL §1.3/I5: no school_id) has nobody else to bill them, so they
  // need their own reachable Upgrade tab — same UpgradeView, whose tutor
  // lane (isSchoolLane false) already resolves their own teacher-billing
  // record via /api/teacher/me. Structure-gated, never on the 'tutor' label.
  const teacherTabs: NavTab[] = [
    { label: t('schools.ui.topBar.tabDashboard', 'Dashboard'), to: '/schools',           routeName: 'schools-dashboard' },
    { label: t('schools.ui.topBar.tabStudents', 'Students'),  to: '/schools/students',  routeName: 'students' },
    // Same "Insights" unification as the school_admin set above.
    { label: t('schools.ui.topBar.tabInsights', 'Insights'),  to: '/schools/analytics', routeName: 'analytics' },
  ]
  if (!currentUser.value.school_id) {
    teacherTabs.push(...upgradeTab.value)
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

const displayName = computed(() => currentUser.value?.display_name || t('schools.ui.topBar.youFallback', 'You'))
const initials = computed(() =>
  displayName.value.split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || 'SS',
)
const roleLabel = computed(() => {
  // Routed through the terminology dressing (neutral default) — 'Govt Admin'
  // was a dressing leak on org leaders (founder bug 2026-08-02).
  if (isGovtAdmin.value) return leaderRoleLabel()
  if (isSchoolAdmin.value) return t('schools.ui.topBar.roleSchoolAdmin', 'School Admin')
  return t('schools.ui.topBar.roleTeacher', 'Teacher')
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
// The two shared pages a group leader reaches from this menu — Inbox and
// Support — still live at /schools/* URLs, so they count as the org surface
// for the same leader (job #786: an org leader's Support page read
// "SaySomethingin · Schools" across the top).
const SHARED_MEMBER_PAGES = new Set(['/schools/support', '/schools/inbox'])
const onOrgSurface = computed(
  () => isGovtAdmin.value && (route.path === '/org' || route.path.startsWith('/org/') || SHARED_MEMBER_PAGES.has(route.path)),
)
const brandTail = computed(() => (onOrgSurface.value ? '' : t('schools.ui.topBar.brandTailSchools', 'Schools')))
const brandTo = computed(() => {
  if (!onOrgSurface.value) return '/schools'
  const groupId = currentUser.value?.group_id
  return groupId ? `/org/${groupId}` : '/'
})
// The wordmark ("SaySomethingin") is never translated — only the tail is.
const brandAria = computed(() =>
  onOrgSurface.value ? 'SaySomethingin' : `SaySomethingin · ${brandTail.value}`,
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
        :aria-label="t('schools.ui.topBar.menuAriaLabel', 'Menu')"
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

      <nav class="tabs" :aria-label="t('schools.ui.topBar.navSectionsAriaLabel', 'Schools sections')">
        <router-link
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          :class="['tab', { active: isActive(tab) }]"
        >
          {{ tab.label }}
        </router-link>
      </nav>

      <nav v-if="mobileNavOpen" class="mobile-nav" :aria-label="t('schools.ui.topBar.navSectionsAriaLabel', 'Schools sections')">
        <router-link
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          :class="['mobile-nav-item', { active: isActive(tab) }]"
          @click="closeMobileNav"
        >
          {{ tab.label }}
        </router-link>
      </nav>
    </div>

    <div class="right">
      <!-- The ONE universal refresh affordance — renders only on surfaces that
           registered a loader, spins while fetching. Same button, same spot on
           every dashboard (consistency law §1.12). -->
      <RefreshButton />

      <div class="user-menu">
        <button type="button" class="user-trigger" data-walk="schools-user-menu-trigger" @click="toggleMenu">
          <span class="avatar" :style="{ background: roleAvatarColor }">{{ initials }}<span v-if="inboxUnread > 0" class="avatar-dot" :aria-label="t('schools.inbox.unreadAria', 'Unread messages')"></span></span>
          <span class="identity">
            <span class="identity-name">{{ displayName }}</span>
            <span class="identity-role">{{ roleLabel }}</span>
          </span>
          <span class="caret">▾</span>
        </button>
        <div v-if="menuOpen" class="user-menu-pop">
          <router-link :to="handbookTo" class="menu-item" @click="closeMenu">{{ t('schools.ui.topBar.menuHandbook', 'Handbook') }}</router-link>
          <!-- HANDBOOK Open your inbox
               section: your-own-account
               roles: teacher, school_admin, leader
               place: dashboard
               keywords: inbox, messages, unread, badge, reply, notice, undo
               What it's for. Getting to the messages sent to you: a reply on your Support thread, or a notice that your own practice was copied onto a class account. The dot on your avatar and the number beside **Inbox** are how many you have not opened.
               Where it is. **Inbox** in the account menu at the top right, under your name, just above Support.
               How you do it.
               1. Tap your name at the top right.
               2. Tap **Inbox**.
               Worth knowing. The number only goes down when you open a message, not when it arrives. The item is not shown while a platform admin is viewing the dashboard as someone else.
               checked: 4b41ab85.55e6235f
          -->
          <router-link v-if="!isViewingAs" to="/schools/inbox" class="menu-item menu-item-inbox" data-walk="schools-inbox-menu" @click="closeMenu">
            {{ t('schools.inbox.menuInbox', 'Inbox') }}
            <span v-if="inboxUnread > 0" class="menu-count" :aria-label="t('schools.inbox.unreadAria', 'Unread messages')">{{ inboxBadge }}</span>
          </router-link>
          <!-- The support channel, directly under the inbox: a once-a-term
               thing too, and the same corpus answers most of it. Admins only
               (Tom, 2026-09-10): a class teacher never sees this entry, and the
               route refuses them anyway. Replies land in the inbox above, which
               carries the unread count; this entry opens the thread. -->
          <router-link v-if="isSchoolAdmin || isGovtAdmin" to="/schools/support" class="menu-item menu-item-support" @click="closeMenu">
            {{ t('schools.support.menuSupport', 'Support') }}
          </router-link>
          <router-link v-if="isSchoolAdmin" to="/schools/settings" class="menu-item" @click="closeMenu">{{ t('schools.ui.topBar.menuSchoolSettings', 'School settings') }}</router-link>
          <!-- HANDBOOK Report a bug from the dashboard
               section: your-own-account
               roles: teacher, school_admin, leader
               place: dashboard
               parts: schools-report-bug-toast
               keywords: bug, report, problem, went wrong, suggestion, feedback, broken, dashboard
               What it's for. Telling us when the dashboard misbehaves, or suggesting something, without leaving the dashboard. The page you are on and your school are attached for you.
               Where it is. **Report a bug** in the account menu at the top right, under your name.
               How you do it.
               1. Tap your name at the top right, then **Report a bug**.
               2. Write what happened, add a screenshot if you have one, and tap **Send**.
               Worth knowing. Nobody replies through the app: the note goes to one place where we read it. Questions about the dashboard go to **Support** instead. The item is not shown while a platform admin is viewing the dashboard as someone else.
               checked: 37290b79.8d741e37
          -->
          <button v-if="!isViewingAs" type="button" class="menu-item" data-walk="schools-report-bug" @click="openBugReport">{{ t('schools.bugReport.menuItem', 'Report a bug') }}</button>
          <!-- Roles are additive facets of ONE account — leaving the schools
               surface is a NAVIGATION, not an identity sign-out. Before this
               existed, the only exit in the menu was "Sign out", which reads
               as "sign out of the teacher identity" but kills the whole
               session (founder incident, 2026-07-18). -->
          <!-- Same affordance as the Learn button, so it follows the same rule:
               not offered while you're already in the player (2026-08-06). -->
          <router-link v-if="!isOnPlayerRoute" to="/" class="menu-item" @click="closeMenu">{{ t('schools.ui.topBar.menuMyPlayer', 'My player') }}</router-link>
          <button type="button" class="menu-item" @click="signOut">{{ t('schools.ui.topBar.menuSignOut', 'Sign out') }}</button>
        </div>
      </div>
    </div>
    <ReportBugModal v-if="bugModalOpen" @close="bugModalOpen = false" @sent="onBugSent" />
    <Transition name="bug-toast">
      <div v-if="bugToast" class="bug-toast" role="status" data-walk="schools-report-bug-toast" @click="bugToast = false">
        {{ t('schools.bugReport.toast', 'Got it, thank you.') }}
      </div>
    </Transition>
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
.menu-item-support { display: flex; align-items: center; gap: 8px; }
.menu-item-inbox { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.menu-count {
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 600; line-height: 1; color: #fff;
  background: var(--schools-accent, #c23a3a);
}
.avatar { position: relative; }
.avatar-dot {
  position: absolute; top: -2px; right: -2px; width: 9px; height: 9px; border-radius: 50%;
  background: var(--schools-accent, #c23a3a); border: 2px solid #fff; box-sizing: content-box;
}
.menu-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--schools-red, #b3312f); flex-shrink: 0; }

/* The one-way thank-you after a bug report: a pill under the bar, gone on
   its own a moment later. Fixed, so it clears the bar on every width. */
.bug-toast {
  position: fixed;
  top: calc(var(--top-bands-h, 0px) + 64px + env(safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 70;
  padding: 10px 18px;
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
  background: var(--schools-fg, #2c2622);
  border-radius: 999px;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  white-space: nowrap;
}
.bug-toast-enter-active, .bug-toast-leave-active { transition: opacity 180ms ease-out; }
.bug-toast-enter-from, .bug-toast-leave-to { opacity: 0; }

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
