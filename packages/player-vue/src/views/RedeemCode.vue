<script setup lang="ts">
import { ref, computed, onMounted, inject } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInviteCode } from '../composables/useInviteCode'
import { useSharedUserEntitlements } from '../composables/useUserEntitlements'

const route = useRoute()
const router = useRouter()
const auth = inject<any>('auth', null)
const { validateCode, redeemCode, pendingCode, clearPendingCode } = useInviteCode()
const { refresh: refreshEntitlements } = useSharedUserEntitlements()

const isLoading = ref(true)
const isRedeeming = ref(false)
const error = ref('')
const redeemSuccess = ref(false)
const redeemLabel = ref('')

const isSignedIn = computed(() => auth?.isAuthenticated?.value ?? false)

const code = computed(() => (route.params.code as string) || '')

// Display info from validation
const displayTitle = computed(() => {
  if (!pendingCode.value) return ''
  if (pendingCode.value.codeKind === 'entitlement') {
    return pendingCode.value.label || 'Access Code'
  }
  const map: Record<string, string> = {
    ssi_admin: 'SSi Admin Invite',
    govt_admin: 'Regional Admin Invite',
    school_admin: 'School Admin Invite',
    teacher: 'Teacher Invite',
    student: 'Student Invite',
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
  if (ctx.regionName) return ctx.regionName
  if (ctx.className) return ctx.className
  return ''
})

onMounted(async () => {
  if (!code.value) {
    error.value = 'No code provided'
    isLoading.value = false
    return
  }
  const valid = await validateCode(code.value)
  if (!valid) {
    error.value = 'This code is invalid or has expired'
  }
  isLoading.value = false
})

async function handleRedeem() {
  isRedeeming.value = true
  error.value = ''
  try {
    const token = await auth?.getToken?.()
    if (!token) {
      error.value = 'Please sign in first'
      return
    }
    const result = await redeemCode(token)
    if (result.success) {
      redeemSuccess.value = true
      redeemLabel.value = result.label || displayTitle.value
      if (result.codeKind === 'entitlement') {
        refreshEntitlements()
      }
      // Redirect after short delay
      setTimeout(() => {
        router.push(result.redirectTo || '/')
      }, 2000)
    } else {
      error.value = result.error || 'Failed to redeem code'
    }
  } catch {
    error.value = 'Something went wrong'
  } finally {
    isRedeeming.value = false
  }
}

function goHome() {
  clearPendingCode()
  router.push('/')
}

function goSignIn() {
  // Navigate home WITHOUT clearing pending code — sessionStorage
  // preserves it through the OTP flow, and SignInModal auto-redeems after auth.
  router.push('/')
}
</script>

<template>
  <div class="redeem-page">
    <div class="redeem-card">
      <!-- Loading -->
      <div v-if="isLoading" class="redeem-loading">
        <div class="spinner"></div>
        <p>Checking code...</p>
      </div>

      <!-- Error -->
      <div v-else-if="error && !pendingCode" class="redeem-error">
        <h2>Invalid Code</h2>
        <p>{{ error }}</p>
        <button class="redeem-btn" @click="goHome">Go to App</button>
      </div>

      <!-- Success -->
      <div v-else-if="redeemSuccess" class="redeem-success">
        <h2>Code Redeemed!</h2>
        <p>{{ redeemLabel }}</p>
        <p class="redeem-redirect">Redirecting...</p>
      </div>

      <!-- Valid code, show details -->
      <div v-else-if="pendingCode" class="redeem-details">
        <h2>{{ displayTitle }}</h2>
        <p v-if="displayDetail" class="redeem-detail-text">{{ displayDetail }}</p>
        <p v-if="error" class="redeem-error-text">{{ error }}</p>

        <div v-if="isSignedIn" class="redeem-actions">
          <button
            class="redeem-btn redeem-btn--primary"
            :disabled="isRedeeming"
            @click="handleRedeem"
          >
            {{ isRedeeming ? 'Redeeming...' : 'Redeem' }}
          </button>
          <button class="redeem-btn" @click="goHome">Cancel</button>
        </div>

        <div v-else class="redeem-auth-prompt">
          <p>Sign in or create an account to redeem this code.</p>
          <button class="redeem-btn redeem-btn--primary" @click="goSignIn">Sign In</button>
        </div>
      </div>
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
}

.redeem-card {
  background: var(--bg-card, #141420);
  border-radius: 12px;
  padding: 2rem;
  max-width: 400px;
  width: 100%;
  text-align: center;
  color: var(--text-primary, #e0e0e0);
}

.redeem-card h2 {
  margin: 0 0 0.5rem;
  font-size: 1.25rem;
  color: var(--text-primary, #fff);
}

.redeem-detail-text {
  color: var(--text-secondary, #aaa);
  margin: 0 0 1.5rem;
}

.redeem-loading {
  padding: 2rem 0;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--text-secondary, #555);
  border-top-color: var(--accent, #4fc3f7);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.redeem-error-text {
  color: #ef5350;
  font-size: 0.875rem;
  margin: 0.5rem 0 1rem;
}

.redeem-redirect {
  color: var(--text-secondary, #aaa);
  font-size: 0.875rem;
}

.redeem-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.redeem-auth-prompt {
  margin-top: 1.5rem;
}

.redeem-auth-prompt p {
  color: var(--text-secondary, #aaa);
  margin-bottom: 1rem;
}

.redeem-btn {
  background: var(--bg-card-hover, #1e1e2e);
  color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 0.75rem 1.5rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: background 0.2s;
}

.redeem-btn:hover {
  background: var(--bg-hover, #2a2a3e);
}

.redeem-btn--primary {
  background: var(--accent, #4fc3f7);
  color: #000;
  border-color: var(--accent, #4fc3f7);
}

.redeem-btn--primary:hover {
  opacity: 0.9;
}

.redeem-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.redeem-success h2 {
  color: #66bb6a;
}
</style>
