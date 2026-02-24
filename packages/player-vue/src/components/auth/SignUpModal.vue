<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSignUp, useClerk } from '@clerk/vue'
import AuthModal from './AuthModal.vue'
import { useAuthModal } from '@/composables/useAuthModal'
import { useInviteCode } from '@/composables/useInviteCode'

interface Props {
  isOpen: boolean
  startStep?: 'code' | 'form'
}

const props = withDefaults(defineProps<Props>(), {
  startStep: 'form',
})

const emit = defineEmits<{
  close: []
  switchToSignIn: []
  success: [payload?: { role?: string; redirectTo?: string }]
}>()

const { isLoaded, signUp, setActive } = useSignUp()
const clerk = useClerk()
const { sharedEmail, switchToSignIn } = useAuthModal()
const { pendingCode, validationError, isValidating, isRedeeming, validateCode, redeemCode, clearPendingCode } = useInviteCode()

// Form state
const email = ref('')

// Initialize email from sharedEmail when modal opens
watch(() => props.isOpen, (isOpen) => {
  if (isOpen && sharedEmail.value) {
    email.value = sharedEmail.value
  }
  if (isOpen) {
    step.value = props.startStep === 'code' ? 'code' : (pendingCode.value ? 'context' : 'form')
  }
}, { immediate: true })
const verificationCode = ref('')
const isLoading = ref(false)
const error = ref('')
const step = ref<'code' | 'context' | 'form' | 'verify'>(props.startStep === 'code' ? 'code' : 'form')

// Invite code input
const codeInput = ref('')

// Auto-format code input: uppercase, auto-hyphen after 3 chars
const handleCodeInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  let val = target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  // Auto-insert hyphen after 3 letters
  if (val.length === 4 && !val.includes('-')) {
    val = val.slice(0, 3) + '-' + val.slice(3)
  }
  // Max length ABC-123
  if (val.length > 7) val = val.slice(0, 7)
  codeInput.value = val
}

const handleValidateCode = async () => {
  if (!codeInput.value || codeInput.value.length < 5) return
  const valid = await validateCode(codeInput.value)
  if (valid) {
    step.value = 'context'
  }
}

const stepTitle = computed(() => {
  if (step.value === 'code') return 'Enter invite code'
  if (step.value === 'context') return 'Confirm your role'
  if (step.value === 'verify') return 'Check your email'
  return 'Begin your journey'
})

const roleDisplayName = computed(() => {
  if (!pendingCode.value) return ''
  const map: Record<string, string> = {
    govt_admin: 'Regional Admin',
    school_admin: 'School Admin',
    teacher: 'Teacher',
    student: 'Student',
  }
  return map[pendingCode.value.codeType] || pendingCode.value.codeType
})

const contextDescription = computed(() => {
  if (!pendingCode.value) return ''
  const ctx = pendingCode.value
  if (ctx.codeType === 'govt_admin' && ctx.regionName) return `for ${ctx.regionName}`
  if (ctx.codeType === 'school_admin' && ctx.regionName) return `in ${ctx.regionName}`
  if (ctx.codeType === 'teacher' && ctx.schoolName) return `at ${ctx.schoolName}`
  if (ctx.codeType === 'student') {
    const parts = []
    if (ctx.className) parts.push(ctx.className)
    if (ctx.schoolName) parts.push(`at ${ctx.schoolName}`)
    return parts.join(' ')
  }
  return ''
})

// Validation
const isEmailValid = computed(() => {
  if (!email.value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)
})

const canSubmit = computed(() => {
  return email.value && isEmailValid.value && !isLoading.value
})

// Handle sign up
const handleSignUp = async () => {
  if (!isLoaded.value || !signUp.value) return

  isLoading.value = true
  error.value = ''

  try {
    await signUp.value.create({
      emailAddress: email.value,
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

      // If there's a pending invite code, redeem it now
      if (pendingCode.value) {
        try {
          // Get fresh session token from Clerk
          const sess = clerk.value?.session
          const token = sess ? await sess.getToken() : null
          if (token) {
            const redeemResult = await redeemCode(token)
            if (redeemResult.success) {
              emit('success', { role: redeemResult.role, redirectTo: redeemResult.redirectTo })
              emit('close')
              return
            }
            console.error('[SignUpModal] Code redemption failed:', redeemResult.error)
          }
        } catch (err) {
          console.error('[SignUpModal] Code redemption error:', err)
        }
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

// Reset form when modal closes
const handleClose = () => {
  email.value = ''
  verificationCode.value = ''
  error.value = ''
  codeInput.value = ''
  clearPendingCode()
  step.value = 'form'
  emit('close')
}
</script>

<template>
  <AuthModal :is-open="isOpen" :title="stepTitle" @close="handleClose">
    <!-- Code Entry Step -->
    <div v-if="step === 'code'" class="auth-form">
      <p class="code-intro">Have an invite code? Enter it below to join your school or class.</p>

      <!-- Error message -->
      <Transition name="error">
        <div v-if="validationError" class="error-message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {{ validationError }}
        </div>
      </Transition>

      <div class="input-group">
        <label for="invite-code" class="input-label">Invite Code</label>
        <div class="input-wrapper code-input-wrapper" :class="{ focused: codeInput }">
          <input
            id="invite-code"
            :value="codeInput"
            @input="handleCodeInput"
            type="text"
            placeholder="ABC-123"
            autocomplete="off"
            maxlength="7"
          />
        </div>
      </div>

      <button
        type="button"
        class="submit-btn"
        :class="{ loading: isValidating }"
        :disabled="codeInput.length < 5 || isValidating"
        @click="handleValidateCode"
      >
        <span v-if="!isValidating">Validate Code</span>
        <span v-else class="loading-spinner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="32"/>
          </svg>
        </span>
      </button>

      <p class="switch-mode">
        Don't have a code?
        <button type="button" @click="step = 'form'">Sign up without a code</button>
      </p>
    </div>

    <!-- Context Confirmation Step -->
    <div v-else-if="step === 'context'" class="auth-form">
      <div class="context-card">
        <div class="role-badge">{{ roleDisplayName }}</div>
        <p class="context-detail" v-if="contextDescription">{{ contextDescription }}</p>
      </div>

      <button type="button" class="submit-btn" @click="step = 'form'">
        Continue to sign up
      </button>

      <button type="button" class="back-btn" @click="clearPendingCode(); codeInput = ''; step = 'code'">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Use a different code
      </button>
    </div>

    <!-- Sign Up Form -->
    <form v-else-if="step === 'form'" @submit.prevent="handleSignUp" class="auth-form">
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

      <p class="otp-hint">We'll send you a verification code</p>

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

.otp-hint {
  text-align: center;
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin: -0.5rem 0 0;
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

/* Code entry step */
.code-intro {
  color: var(--text-secondary);
  font-size: 0.875rem;
  text-align: center;
  margin: 0;
}

.code-input-wrapper input {
  text-align: center;
  font-size: 1.5rem;
  letter-spacing: 0.3em;
  padding: 1rem !important;
  font-family: var(--font-mono);
  text-transform: uppercase;
}

/* Context confirmation step */
.context-card {
  text-align: center;
  padding: 1.5rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
}

.role-badge {
  display: inline-block;
  padding: 0.375rem 1rem;
  background: linear-gradient(135deg, rgba(194, 58, 58, 0.2), rgba(212, 168, 83, 0.2));
  border: 1px solid rgba(212, 168, 83, 0.3);
  border-radius: 20px;
  color: var(--ssi-gold);
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.context-detail {
  color: var(--text-secondary);
  font-size: 1rem;
  margin: 0.75rem 0 0;
}
</style>
