<script setup lang="ts">
import { ref, onMounted, inject } from 'vue'
import { useRouter } from 'vue-router'
import { useSchoolContext, type SchoolUser } from '@/composables/schools/useSchoolContext'
import { useUserRole } from '@/composables/useUserRole'
import { setSchoolsClient } from '@/composables/schools/client'
import { useDemoController } from '@/composables/demo/useDemoController'
import { populateDemoData } from '@/composables/demo/populateDemoData'
import { setLocale } from '@/composables/useI18n'
import type { EagerScriptPreload } from '@/composables/useEagerScriptPreload'

const router = useRouter()
const supabase = inject<any>('supabase', ref(null))
const handleCourseSelect = inject<any>('handleCourseSelect')
const eagerScript = inject<EagerScriptPreload>('eagerScript')!
const isReady = ref(false)
const isStarting = ref(false)
const preloadStatus = ref('')

// NOTE: ssi-last-course and ssi-dev-tier are set inside startDemo(),
// NOT here in setup. Setting them at setup time leaks paid tier to
// anyone who visits /demo without starting a demo.

// Pre-built demo users with full context (no DB fetch needed)
const demoUsers: Record<string, SchoolUser> = {
  teacher: {
    user_id: 'test_teacher_rhian',
    learner_id: 'e0200000-0000-0000-0000-000000000001',
    display_name: 'Rhian Griffiths',
    educational_role: 'teacher',
    platform_role: null,
    school_id: 'e0000000-0000-0000-0000-000000000001',
    school_name: 'Ysgol Gymraeg Aberystwyth',
    region_code: 'wales',
  },
  school_admin: {
    user_id: 'test_admin_elen',
    learner_id: 'e0100000-0000-0000-0000-000000000001',
    display_name: 'Elen Rhys',
    educational_role: 'school_admin',
    platform_role: null,
    school_id: 'e0000000-0000-0000-0000-000000000001',
    school_name: 'Ysgol Gymraeg Aberystwyth',
    region_code: 'wales',
  },
  govt_admin: {
    user_id: 'test_govt_gwilym',
    learner_id: 'e0100000-0000-0000-0000-000000000010',
    display_name: 'Gwilym ap Dafydd',
    educational_role: 'govt_admin',
    platform_role: null,
    region_code: 'wales',
    organization_name: 'Llywodraeth Cymru - Adran Addysg',
  },
}

const demos = [
  {
    id: 'teacher-demo',
    userKey: 'teacher',
    title: 'Teacher View',
    subtitle: 'Rhian Griffiths — Ysgol Gymraeg Aberystwyth',
    description: 'Run a class learning session, manage classes, track student progress.',
    icon: '👩‍🏫',
  },
  {
    id: 'govt-admin-demo',
    userKey: 'govt_admin',
    title: 'Group Admin View',
    subtitle: 'Gwilym ap Dafydd — Llywodraeth Cymru',
    description: 'Monitor all schools in your group. Aggregated data, privacy-first.',
    icon: '🏛️',
  },
]

onMounted(async () => {
  // Ensure Supabase client is available for schools composables
  if (supabase.value) {
    setSchoolsClient(supabase.value)
  }
  isReady.value = true

  // Welsh preload is handled by App.vue — it reads 'cym_s_for_eng' from
  // localStorage (set synchronously in setup above) and preloads it via
  // handleCourseSelect → eagerScript.preload. No need to duplicate here.
})

async function startDemo(demo: typeof demos[0]) {
  if (isStarting.value) return
  isStarting.value = true

  const ctx = useSchoolContext()
  const demoController = useDemoController()
  const user = demoUsers[demo.userKey]

  // Flag demo-active in sessionStorage FIRST. The useGodMode watcher on
  // selectedUser (same ref as ctx.currentUser during migration) branches
  // on this flag to choose sessionStorage over localStorage, so the fake
  // persona auto-clears on tab close. If we set currentUser before the
  // flag, the persona would leak to localStorage and survive demo exit.
  sessionStorage.setItem('ssi-demo-active', 'true')
  sessionStorage.setItem('ssi-demo-last-course', 'cym_s_for_eng')
  sessionStorage.setItem('ssi-demo-tier', 'paid')

  // Set the school context directly to the demo persona. Schools composables
  // read ctx.currentUser to scope queries; for demo, they also see
  // isDemoMode=true and short-circuit to the pre-populated data refs.
  ctx.currentUser.value = user

  // Sync the impersonated role into useUserRole so the /schools route guard
  // and SchoolsContainer's canAccessSchools see a school-scoped role.
  useUserRole().initialize(user.platform_role, user.educational_role)

  // Set locale to English (demo audience speaks English)
  setLocale('eng')

  // Make handleCourseSelect available to the demo controller for direct course switching
  if (handleCourseSelect) {
    ;(window as any).__demoSelectCourse = handleCourseSelect
  }

  // Populate dashboard data directly into composable refs — no Supabase queries
  populateDemoData(demo.userKey as 'teacher' | 'govt_admin')

  // Navigate to schools dashboard (data is already in the refs, renders instantly)
  await router.push('/schools')

  // Small delay for mount, then start the demo tour
  await new Promise(resolve => setTimeout(resolve, 300))
  demoController.startDemo(demo.id)
}
</script>

<template>
  <div class="demo-launcher">
    <div class="demo-content">
      <!-- Header -->
      <div class="demo-header">
        <div class="demo-logo">
          <span class="logo-text">SaySomethingin</span>
          <span class="logo-accent">Schools</span>
        </div>
        <p class="demo-tagline">
          The simplest way to bring language learning to life in your classroom.
          Built on 15 years of proven methodology.
        </p>
      </div>

      <!-- Demo cards -->
      <div class="demo-cards">
        <button
          v-for="demo in demos"
          :key="demo.id"
          class="demo-card"
          :disabled="!isReady || isStarting"
          @click="startDemo(demo)"
        >
          <span class="card-icon">{{ demo.icon }}</span>
          <div class="card-text">
            <h2 class="card-title">{{ demo.title }}</h2>
            <p class="card-subtitle">{{ demo.subtitle }}</p>
            <p class="card-description">{{ demo.description }}</p>
          </div>
          <span class="card-arrow">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </button>
      </div>

      <!-- Footer -->
      <p class="demo-footer">
        This is a live interactive demo with sample data from Welsh schools.
        <br>Use arrow keys during the tour to navigate between steps.
      </p>
      <p v-if="preloadStatus && preloadStatus !== 'Ready'" class="demo-preload-status">
        {{ preloadStatus }}
      </p>

      <!-- Back to app -->
      <router-link to="/" class="back-to-app">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back to app
      </router-link>
    </div>
  </div>
</template>

<style scoped>
.demo-launcher {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary, #e8e3dd);
  padding: 24px;
  padding-top: calc(24px + env(safe-area-inset-top, 0px));
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
}

.demo-content {
  max-width: 560px;
  width: 100%;
}

.demo-header {
  text-align: center;
  margin-bottom: 40px;
}

.demo-logo {
  margin-bottom: 16px;
}

.logo-text {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary, #2C2622);
  letter-spacing: -0.02em;
}

.logo-accent {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 28px;
  font-weight: 700;
  color: var(--ssi-red, #c23a3a);
  margin-left: 8px;
}

.demo-tagline {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 15px;
  color: var(--text-muted, #8A8078);
  line-height: 1.6;
  margin: 0;
}

.demo-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 32px;
}

.demo-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.04));
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
  width: 100%;
  color: inherit;
  font: inherit;
  box-shadow: var(--shadow-sm, 0 1px 3px rgba(44, 38, 34, 0.10));
}

.demo-card:hover:not(:disabled) {
  border-color: var(--ssi-red, #c23a3a);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md, 0 2px 6px rgba(44, 38, 34, 0.12));
}

.demo-card:active:not(:disabled) {
  transform: translateY(0);
}

.demo-card:disabled {
  opacity: 0.5;
  cursor: wait;
}

.card-icon {
  font-size: 32px;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary, #e8e3dd);
  border-radius: 12px;
}

.card-text {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary, #2C2622);
  margin: 0 0 2px;
}

.card-subtitle {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 13px;
  color: var(--ssi-red, #c23a3a);
  margin: 0 0 6px;
  font-weight: 500;
}

.card-description {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 13px;
  color: var(--text-muted, #8A8078);
  margin: 0;
  line-height: 1.4;
}

.card-arrow {
  flex-shrink: 0;
  color: var(--text-muted, #8A8078);
  transition: color 0.2s ease, transform 0.2s ease;
}

.demo-card:hover .card-arrow {
  color: var(--ssi-red, #c23a3a);
  transform: translateX(2px);
}

.demo-footer {
  text-align: center;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 12px;
  color: var(--text-muted, #8A8078);
  line-height: 1.6;
  margin: 0;
}

.demo-preload-status {
  text-align: center;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 11px;
  color: var(--ssi-red, #c23a3a);
  margin: 12px 0 0;
  opacity: 0.7;
}

.back-to-app {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 24px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 14px;
  color: var(--text-muted, #8A8078);
  text-decoration: none;
  transition: color 0.2s ease;
}

.back-to-app:hover {
  color: var(--text-primary, #2C2622);
}

@media (max-width: 480px) {
  .demo-launcher {
    padding: 16px;
  }

  .logo-text,
  .logo-accent {
    font-size: 22px;
  }

  .demo-card {
    padding: 16px;
  }

  .card-icon {
    font-size: 24px;
    width: 40px;
    height: 40px;
  }
}
</style>
