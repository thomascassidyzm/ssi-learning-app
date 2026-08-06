import {
  createRouter,
  createWebHistory,
  type NavigationGuardWithThis,
  type RouteRecordRaw,
} from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'
import { prepareMissionFromRoute } from '@/missions/useMission'

// Breadcrumb for the LAST management surface a user was on (`teach` | `schools`).
// Solo tutors have no `educational_role`, so the role cache can't tell a tutor
// apart from a plain learner — which is why a tutor who hits /schools used to
// fall straight onto the member-facing "no school access" wall with no way back.
// We remember which dashboard they came from so the /schools guard can bounce a
// non-member back to THEIR surface (a tutor → /teach) instead of the wall.
const LAST_DASHBOARD_KEY = 'ssi-last-dashboard'

function rememberDashboard(kind: 'teach' | 'schools'): void {
  try {
    localStorage.setItem(LAST_DASHBOARD_KEY, kind)
  } catch {
    // localStorage unavailable — non-fatal, we just lose the breadcrumb
  }
}

export function lastDashboard(): 'teach' | 'schools' | null {
  try {
    const v = localStorage.getItem(LAST_DASHBOARD_KEY)
    return v === 'teach' || v === 'schools' ? v : null
  } catch {
    return null
  }
}

/**
 * The route of the management surface this user last came from, or null for a
 * plain learner who has never had one.
 *
 * Owner ruling 2026-08-06: entering the player ALWAYS gives the immersive,
 * navless player ('/'). That leaves a teacher/tutor who launched self-practice
 * from their dashboard with no shell nav to get home, so App.vue uses this
 * breadcrumb to show the one low-emphasis AppEscape pill back to their surface.
 * A plain learner returns null here and sees the fully navless player.
 */
export function lastDashboardPath(): string | null {
  const kind = lastDashboard()
  if (kind === 'teach') return '/tutors/dashboard'
  if (kind === 'schools') return '/schools'
  return null
}

// The two EMBEDDED play routes — the player wrapped in a management shell.
// Since 2026-08-06 these exist for play-as-class ONLY (see the global guard at
// the bottom of this file).
const EMBEDDED_PLAY_ROUTE_NAMES = ['schools-play', 'teach-play']

// Lazy-loaded views
const PlayerContainer = () => import('@/containers/PlayerContainer.vue')
const SchoolsContainer = () => import('@/containers/SchoolsContainer.vue')
const TeachContainer = () => import('@/containers/TeachContainer.vue')
const AdminContainer = () => import('@/containers/AdminContainer.vue')
const AdminSchoolsContainer = () => import('@/containers/AdminSchoolsContainer.vue')
const AdminGroupContainer = () => import('@/containers/AdminGroupContainer.vue')
const MethodologyContainer = () => import('@/containers/MethodologyContainer.vue')
// Schools views (lazy-loaded)
const DashboardView = () => import('@/views/schools/DashboardView.vue')
const TeachersView = () => import('@/views/schools/TeachersView.vue')
const StudentsView = () => import('@/views/schools/StudentsView.vue')
const TeacherDashboard = () => import('@/views/schools/TeacherDashboard.vue')
const ClassDetail = () => import('@/views/schools/ClassDetail.vue')
// THE LENS: the node-scoped Insight Engine — mounted at the old analytics
// URLs (the URLs live, the old-school analytics page died).
const NodeInsightsView = () => import('@/views/admin/NodeInsightsView.vue')
const SettingsView = () => import('@/views/schools/SettingsView.vue')
const SchoolsView = () => import('@/views/schools/SchoolsView.vue')
const SetupView = () => import('@/views/schools/SetupView.vue')
// THE VIEW — the one recursive node home (docs/THE-VIEW.md)
const NodeHomeView = () => import('@/views/admin/NodeHomeView.vue')
const UpgradeView = () => import('@/views/schools/UpgradeView.vue')
// Teach (private tutor) views
const TeachDashboard = () => import('@/views/teach/TeachDashboard.vue')
const WithTeacher = () => import('@/views/teach/WithTeacher.vue')
// Onboarding — the three signup doors (/schools1, /schools2, /tutors)
const Onboarding = () => import('@/views/onboarding/Onboarding.vue')

// The member-surface guard, shared by /schools and the top-level /org node
// surface — they are the SAME shell (SchoolsContainer), so a leader arriving
// by either door gets the same role priming and the same bounces.
// Parent-level so a deep-link (e.g. /schools/analytics, /org/:id/insights)
// primes the role cache before the container's gate runs. The
// platform-subscription gate itself (lever-3) is enforced in SchoolsContainer,
// which wraps EVERY child route — it's async (loads platform_status), and a
// router guard can't resolve it synchronously, so the container is the right
// place. This guard just makes sure the role cache is restored first (no flash
// of wrong state).
const memberSurfaceGuard: NavigationGuardWithThis<undefined> = (to, _from, next) => {
  // Guided-mission deep link (?mission=<id>, dev/staging-gated): primes the
  // demo persona's role cache BEFORE the checks below so the mission's
  // signed-out visitor isn't bounced. The demo world itself is arranged in
  // SchoolsContainer setup (activatePendingMission), after setSchoolsClient.
  prepareMissionFromRoute(to)
  const { canAccessAdmin, hasSchoolRole, isInitialized, restoreFromCache } = useUserRole()
  restoreFromCache()
  // ssi_admins have their OWN schools surface (/admin/schools read-views) and
  // aren't members of any school — so redirect them OUT of the member-facing
  // tree from ANY entry point (a deep-link to /schools/teachers must never
  // dump them on the learner "no school access / join code" wall).
  // When acting-as a persona, hasSchoolRole is the PERSONA's, so they pass
  // through to the live school experience as intended. (Guard on the PARENT
  // so it covers every child route, not just the bare dashboard.)
  if (canAccessAdmin.value && !hasSchoolRole.value) {
    return next('/admin/structure')
  }
  // A user with a KNOWN role but NO school role is not a member.
  // Solo tutors have no `educational_role`, so they look identical to a
  // plain learner here — the role cache can't tell them apart. Rather than
  // let them fall onto the member-facing "no school access" wall (a dead
  // end — this is exactly what trapped Aran coming from /teach), bounce
  // them to the surface they belong to: a tutor (last on /teach) back to
  // /teach, anyone else to the learner home. Only act once the role cache
  // is initialized, so a first cold load (cache not yet primed) still
  // reaches the container, which has its own login/loading handling.
  if (isInitialized.value && !hasSchoolRole.value) {
    return next(lastDashboard() === 'teach' ? '/tutors/dashboard' : '/')
  }
  // Genuine member — remember it for the symmetric breadcrumb.
  rememberDashboard('schools')
  next()
}

const routes: RouteRecordRaw[] = [
  // Learning player (default)
  {
    path: '/',
    name: 'player',
    component: PlayerContainer,
    meta: {
      title: 'Learn',
      hideAppEscape: true, // immersive player — its own flow, no shell escape
    },
    // Owner ruling 2026-07-24: everyone lands in the player by default,
    // regardless of role. /schools is somewhere you deliberately navigate to
    // (the Learn/Schools switcher) — not a hijack on login. This supersedes
    // the 2026-07-16 "staff home is the dashboard" ruling below, which was
    // already tried once (ca88e0a8) and reverted for an unrelated reason (a
    // z-index tap-shield bug that made the course chooser dead for ALL
    // users, root-caused and fixed independently in 7f67014a — still in
    // place, so that landmine is already cleared). Deep links to /schools/*
    // are untouched by this route; SchoolsContainer's own guard bounces a
    // non-member back to their surface, it just never fires FROM here.
  },
  // THE VIEW's member node surface — TOP-LEVEL (founder ruling 2026-08-02:
  // an org/workplace is NOT a schools feature, so it must not live under
  // /schools). ONE :id route serves groups, orgs, schools AND classes (the
  // home endpoint resolves whichever id it's given), and the server scopes a
  // leader to their own subtree — rail rooted at their top node, no admin
  // escape. Server-backed reads only (no client org-table queries — the
  // RLS-condition caution). Same shell/guard/gate as /schools; only the URL
  // and the org-lane wording differ. `/orgs` (plural, defined below among the
  // signup doors) is the self-serve ORG SIGNUP door (founder instruction
  // 2026-08-02) — a distinct route name ('onboard-org'), never this member
  // node surface, so an org's OWN members still only ever land on /org/:id.
  {
    path: '/org',
    component: SchoolsContainer,
    meta: { hideAppEscape: true }, // SchoolsContainer carries its own nav
    beforeEnter: memberSurfaceGuard,
    children: [
      {
        path: ':id',
        name: 'org-node-home',
        component: NodeHomeView,
        meta: { title: 'Organisation', description: 'Node home (member scope)', nodeSurface: true },
      },
      {
        // THE LENS at member scope — "See insights" on the member node home.
        path: ':id/insights',
        name: 'org-node-insights',
        component: NodeInsightsView,
        meta: {
          title: 'Insights',
          description: 'The Insight Engine scoped to this node (member scope)',
        },
      },
      {
        // The org lane's billing door: the same UpgradeView, reached without
        // an org leader ever being shown a /schools URL.
        path: 'upgrade',
        name: 'org-upgrade',
        component: UpgradeView,
        meta: { title: 'Upgrade', description: 'Subscribe / manage seats' },
      },
    ],
  },
  // Schools dashboard routes
  {
    path: '/schools',
    component: SchoolsContainer,
    meta: { hideAppEscape: true }, // SchoolsContainer carries its own nav
    beforeEnter: memberSurfaceGuard,
    children: [
      {
        path: 'setup',
        name: 'schools-setup',
        component: SetupView,
        meta: {
          title: 'School setup',
          description: 'First-time onboarding wizard for school admins',
        },
      },
      {
        path: '',
        name: 'schools-dashboard',
        // RETIRED for school-scoped school_admins (nav unification, third
        // persona, 2026-07-30): SchoolsContainer redirects them to their
        // school's node home (/org/:schoolId). Stays live for
        // teachers and legacy no-school school_admin rows.
        component: DashboardView,
        meta: {
          title: 'Dashboard',
          description: 'Overview of school learning activity',
          // railFrame: SchoolsContainer wraps this flat view in the
          // WHERE-YOU-ARE rail (founder ruling 2026-07-31: the rail is
          // orientation — it never disappears; see useSchoolsRail.ts).
          railFrame: true,
        },
      },
      {
        path: 'teachers',
        name: 'teachers',
        // RETIRED for school-scoped school_admins (2026-07-30): teachers ARE
        // the school node's children — SchoolsContainer redirects to the node
        // home with the teachers lens. Live for legacy no-school rows.
        component: TeachersView,
        meta: {
          title: 'Teachers',
          description: 'Manage teachers and their classes',
          railFrame: true,
        },
      },
      {
        path: 'students',
        name: 'students',
        component: StudentsView,
        meta: {
          title: 'Students',
          description: 'View and manage student progress',
          railFrame: true,
        },
      },
      {
        path: 'classes',
        name: 'classes',
        component: TeacherDashboard,
        meta: {
          title: 'My Classes',
          description: 'Manage classes and start learning sessions',
          railFrame: true,
        },
      },
      {
        path: 'classes/:id',
        name: 'class-detail',
        component: ClassDetail,
        meta: {
          title: 'Class Detail',
          description: 'View class roster and settings',
          railFrame: true,
        },
      },
      {
        path: 'analytics',
        name: 'analytics',
        // The teacher-scoped Rate-compare insight tool, embedded in the schools
        // shell (its own TopNav + full-viewport scroll suppressed via `embedded`).
        // For a group-scoped govt_admin (2026-07-29) and a school-scoped
        // school_admin (2026-07-30) this URL is retired — SchoolsContainer
        // redirects it to their node's /org/:id/insights (nav
        // unification); it stays live for teachers.
        component: () => import('@/insight/TeacherInsightsView.vue'),
        props: { embedded: true },
        meta: {
          title: 'Analytics',
          description: 'Your class vs the average — the Rate-compare insight tool',
          railFrame: true,
        },
      },
      {
        path: 'settings',
        name: 'settings',
        component: SettingsView,
        meta: {
          title: 'Settings',
          description: 'School and account settings',
          railFrame: true,
        },
      },
      {
        path: 'all',
        name: 'schools-list',
        // RETIRED for group-scoped leaders (nav unification, 2026-07-29): the
        // URL lives, the separate design dies — SchoolsContainer redirects a
        // govt_admin with a group_id to the node home with the schools lens
        // (mirrors the admin-group-schools redirect below). The flat list
        // still mounts for legacy no-group govt_admin rows only.
        component: SchoolsView,
        meta: {
          title: 'Schools',
          description: 'All schools in group (govt admin)',
        },
      },
      {
        // LEGACY (moved 2026-08-02 to top-level /org — see the route above).
        // The old member-mount URLs live on as redirects so invite links,
        // bookmarks and shared deep links keep working; query and hash ride
        // along, which matters for ?lens=, ?student= and ?mission=.
        path: 'org/:id',
        redirect: (to) => ({ path: `/org/${to.params.id}`, query: to.query, hash: to.hash }),
      },
      {
        path: 'org/:id/insights',
        redirect: (to) => ({
          path: `/org/${to.params.id}/insights`,
          query: to.query,
          hash: to.hash,
        }),
      },
      {
        path: 'play',
        name: 'schools-play',
        component: PlayerContainer,
        meta: {
          title: 'Class session',
          description:
            'Run a class learning session — schools top bar stays above the player. ' +
            'Play-as-class ONLY (owner ruling 2026-08-06): staff self-practice goes to the ' +
            'immersive navless player at /, so a class-less arrival here is redirected there.',
        },
      },
      {
        path: 'upgrade',
        name: 'schools-upgrade',
        component: UpgradeView,
        meta: { title: 'Upgrade', description: 'Subscribe / manage teacher seats' },
      },
    ],
  },
  // Tutor (freelancer) dashboard. ONE tutor namespace: /tutors is the sign-up
  // page (Onboarding door, defined below); /tutors/dashboard is the freelancer's
  // shell. Consolidated from the old /teach surface (removed 2026-06-20) — the
  // /teach name + the buggy /teach/setup signup are gone; signup is /tutors only.
  {
    path: '/tutors/dashboard',
    component: TeachContainer,
    meta: { hideAppEscape: true }, // TeachContainer carries its own nav
    // See the /schools guard note: primes the role cache; the platform gate
    // (1mo tutor trial → £15/mo) is enforced async in TeachContainer.
    beforeEnter: (_to, _from, next) => {
      const { restoreFromCache } = useUserRole()
      restoreFromCache()
      // Remember the tutor's surface so if they later land on /schools (stale
      // link, confused session) the /schools guard sends them back here rather
      // than dumping them on the member wall.
      rememberDashboard('teach')
      next()
    },
    children: [
      {
        path: '',
        name: 'teach-dashboard',
        component: TeachDashboard,
        meta: { title: 'Teach' },
      },
      {
        path: 'upgrade',
        name: 'teach-upgrade',
        component: UpgradeView,
        meta: { title: 'Upgrade', description: 'Subscribe to your tutoring dashboard' },
      },
      {
        // Play-as-class for tutors — renders the player INSIDE TeachContainer so
        // the tutor nav stays above it (mirrors /schools/play in SchoolsContainer).
        path: 'play',
        name: 'teach-play',
        component: PlayerContainer,
        meta: {
          title: 'Class session',
          description:
            'Run a class learning session — tutor nav stays above the player. Play-as-class ' +
            'ONLY (owner ruling 2026-08-06); a class-less arrival is redirected to /.',
        },
      },
    ],
  },
  // Back-compat: old /teach links / PWA shortcuts → the new /tutors namespace.
  // /teach/setup is retired — its signup now happens at the /tutors door.
  { path: '/teach', redirect: '/tutors/dashboard' },
  { path: '/teach/setup', redirect: '/tutors' },
  { path: '/teach/upgrade', redirect: '/tutors/dashboard/upgrade' },
  { path: '/teach/play', redirect: '/tutors/dashboard/play' },
  // Student attribution gateway (no auth required)
  {
    path: '/with/:code',
    name: 'with-teacher',
    component: WithTeacher,
    meta: { title: 'Learning with your teacher' },
  },
  // Signup doors — two roles (school / tutor); the offer is per-course (pricing_tier),
  // not per-door. Note: bare /schools is the school DASHBOARD, not a signup door.
  {
    path: '/schools1',
    name: 'onboard-school-1',
    component: Onboarding,
    props: { track: 'school' },
    meta: { title: 'Set up your school' },
  },
  // /schools2 RETIRED (founder ruling 2026-08-02) — one school door, not two.
  // The URL stays alive FOREVER as a pure redirect because external marketing
  // links point at it; query + hash are preserved (same pattern as the
  // /schools/org/:id → /org/:id redirects above). /schools2 was the
  // English-first door listing the full catalogue, so /schools1's course
  // dropdown was widened from the year-free set to the WHOLE catalogue
  // (Onboarding.vue targetOptions) — no course becomes unreachable.
  {
    path: '/schools2',
    redirect: (to) => ({ path: '/schools1', query: to.query, hash: to.hash }),
  },
  {
    path: '/tutors',
    name: 'onboard-tutor',
    component: Onboarding,
    props: { track: 'tutor' },
    meta: { title: 'Start teaching' },
  },
  // Self-serve org/workplace signup (founder instruction 2026-08-02) — the
  // neutral-dressing sibling of the two doors above. Provisions via the
  // 'org' track (api/onboarding/provision.ts): a root `groups` row + a
  // govt_admins leader row, then redirects to the leader's own /org/:id.
  {
    path: '/orgs',
    name: 'onboard-org',
    component: Onboarding,
    props: { track: 'org' },
    meta: { title: 'Set up your organisation' },
  },
  // PARTNER DOORS — one landing page per partner network, parameterised off
  // views/marketing/partners.ts (a second partner = one copy entry + one route
  // line, no new component). Deliberately UNLINKED from every nav and
  // noindex'd by the component: shareable by URL, not discoverable. Sells the
  // LIVE tutor model only and CTAs into /tutors — no affiliate offer appears
  // on it (that lane is undecided, founder exploration 2026-08-03).
  {
    path: '/znotes',
    name: 'partner-znotes',
    component: () => import('@/views/marketing/PartnerDoor.vue'),
    props: { partner: 'znotes' },
    meta: { title: 'Teach English with SSi', hideAppEscape: true },
  },
  // Teacher / tutor insights — the calm single-widget Rate-compare view.
  // Top-level + un-gated so it opens in a browser with ?demo WITHOUT a teacher
  // login (the global admin guard only fires on /admin + /methodology). It is
  // scoped to THEIR class (or a learner within it) and shows nothing but the
  // entity-vs-average Rate-compare widget — the opposite of /admin/insights.
  {
    path: '/teacher-insights',
    name: 'teacher-insights',
    component: () => import('@/insight/TeacherInsightsView.vue'),
    meta: {
      title: 'Your class',
      description: 'Your class vs the average — the Rate-compare widget, teacher-framed',
      hideAppEscape: true, // carries the full TopNav, so no floating Back needed
    },
  },
  // Learner profile / mirror — founder-commissioned design build 2026-08-03.
  // PREVIEW: deliberately UNLINKED from every nav, which is the flag — nothing
  // learner-visible changes until it is wired in, so this can be tasted on dev
  // without touching a single shipped surface. Lives under App.vue's provides,
  // so it injects the app's existing course plumbing rather than duplicating it.
  {
    path: '/me',
    name: 'learner-profile',
    component: () => import('@/views/me/ProfileView.vue'),
    meta: {
      title: 'You',
      description: 'Learner profile, mirror and plan — preview surface',
      hideAppEscape: true, // carries its own Back-to-learning link
    },
  },
  // Admin panel
  {
    path: '/admin',
    component: AdminContainer,
    meta: { hideAppEscape: true }, // AdminContainer carries its own nav
    children: [
      {
        // Default /admin landing — the Structure surface (the org tree).
        path: '',
        redirect: '/admin/structure',
      },
      {
        // Canonical invites surface (2026-07-17 rethink): one create card
        // (org / direct / demo) + one live list, replacing the
        // creation/list halves of Access, Demos and Try Links. See
        // docs/invites-redesign/DESIGN.md.
        path: 'invites',
        name: 'admin-invites',
        component: () => import('@/views/admin/AdminInvites.vue'),
        meta: { title: 'Invites', description: 'One primitive — who × where × what × limits; every link that lets someone in, real or demo' },
      },
      {
        // Old paths — kept working, not just bookmark hygiene. Ways-in
        // management now lives on /admin/structure (THE-MODEL.md §1.10).
        path: 'access',
        redirect: '/admin/structure',
      },
      {
        path: 'demos',
        redirect: '/admin/structure',
      },
      {
        path: 'demo-organisations',
        redirect: '/admin/structure',
      },
      {
        path: 'demo-schools',
        redirect: '/admin/structure',
      },
      {
        path: 'analytics',
        name: 'admin-analytics',
        component: () => import('@/views/admin/AdminAnalytics.vue'),
        meta: { title: 'Admin Analytics', description: 'Platform-wide analytics dashboard' },
      },
      {
        path: 'users',
        name: 'admin-users',
        component: () => import('@/views/admin/AdminUsers.vue'),
        meta: { title: 'Admin Users', description: 'All platform users and enrollments' },
      },
      {
        path: 'users/:learnerId',
        name: 'admin-user-detail',
        component: () => import('@/views/admin/AdminUserDetail.vue'),
        meta: { title: 'User Detail', description: 'Individual user profile and progress' },
      },
      {
        path: 'attention',
        name: 'admin-attention',
        component: () => import('@/views/admin/AdminAttention.vue'),
        meta: { title: 'Needs Attention', description: 'Subscribers who need attention' },
      },
      {
        path: 'activity',
        name: 'admin-activity',
        component: () => import('@/views/admin/AdminActivity.vue'),
        meta: { title: 'Admin Activity', description: 'Live activity and recent sessions' },
      },
      {
        path: 'courses',
        name: 'admin-courses',
        component: () => import('@/views/admin/AdminCourses.vue'),
        meta: { title: 'Admin Courses', description: 'Course overview with enrollment stats' },
      },
      {
        path: 'pod-auditioner',
        name: 'admin-pod-auditioner',
        component: () => import('@/components/PodStageAuditioner.vue'),
        meta: { title: 'Pod stage auditioner', description: 'One sentence through all 10 pod stages (Stage-0 tiers + Stages 1-9)' },
      },
      {
        path: 'entitlements',
        redirect: '/admin/structure',
      },
      {
        path: 'try-links',
        redirect: '/admin/structure',
      },
      {
        path: 'release-notes',
        name: 'admin-release-notes',
        component: () => import('@/views/admin/AdminReleaseNotes.vue'),
        meta: { title: 'Release Notes', description: 'Curate the What\'s New panel in Settings' },
      },
      {
        // Structure — the org tree IS the page (2026-07-17 consolidation:
        // Setup's Groups/Schools/Staff/Entitlements tabs dissolved into one
        // tree with node facets; ways-in management lives on the node panel —
        // THE-MODEL.md §1.10).
        path: 'structure',
        name: 'admin-structure',
        component: () => import('@/views/admin/AdminStructure.vue'),
        meta: { title: 'Structure', description: 'The org tree — groups, schools, staff and entitlements at the node they belong to' },
      },
      {
        // Old Setup console path — Setup dissolved into Structure.
        path: 'setup',
        redirect: '/admin/structure',
      },
      {
        path: 'schools',
        redirect: '/admin/structure',
      },
      {
        path: 'methodology',
        name: 'admin-methodology',
        component: () => import('@/views/admin/AdminMethodology.vue'),
        meta: { title: 'Measuring progress', description: 'Methodology papers and demos' },
      },
      {
        path: 'insights',
        name: 'admin-insights',
        component: () => import('@/insight/InsightsView.vue'),
        meta: { title: 'Insights', description: 'Insight Engine — what Claude surfaced (discovery feed)' },
      },
      {
        path: 'stats',
        name: 'admin-stats',
        component: () => import('@/views/admin/AdminStatsView.vue'),
        meta: { title: 'Stats', description: 'Insight Engine boards — lifecycle, rates, content, ops' },
      },
      {
        path: 'board',
        name: 'admin-board',
        component: () => import('@/views/admin/BoardReportView.vue'),
        meta: { title: 'Board', description: 'Living board report — live business state + authored reports' },
      },
      {
        path: 'onboarding',
        name: 'admin-onboarding',
        component: () => import('@/views/admin/AdminOnboardingView.vue'),
        meta: { title: 'Onboarding', description: 'Live-editable onboarding message series' },
      },
    ],
  },
  // Admin read-views — view a specific school's dashboard as ssi_admin
  // without impersonating. useSchoolContext is populated from the :id
  // route param; queries still run as the real admin.
  {
    path: '/admin/schools/:id',
    component: AdminSchoolsContainer,
    meta: { hideAppEscape: true }, // carries AdminTopBar — the floating Back pill overlapped it
    children: [
      {
        // THE VIEW (docs/THE-VIEW.md): the school's landing IS node home —
        // same recursive page as every other level. Deep school tools stay
        // at the sibling sub-routes below.
        path: '',
        name: 'admin-school-dashboard',
        component: NodeHomeView,
        meta: { title: 'School Home', description: 'Node home for a school', nodeSurface: true },
      },
      {
        path: 'classes',
        name: 'admin-school-classes',
        component: TeacherDashboard,
        meta: { title: 'School Classes' },
      },
      {
        // The admin "Class tools" page is DEAD (founder ruling 2026-07-19):
        // it duplicated the class node home with zero admin-usable verbs.
        // The URL survives as a redirect so old links never 404.
        path: 'classes/:classId',
        name: 'admin-school-class-detail',
        redirect: (to) => ({ path: `/admin/classes/${to.params.classId}` }),
      },
      {
        path: 'students',
        name: 'admin-school-students',
        component: StudentsView,
        meta: { title: 'School Students' },
      },
      {
        path: 'teachers',
        name: 'admin-school-teachers',
        component: TeachersView,
        meta: { title: 'School Teachers' },
      },
      {
        path: 'analytics',
        name: 'admin-school-analytics',
        component: NodeInsightsView,
        meta: { title: 'School Insights', description: 'The Insight Engine scoped to this school' },
      },
    ],
  },
  // Admin read-view for groups (cross-schools, govt_admin-scope queries)
  {
    path: '/admin/groups/:id',
    component: AdminGroupContainer,
    meta: { hideAppEscape: true }, // carries AdminTopBar — no floating Back pill on top
    children: [
      {
        // THE VIEW (docs/THE-VIEW.md): the group's landing IS node home.
        path: '',
        name: 'admin-group-dashboard',
        component: NodeHomeView,
        meta: { title: 'Group Home', description: 'Node home for a group', nodeSurface: true },
      },
      {
        // The old Full-schools list — the URL lives, the separate design
        // dies: node home with the All-schools lens preselected.
        path: 'schools',
        name: 'admin-group-schools',
        redirect: (to) => ({ path: `/admin/groups/${to.params.id}`, query: { lens: 'schools' } }),
      },
      {
        path: 'analytics',
        name: 'admin-group-analytics',
        component: NodeInsightsView,
        meta: { title: 'Group Insights', description: 'The Insight Engine scoped to this group' },
      },
    ],
  },
  // Standalone admin read-views
  {
    // THE VIEW (docs/THE-VIEW.md): class level gets the same node home —
    // map rail, identity (lead + co-teachers, read-only), students as
    // children (with the full teaching data in-row). Deliberately the SAME
    // container + view pair as /admin/groups/:id so drilling group → class
    // reuses the mounted surface (one continuous map, no repaint — founder
    // ruling 2026-07-19). This IS the class page for admins — the old
    // "Class tools" page is dead (founder ruling 2026-07-19).
    path: '/admin/classes/:id',
    component: AdminGroupContainer,
    meta: { hideAppEscape: true },
    children: [
      {
        path: '',
        name: 'admin-class-detail',
        component: NodeHomeView,
        meta: { title: 'Class Home (Admin)', nodeSurface: true },
      },
    ],
  },
  {
    // THE LENS at class level — "See insights" on a class node home.
    path: '/admin/classes/:id/insights',
    name: 'admin-class-insights',
    component: () => import('@/views/admin/AdminClassInsights.vue'),
    meta: { title: 'Class Insights (Admin)' },
  },
  {
    // The individual learner page is DEAD (founder ruling 2026-07-19) — its
    // teacher-relevant content (journey, last-7-days) lives flat on the
    // student rows of the class node home. The URL survives as a redirect
    // so old links never 404.
    path: '/admin/users/:learnerId/progress',
    redirect: (to) => ({ path: `/admin/users/${to.params.learnerId}` }),
  },
  // Shareable redeem link. :code? is optional — a bare /redeem visit (e.g. a
  // teacher's whiteboard code, typed manually rather than clicked) drops into
  // RedeemCode.vue's manual code-entry step instead of 404ing.
  {
    path: '/redeem/:code?',
    name: 'redeem-code',
    component: () => import('@/views/RedeemCode.vue'),
    meta: { title: 'Redeem Code' },
  },
  // Group leader landing door (owner addendum 2026-07-13): a signup-page-
  // skinned entry to the govt_admin invite flow, matching the /schools1 /
  // /tutors landing-page convention. Reuses RedeemCode's redemption
  // machinery unchanged — /group?code=XYZ and /group/:code both work (the
  // code param is optional so the bare query form resolves too).
  {
    path: '/group/:code?',
    name: 'group-landing',
    component: () => import('@/views/RedeemCode.vue'),
    props: { variant: 'landing' },
    meta: { title: 'Bring SSi to your group' },
  },
  // Try link gateway (no auth required — zero-friction course preview)
  {
    path: '/try/:code',
    name: 'try-link',
    component: () => import('@/views/TryLinkGateway.vue'),
    meta: { title: 'Try SaySomethingin' },
  },
  // Frozen board-report snapshot (no auth — capability-by-unguessability,
  // living-board-report-spec.md §5). Renders only the stored payload.
  {
    path: '/board/:code',
    name: 'board-snapshot',
    component: () => import('@/views/BoardSnapshotView.vue'),
    meta: { title: 'Board Report' },
  },
  // PWA install guide
  {
    path: '/install',
    name: 'install-guide',
    component: () => import('@/views/InstallGuide.vue'),
    meta: { title: 'Install App' },
  },
  // Methodology explainer pages — admin-gated initially. See
  // docs/methodology/metrics-architecture.md §9 (Methodology explainer pages).
  // Spec-by-demonstration: each page renders a working visualisation of a
  // principle from the metrics-architecture spec using real (anonymised)
  // learner data. Settings toggles will link here to demystify what each
  // option measures and what the learner gets back from turning it on.
  {
    path: '/methodology',
    component: MethodologyContainer,
    children: [
      {
        path: '',
        name: 'methodology',
        component: () => import('@/views/methodology/MethodologyView.vue'),
        meta: { title: 'Methodology', description: 'Methodology explainer pages — admin' },
      },
      {
        path: 'empirical-baseline',
        name: 'methodology-empirical-baseline',
        component: () => import('@/views/methodology/EmpiricalBaselineView.vue'),
        meta: { title: 'Empirical baseline', description: 'Population distribution of practice hours with 30/100-hour anchors' },
      },
    ],
  },
  // Hidden power-user/support alias for the existing `?reset=1` recovery
  // mode (App.vue) — a *typed-in* URL must be speakable over the phone to a
  // stuck learner; query strings aren't. Deliberately not linked from any
  // UI copy (the boot-watchdog floor screen has its own self-contained "Fix
  // the app" button per Tom's ruling — this route is the support-channel
  // fallback, never something the app itself points users at). A hard
  // navigation, not a client-side route change, so the full reset flow
  // (App.vue's top-level check) actually runs.
  {
    path: '/reset',
    name: 'reset-alias',
    beforeEnter: () => {
      window.location.replace('/?reset=1')
      return false
    },
    component: { render: () => null }, // never rendered — beforeEnter always hard-redirects first
  },
  // Catch-all redirect to player
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition
    }
    // Drilling within THE VIEW's node surface is movement inside ONE map —
    // keep the scroll where it is (no jump-to-top jolt between nodes).
    if (to.meta.nodeSurface && from.meta.nodeSurface) {
      return false
    }
    return { top: 0 }
  },
})

// Stale chunk recovery: after a deploy, the running tab still references
// old hashed chunk URLs that no longer exist on the CDN. Reload to the
// target path so the browser fetches a fresh index.html + current chunks.
router.onError((err, to) => {
  const msg = err instanceof Error ? err.message : String(err)
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed')
  ) {
    // Guard against a reload loop: if the fresh index.html STILL can't load the
    // chunk (CDN not yet propagated, or a genuine error), reloading to the same
    // path would loop forever. Only auto-reload once per target per session;
    // a successful navigation clears the guard (afterEach below), so a later
    // deploy in the same session can recover again.
    const guardKey = 'ssi-chunk-reload:' + to.fullPath
    let alreadyTried = false
    try { alreadyTried = sessionStorage.getItem(guardKey) === '1' } catch { /* storage blocked */ }
    if (alreadyTried) {
      console.error('[Router] stale-chunk reload already attempted for', to.fullPath, '— not looping')
      return
    }
    try { sessionStorage.setItem(guardKey, '1') } catch { /* storage blocked */ }
    window.location.assign(to.fullPath)
  }
})

// A successful navigation means the (possibly freshly-reloaded) chunks loaded,
// so clear any stale-chunk reload guard for that path — a later deploy in the
// same session can then trigger recovery again.
router.afterEach((to) => {
  try { sessionStorage.removeItem('ssi-chunk-reload:' + to.fullPath) } catch { /* storage blocked */ }
})

// Guard admin + methodology routes — useUserRole is the single authority.
// Methodology pages are admin-gated initially (see metrics-architecture.md §9);
// individual pages may be opened to all learners later as we add a per-route
// `meta.public: true` flag, but for now everything under /methodology requires
// ssi_admin / god.
//
// Used to deny (bounce to '/') whenever canAccessAdmin was false — including
// a fresh browser with no cache yet, reading "don't know" as "no" and
// bouncing an about-to-resolve ssi_admin off every deep link. Now mirrors the
// /schools guard's own shape: only a role the cache actually KNOWS to be
// non-admin gets bounced here; an unresolved cache defers to AdminContainer,
// which gates rendering on the shared resolved-session gate and corrects
// (redirects) once resolution genuinely says non-admin.
router.beforeEach((to, _from, next) => {
  const requiresAdmin = to.path.startsWith('/admin') || to.path.startsWith('/methodology')
  if (!requiresAdmin) return next()
  const { canAccessAdmin, isInitialized, restoreFromCache } = useUserRole()
  restoreFromCache()
  if (isInitialized.value && !canAccessAdmin.value) return next('/')
  next()
})

// Owner ruling 2026-08-06: entering the player ALWAYS gives the immersive,
// navless player at '/'. The two embedded play routes survive for play-as-class
// only — there the shell bar earns its place by naming WHICH class is live — and
// every launcher pushes a `?class=` query. An arrival without one is a stale
// bookmark or a hand-typed URL; a class-less wrapped player is precisely the
// two-doors-one-player inconsistency this removes, so send it to '/'.
//
// GLOBAL rather than per-route beforeEnter deliberately: a query-only change on
// the same record (dropping ?class= while staying on /schools/play) does NOT
// re-run beforeEnter, and that is exactly the case that would slip through.
router.beforeEach((to, _from, next) => {
  if (!EMBEDDED_PLAY_ROUTE_NAMES.includes(to.name as string)) return next()
  if (typeof to.query.class === 'string' && to.query.class) return next()
  next('/')
})

// Update document title on navigation
router.afterEach((to) => {
  const baseTitle = 'SSi'
  const pageTitle = to.meta.title as string | undefined
  document.title = pageTitle ? `${pageTitle} - ${baseTitle}` : baseTitle
})

export default router
