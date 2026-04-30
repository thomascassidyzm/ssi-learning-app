<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import { labelForCourse } from '@/lib/teacherCourses'
import { getPaddle } from '@/lib/paddle'
import '@/styles/schools-tokens.css'

const route = useRoute()
const supabase = inject('supabase', ref(null)) as any

interface PublicTeacher {
  id: string
  display_name: string
  photo_url: string | null
  bio: string | null
  country: string | null
  teaching_languages: string[]
}

interface PublicClass {
  id: string
  class_name: string
  course_code: string
  student_join_code: string
}

// Locked pricing — single Paddle Price ID
const STUDENT_MONTHLY_PRICE = 10
const STANDARD_SSI_PRICE = 15
const STUDENT_PADDLE_PRICE_ID =
  (import.meta.env.VITE_PADDLE_STUDENT_PRICE_MONTHLY as string | undefined) ||
  'pri_01kpxh6hq7se3yqndd4k6xb457'

const teacher = ref<PublicTeacher | null>(null)
const classInfo = ref<PublicClass | null>(null)
const seatsRemaining = ref<number | null>(null)
const isFull = ref(false)
const isLoading = ref(true)
const notFound = ref(false)

// Auth state
const userEmail = ref<string | null>(null)
const userId = ref<string | null>(null)
const isAuthLoading = ref(false)
const showLogin = ref(false)
const loginStep = ref<'email' | 'otp'>('email')
const loginEmail = ref('')
const loginOtp = ref('')
const loginError = ref('')

// Checkout state
const isOpeningCheckout = ref(false)
const checkoutError = ref('')

const code = computed(() => {
  const raw = route.params.code
  return typeof raw === 'string' ? raw.toUpperCase() : ''
})

const courseLabel = computed(() =>
  classInfo.value ? labelForCourse(classInfo.value.course_code) : ''
)

const isEmailValid = computed(
  () => !!loginEmail.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.value)
)

async function refreshSession() {
  if (!supabase.value) return
  const { data: { session } } = await supabase.value.auth.getSession()
  userEmail.value = session?.user?.email ?? null
  userId.value = session?.user?.id ?? null
}

async function loadClass() {
  if (!code.value) {
    notFound.value = true
    isLoading.value = false
    return
  }

  try {
    const res = await fetch(`/api/teacher/by-code?code=${encodeURIComponent(code.value)}`)
    if (res.status === 404 || !res.ok) {
      notFound.value = true
      return
    }
    const data = await res.json()
    teacher.value = data.teacher
    classInfo.value = data.class
    if (typeof data.seats_remaining === 'number') seatsRemaining.value = data.seats_remaining
    if (typeof data.is_full === 'boolean') isFull.value = data.is_full
  } catch {
    notFound.value = true
  } finally {
    isLoading.value = false
  }

  await refreshSession()
}

onMounted(loadClass)

async function handleStartLearning() {
  if (!teacher.value || !classInfo.value || isFull.value) return

  if (!userId.value || !userEmail.value) {
    showLogin.value = true
    return
  }

  await openCheckout()
}

async function openCheckout() {
  if (!teacher.value || !classInfo.value || !userId.value || !userEmail.value) return
  if (isOpeningCheckout.value) return

  if (!STUDENT_PADDLE_PRICE_ID) {
    checkoutError.value = 'Student plan price not configured'
    return
  }

  isOpeningCheckout.value = true
  checkoutError.value = ''
  try {
    const paddle = await getPaddle()
    paddle.Checkout.open({
      items: [{ priceId: STUDENT_PADDLE_PRICE_ID, quantity: 1 }],
      customer: { email: userEmail.value },
      customData: {
        kind: 'student_via_teacher',
        teacher_id: teacher.value.id,
        class_id: classInfo.value.id,
        supabase_user_id: userId.value,
      },
      settings: {
        successUrl: `${window.location.origin}/?just_subscribed=1`,
      },
    })
  } catch (err: any) {
    checkoutError.value = err?.message || 'Failed to open checkout'
  } finally {
    isOpeningCheckout.value = false
  }
}

async function handleSendOtp() {
  if (!isEmailValid.value || !supabase.value) return
  isAuthLoading.value = true
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
    isAuthLoading.value = false
  }
}

async function handleVerifyOtp() {
  if (loginOtp.value.length < 6 || !supabase.value) return
  isAuthLoading.value = true
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
    await refreshSession()
    showLogin.value = false
    await openCheckout()
  } catch (err: any) {
    loginError.value = err.message || 'Verification failed'
  } finally {
    isAuthLoading.value = false
  }
}

function handleBackToEmail() {
  loginStep.value = 'email'
  loginOtp.value = ''
  loginError.value = ''
}

function cancelLogin() {
  showLogin.value = false
  loginStep.value = 'email'
  loginEmail.value = ''
  loginOtp.value = ''
  loginError.value = ''
}
</script>

<template>
  <div class="with-teacher schools-surface">
    <AtmosphereBackdrop />

    <div class="with-teacher-content">
      <div v-if="isLoading" class="loading">
        <div class="loading-spinner"></div>
      </div>

      <FrostCard v-else-if="notFound" variant="panel" class="join-card not-found">
        <h1 class="frost-display">We couldn't find that class.</h1>
        <p class="not-found-copy">
          Double-check the link your teacher gave you, or head to the
          SaySomethingin home page.
        </p>
        <router-link to="/" class="home-link">
          <Button variant="primary">Go to SaySomethingin</Button>
        </router-link>
      </FrostCard>

      <FrostCard v-else-if="teacher && classInfo" variant="panel" class="join-card">
        <span class="frost-eyebrow">You're joining</span>
        <h1 class="class-name frost-display">{{ classInfo.class_name }}</h1>
        <p class="course-label">{{ courseLabel }}</p>

        <p class="with-line">
          with <strong>{{ teacher.display_name }}</strong>
        </p>

        <div v-if="teacher.photo_url" class="photo">
          <img :src="teacher.photo_url" :alt="teacher.display_name" />
        </div>

        <p v-if="teacher.bio" class="bio">{{ teacher.bio }}</p>

        <div class="price-block">
          <div class="price-row">
            <span class="price-amount frost-mono-nums">£{{ STUDENT_MONTHLY_PRICE }}</span>
            <span class="price-period">/ month</span>
          </div>
          <p class="price-pitch">
            That's <strong>£{{ STANDARD_SSI_PRICE - STUDENT_MONTHLY_PRICE }} off</strong>
            the regular SaySomethingin price (£{{ STANDARD_SSI_PRICE }}/month) —
            unlocked by your teacher's class.
          </p>
          <p class="price-hint">
            You'll have your own SaySomethingin account to practise between live sessions.
            Your subscription supports <strong>{{ teacher.display_name }}</strong>.
          </p>
        </div>

        <div v-if="isFull" class="error">
          This class is full ({{ seatsRemaining }} seats remaining). Ask your teacher
          to open another class.
        </div>

        <div v-else-if="checkoutError" class="error">{{ checkoutError }}</div>

        <Button
          v-if="!showLogin"
          variant="primary"
          size="lg"
          :disabled="isOpeningCheckout || isFull"
          :loading="isOpeningCheckout"
          @click="handleStartLearning"
        >
          Start learning
        </Button>

        <!-- Inline OTP login -->
        <div v-else class="login-block">
          <p class="login-intro">Sign in or create your SaySomethingin account to continue.</p>

          <div v-if="loginError" class="error">{{ loginError }}</div>

          <form v-if="loginStep === 'email'" class="login-form" @submit.prevent="handleSendOtp">
            <input
              v-model="loginEmail"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              autofocus
              class="login-input"
            />
            <Button
              type="submit"
              variant="primary"
              :disabled="!isEmailValid || isAuthLoading"
              :loading="isAuthLoading"
            >
              Send code
            </Button>
            <Button type="button" variant="ghost" size="sm" @click="cancelLogin">Cancel</Button>
          </form>

          <form v-else class="login-form" @submit.prevent="handleVerifyOtp">
            <p class="otp-info">
              We've emailed a 6-digit code to <strong>{{ loginEmail }}</strong>.
            </p>
            <input
              v-model="loginOtp"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="6"
              placeholder="000000"
              autocomplete="one-time-code"
              autofocus
              class="login-input otp-input"
            />
            <Button
              type="submit"
              variant="primary"
              :disabled="loginOtp.length < 6 || isAuthLoading"
              :loading="isAuthLoading"
            >
              Verify and continue to payment
            </Button>
            <Button type="button" variant="ghost" size="sm" @click="handleBackToEmail">Back</Button>
          </form>
        </div>

        <p class="trial-note">
          Same SaySomethingin account, same ten languages, same method.
        </p>
      </FrostCard>
    </div>
  </div>
</template>

<style scoped>
.with-teacher {
  min-height: 100vh;
  position: relative;
  background: var(--bg-primary);
  color: var(--ink-primary);
  font-family: var(--font-body);
}

.with-teacher-content {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: var(--space-8);
}

.loading {
  display: flex;
  justify-content: center;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(var(--tone-red), 0.12);
  border-top-color: var(--ssi-red);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

.join-card {
  padding: var(--space-12) var(--space-10);
  max-width: 480px;
  width: 100%;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.not-found {
  gap: var(--space-5);
}

.not-found .frost-display {
  font-size: var(--text-2xl);
  margin: 0;
}

.not-found-copy {
  color: var(--ink-muted);
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.5;
}

.home-link {
  text-decoration: none;
}

.class-name {
  font-size: var(--text-3xl);
  margin: var(--space-1) 0 var(--space-1);
  color: var(--ssi-red);
  letter-spacing: -0.015em;
}

.course-label {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  margin: 0 0 var(--space-3);
}

.with-line {
  font-size: var(--text-base);
  color: var(--ink-primary);
  margin: 0 0 var(--space-5);
}

.photo {
  width: 96px;
  height: 96px;
  margin: 0 auto var(--space-5);
  border-radius: var(--radius-full);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.6);
}

.photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.bio {
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;
  margin: 0 0 var(--space-5);
}

.price-block {
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(44, 38, 34, 0.06);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  margin-bottom: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
}

.price-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: var(--space-2);
}

.price-amount {
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  color: var(--ink-primary);
  line-height: 1;
}

.price-period {
  color: var(--ink-muted);
  font-size: var(--text-base);
}

.price-pitch {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  line-height: 1.5;
}

.price-pitch strong {
  color: var(--ssi-gold);
  font-weight: var(--font-bold);
}

.price-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: 1.5;
}

/* Login */
.login-block {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.login-intro {
  margin: 0 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--ink-muted);
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: stretch;
}

.login-input {
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  color: var(--ink-primary);
  text-align: center;
}

.login-input:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.12);
}

.otp-input {
  font-size: var(--text-xl);
  letter-spacing: 0.4em;
  font-family: var(--font-mono);
}

.otp-info {
  margin: 0 0 var(--space-1);
  font-size: var(--text-sm);
  color: var(--ink-muted);
}

.error {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.22);
  border-radius: var(--radius-lg);
  color: var(--ssi-red);
  font-size: var(--text-xs);
  text-align: left;
  margin-bottom: var(--space-3);
}

.trial-note {
  margin: var(--space-4) 0 0;
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .with-teacher-content {
    padding: var(--space-4);
  }

  .join-card {
    padding: var(--space-8) var(--space-6);
  }
}
</style>
