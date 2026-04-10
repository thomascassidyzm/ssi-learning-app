<script setup lang="ts">
import { ref, inject, computed } from 'vue'
import TopNav from '@/components/schools/shared/TopNav.vue'
import GodModePanel from '@/components/schools/GodModePanel.vue'
import { SignInModal } from '@/components/auth'
import { useAuthModal } from '@/composables/useAuthModal'
import { useUserRole } from '@/composables/useUserRole'
import { setSchoolsClient } from '@/composables/schools/client'

// Supabase client from App
const supabase = inject('supabase', ref(null)) as any

// Set client immediately during setup (before child components call useGodMode)
if (supabase.value) {
  setSchoolsClient(supabase.value)
}

// Auth state — inject from App.vue (useAuth creates non-singleton refs, must use inject)
const auth = inject<any>('auth', null)
const isAuthenticated = computed(() => auth?.isAuthenticated?.value ?? false)
const isAuthLoading = computed(() => auth?.isLoading?.value ?? false)
const { canAccessSchools, restoreFromCache } = useUserRole()
restoreFromCache()

// Inline login state
const loginEmail = ref('')
const loginOtp = ref('')
const loginStep = ref<'email' | 'otp'>('email')
const loginError = ref('')
const isLoginLoading = ref(false)

const isEmailValid = computed(() =>
  loginEmail.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.value)
)

// Show dashboard if authenticated with school role
const showDashboard = computed(() =>
  isAuthenticated.value && canAccessSchools.value
)

// Show "no access" if authenticated but no school role
const showNoAccess = computed(() =>
  isAuthenticated.value && !canAccessSchools.value && !isAuthLoading.value
)

// Show login if not authenticated
const showLogin = computed(() =>
  !isAuthenticated.value && !isAuthLoading.value
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
const { open: openAuth, close: closeAuth } = useAuthModal()

const handleAuthSuccess = () => {
  closeAuth()
}
</script>

<template>
  <div class="schools-container">
    <!-- Loading spinner while auth initialises -->
    <div v-if="isAuthLoading" class="schools-loading">
      <div class="loading-spinner"></div>
      <p>Loading...</p>
    </div>

    <!-- Login screen -->
    <div v-else-if="showLogin" class="schools-login">
      <div class="login-card">
        <div class="login-header">
          <span class="login-logo">SaySomethingin</span>
          <span class="login-logo-accent">Schools</span>
        </div>
        <p class="login-subtitle">Sign in to access your school dashboard</p>

        <!-- Error -->
        <div v-if="loginError" class="login-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {{ loginError }}
        </div>

        <!-- Email step -->
        <form v-if="loginStep === 'email'" class="login-form" @submit.prevent="handleSendOtp">
          <div class="login-field">
            <label for="schools-email">Email</label>
            <input
              id="schools-email"
              v-model="loginEmail"
              type="email"
              placeholder="you@school.edu"
              autocomplete="email"
              autofocus
            />
          </div>
          <button
            type="submit"
            class="login-btn"
            :disabled="!isEmailValid || isLoginLoading"
          >
            {{ isLoginLoading ? 'Sending...' : 'Continue' }}
          </button>
        </form>

        <!-- OTP step -->
        <form v-else class="login-form" @submit.prevent="handleVerifyOtp">
          <div class="login-otp-info">
            <p>Check your email for a 6-digit code</p>
            <p class="login-otp-email">{{ loginEmail }}</p>
          </div>
          <div class="login-field">
            <label for="schools-otp">Verification Code</label>
            <input
              id="schools-otp"
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
          </div>
          <button
            type="submit"
            class="login-btn"
            :disabled="loginOtp.length < 6 || isLoginLoading"
          >
            {{ isLoginLoading ? 'Verifying...' : 'Verify' }}
          </button>
          <button type="button" class="login-back" @click="handleBackToEmail">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
        </form>
      </div>
    </div>

    <!-- No access screen -->
    <div v-else-if="showNoAccess" class="schools-login">
      <div class="login-card">
        <div class="login-header">
          <span class="login-logo">SaySomethingin</span>
          <span class="login-logo-accent">Schools</span>
        </div>
        <p class="login-subtitle">Your account doesn't have access to the schools dashboard yet.</p>
        <p class="login-hint">If you've been given a join code, enter it below.</p>

        <div v-if="joinCodeError" class="login-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {{ joinCodeError }}
        </div>

        <div v-if="joinCodeSuccess" class="login-success">
          {{ joinCodeSuccess }}
        </div>

        <form v-if="!joinCodeSuccess" class="login-form" @submit.prevent="handleRedeemCode">
          <div class="login-field">
            <label for="schools-join-code">Join Code</label>
            <input
              id="schools-join-code"
              v-model="joinCode"
              type="text"
              placeholder="e.g. ABC-123"
              class="otp-input"
              autofocus
            />
          </div>
          <button
            type="submit"
            class="login-btn"
            :disabled="!joinCode.trim() || isJoinCodeLoading"
          >
            {{ isJoinCodeLoading ? 'Checking...' : 'Join' }}
          </button>
        </form>
      </div>
    </div>

    <!-- Authenticated dashboard -->
    <template v-else-if="showDashboard">
      <TopNav @sign-in="openAuth" @sign-up="openAuth" />
      <GodModePanel />

      <main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
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
  background: var(--bg-primary);
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

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-subtle, rgba(44, 38, 34, 0.1));
  border-top-color: var(--ssi-red, #c23a3a);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Login */
.schools-login {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
}

.login-card {
  background: var(--bg-card, #ffffff);
  border: 1px solid var(--border-subtle, rgba(44, 38, 34, 0.06));
  border-radius: 20px;
  padding: 48px 40px;
  max-width: 420px;
  width: 100%;
  text-align: center;
  box-shadow: 0 4px 24px rgba(44, 38, 34, 0.08);
}

.login-header {
  margin-bottom: 8px;
}

.login-logo {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary, #2C2622);
}

.login-logo-accent {
  font-family: var(--font-body, 'DM Sans', sans-serif);
  font-size: 24px;
  font-weight: 700;
  color: var(--ssi-red, #c23a3a);
  margin-left: 6px;
}

.login-subtitle {
  color: var(--text-muted, #8A8078);
  font-size: 15px;
  margin: 0 0 28px;
  line-height: 1.5;
}

.login-hint {
  color: var(--text-muted, #8A8078);
  font-size: 13px;
  margin: 0 0 20px;
}

.login-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
  color: #dc2626;
  font-size: 13px;
  text-align: left;
  margin-bottom: 20px;
}

.login-success {
  padding: 10px 14px;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: 10px;
  color: #16a34a;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 20px;
}

.login-error svg {
  flex-shrink: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.login-field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted, #8A8078);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.login-field input {
  padding: 14px 16px;
  background: var(--bg-primary, #f5f0eb);
  border: 1px solid var(--border-subtle, rgba(44, 38, 34, 0.1));
  border-radius: 12px;
  color: var(--text-primary, #2C2622);
  font-size: 15px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.login-field input::placeholder {
  color: var(--text-faint, #b5aea6);
}

.login-field input:focus {
  outline: none;
  border-color: var(--ssi-red, #c23a3a);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.12);
}

.login-field input.otp-input {
  text-align: center;
  font-size: 22px;
  letter-spacing: 0.4em;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.login-btn {
  padding: 14px 24px;
  background: var(--ssi-red, #c23a3a);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  cursor: pointer;
  transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
}

.login-btn:hover:not(:disabled) {
  background: #a83232;
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(194, 58, 58, 0.3);
}

.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.login-back {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: none;
  border: none;
  color: var(--text-muted, #8A8078);
  font-size: 14px;
  font-family: var(--font-body, 'DM Sans', sans-serif);
  cursor: pointer;
  transition: color 0.2s;
  padding: 4px;
}

.login-back:hover {
  color: var(--text-primary, #2C2622);
}

.login-otp-info {
  margin-bottom: 4px;
}

.login-otp-info p {
  margin: 0;
  color: var(--text-muted, #8A8078);
  font-size: 14px;
}

.login-otp-email {
  color: var(--text-primary, #2C2622) !important;
  font-weight: 600;
  margin-top: 4px !important;
}

/* Page transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .main-content {
    padding: 16px;
  }

  .login-card {
    padding: 36px 24px;
    border-radius: 16px;
  }
}
</style>
