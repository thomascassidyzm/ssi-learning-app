<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSignUp, useClerk } from '@clerk/vue'
import AuthModal from './AuthModal.vue'
import { useAuthModal } from '@/composables/useAuthModal'

interface Props {
  isOpen: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  close: []
  switchToSignIn: []
  success: []
}>()

const { isLoaded, signUp, setActive } = useSignUp()
const clerk = useClerk()
const { sharedEmail, switchToSignIn } = useAuthModal()

// Form state
const email = ref('')
const password = ref('')

// Initialize email from sharedEmail when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen && sharedEmail.value) {
    email.value = sharedEmail.value
  }
}, { immediate: true })
const confirmPassword = ref('')
const verificationCode = ref('')
const isLoading = ref(false)
const error = ref('')
const showPassword = ref(false)
const step = ref<'form' | 'verify'>('form')

// Password requirements
const passwordRequirements = computed(() => [
  { met: password.value.length >= 8, text: 'At least 8 characters' },
  { met: /[A-Z]/.test(password.value), text: 'One uppercase letter' },
  { met: /[a-z]/.test(password.value), text: 'One lowercase letter' },
  { met: /[0-9]/.test(password.value), text: 'One number' },
])

const isPasswordStrong = computed(() =>
  passwordRequirements.value.every(r => r.met)
)

// Validation
const isEmailValid = computed(() => {
  if (!email.value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)
})

const doPasswordsMatch = computed(() => {
  if (!confirmPassword.value) return true
  return password.value === confirmPassword.value
})

const canSubmit = computed(() => {
  return email.value &&
    password.value &&
    confirmPassword.value &&
    isEmailValid.value &&
    isPasswordStrong.value &&
    doPasswordsMatch.value &&
    !isLoading.value
})

// Handle sign up
const handleSignUp = async () => {
  if (!isLoaded.value || !signUp.value) return

  isLoading.value = true
  error.value = ''

  try {
    await signUp.value.create({
      emailAddress: email.value,
      password: password.value,
    })

    // Send verification email
    await signUp.value.prepareEmailAddressVerification({
      strategy: 'email_code',
    })

    step.value = 'verify'
  } catch (err: any) {
    console.error('Sign up error:', err)
    if (err.errors?.[0]?.message) {
      error.value = err.errors[0].message
    } else if (err.message) {
      error.value = err.message
    } else {
      error.value = 'Unable to create account. Please try again.'
    }
  } finally {
    isLoading.value = false
  }
}

// Handle verification
const handleVerify = async () => {
  if (!isLoaded.value || !signUp.value) return

  isLoading.value = true
  error.value = ''

  try {
    const result = await signUp.value.attemptEmailAddressVerification({
      code: verificationCode.value,
    })

    if (result.status === 'complete') {
      if (setActive.value) {
        await setActive.value({ session: result.createdSessionId })
      }
      emit('success')
      emit('close')
    } else {
      console.log('Verification requires additional steps:', result.status)
      error.value = 'Please complete all verification steps.'
    }
  } catch (err: any) {
    console.error('Verification error:', err)
    if (err.errors?.[0]?.message) {
      error.value = err.errors[0].message
    } else {
      error.value = 'Invalid verification code. Please try again.'
    }
  } finally {
    isLoading.value = false
  }
}

// Resend verification code
const resendCode = async () => {
  if (!isLoaded.value || !signUp.value) return

  try {
    await signUp.value.prepareEmailAddressVerification({
      strategy: 'email_code',
    })
    error.value = ''
  } catch (err: any) {
    error.value = 'Unable to resend code. Please try again.'
  }
}

// OAuth sign up
const handleOAuthSignUp = async (provider: 'oauth_google' | 'oauth_apple') => {
  if (!isLoaded.value || !signUp.value) return

  try {
    await signUp.value.authenticateWithRedirect({
      strategy: provider,
      redirectUrl: '/sso-callback',
      redirectUrlComplete: '/schools',
    })
  } catch (err: any) {
    console.error('OAuth error:', err)
    error.value = 'Unable to sign up with this provider.'
  }
}

// Reset form when modal closes
const handleClose = () => {
  email.value = ''
  password.value = ''
  confirmPassword.value = ''
  verificationCode.value = ''
  error.value = ''
  showPassword.value = false
  step.value = 'form'
  emit('close')
}
</script>

<template>
  <AuthModal :is-open="isOpen" :title="step === 'form' ? 'Begin your journey' : 'Check your email'" @close="handleClose">
    <!-- Sign Up Form -->
    <form v-if="step === 'form'" @submit.prevent="handleSignUp" class="auth-form">
      <!-- Error message -->
      <Transition name="error">
        <div v-if="error" class="error-message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {{ error }}
        </div>
      </Transition>

      <!-- Email input -->
      <div class="input-group">
        <label for="signup-email" class="input-label">Email</label>
        <div class="input-wrapper" :class="{ focused: email, invalid: email && !isEmailValid }">
          <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M22 6l-10 7L2 6"/>
          </svg>
          <input
            id="signup-email"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </div>
      </div>

      <!-- Password input -->
      <div class="input-group">
        <label for="signup-password" class="input-label">Password</label>
        <div class="input-wrapper" :class="{ focused: password }">
          <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <circle cx="12" cy="16" r="1"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <input
            id="signup-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="••••••••"
            autocomplete="new-password"
            required
          />
          <button
            type="button"
            class="password-toggle"
            @click="showPassword = !showPassword"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
          >
            <svg v-if="showPassword" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          </button>
        </div>

        <!-- Password requirements -->
        <div v-if="password" class="password-requirements">
          <div
            v-for="req in passwordRequirements"
            :key="req.text"
            class="requirement"
            :class="{ met: req.met }"
          >
            <svg v-if="req.met" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
            </svg>
            {{ req.text }}
          </div>
        </div>
      </div>

      <!-- Confirm password -->
      <div class="input-group">
        <label for="signup-confirm" class="input-label">Confirm Password</label>
        <div class="input-wrapper" :class="{ focused: confirmPassword, invalid: confirmPassword && !doPasswordsMatch }">
          <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <circle cx="12" cy="16" r="1"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <input
            id="signup-confirm"
            v-model="confirmPassword"
            :type="showPassword ? 'text' : 'password'"
            placeholder="••••••••"
            autocomplete="new-password"
            required
          />
        </div>
        <p v-if="confirmPassword && !doPasswordsMatch" class="input-error">
          Passwords don't match
        </p>
      </div>

      <!-- Submit button -->
      <button
        type="submit"
        class="submit-btn"
        :class="{ loading: isLoading }"
        :disabled="!canSubmit"
      >
        <span v-if="!isLoading">Create Account</span>
        <span v-else class="loading-spinner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"/>
          </svg>
        </span>
      </button>

      <!-- Divider -->
      <div class="divider">
        <span>or continue with</span>
      </div>

      <!-- OAuth buttons -->
      <div class="oauth-buttons">
        <button type="button" class="oauth-btn" @click="handleOAuthSignUp('oauth_google')">
          <svg viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google
        </button>
        <button type="button" class="oauth-btn" @click="handleOAuthSignUp('oauth_apple')">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
          </svg>
          Apple
        </button>
      </div>

      <!-- Switch to sign in -->
      <p class="switch-mode">
        Already have an account?
        <button type="button" @click="switchToSignIn(email)">Sign in</button>
      </p>
    </form>

    <!-- Verification Form -->
    <form v-else @submit.prevent="handleVerify" class="auth-form">
      <div class="verification-info">
        <div class="verification-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="4" width="20" height="16" rx="2"/>
            <path d="M22 6l-10 7L2 6"/>
          </svg>
        </div>
        <p>We've sent a verification code to</p>
        <p class="verification-email">{{ email }}</p>
      </div>

      <!-- Error message -->
      <Transition name="error">
        <div v-if="error" class="error-message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {{ error }}
        </div>
      </Transition>

      <!-- Verification code input -->
      <div class="input-group">
        <label for="verification-code" class="input-label">Verification Code</label>
        <div class="input-wrapper verification-input" :class="{ focused: verificationCode }">
          <input
            id="verification-code"
            v-model="verificationCode"
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

      <!-- Verify button -->
      <button
        type="submit"
        class="submit-btn"
        :class="{ loading: isLoading }"
        :disabled="verificationCode.length < 6 || isLoading"
      >
        <span v-if="!isLoading">Verify Email</span>
        <span v-else class="loading-spinner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"/>
          </svg>
        </span>
      </button>

      <!-- Resend code -->
      <p class="resend-code">
        Didn't receive the code?
        <button type="button" @click="resendCode">Resend</button>
      </p>

      <!-- Back to form -->
      <button type="button" class="back-btn" @click="step = 'form'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back
      </button>
    </form>
  </AuthModal>
</template>

<style scoped>
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

/* Error message */
.error-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--error-muted);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  color: var(--error);
  font-size: 0.875rem;
}

.error-message svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.error-enter-active,
.error-leave-active {
  transition: all 0.2s ease;
}

.error-enter-from,
.error-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* Input groups */
.input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.input-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
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
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.15), 0 0 20px rgba(194, 58, 58, 0.1);
}

.input-wrapper.invalid {
  border-color: var(--error);
}

.input-icon {
  position: absolute;
  left: 1rem;
  width: 18px;
  height: 18px;
  color: var(--text-muted);
  pointer-events: none;
  transition: color 0.2s ease;
}

.input-wrapper:focus-within .input-icon {
  color: var(--ssi-red);
}

.input-wrapper input {
  flex: 1;
  padding: 0.875rem 1rem 0.875rem 2.75rem;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 1rem;
  outline: none;
}

.input-wrapper input::placeholder {
  color: var(--text-muted);
}

.input-error {
  font-size: 0.75rem;
  color: var(--error);
  margin: 0;
}

/* Password toggle */
.password-toggle {
  position: absolute;
  right: 0.75rem;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--text-muted);
  transition: all 0.2s ease;
}

.password-toggle:hover {
  color: var(--text-secondary);
  background: rgba(255, 255, 255, 0.05);
}

.password-toggle svg {
  width: 18px;
  height: 18px;
}

/* Password requirements */
.password-requirements {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.requirement {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.requirement.met {
  color: var(--success);
}

.requirement svg {
  width: 14px;
  height: 14px;
}

/* Submit button */
.submit-btn {
  position: relative;
  padding: 1rem 2rem;
  background: linear-gradient(135deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
  border: none;
  border-radius: 12px;
  color: white;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  overflow: hidden;
}

.submit-btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent 0%, rgba(255, 255, 255, 0.1) 100%);
  opacity: 0;
  transition: opacity 0.2s ease;
}

.submit-btn:hover:not(:disabled)::before {
  opacity: 1;
}

.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 25px rgba(194, 58, 58, 0.4);
}

.submit-btn:active:not(:disabled) {
  transform: translateY(0);
}

.submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submit-btn.loading {
  pointer-events: none;
}

.loading-spinner svg {
  width: 24px;
  height: 24px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Divider */
.divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.1), transparent);
}

/* OAuth buttons */
.oauth-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.oauth-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.oauth-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.2);
  color: var(--text-primary);
}

.oauth-btn svg {
  width: 20px;
  height: 20px;
}

/* Switch mode */
.switch-mode {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-muted);
  margin: 0;
}

.switch-mode button {
  color: var(--ssi-gold);
  font-weight: 600;
  transition: color 0.2s ease;
}

.switch-mode button:hover {
  color: var(--ssi-gold-light);
}

/* Verification styles */
.verification-info {
  text-align: center;
  padding: 1rem 0;
}

.verification-icon {
  width: 64px;
  height: 64px;
  margin: 0 auto 1rem;
  background: linear-gradient(135deg, rgba(194, 58, 58, 0.2), rgba(212, 168, 83, 0.2));
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.verification-icon svg {
  width: 32px;
  height: 32px;
  color: var(--ssi-gold);
}

.verification-info p {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0;
}

.verification-email {
  color: var(--text-primary) !important;
  font-weight: 600;
  margin-top: 0.25rem !important;
}

.verification-input input {
  text-align: center;
  font-size: 1.5rem;
  letter-spacing: 0.5em;
  padding: 1rem !important;
  font-family: var(--font-mono);
}

/* Resend code */
.resend-code {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-muted);
  margin: 0;
}

.resend-code button {
  color: var(--ssi-gold);
  font-weight: 600;
  transition: color 0.2s ease;
}

.resend-code button:hover {
  color: var(--ssi-gold-light);
}

/* Back button */
.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  color: var(--text-muted);
  font-size: 0.875rem;
  transition: color 0.2s ease;
}

.back-btn:hover {
  color: var(--text-secondary);
}

.back-btn svg {
  width: 18px;
  height: 18px;
}
</style>
