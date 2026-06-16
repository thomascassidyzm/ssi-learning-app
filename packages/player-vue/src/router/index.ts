import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'

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
const StudentProgressView = () => import('@/views/schools/StudentProgressView.vue')
const SetupView = () => import('@/views/schools/SetupView.vue')
// Teach (private tutor) views
const TeachDashboard = () => import('@/views/teach/TeachDashboard.vue')
const TeachSetup = () => import('@/views/teach/TeachSetup.vue')
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
    },
  },
  // Schools dashboard routes
  {
    path: '/schools',
    component: SchoolsContainer,
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
        beforeEnter: (_to, _from, next) => {
          const { canAccessAdmin, hasSchoolRole, restoreFromCache } = useUserRole()
          restoreFromCache()
          if (canAccessAdmin.value && !hasSchoolRole.value) {
            return next('/admin/schools')
          }
          next()
        },
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
        component: AnalyticsView,
        meta: {
          title: 'Analytics',
          description: 'Detailed learning analytics and reports',
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
        path: 'student-progress',
        name: 'student-progress',
        component: StudentProgressView,
        meta: {
          title: 'Student Progress',
          description: 'Individual student progress view',
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
    ],
  },
  // Teach (private tutor) routes
  {
    path: '/teach',
    component: TeachContainer,
    children: [
      {
        path: '',
        name: 'teach-dashboard',
        component: TeachDashboard,
        meta: { title: 'Teach' },
      },
      {
        path: 'setup',
        name: 'teach-setup',
        component: TeachSetup,
        meta: { title: 'Set up your teacher profile' },
      },
    ],
  },
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
    },
  },
  // Admin panel
  {
    path: '/admin',
    component: AdminContainer,
    children: [
      {
        // Default /admin landing — redirect to the Setup page (schools + groups
        // + staff + entitlements), not the Invite-Codes subpage.
        path: '',
        redirect: '/admin/schools',
      },
      {
        path: 'access',
        name: 'admin-access',
        component: () => import('@/views/admin/AdminAccess.vue'),
        meta: { title: 'Access Codes', description: 'Create invite and direct-access codes' },
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
        path: 'schools',
        name: 'admin-schools',
        component: () => import('@/views/admin/SchoolsSetup.vue'),
        meta: { title: 'Schools Setup' },
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
        meta: { title: 'Insights', description: 'Insight Engine — Claude-directed analytics boards' },
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
  // Premium upgrade landing
  {
    path: '/premium',
    name: 'premium',
    component: () => import('@/views/PremiumView.vue'),
    meta: { title: 'SSi Premium' },
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
  // Shareable redeem link
  {
    path: '/redeem/:code',
    name: 'redeem-code',
    component: () => import('@/views/RedeemCode.vue'),
    meta: { title: 'Redeem Code' },
  },
  // Try link gateway (no auth required — zero-friction course preview)
  {
    path: '/try/:code',
    name: 'try-link',
    component: () => import('@/views/TryLinkGateway.vue'),
    meta: { title: 'Try SaySomethingin' },
  },
  // Demo launcher (no auth required)
  {
    path: '/demo',
    name: 'demo',
    component: () => import('@/views/DemoLauncher.vue'),
    meta: { title: 'Demo - SaySomethingin Schools' },
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
    window.location.assign(to.fullPath)
  }
})

// Guard admin + methodology routes — useUserRole is the single authority.
// Methodology pages are admin-gated initially (see metrics-architecture.md §9);
// individual pages may be opened to all learners later as we add a per-route
// `meta.public: true` flag, but for now everything under /methodology requires
// ssi_admin / god.
router.beforeEach((to, _from, next) => {
  const requiresAdmin = to.path.startsWith('/admin') || to.path.startsWith('/methodology')
  if (!requiresAdmin) return next()
  const { canAccessAdmin, restoreFromCache } = useUserRole()
  restoreFromCache()
  return canAccessAdmin.value ? next() : next('/')
})

// Update document title on navigation
router.afterEach((to) => {
  const baseTitle = 'SSi'
  const pageTitle = to.meta.title as string | undefined
  document.title = pageTitle ? `${pageTitle} - ${baseTitle}` : baseTitle
})

export default router
