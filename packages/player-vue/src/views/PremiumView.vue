<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
import { SignInModal } from '@/components/auth'
import { useAuthModal } from '@/composables/useAuthModal'
import { getPaddle, paddleConfig } from '@/lib/paddle'
import '@/styles/schools-tokens.css'

const route = useRoute()
const supabase = inject('supabase', ref(null)) as any
const auth = inject<any>('auth', null)

const isAuthenticated = computed(() => auth?.isAuthenticated?.value ?? false)
const isAuthLoading = computed(() => auth?.isLoading?.value ?? false)

const { open: openAuth, close: closeAuth } = useAuthModal()
const handleAuthSuccess = () => closeAuth()

interface Subscription {
  id: string
  status: string
  plan_name: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  provider: string
}

const subscription = ref<Subscription | null>(null)
const isLoadingSub = ref(true)
const isOpeningCheckout = ref(false)
const isPolling = ref(false)
const checkoutError = ref('')

const PREMIUM_PRICE = 15

async function getAuthToken(): Promise<string | null> {
  if (!supabase.value) return null
  const { data: { session } } = await supabase.value.auth.getSession()
  return session?.access_token ?? null
}

async function fetchSubscription() {
  const token = await getAuthToken()
  if (!token) {
    isLoadingSub.value = false
    return
  }
  try {
    const res = await fetch('/api/me/subscription', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      subscription.value = data.subscription
    }
  } catch {
    // ignore — render upgrade CTA
  } finally {
    isLoadingSub.value = false
  }
}

async function pollUntilActive(timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  isPolling.value = true
  while (Date.now() - start < timeoutMs) {
    await fetchSubscription()
    if (subscription.value?.status === 'active') {
      isPolling.value = false
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  isPolling.value = false
}

async function startCheckout() {
  if (isOpeningCheckout.value) return
  const priceId = paddleConfig.teacherMonthlyPriceId // single Premium product
  if (!priceId) {
    checkoutError.value = 'Premium price not configured'
    return
  }
  isOpeningCheckout.value = true
  checkoutError.value = ''
  try {
    const { data: { session } } = await supabase.value.auth.getSession()
    const email = session?.user?.email
    const userId = session?.user?.id
    if (!email || !userId) {
      checkoutError.value = 'Sign in again to start checkout'
      return
    }
    const paddle = await getPaddle()
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: { email },
      customData: {
        kind: 'premium',
        supabase_user_id: userId,
      },
      settings: {
        successUrl: `${window.location.origin}/premium?just_subscribed=1`,
      },
    })
  } catch (err: any) {
    checkoutError.value = err?.message || 'Failed to open checkout'
  } finally {
    isOpeningCheckout.value = false
  }
}

const formattedPeriodEnd = computed(() => {
  if (!subscription.value?.current_period_end) return null
  return new Date(subscription.value.current_period_end).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
})

onMounted(async () => {
  if (isAuthenticated.value) {
    await fetchSubscription()
    if (route.query.just_subscribed && subscription.value?.status !== 'active') {
      await pollUntilActive()
    }
  } else {
    isLoadingSub.value = false
  }
})
</script>

<template>
  <div class="premium-page schools-surface">
    <AtmosphereBackdrop />

    <main class="content">
      <header class="page-header">
        <span class="frost-eyebrow">SSi Premium</span>
        <h1 class="frost-display">All courses. All features. £{{ PREMIUM_PRICE }}/month.</h1>
        <p class="lede">
          7 days free, then £{{ PREMIUM_PRICE }}/month. Cancel anytime.
        </p>
      </header>

      <FrostCard variant="panel" class="state-card">
        <!-- Auth still resolving -->
        <div v-if="isAuthLoading" class="centered">
          <div class="loading-spinner"></div>
        </div>

        <!-- Not signed in -->
        <div v-else-if="!isAuthenticated" class="cta">
          <p>Sign in to upgrade. We use a one-time code by email — no password.</p>
          <Button variant="primary" size="lg" @click="() => openAuth()">Sign in</Button>
        </div>

        <!-- Loading sub -->
        <div v-else-if="isLoadingSub" class="centered">
          <div class="loading-spinner"></div>
        </div>

        <!-- Post-checkout polling -->
        <div v-else-if="isPolling" class="centered">
          <div class="loading-spinner"></div>
          <p class="muted">Setting up your subscription…</p>
        </div>

        <!-- Already on Premium -->
        <div v-else-if="subscription?.status === 'active'" class="active-state">
          <span class="active-badge">You're on Premium</span>
          <p v-if="formattedPeriodEnd">
            Next billing: <strong>{{ formattedPeriodEnd }}</strong>
          </p>
          <p v-if="subscription.cancel_at_period_end" class="muted">
            Your subscription is set to cancel at the end of the current period.
          </p>
          <p class="muted small">
            Manage payment and cancellation from your Paddle receipt email.
          </p>
        </div>

        <!-- Upgrade CTA -->
        <div v-else class="cta">
          <ul class="benefit-list">
            <li>All paid SSi courses, every language pair</li>
            <li>Run your own classes as a teacher (optional, no extra charge)</li>
            <li>Offline-capable, sync across devices</li>
          </ul>
          <div v-if="checkoutError" class="error">{{ checkoutError }}</div>
          <Button
            variant="primary"
            size="lg"
            :loading="isOpeningCheckout"
            :disabled="isOpeningCheckout"
            @click="startCheckout"
          >
            Start 7-day free trial
          </Button>
        </div>
      </FrostCard>
    </main>

    <SignInModal @success="handleAuthSuccess" />
  </div>
</template>

<style scoped>
.premium-page {
  min-height: 100vh;
  position: relative;
  background: var(--bg-primary);
  color: var(--ink-primary);
  font-family: var(--font-body);
}

.content {
  position: relative;
  z-index: 10;
  max-width: 640px;
  margin: 0 auto;
  padding: var(--space-12) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  text-align: center;
}

.page-header .frost-display {
  font-size: var(--text-3xl);
  line-height: 1.15;
  margin: 0;
}

.lede {
  color: var(--ink-secondary);
  font-size: var(--text-base);
  line-height: 1.5;
  margin: 0;
}

.state-card {
  padding: var(--space-8);
}

.centered {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-8) 0;
}

.cta {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.cta p {
  margin: 0;
  color: var(--ink-secondary);
  line-height: 1.5;
}

.benefit-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.benefit-list li {
  position: relative;
  padding-left: var(--space-6);
  color: var(--ink-secondary);
  line-height: 1.5;
}

.benefit-list li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.55em;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ssi-gold);
}

.active-state {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-items: flex-start;
}

.active-badge {
  display: inline-flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  background: rgba(46, 160, 67, 0.1);
  border: 1px solid rgba(46, 160, 67, 0.3);
  border-radius: var(--radius-full);
  color: rgb(46, 120, 67);
  font-weight: var(--font-semibold);
  font-size: var(--text-sm);
}

.muted {
  color: var(--ink-muted);
}

.muted.small {
  font-size: var(--text-xs);
}

.error {
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.22);
  border-radius: var(--radius-lg);
  color: var(--ssi-red);
  font-size: var(--text-sm);
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(var(--tone-red), 0.12);
  border-top-color: var(--ssi-red);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .content {
    padding: var(--space-8) var(--space-4);
  }

  .state-card {
    padding: var(--space-6);
  }
}
</style>
