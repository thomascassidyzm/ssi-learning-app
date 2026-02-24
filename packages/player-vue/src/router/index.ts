import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

// Lazy-loaded views
const PlayerContainer = () => import('@/containers/PlayerContainer.vue')
const SchoolsContainer = () => import('@/containers/SchoolsContainer.vue')
const SimpleSessionTest = () => import('@/components/SimpleSessionTest.vue')
const SSOCallback = () => import('@/views/SSOCallback.vue')

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
    ],
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
  // OAuth SSO callback handler
  {
    path: '/sso-callback',
    name: 'sso-callback',
    component: SSOCallback,
    meta: {
      title: 'Signing in...',
    },
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

// Update document title on navigation
router.afterEach((to) => {
  const baseTitle = 'SSi'
  const pageTitle = to.meta.title as string | undefined
  document.title = pageTitle ? `${pageTitle} - ${baseTitle}` : baseTitle
})

export default router
