import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

// Lazy-loaded views for code splitting
const DashboardView = () => import('@/views/DashboardView.vue')
const SchoolsView = () => import('@/views/SchoolsView.vue')
const TeachersView = () => import('@/views/TeachersView.vue')
const StudentsView = () => import('@/views/StudentsView.vue')
const TeacherDashboard = () => import('@/views/TeacherDashboard.vue')
const ClassDetail = () => import('@/views/ClassDetail.vue')
const AnalyticsView = () => import('@/views/AnalyticsView.vue')
const SettingsView = () => import('@/views/SettingsView.vue')
const StudentProgressView = () => import('@/views/StudentProgressView.vue')

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: DashboardView,
    meta: {
      title: 'Dashboard',
      description: 'Overview of school learning activity',
    },
  },
  {
    path: '/schools',
    name: 'schools',
    component: SchoolsView,
    meta: {
      title: 'Schools',
      description: 'View and manage schools in region',
    },
  },
  {
    path: '/teachers',
    name: 'teachers',
    component: TeachersView,
    meta: {
      title: 'Teachers',
      description: 'Manage teachers and their classes',
    },
  },
  {
    path: '/students',
    name: 'students',
    component: StudentsView,
    meta: {
      title: 'Students',
      description: 'View and manage student progress',
    },
  },
  {
    path: '/classes',
    name: 'classes',
    component: TeacherDashboard,
    meta: {
      title: 'My Classes',
      description: 'Manage classes and start learning sessions',
    },
  },
  {
    path: '/classes/:id',
    name: 'class-detail',
    component: ClassDetail,
    meta: {
      title: 'Class Detail',
      description: 'View class roster and settings',
    },
  },
  {
    path: '/analytics',
    name: 'analytics',
    component: AnalyticsView,
    meta: {
      title: 'Analytics',
      description: 'Detailed learning analytics and reports',
    },
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsView,
    meta: {
      title: 'Settings',
      description: 'School and account settings',
    },
  },
  {
    path: '/progress',
    name: 'progress',
    component: StudentProgressView,
    meta: {
      title: 'My Progress',
      description: 'View your learning progress',
    },
  },
  // Catch-all redirect to dashboard
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
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
  const baseTitle = 'SSi Schools'
  const pageTitle = to.meta.title as string | undefined
  document.title = pageTitle ? `${pageTitle} - ${baseTitle}` : baseTitle
})

export default router
