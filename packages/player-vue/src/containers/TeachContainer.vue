<script setup lang="ts">
import { ref, inject, computed } from 'vue'
import TopNav from '@/components/schools/shared/TopNav.vue'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import { SignInModal } from '@/components/auth'
import { useAuthModal } from '@/composables/useAuthModal'
import '@/styles/schools-tokens.css'

// Supabase + auth from App.vue
const supabase = inject('supabase', ref(null)) as any
const auth = inject<any>('auth', null)

const isAuthenticated = computed(() => auth?.isAuthenticated?.value ?? false)
const isAuthLoading = computed(() => auth?.isLoading?.value ?? false)

const showLogin = computed(() => !isAuthenticated.value && !isAuthLoading.value)

// Inline OTP login (mirrors SchoolsContainer pattern; no role gate — anyone
// signed in can claim a teacher profile via /teach/setup)
const loginEmail = ref('')
const loginOtp = ref('')
const loginStep = ref<'email' | 'otp'>('email')
const loginError = ref('')
const isLoginLoading = ref(false)

const isEmailValid = computed(() =>
  loginEmail.value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail.value)
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

const { open: openAuth, close: closeAuth } = useAuthModal()
const handleAuthSuccess = () => closeAuth()
</script>

<template>
  <div class="teach-container schools-surface">
    <AtmosphereBackdrop />

    <div v-if="isAuthLoading" class="teach-loading">
      <div class="loading-spinner"></div>
      <p>Loading…</p>
    </div>

    <div v-else-if="showLogin" class="teach-login">
      <FrostCard variant="panel" class="login-card">
        <div class="login-header">
          <span class="login-logo">SaySomethingin</span>
          <span class="login-logo-accent">Teach</span>
        </div>
        <p class="login-subtitle">
          Sign in to your teacher account, or use this email to start earning by
          running classes for your students.
        </p>

        <div v-if="loginError" class="login-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {{ loginError }}
        </div>

        <form v-if="loginStep === 'email'" class="login-form" @submit.prevent="handleSendOtp">
          <div class="login-field">
            <label for="teach-email">Email</label>
            <input
              id="teach-email"
              v-model="loginEmail"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              autofocus
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            block
            :disabled="!isEmailValid || isLoginLoading"
            :loading="isLoginLoading"
          >
            Continue
          </Button>
        </form>

        <form v-else class="login-form" @submit.prevent="handleVerifyOtp">
          <div class="login-otp-info">
            <p>Check your email for a 6-digit code</p>
            <p class="login-otp-email">{{ loginEmail }}</p>
          </div>
          <div class="login-field">
            <label for="teach-otp">Verification code</label>
            <input
              id="teach-otp"
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
          <Button
            type="submit"
            variant="primary"
            block
            :disabled="loginOtp.length < 6 || isLoginLoading"
            :loading="isLoginLoading"
          >
            Verify
          </Button>
          <Button type="button" variant="ghost" size="sm" @click="handleBackToEmail">
            Back
          </Button>
        </form>
      </FrostCard>
    </div>

    <template v-else>
      <TopNav @sign-in="openAuth" @sign-up="openAuth" />
      <main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </template>

    <SignInModal @success="handleAuthSuccess" />
  </div>
</template>

<style scoped>
.teach-container {
  min-height: 100vh;
  position: relative;
  background: var(--bg-primary);
  color: var(--ink-primary);
  font-family: var(--font-body);
  overflow-y: auto;
}

.main-content {
  position: relative;
  z-index: 10;
  margin-top: calc(var(--nav-height) + env(safe-area-inset-top, 0px));
  min-height: calc(100vh - var(--nav-height) - env(safe-area-inset-top, 0px));
  padding: var(--space-8);
  max-width: var(--container-max);
  margin-left: auto;
  margin-right: auto;
}

/* Loading */
.teach-loading {
  position: relative;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: var(--space-4);
  color: var(--ink-muted);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(var(--tone-red), 0.12);
  border-top-color: var(--ssi-red);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

/* Login */
.teach-login {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: var(--space-6);
}

.login-card {
  padding: var(--space-12) var(--space-10);
  max-width: 420px;
  width: 100%;
  text-align: center;
}

.login-header {
  margin-bottom: var(--space-2);
}

.login-logo {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--ink-primary);
  letter-spacing: -0.015em;
}

.login-logo-accent {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--ssi-red);
  margin-left: var(--space-2);
  letter-spacing: -0.015em;
}

.login-subtitle {
  color: var(--ink-muted);
  font-size: var(--text-sm);
  margin: 0 0 var(--space-7);
  line-height: 1.5;
}

.login-error {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.22);
  border-radius: var(--radius-lg);
  color: var(--ssi-red);
  font-size: var(--text-xs);
  text-align: left;
  margin-bottom: var(--space-5);
}

.login-error svg {
  flex-shrink: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  text-align: left;
}

.login-field label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.login-field input {
  padding: var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-lg);
  color: var(--ink-primary);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.login-field input::placeholder {
  color: var(--ink-faint);
}

.login-field input:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.12);
}

.login-field input.otp-input {
  text-align: center;
  font-size: var(--text-xl);
  letter-spacing: 0.4em;
  font-family: var(--font-mono);
}

.login-otp-info {
  margin-bottom: var(--space-1);
}

.login-otp-info p {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.login-otp-email {
  color: var(--ink-primary) !important;
  font-weight: var(--font-semibold);
  margin-top: var(--space-1) !important;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--transition-base);
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
    padding: var(--space-4);
  }

  .login-card {
    padding: var(--space-10) var(--space-6);
  }
}
</style>
