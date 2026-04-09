import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useUserRole } from '@/composables/useUserRole'

// Lazy-loaded views
const PlayerContainer = () => import('@/containers/PlayerContainer.vue')
const SchoolsContainer = () => import('@/containers/SchoolsContainer.vue')
const AdminContainer = () => import('@/containers/AdminContainer.vue')
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
          description: 'All schools in region (govt admin)',
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
        path: 'setup',
        name: 'schools-setup',
        component: () => import('@/views/schools/SetupView.vue'),
        meta: {
          title: 'Setup',
          description: 'School, group, and entitlement management',
          requiresAdmin: true,
        },
      },
    ],
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
    ],
  },
  // Shareable redeem link
  {
    path: '/redeem/:code',
    name: 'redeem-code',
    component: () => import('@/views/RedeemCode.vue'),
    meta: { title: 'Redeem Code' },
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

// Guard admin routes — useUserRole is the single authority
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
