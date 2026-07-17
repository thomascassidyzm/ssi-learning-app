import { watch } from 'vue'
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'

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

function lastDashboard(): 'teach' | 'schools' | null {
  try {
    const v = localStorage.getItem(LAST_DASHBOARD_KEY)
    return v === 'teach' || v === 'schools' ? v : null
  } catch {
    return null
  }
}

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
const AnalyticsView = () => import('@/views/schools/AnalyticsView.vue')
const SettingsView = () => import('@/views/schools/SettingsView.vue')
const SchoolsView = () => import('@/views/schools/SchoolsView.vue')
const SetupView = () => import('@/views/schools/SetupView.vue')
const UpgradeView = () => import('@/views/schools/UpgradeView.vue')
// Teach (private tutor) views
const TeachDashboard = () => import('@/views/teach/TeachDashboard.vue')
const WithTeacher = () => import('@/views/teach/WithTeacher.vue')
// Onboarding — the three signup doors (/schools1, /schools2, /tutors)
const Onboarding = () => import('@/views/onboarding/Onboarding.vue')

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
    // Staff home is the dashboard, not the bare player (owner ruling 2026-07-16):
    // any school-staff role (teacher/school_admin/govt_admin) landing on root —
    // a minted sign-in link, a stale bookmark, a bare-domain magic-link redirect —
    // belongs on /schools, reaching the player only via its own Learn button (the
    // schools-framed /schools/play route). This is the fast path for a role
    // already cached in this browser — defers rather than guessing when the
    // cache is empty (fresh browser); the corrective redirect below the router
    // definition covers that case once the shared resolved-session gate settles.
    beforeEnter: (_to, _from, next) => {
      const { hasSchoolRole, isInitialized, restoreFromCache } = useUserRole()
      restoreFromCache()
      if (isInitialized.value && hasSchoolRole.value) {
        return next('/schools')
      }
      next()
    },
  },
  // Schools dashboard routes
  {
    path: '/schools',
    component: SchoolsContainer,
    meta: { hideAppEscape: true }, // SchoolsContainer carries its own nav
    // Parent-level guard so a deep-link (e.g. /schools/analytics) still primes
    // the role cache before the container's gate runs. The platform-subscription
    // gate itself (lever-3) is enforced in SchoolsContainer, which wraps EVERY
    // child route — it's async (loads platform_status), and a router guard can't
    // resolve it synchronously, so the container is the right place. This guard
    // just makes sure the role cache is restored first (no flash of wrong state).
    beforeEnter: (_to, _from, next) => {
      const { canAccessAdmin, hasSchoolRole, isInitialized, restoreFromCache } = useUserRole()
      restoreFromCache()
      // ssi_admins have their OWN schools surface (/admin/schools read-views) and
      // aren't members of any school — so redirect them OUT of the member-facing
      // /schools tree from ANY entry point (a deep-link to /schools/teachers must
      // never dump them on the learner "no school access / join code" wall).
      // When acting-as a persona, hasSchoolRole is the PERSONA's, so they pass
      // through to the live school experience as intended. (Guard on the PARENT
      // so it covers every child route, not just the bare dashboard.)
      if (canAccessAdmin.value && !hasSchoolRole.value) {
        return next('/admin/setup')
      }
      // A user with a KNOWN role but NO school role is not a school member.
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
      // Genuine school member — remember it for the symmetric breadcrumb.
      rememberDashboard('schools')
      next()
    },
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
        component: DashboardView,
        meta: {
          title: 'Dashboard',
          description: 'Overview of school learning activity',
        },
      },
      {
        path: 'teachers',
        name: 'teachers',
        component: TeachersView,
        meta: {
          title: 'Teachers',
          description: 'Manage teachers and their classes',
        },
      },
      {
        path: 'students',
        name: 'students',
        component: StudentsView,
        meta: {
          title: 'Students',
          description: 'View and manage student progress',
        },
      },
      {
        path: 'classes',
        name: 'classes',
        component: TeacherDashboard,
        meta: {
          title: 'My Classes',
          description: 'Manage classes and start learning sessions',
        },
      },
      {
        path: 'classes/:id',
        name: 'class-detail',
        component: ClassDetail,
        meta: {
          title: 'Class Detail',
          description: 'View class roster and settings',
        },
      },
      {
        path: 'analytics',
        name: 'analytics',
        // The teacher-scoped Rate-compare insight tool, embedded in the schools
        // shell (its own TopNav + full-viewport scroll suppressed via `embedded`).
        component: () => import('@/insight/TeacherInsightsView.vue'),
        props: { embedded: true },
        meta: {
          title: 'Analytics',
          description: 'Your class vs the average — the Rate-compare insight tool',
        },
      },
      {
        path: 'settings',
        name: 'settings',
        component: SettingsView,
        meta: {
          title: 'Settings',
          description: 'School and account settings',
        },
      },
      {
        path: 'all',
        name: 'schools-list',
        component: SchoolsView,
        meta: {
          title: 'Schools',
          description: 'All schools in group (govt admin)',
        },
      },
      {
        path: 'play',
        name: 'schools-play',
        component: PlayerContainer,
        meta: {
          title: 'Class session',
          description: 'Run a class learning session — schools top bar stays above the player',
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
        meta: { title: 'Class session', description: 'Run a class learning session — tutor nav stays above the player' },
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
  // not per-door. /schools1 + /schools2 both run the ONE school flow (kept as two
  // paths so existing landing-page links don't break). Note: bare /schools is the
  // school DASHBOARD, not a signup door.
  {
    path: '/schools1',
    name: 'onboard-school-1',
    component: Onboarding,
    props: { track: 'school' },
    meta: { title: 'Set up your school' },
  },
  {
    path: '/schools2',
    name: 'onboard-school-2',
    component: Onboarding,
    props: { track: 'school' },
    meta: { title: 'Set up your school' },
  },
  {
    path: '/tutors',
    name: 'onboard-tutor',
    component: Onboarding,
    props: { track: 'tutor' },
    meta: { title: 'Start teaching' },
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
  // Admin panel
  {
    path: '/admin',
    component: AdminContainer,
    meta: { hideAppEscape: true }, // AdminContainer carries its own nav
    children: [
      {
        // Default /admin landing — redirect to the Setup page (schools + groups
        // + staff + entitlements), not the Invite-Codes subpage.
        path: '',
        redirect: '/admin/setup',
      },
      {
        path: 'access',
        name: 'admin-access',
        component: () => import('@/views/admin/AdminAccess.vue'),
        meta: { title: 'Access Codes', description: 'Create invite and direct-access codes' },
      },
      {
        path: 'demo-organisations',
        name: 'admin-demo-schools',
        component: () => import('@/views/admin/AdminDemoSchools.vue'),
        meta: { title: 'Demo Organisations', description: 'Self-serve sales showcase orgs for prospects' },
      },
      {
        // Old path — kept working, not just bookmark hygiene: the tool used
        // to mint a single flat demo school, so any saved link/doc predates
        // the org-tree model this route now serves.
        path: 'demo-schools',
        redirect: '/admin/demo-organisations',
      },
      {
        path: 'invites',
        redirect: '/admin/access',
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
        redirect: '/admin/access',
      },
      {
        path: 'try-links',
        name: 'admin-try-links',
        component: () => import('@/views/admin/AdminTryLinks.vue'),
        meta: { title: 'Try Links', description: 'Zero-friction preview links for partners' },
      },
      {
        path: 'release-notes',
        name: 'admin-release-notes',
        component: () => import('@/views/admin/AdminReleaseNotes.vue'),
        meta: { title: 'Release Notes', description: 'Curate the What\'s New panel in Settings' },
      },
      {
        // Canonical path — the whole Setup console (schools + groups + staff +
        // entitlements), not just schools. /admin/schools (below) redirects here
        // for old links.
        path: 'setup',
        name: 'admin-setup',
        component: () => import('@/views/admin/SchoolsSetup.vue'),
        meta: { title: 'Setup' },
      },
      {
        path: 'schools',
        redirect: '/admin/setup',
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
    children: [
      {
        path: '',
        name: 'admin-school-dashboard',
        component: DashboardView,
        meta: { title: 'School Dashboard', description: 'Admin view of a school' },
      },
      {
        path: 'classes',
        name: 'admin-school-classes',
        component: TeacherDashboard,
        meta: { title: 'School Classes' },
      },
      {
        path: 'classes/:classId',
        name: 'admin-school-class-detail',
        component: ClassDetail,
        meta: { title: 'Class Detail' },
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
        component: AnalyticsView,
        meta: { title: 'School Analytics' },
      },
    ],
  },
  // Admin read-view for groups (cross-schools, govt_admin-scope queries)
  {
    path: '/admin/groups/:id',
    component: AdminGroupContainer,
    children: [
      {
        path: '',
        name: 'admin-group-dashboard',
        component: DashboardView,
        meta: { title: 'Group Dashboard' },
      },
      {
        path: 'schools',
        name: 'admin-group-schools',
        component: SchoolsView,
        meta: { title: 'Schools in Group' },
      },
      {
        path: 'analytics',
        name: 'admin-group-analytics',
        component: AnalyticsView,
        meta: { title: 'Group Analytics' },
      },
    ],
  },
  // Standalone admin read-views
  {
    path: '/admin/classes/:id',
    name: 'admin-class-detail',
    component: () => import('@/views/admin/AdminClassDetail.vue'),
    meta: { title: 'Class Detail (Admin)' },
  },
  {
    path: '/admin/users/:learnerId/progress',
    name: 'admin-user-progress',
    component: () => import('@/views/admin/AdminUserProgress.vue'),
    meta: { title: 'User Progress (Admin)' },
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
  scrollBehavior(_to, _from, savedPosition) {
    if (savedPosition) {
      return savedPosition
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

// Corrective redirect for '/' — the beforeEnter guard above defers rather
// than bounce when the role cache is empty (a fresh browser has nothing to
// go on yet). Once the shared resolved-session gate settles (identity + role
// known — a single fetch, owned by useAuth) AND resolves to a school-staff
// role, catch a staff member left on the bare player: either because their
// FIRST navigation to '/' raced ahead of that DB fetch, or because they
// signed in from an already-mounted '/' (no new navigation to re-run the
// guard). A reactive watch rather than a one-shot promise so it also covers
// the later case, and so it keeps working across sign-out/sign-in within the
// same page load. Replaces the bespoke post-auth-init check that used to
// live in App.vue's onMounted — this is the one place that owns it now,
// reachable without any component/injection context (unlike App.vue's
// injected `auth` instance, which router guards can't see).
watch(
  () => useResolvedSession().isResolved.value && useUserRole().hasSchoolRole.value,
  (shouldRedirect) => {
    if (shouldRedirect && router.currentRoute.value.path === '/') {
      router.replace('/schools')
    }
  },
)

// Update document title on navigation
router.afterEach((to) => {
  const baseTitle = 'SSi'
  const pageTitle = to.meta.title as string | undefined
  document.title = pageTitle ? `${pageTitle} - ${baseTitle}` : baseTitle
})

export default router
