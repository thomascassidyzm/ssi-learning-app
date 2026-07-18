<script setup lang="ts">
import { ref, inject, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SchoolsTopBar from '@/components/schools/shared/SchoolsTopBar.vue'
import SchoolsErrorBoundary from '@/components/schools/shared/SchoolsErrorBoundary.vue'
import UpgradeView from '@/views/schools/UpgradeView.vue'
import { SignInModal } from '@/components/auth'
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'
import { useAuthModal } from '@/composables/useAuthModal'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import { setSchoolsClient } from '@/composables/schools/client'
import { useSchoolData } from '@/composables/schools/useSchoolData'
import { useClassesData } from '@/composables/schools/useClassesData'
import { useTeachersData } from '@/composables/schools/useTeachersData'
import { useStudentsData } from '@/composables/schools/useStudentsData'

// Supabase client from App
const supabase = inject('supabase', ref(null)) as any

// Set client immediately during setup (before child components call useSchoolContext)
if (supabase.value) {
  setSchoolsClient(supabase.value)
}

// Auth state — inject from App.vue (useAuth creates non-singleton refs, must use inject)
const auth = inject<any>('auth', null)
const isAuthenticated = computed(() => auth?.isAuthenticated?.value ?? false)
const isAuthLoading = computed(() => auth?.isLoading?.value ?? false)
const { canAccessSchools, isSsiAdmin, isTeacher, educationalRole, isInitialized: isRoleInitialized, restoreFromCache } = useUserRole()
restoreFromCache()
const router = useRouter()

// Load the school context for the real authenticated user — the schools
// composables scope their queries off this.
const ctx = useSchoolContext()
watch(
  () => auth?.isAuthenticated?.value && canAccessSchools.value,
  (ready) => {
    if (ready && supabase.value && auth?.user?.value?.id) {
      ctx.loadFromAuth(auth.user.value.id, supabase.value).catch((err: unknown) => {
        console.error('[SchoolsContainer] Failed to load school context:', err)
      })
    }
  },
  { immediate: true },
)

// Prefetch hoist: fire the dashboard-suite data fetches here, at container
// (route entry) level, the moment the school context resolves — instead of
// waiting for each destination view (DashboardView, TeachersView, ...) to
// mount on navigation. A fresh demo-claim or login lands on /schools before
// role/school data exists; starting these here means the data is usually
// warm by the time the learner actually clicks into a tab. Composables are
// module-level singletons (see useClassesData etc.) so this is just calling
// their existing fetch functions earlier — no new caching layer.
const { fetchSchools: prefetchSchools } = useSchoolData()
const { fetchClasses: prefetchClasses } = useClassesData()
const { fetchTeachers: prefetchTeachers } = useTeachersData()
const { fetchStudents: prefetchStudents } = useStudentsData()
watch(
  () => ctx.currentUser.value,
  (user) => {
    if (!user) return
    prefetchSchools()
    if (ctx.isTeacher.value || ctx.isSchoolAdmin.value) prefetchClasses()
    if (ctx.isSchoolAdmin.value) {
      prefetchTeachers()
      prefetchStudents()
    } else if (ctx.isTeacher.value) {
      prefetchStudents()
    }
  },
  { immediate: true },
)

// Inline login state
const loginEmail = ref('')
const loginOtp = ref('')
const loginStep = ref<'email' | 'otp'>('email')
const loginError = ref('')
const isLoginLoading = ref(false)

const isEmailValid = computed(() =>
  loginEmail.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.value)
)

// Demo flow sets ctx.currentUser directly without a real auth session, so
// treat a populated context as sufficient to render the dashboard even
// when isAuthenticated is false. Real sign-ins also populate ctx.
const hasSchoolContext = computed(() => !!ctx.currentUser.value)

// Platform-subscription gate (lever-3). FAIL-OPEN: ctx.platformActive defaults
// to true for legacy rows / pre-migration DBs / unloaded context, so this never
// locks anyone out before the migration lands. ssi_admins and demo (no real
// auth) all bypass — only a real, expired school/tutor is blocked.
const platformBypass = computed(
  () => isSsiAdmin.value || !isAuthenticated.value,
)
const platformActive = computed(() => platformBypass.value || ctx.platformActive.value)

const showDashboard = computed(() =>
  (isAuthenticated.value || hasSchoolContext.value) &&
  canAccessSchools.value &&
  platformActive.value,
)

// Signed in, allowed by role, but the platform trial/subscription has lapsed.
const showExpired = computed(() =>
  (isAuthenticated.value || hasSchoolContext.value) &&
  canAccessSchools.value &&
  !platformActive.value,
)

// Auth completing (session found) can race ahead of the role cache — the
// learner-row fetch that populates useUserRole runs after auth resolves, so
// there's a window where isAuthenticated is true but roles are still
// unknown. showDashboard/showExpired fail safe in that window (they require
// canAccessSchools, which defaults false until roles load) — but showNoAccess
// is the false-positive risk: it reads "no role yet" as "no access", flashing
// (or sticking on) the join-code wall for a legitimate ssi_admin/teacher on a
// cold load. Gate it on isRoleInitialized so it can only fire once we
// actually know the answer.
const isRoleLoading = computed(() => isAuthenticated.value && !isRoleInitialized.value)

const showNoAccess = computed(() =>
  isAuthenticated.value && isRoleInitialized.value && !canAccessSchools.value && !isAuthLoading.value,
)

const showLogin = computed(() =>
  !isAuthenticated.value && !hasSchoolContext.value && !isAuthLoading.value,
)

// A solo tutor (teacher role, no school membership) who lands here is in the
// wrong place — the schools "no access / join code" wall is for a learner with
// no teaching role at all. Send them to their own dashboard at /teach instead.
//
// Tutor signal = an educational teacher role (useUserRole.isTeacher reflects
// educational_role from the role cache, or ctx.isTeacher once the school
// context row has loaded) with NO school attached (no school_id on the loaded
// context). Loop-safe: we only ever redirect AWAY from /schools to /teach (a
// different route that unmounts this container), and only while showNoAccess
// is genuinely active — so there is no path back into this watcher.
// NB: a real freelance tutor's educational_role is literally 'tutor'
// (provision.ts keeps it deliberately distinct from the school 'teacher'
// role) — so the 'teacher'-shaped checks alone MISS them on a cold load,
// stranding the exact user this redirect exists for.
const isTutorNoSchool = computed(
  () =>
    (isTeacher.value ||
      ctx.isTeacher.value ||
      educationalRole.value === 'tutor' ||
      ctx.currentUser.value?.educational_role === 'tutor') &&
    !ctx.currentUser.value?.school_id,
)
watch(
  () => showNoAccess.value && isTutorNoSchool.value,
  (redirect) => {
    if (redirect) router.replace('/tutors/dashboard')
  },
  { immediate: true },
)

async function handleSendOtp() {
  if (!isEmailValid.value || !supabase.value) return
  isLoginLoading.value = true
  loginError.value = ''

  try {
    const { error } = await supabase.value.auth.signInWithOtp({
      email: loginEmail.value.trim(),
    })
    if (error) {
      loginError.value = error.message || 'Unable to send code'
      return
    }
    loginStep.value = 'otp'
  } catch (err: any) {
    loginError.value = err.message || 'Unable to send code'
  } finally {
    isLoginLoading.value = false
  }
}

async function handleVerifyOtp() {
  if (loginOtp.value.length < 6 || !supabase.value) return
  isLoginLoading.value = true
  loginError.value = ''

  try {
    const { error } = await supabase.value.auth.verifyOtp({
      email: loginEmail.value.trim(),
      token: loginOtp.value,
      type: 'email',
    })
    if (error) {
      loginError.value = error.message || 'Invalid code'
      return
    }
    // Auth state change will be picked up by useAuth's onAuthStateChange listener
    // which calls ensureLearnerExists → useUserRole().initialize()
    // The computed showDashboard will reactively update
  } catch (err: any) {
    loginError.value = err.message || 'Verification failed'
  } finally {
    isLoginLoading.value = false
  }
}

function handleBackToEmail() {
  loginStep.value = 'email'
  loginOtp.value = ''
  loginError.value = ''
}

// Join code state (inline, no modal)
const joinCode = ref('')
const joinCodeError = ref('')
const joinCodeSuccess = ref('')
const isJoinCodeLoading = ref(false)

// Escape hatch: anyone who lands on this "no school access" wall by mistake
// (e.g. a tutor whose session got confused) must always be able to get back to
// a clean login. Sign out, then reload → the schools sign-in form.
async function handleSignOut() {
  try {
    if (auth?.signOut) await auth.signOut()
    else await supabase.value?.auth?.signOut()
  } finally {
    window.location.href = '/schools'
  }
}

async function handleRedeemCode() {
  if (!joinCode.value.trim()) return
  isJoinCodeLoading.value = true
  joinCodeError.value = ''
  joinCodeSuccess.value = ''

  try {
    // Validate
    const validateRes = await fetch('/api/code/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: joinCode.value.trim().toUpperCase() }),
    })
    const validateData = await validateRes.json()

    if (!validateData.valid) {
      joinCodeError.value = validateData.error || 'Invalid code'
      return
    }

    // Get auth token
    const { data: { session } } = await supabase.value.auth.getSession()
    if (!session?.access_token) {
      joinCodeError.value = 'Not signed in'
      return
    }

    // Redeem
    const redeemRes = await fetch('/api/code/redeem', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        code: joinCode.value.trim().toUpperCase(),
        codeKind: validateData.codeKind,
      }),
    })
    const redeemData = await redeemRes.json()

    if (!redeemData.success) {
      joinCodeError.value = redeemData.error || 'Failed to redeem code'
      return
    }

    joinCodeSuccess.value = 'Code redeemed! Loading dashboard...'
    // Reload to pick up new role
    setTimeout(() => window.location.reload(), 500)
  } catch (err: any) {
    joinCodeError.value = err.message || 'Something went wrong'
  } finally {
    isJoinCodeLoading.value = false
  }
}

// Global auth modal (still needed for TopNav sign-in)
const { close: closeAuth } = useAuthModal()

const handleAuthSuccess = () => {
  closeAuth()
}

// Email of the currently authenticated user (for no-access copy).
const authedEmail = computed(() => auth?.user?.value?.email || '')

// The /schools/play route renders the LearningPlayer inside the schools
// surface — drop main-content's padding/max-width so the player fills the
// area below the top bar instead of sitting in a centred card.
const route = useRoute()
const isPlayRoute = computed(() => route.name === 'schools-play')

// Every schools page renders in place, scrolled to top. The router's global
// scrollBehavior only scrolls the WINDOW — but this surface scrolls inside
// .schools-container (overflow-y: auto), so a tab switch used to inherit the
// previous page's scroll offset (content appearing mid/bottom of the
// viewport). flush:'post' = the new page is already in the DOM when we reset.
const containerEl = ref<HTMLElement | null>(null)
watch(
  () => route.path,
  () => {
    if (containerEl.value) containerEl.value.scrollTop = 0
  },
  { flush: 'post' },
)
</script>

<template>
  <div ref="containerEl" class="schools-container schools-surface">
    <!-- Loading spinner while auth or the role cache initialises -->
    <div v-if="isAuthLoading || isRoleLoading" class="schools-loading">
      <div class="loading-spinner"></div>
      <p>Loading...</p>
    </div>

    <!-- Login / no-access — two-pane brand + form layout -->
    <div v-else-if="showLogin || showNoAccess" class="schools-login-page">
      <!-- Brand pane -->
      <aside class="schools-login-pane schools-login-pane--brand">
        <header class="brand-logo">
          <span class="logo-mark">S</span>
          <span class="logo-text">
            SaySomethingin <span class="logo-dot">·</span> <span class="logo-tail">Schools</span>
          </span>
        </header>

        <div class="brand-body">
          <div class="brand-kicker">Welcome back</div>
          <h1 class="arsenal brand-headline">
            Welcome back.<br />Your classes are waiting.
          </h1>
          <p class="brand-lede">
            Sign in to see how your class is doing, play a session together, or jump into the
            analytics for the week. We work on Chromebooks, tablets and phones — and we never
            store student passwords.
          </p>
        </div>

        <footer class="brand-footer">
          <span>v3 · Spring 2026</span>
          <span class="brand-footer-sep">·</span>
          <a href="https://www.saysomethingin.com" class="brand-footer-link">
            ← Back to saysomethingin.com
          </a>
        </footer>
      </aside>

      <!-- Form pane -->
      <section class="schools-login-pane schools-login-pane--form">
        <div class="form-inner">
          <!-- Email step -->
          <form
            v-if="showLogin && loginStep === 'email'"
            class="login-form"
            @submit.prevent="handleSendOtp"
          >
            <h2 class="arsenal form-title">Sign in</h2>
            <p class="form-lede">
              Enter the email address your school registered with us. We'll send a single-use code.
            </p>

            <div v-if="loginError" class="form-alert form-alert--error" role="alert">
              {{ loginError }}
            </div>

            <label class="form-field">
              <span class="form-label">School email</span>
              <input
                v-model="loginEmail"
                type="email"
                placeholder="you@school.edu"
                autocomplete="email"
                autofocus
              />
            </label>

            <button
              type="submit"
              class="btn-play btn-play--block"
              :disabled="!isEmailValid || isLoginLoading"
            >
              {{ isLoginLoading ? 'Sending…' : 'Send me a code →' }}
            </button>
          </form>

          <!-- OTP step -->
          <form
            v-else-if="showLogin && loginStep === 'otp'"
            class="login-form"
            @submit.prevent="handleVerifyOtp"
          >
            <h2 class="arsenal form-title">Check your email</h2>
            <p class="form-lede">
              We sent a 6-digit code to <strong>{{ loginEmail }}</strong>. It expires in 10 minutes.
            </p>

            <div v-if="loginError" class="form-alert form-alert--error" role="alert">
              {{ loginError }}
            </div>

            <label class="form-field">
              <span class="form-label">Verification code</span>
              <input
                v-model="loginOtp"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="6"
                placeholder="000000"
                autocomplete="one-time-code"
                autofocus
                class="otp-input"
              />
            </label>

            <button
              type="submit"
              class="btn-play btn-play--block"
              :disabled="loginOtp.length < 6 || isLoginLoading"
            >
              {{ isLoginLoading ? 'Verifying…' : 'Verify and sign in →' }}
            </button>

            <div class="form-secondary-row">
              <button
                type="button"
                class="form-secondary"
                :disabled="isLoginLoading"
                @click="handleSendOtp"
              >
                Resend code
              </button>
              <button type="button" class="form-secondary" @click="handleBackToEmail">
                Use a different email
              </button>
            </div>
          </form>

          <!-- No access -->
          <form
            v-else-if="showNoAccess"
            class="login-form"
            @submit.prevent="handleRedeemCode"
          >
            <span class="no-access-pill">● No school access yet</span>
            <h2 class="arsenal form-title">You're signed in, but…</h2>
            <p class="form-lede">
              We couldn't find a school account linked to
              <strong>{{ authedEmail || 'this address' }}</strong>. Ask your school admin for a
              join code, or set up a new school below.
            </p>

            <div v-if="joinCodeError" class="form-alert form-alert--error" role="alert">
              {{ joinCodeError }}
            </div>
            <div v-if="joinCodeSuccess" class="form-alert form-alert--success" role="status">
              {{ joinCodeSuccess }}
            </div>

            <label v-if="!joinCodeSuccess" class="form-field">
              <span class="form-label">Join code from your school</span>
              <input
                v-model="joinCode"
                type="text"
                placeholder="e.g. KMP-7Q3X"
                class="join-code-input"
                autofocus
              />
            </label>

            <button
              v-if="!joinCodeSuccess"
              type="submit"
              class="btn-play btn-play--block"
              :disabled="!joinCode.trim() || isJoinCodeLoading"
            >
              {{ isJoinCodeLoading ? 'Checking…' : 'Join school →' }}
            </button>

            <div class="form-divider" />
            <a href="/schools1" class="form-secondary form-secondary--link">
              I'm setting up a new school →
            </a>
            <router-link to="/tutors/dashboard" class="form-secondary form-secondary--link">
              I'm a tutor — go to my dashboard →
            </router-link>
            <a href="/" class="form-secondary form-secondary--link">
              Just here to learn → go to the app
            </a>
            <button type="button" class="form-escape-link" @click="handleSignOut">
              Not your account? Sign out
            </button>
          </form>
        </div>
      </section>
    </div>

    <!-- Platform trial / subscription expired — pay IN-APP (no dead-end). -->
    <div v-else-if="showExpired" class="schools-expired">
      <div class="expired-card">
        <span class="expired-pill">● Trial ended</span>
        <!-- "trial", not "month": free/Welsh-track schools get a full year. -->
        <h1 class="arsenal expired-headline">Your free trial has ended</h1>
        <p class="expired-lede">
          Subscribe below to keep your classes, analytics and student progress.
          Your data is safe — nothing is deleted.
        </p>
        <UpgradeView />
      </div>
    </div>

    <!-- Authenticated dashboard -->
    <template v-else-if="showDashboard">
      <SchoolsTopBar />

      <!-- Dunning grace: Paddle marked past_due but retries are still running.
           Access is retained (see ctx.platformActive); this banner is the only
           visible sign something needs attention, so admins fix the card before
           the terminal lockout. -->
      <div v-if="ctx.platformPastDue.value" class="schools-past-due-banner">
        ⚠️ There's a problem with your school's payment. Please update your card to avoid losing access.
        <router-link to="/schools/upgrade">Manage billing</router-link>
      </div>

      <main :class="['main-content', { 'main-content--full': isPlayRoute }]">
        <SchoolsErrorBoundary>
          <!-- NO <transition> here, deliberately (2026-07-16). Two bug classes
               came from animating this swap and each fix produced the next:
               1. mode="out-in" deferred mounting the incoming page behind a
                  leave-completion callback that never fired leaving
                  /schools/analytics — blank page until hard reload.
               2. The plain crossfade that replaced it kept BOTH pages in
                  normal flow simultaneously, so the incoming page rendered
                  stacked BELOW the leaving one (measured at y≈500-870px in a
                  800px viewport) for the fade duration, then snapped up —
                  and the enter could wedge >1s when a nav landed mid-boot.
               An instant swap has no double-DOM, no leave/enter callbacks,
               nothing to get stuck on: the page renders in place, once. -->
          <router-view v-slot="{ Component }">
            <component :is="Component" />
          </router-view>
        </SchoolsErrorBoundary>
      </main>
    </template>

    <!-- Unified Auth Modal (for invite code flows) -->
    <SignInModal @success="handleAuthSuccess" />
  </div>
</template>

<style scoped>
.schools-container {
  height: 100vh;
  position: relative;
  background: var(--schools-page-backdrop, #e8e5dd);
  overflow-y: auto;
}

.main-content {
  margin-top: calc(var(--nav-height, 80px) + env(safe-area-inset-top, 0px));
  min-height: calc(100vh - var(--nav-height, 80px) - env(safe-area-inset-top, 0px));
  position: relative;
  z-index: 10;
  padding: 32px;
  max-width: 1400px;
  margin-left: auto;
  margin-right: auto;
}

/* Class session: player fills the area below the schools top bar. */
.main-content.main-content--full {
  margin-top: 0;
  padding: 0;
  max-width: none;
  min-height: calc(100vh - 54px);
}

/* Loading */
.schools-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  gap: 16px;
  color: var(--text-muted, #8A8078);
}

/* Dunning grace banner (past_due — access retained, card needs fixing) */
.schools-past-due-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 10px 16px;
  background: #fdf1d6;
  border-bottom: 1px solid rgba(184, 134, 11, 0.3);
  color: #7a5a00;
  font-size: 14px;
  text-align: center;
}
.schools-past-due-banner a {
  color: inherit;
  font-weight: 600;
  text-decoration: underline;
}

/* Expired / renew panel */
.schools-expired {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 32px;
  background: var(--schools-page-backdrop, #e8e5dd);
}
.expired-card {
  max-width: 480px;
  width: 100%;
  background: #fdf9f0;
  border: 1px solid var(--schools-border, rgba(44, 38, 34, 0.12));
  border-radius: 16px;
  padding: 40px;
  text-align: center;
  box-shadow: 0 12px 40px rgba(44, 38, 34, 0.1);
}
.expired-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  background: #fff5e5;
  border: 1px solid #f4d28a;
  color: #7a5418;
  border-radius: 30px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-bottom: 18px;
}
.expired-headline {
  font-size: 30px;
  line-height: 1.1;
  margin: 0 0 14px;
}
.expired-lede {
  font-size: 15px;
  line-height: 1.55;
  color: var(--schools-fg-2, #5a534c);
  margin: 0 0 24px;
}
.expired-cta {
  justify-content: center;
  padding: 14px 18px;
  font-size: 15px;
  text-decoration: none;
}
.expired-note {
  font-size: 13px;
  color: var(--schools-fg-3, #8a8078);
  margin: 18px 0 0;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-subtle, rgba(44, 38, 34, 0.1));
  border-top-color: var(--schools-red, #DB1E17);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* ============================================================
 * Login / no-access — two-pane brand + form layout (Aran 2026-05)
 * ============================================================ */
.schools-login-page {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  min-height: 100vh;
  background: var(--schools-page-backdrop, #e8e5dd);
}

.schools-login-pane {
  display: flex;
  flex-direction: column;
  padding: 48px 56px;
}

/* Brand pane — SSi app red (brand #DB1E17 → deep #900600), not the old maroon */
.schools-login-pane--brand {
  background:
    linear-gradient(155deg, var(--schools-red, #DB1E17) 0%, var(--schools-red-deep, #900600) 100%);
  color: #fff;
  justify-content: space-between;
  background-image:
    radial-gradient(800px 400px at 20% 0%, rgba(255, 255, 255, 0.10) 0%, transparent 60%),
    radial-gradient(600px 400px at 90% 100%, rgba(255, 255, 255, 0.06) 0%, transparent 60%),
    linear-gradient(155deg, var(--schools-red, #DB1E17) 0%, var(--schools-red-deep, #900600) 100%);
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo-mark {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  /* On the red brand pane the brand-red fill would vanish — use a white glass
     chip with the brand red as the letter colour instead. */
  background: rgba(255, 255, 255, 0.92);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: 18px;
  color: var(--schools-red-deep, #900600);
}
.logo-text {
  font-family: var(--font-display);
  font-size: 18px;
  color: #fff;
}
.logo-dot { opacity: 0.5; }
.logo-tail { opacity: 0.85; }

.brand-body { max-width: 480px; }
.brand-kicker {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.7;
  margin-bottom: 14px;
}
.brand-headline {
  font-size: clamp(36px, 4.2vw, 52px);
  line-height: 1.05;
  letter-spacing: -0.01em;
  color: #fff;
  margin: 0;
}
.brand-lede {
  font-size: 15.5px;
  line-height: 1.55;
  max-width: 430px;
  margin-top: 18px;
  opacity: 0.85;
}

.brand-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  opacity: 0.75;
  flex-wrap: wrap;
}
.brand-footer-sep { opacity: 0.4; }
.brand-footer-link {
  color: inherit;
  text-decoration: none;
  opacity: 0.85;
}
.brand-footer-link:hover { opacity: 1; }

/* Form pane */
.schools-login-pane--form {
  background: #fdf9f0;
  justify-content: center;
}
.form-inner {
  max-width: 420px;
  width: 100%;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-title {
  font-size: 34px;
  line-height: 1.1;
  margin: 0;
}
.form-lede {
  font-size: 15px;
  color: var(--schools-fg-2);
  line-height: 1.55;
  max-width: 380px;
  margin: 0;
}
.form-lede strong { color: var(--schools-fg); }

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-label {
  font-size: 12.5px;
  color: var(--schools-fg-2);
}
.form-field input {
  padding: 12px 14px;
  font-size: 15px;
  font-family: var(--font-body);
  border: 1px solid var(--schools-border-strong);
  border-radius: 8px;
  background: #fff;
  color: var(--schools-fg);
  transition: border-color 160ms ease-out, box-shadow 160ms ease-out;
}
.form-field input::placeholder { color: var(--schools-fg-3); }
.form-field input:focus {
  outline: none;
  border-color: var(--schools-red);
  box-shadow: 0 0 0 3px rgba(219, 30, 23, 0.12);
}
.form-field .otp-input {
  text-align: center;
  font-size: 26px;
  letter-spacing: 0.4em;
  font-family: var(--font-display);
  padding: 16px 14px;
}
.form-field .join-code-input {
  font-family: 'SF Mono', 'Fira Code', monospace;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Block primary button — overrides default inline btn-play layout */
.btn-play--block {
  justify-content: center;
  padding: 14px 18px;
  font-size: 15px;
}

.form-alert {
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
}
.form-alert--error {
  background: rgba(219, 30, 23, 0.08);
  border: 1px solid rgba(219, 30, 23, 0.25);
  color: var(--schools-red-deep);
}
.form-alert--success {
  background: rgba(31, 138, 91, 0.1);
  border: 1px solid rgba(31, 138, 91, 0.3);
  color: var(--schools-success);
  font-weight: 600;
}

.no-access-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: #fff5e5;
  border: 1px solid #f4d28a;
  color: #7a5418;
  border-radius: 30px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  align-self: flex-start;
}

.form-divider {
  height: 1px;
  background: var(--schools-border);
  margin: 4px 0;
}

.form-secondary {
  font-size: 13px;
  color: var(--schools-fg-2);
  text-decoration: none;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-body);
  text-align: left;
}
.form-secondary:hover:not(:disabled) { color: var(--schools-fg); }
.form-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
.form-secondary--link { display: inline-block; }

/* Escape hatch — always a way back to a clean login from this wall. */
.form-escape-link {
  display: block;
  margin-top: 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--schools-red);
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: var(--font-body);
  text-align: left;
}
.form-escape-link:hover { color: var(--schools-red-deep); text-decoration: underline; }

.form-secondary-row {
  display: flex;
  gap: 16px;
  font-size: 13px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 960px) {
  .schools-login-page {
    grid-template-columns: 1fr;
  }
  .schools-login-pane {
    padding: 32px 28px;
  }
  .schools-login-pane--brand {
    /* keep at top, compressed */
    min-height: auto;
  }
  .brand-headline { font-size: 32px; }
  .brand-lede { font-size: 14px; }
}

@media (max-width: 768px) {
  .main-content {
    padding: 16px;
  }
}
</style>
