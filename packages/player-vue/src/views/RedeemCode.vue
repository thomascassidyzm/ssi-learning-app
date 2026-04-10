<script setup lang="ts">
import { ref, computed, onMounted, inject, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInviteCode } from '../composables/useInviteCode'
import { useSharedUserEntitlements } from '../composables/useUserEntitlements'
import { useUserRole } from '../composables/useUserRole'

const route = useRoute()
const router = useRouter()
const auth = inject<any>('auth', null)
const supabase = inject<any>('supabase', ref(null))
const { validateCode, redeemCode, pendingCode, clearPendingCode } = useInviteCode()
const { refresh: refreshEntitlements } = useSharedUserEntitlements()

// --- State ---
const step = ref<'validating' | 'invalid' | 'auth' | 'otp' | 'redeeming' | 'success'>('validating')
const error = ref('')
const email = ref('')
const otpCode = ref('')
const isLoading = ref(false)
const redeemLabel = ref('')
const redirectUrl = ref('/')

const code = computed(() => (route.params.code as string) || '')
const isSignedIn = computed(() => auth?.isAuthenticated?.value ?? false)
const userEmail = computed(() => auth?.user?.value?.email || '')

// Display info from validation
const displayTitle = computed(() => {
  if (!pendingCode.value) return ''
  if (pendingCode.value.codeKind === 'entitlement') {
    return pendingCode.value.label || 'Access Code'
  }
  const map: Record<string, string> = {
    ssi_admin: 'SSi Admin Invite',
    govt_admin: 'Group Admin Invite',
    school_admin: 'School Admin Invite',
    teacher: 'Teacher Invite',
    student: 'Student Invite',
    tester: 'Beta Tester Invite',
  }
  return map[pendingCode.value.codeType || ''] || 'Invite Code'
})

const displayDetail = computed(() => {
  if (!pendingCode.value) return ''
  if (pendingCode.value.codeKind === 'entitlement') {
    const parts = []
    if (pendingCode.value.accessDescription) parts.push(pendingCode.value.accessDescription)
    if (pendingCode.value.durationDescription) parts.push(pendingCode.value.durationDescription)
    return parts.join(' · ')
  }
  const ctx = pendingCode.value
  if (ctx.schoolName) return ctx.schoolName
  if (ctx.groupName) return ctx.groupName
  if (ctx.className) return ctx.className
  return ''
})

const isEmailValid = computed(() => {
  if (!email.value) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)
})

// --- Role-specific copy ---
const authInstructionText = computed(() => {
  const pc = pendingCode.value
  if (!pc) return 'Enter your email to get started'
  if (pc.codeKind === 'entitlement') return 'Enter your email to activate your access'
  switch (pc.codeType) {
    case 'teacher': return 'Enter your email to set up your teacher account'
    case 'student': {
      const cls = pc.className
      return cls ? `Enter your email to join ${cls}` : 'Enter your email to join this class'
    }
    case 'school_admin': return 'Enter your email to set up your school account'
    case 'govt_admin': return 'Enter your email to set up your group admin account'
    default: return 'Enter your email to get started'
  }
})

const successHeading = computed(() => {
  const pc = pendingCode.value
  if (!pc) return "You're all set!"
  if (pc.codeKind === 'entitlement') return 'Access activated!'
  switch (pc.codeType) {
    case 'teacher': return 'Welcome! Your teacher account is ready'
    case 'student': return "You've joined the class!"
    case 'school_admin': return 'Your school account is ready'
    case 'govt_admin': return 'Your group admin account is ready'
    default: return "You're all set!"
  }
})

const successSubtext = computed(() => {
  const pc = pendingCode.value
  if (!pc) return 'Redirecting...'
  if (pc.codeKind === 'entitlement') return 'Taking you to the app...'
  switch (pc.codeType) {
    case 'teacher': return 'Taking you to your classroom dashboard...'
    case 'student': return 'Taking you to your first lesson...'
    case 'school_admin': return 'Taking you to your school overview...'
    case 'govt_admin': return 'Taking you to your group overview...'
    default: return 'Redirecting...'
  }
})

// --- Step 1: Validate on mount ---
onMounted(async () => {
  if (!code.value) {
    error.value = 'No code provided'
    step.value = 'invalid'
    return
  }
  const valid = await validateCode(code.value)
  if (!valid) {
    error.value = 'This code is invalid or has expired'
    step.value = 'invalid'
    return
  }
  // Valid code — check auth state
  if (isSignedIn.value) {
    await doRedeem()
  } else {
    step.value = 'auth'
  }
})

// Watch for auth state changes (e.g. after OTP verify propagates)
watch(isSignedIn, async (signedIn) => {
  if (signedIn && step.value === 'otp') {
    await doRedeem()
  }
})

// --- Step 2: Send OTP ---
async function handleSendOtp() {
  if (!isEmailValid.value) return
  const client = supabase.value
  if (!client) {
    error.value = 'App not ready. Please try again.'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const { error: otpError } = await client.auth.signInWithOtp({ email: email.value })
    if (otpError) {
      error.value = otpError.message || 'Unable to send code. Please try again.'
      return
    }
    step.value = 'otp'
  } catch (err: any) {
    error.value = err.message || 'Unable to send code. Please try again.'
  } finally {
    isLoading.value = false
  }
}

// --- Step 2b: Verify OTP ---
async function handleVerifyOtp() {
  if (otpCode.value.length < 6) return
  const client = supabase.value
  if (!client) {
    error.value = 'App not ready. Please try again.'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const { error: verifyError } = await client.auth.verifyOtp({
      email: email.value,
      token: otpCode.value,
      type: 'email',
    })
    if (verifyError) {
      error.value = verifyError.message || 'Invalid code. Please try again.'
      return
    }
    // Auth state will update via onAuthStateChange — doRedeem called from watcher
    // But also try directly in case watcher doesn't fire fast enough
    await doRedeem()
  } catch (err: any) {
    error.value = err.message || 'Verification failed. Please try again.'
  } finally {
    isLoading.value = false
  }
}

// --- Step 2c: Resend OTP ---
async function handleResendOtp() {
  const client = supabase.value
  if (!client) return

  try {
    const { error: otpError } = await client.auth.signInWithOtp({ email: email.value })
    if (otpError) {
      error.value = 'Unable to resend code. Please try again.'
    } else {
      error.value = ''
    }
  } catch {
    error.value = 'Unable to resend code. Please try again.'
  }
}

// --- Step 3: Redeem ---
async function doRedeem() {
  step.value = 'redeeming'
  error.value = ''

  try {
    const client = supabase.value
    if (!client) {
      error.value = 'App not ready.'
      step.value = 'auth'
      return
    }

    const { data: { session } } = await client.auth.getSession()
    const token = session?.access_token
    if (!token) {
      // Not actually signed in yet — wait for auth propagation
      step.value = 'auth'
      return
    }

    const result = await redeemCode(token)
    if (result.success) {
      redeemLabel.value = result.label || displayTitle.value
      if (result.codeKind === 'entitlement') {
        refreshEntitlements()
      }
      // Update role immediately so feedback widget appears without reload
      if (pendingCode.value?.codeType === 'tester') {
        useUserRole().initialize('tester', null)
      } else if (pendingCode.value?.codeType === 'ssi_admin') {
        useUserRole().initialize('ssi_admin', null)
      } else if (pendingCode.value?.codeType) {
        useUserRole().initialize(null, pendingCode.value.codeType)
      }
      step.value = 'success'
      redirectUrl.value = result.redirectTo || '/'
      setTimeout(() => {
        router.push(redirectUrl.value)
      }, 4000)
    } else {
      error.value = result.error || 'Failed to redeem code'
      step.value = 'auth'
    }
  } catch {
    error.value = 'Something went wrong'
    step.value = 'auth'
  }
}

function goToRedirect() {
  router.push(redirectUrl.value)
}

function goHome() {
  clearPendingCode()
  router.push('/')
}
</script>

<template>
  <div class="redeem-page">
    <div class="redeem-card">

      <!-- Step 1: Validating -->
      <div v-if="step === 'validating'" class="redeem-section">
        <div class="spinner"></div>
        <p class="status-text">Checking code...</p>
      </div>

      <!-- Invalid code -->
      <div v-else-if="step === 'invalid'" class="redeem-section">
        <div class="icon-circle icon-circle--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <h2>Invalid Code</h2>
        <p class="detail-text">{{ error }}</p>
        <button class="btn btn--secondary" @click="goHome">Go to App</button>
      </div>

      <!-- Redeeming spinner -->
      <div v-else-if="step === 'redeeming'" class="redeem-section">
        <h2 class="code-title">{{ displayTitle }}</h2>
        <p v-if="displayDetail" class="detail-text">{{ displayDetail }}</p>
        <div class="spinner" style="margin-top: 1.5rem"></div>
        <p class="status-text">Activating your code...</p>
      </div>

      <!-- Success -->
      <div v-else-if="step === 'success'" class="redeem-section">
        <div class="icon-circle icon-circle--success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2 class="success-title">{{ successHeading }}</h2>
        <p class="detail-text">{{ redeemLabel }}</p>
        <p class="redirect-text">{{ successSubtext }}</p>
        <button class="btn btn--primary btn--continue" @click="goToRedirect">Continue</button>
      </div>

      <!-- Auth + OTP flow -->
      <template v-else>
        <h2 class="code-title">{{ displayTitle }}</h2>
        <p v-if="displayDetail" class="detail-text">{{ displayDetail }}</p>

        <!-- Already signed in -->
        <div v-if="isSignedIn" class="redeem-section">
          <p class="signed-in-text">Signed in as <strong>{{ userEmail }}</strong></p>
          <button class="btn btn--primary" @click="doRedeem">Redeem</button>
        </div>

        <!-- Email input (step === 'auth') -->
        <form v-else-if="step === 'auth'" class="auth-form" @submit.prevent="handleSendOtp">
          <p class="instruction-text">{{ authInstructionText }}</p>

          <Transition name="error-fade">
            <div v-if="error" class="error-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {{ error }}
            </div>
          </Transition>

          <div class="input-group">
            <label for="redeem-email" class="input-label">Email</label>
            <div class="input-wrapper" :class="{ invalid: email && !isEmailValid }">
              <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M22 6l-10 7L2 6"/>
              </svg>
              <input
                id="redeem-email"
                v-model="email"
                type="email"
                placeholder="you@example.com"
                autocomplete="email"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            class="btn btn--primary"
            :class="{ loading: isLoading }"
            :disabled="!isEmailValid || isLoading"
          >
            <span v-if="!isLoading">Continue</span>
            <span v-else class="btn-spinner"></span>
          </button>
        </form>

        <!-- OTP input (step === 'otp') -->
        <form v-else-if="step === 'otp'" class="auth-form" @submit.prevent="handleVerifyOtp">
          <div class="otp-info">
            <div class="icon-circle icon-circle--mail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M22 6l-10 7L2 6"/>
              </svg>
            </div>
            <p class="instruction-text">Check your email for a 6-digit code</p>
            <p class="email-highlight">{{ email }}</p>
            <p class="otp-helper-text">It may take a moment to arrive. Check your spam folder if needed.</p>
          </div>

          <Transition name="error-fade">
            <div v-if="error" class="error-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {{ error }}
            </div>
          </Transition>

          <div class="input-group">
            <label for="redeem-otp" class="input-label">Verification Code</label>
            <div class="input-wrapper otp-input-wrapper">
              <input
                id="redeem-otp"
                v-model="otpCode"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="6"
                placeholder="000000"
                autocomplete="one-time-code"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            class="btn btn--primary"
            :class="{ loading: isLoading }"
            :disabled="otpCode.length < 6 || isLoading"
          >
            <span v-if="!isLoading">Verify</span>
            <span v-else class="btn-spinner"></span>
          </button>

          <p class="resend-text">
            Didn't get the code?
            <button type="button" @click="handleResendOtp">Resend</button>
          </p>

          <button type="button" class="back-link" @click="step = 'auth'; error = ''; otpCode = ''">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
        </form>
      </template>
    </div>
  </div>
</template>

<style scoped>
.redeem-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary, #0a0a0f);
  padding: 1rem;
  font-family: 'DM Sans', sans-serif;
}

.redeem-card {
  background: var(--bg-card, #141420);
  border-radius: 16px;
  padding: 2.5rem 2rem;
  max-width: 420px;
  width: 100%;
  text-align: center;
  color: var(--text-primary, #e0e0e0);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.redeem-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

/* --- Typography --- */

.code-title {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.redeem-card h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.detail-text {
  color: var(--text-secondary, #aaa);
  margin: 0;
  font-size: 0.9375rem;
}

.status-text {
  color: var(--text-secondary, #aaa);
  font-size: 0.9375rem;
  margin: 0;
}

.instruction-text {
  color: var(--text-secondary, #aaa);
  font-size: 0.9375rem;
  margin: 0;
}

.signed-in-text {
  color: var(--text-secondary, #aaa);
  font-size: 0.9375rem;
  margin: 0.75rem 0 1.25rem;
}

.signed-in-text strong {
  color: var(--text-primary, #fff);
}

.redirect-text {
  color: var(--text-secondary, #aaa);
  font-size: 0.875rem;
  margin: 0.5rem 0 0;
}

.success-title {
  color: #66bb6a !important;
}

.otp-helper-text {
  color: var(--text-muted, #666);
  font-size: 0.8125rem;
  margin: 0.25rem 0 0;
}

.btn--continue {
  margin-top: 0.75rem;
}

/* --- Spinner --- */

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(194, 58, 58, 0.2);
  border-top-color: #c23a3a;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* --- Icon circles --- */

.icon-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.5rem;
}

.icon-circle svg {
  width: 32px;
  height: 32px;
}

.icon-circle--error {
  background: rgba(239, 83, 80, 0.15);
  color: #ef5350;
}

.icon-circle--success {
  background: rgba(102, 187, 106, 0.15);
  color: #66bb6a;
}

.icon-circle--mail {
  background: linear-gradient(135deg, rgba(194, 58, 58, 0.2), rgba(212, 168, 83, 0.2));
  color: var(--ssi-gold, #d4a853);
}

/* --- Auth form --- */

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  margin-top: 1.5rem;
}

/* --- Error banner --- */

.error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  color: #ef5350;
  font-size: 0.875rem;
  text-align: left;
}

.error-banner svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.error-fade-enter-active,
.error-fade-leave-active {
  transition: all 0.2s ease;
}

.error-fade-enter-from,
.error-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* --- Inputs --- */

.input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
}

.input-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.input-wrapper:hover {
  border-color: rgba(255, 255, 255, 0.2);
}

.input-wrapper:focus-within {
  border-color: #c23a3a;
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.15), 0 0 20px rgba(194, 58, 58, 0.1);
}

.input-wrapper.invalid {
  border-color: #ef5350;
}

.input-icon {
  position: absolute;
  left: 1rem;
  width: 18px;
  height: 18px;
  color: var(--text-muted, #666);
  pointer-events: none;
  transition: color 0.2s ease;
}

.input-wrapper:focus-within .input-icon {
  color: #c23a3a;
}

.input-wrapper input {
  flex: 1;
  padding: 0.875rem 1rem 0.875rem 2.75rem;
  background: transparent;
  border: none;
  color: var(--text-primary, #e0e0e0);
  font-size: 1rem;
  font-family: 'DM Sans', sans-serif;
  outline: none;
}

.input-wrapper input::placeholder {
  color: var(--text-muted, #666);
}

/* OTP input */
.otp-input-wrapper input {
  text-align: center;
  font-size: 1.5rem;
  letter-spacing: 0.5em;
  padding: 1rem !important;
  font-family: var(--font-mono, monospace);
}

.otp-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.email-highlight {
  color: var(--text-primary, #fff);
  font-weight: 600;
  font-size: 0.9375rem;
  margin: 0;
}

/* --- Buttons --- */

.btn {
  padding: 0.875rem 1.5rem;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  position: relative;
}

.btn--primary {
  background: linear-gradient(135deg, #c23a3a 0%, #a02e2e 100%);
  color: white;
}

.btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 25px rgba(194, 58, 58, 0.4);
}

.btn--primary:active:not(:disabled) {
  transform: translateY(0);
}

.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary.loading {
  pointer-events: none;
}

.btn--secondary {
  background: var(--bg-card-hover, #1e1e2e);
  color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border, #333);
}

.btn--secondary:hover {
  background: var(--bg-hover, #2a2a3e);
}

.btn-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* --- Resend / back --- */

.resend-text {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-muted, #666);
  margin: 0;
}

.resend-text button {
  color: var(--ssi-gold, #d4a853);
  font-weight: 600;
  background: none;
  border: none;
  cursor: pointer;
  font-family: 'DM Sans', sans-serif;
  font-size: 0.875rem;
  padding: 0;
  transition: color 0.2s ease;
}

.resend-text button:hover {
  color: var(--ssi-gold-light, #e0c080);
}

.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  color: var(--text-muted, #666);
  font-size: 0.875rem;
  font-family: 'DM Sans', sans-serif;
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s ease;
}

.back-link:hover {
  color: var(--text-secondary, #aaa);
}

.back-link svg {
  width: 18px;
  height: 18px;
}
</style>
