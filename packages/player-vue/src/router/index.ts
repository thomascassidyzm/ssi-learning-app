import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'

// Lazy-loaded views
const PlayerContainer = () => import('@/containers/PlayerContainer.vue')
const SchoolsContainer = () => import('@/containers/SchoolsContainer.vue')
const TeachContainer = () => import('@/containers/TeachContainer.vue')
const AdminContainer = () => import('@/containers/AdminContainer.vue')
const AdminSchoolsContainer = () => import('@/containers/AdminSchoolsContainer.vue')
const AdminGroupContainer = () => import('@/containers/AdminGroupContainer.vue')
const SimpleSessionTest = () => import('@/components/SimpleSessionTest.vue')
const ListeningPodPlayer = () => import('@/components/ListeningPodPlayer.vue')
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
// Teach (private tutor) views
const TeachDashboard = () => import('@/views/teach/TeachDashboard.vue')
const TeachSetup = () => import('@/views/teach/TeachSetup.vue')
const WithTeacher = () => import('@/views/teach/WithTeacher.vue')

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
  // Legacy redirect: /schools/setup → /admin/schools
  {
    path: '/schools/setup',
    redirect: '/admin/schools',
  },
  // Schools dashboard routes
  {
    path: '/schools',
    component: SchoolsContainer,
    children: [
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
  // Listening Pods
  {
    path: '/pods',
    name: 'listening-pods',
    component: ListeningPodPlayer,
    meta: {
      title: 'Listening Pods',
    },
  },
  // Test route for simple session flow
  {
    path: '/test/simple-session',
    name: 'simple-session-test',
    component: SimpleSessionTest,
    meta: {
      title: 'Simple Session Test',
    },
  },
  // Admin panel
  {
    path: '/admin',
    component: AdminContainer,
    children: [
      {
        path: '',
        name: 'admin',
        component: () => import('@/views/admin/AdminPanel.vue'),
        meta: { title: 'SSi Admin', description: 'Admin panel for managing invite codes' },
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
        path: 'entitlements',
        name: 'admin-entitlements',
        component: () => import('@/views/admin/AdminEntitlements.vue'),
        meta: { title: 'Entitlements', description: 'Manage entitlement access codes' },
      },
      {
        path: 'try-links',
        name: 'admin-try-links',
        component: () => import('@/views/admin/AdminTryLinks.vue'),
        meta: { title: 'Try Links', description: 'Zero-friction preview links for partners' },
      },
      {
        path: 'schools',
        name: 'admin-schools',
        component: () => import('@/views/admin/SchoolsSetup.vue'),
        meta: { title: 'Schools Setup' },
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

// Guard admin routes — useUserRole is the single authority.
router.beforeEach((to, _from, next) => {
  if (!to.path.startsWith('/admin')) return next()
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
