<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import { TEACHER_COURSES } from '@/lib/teacherCourses'
import { getPaddle, paddleConfig } from '@/lib/paddle'

const router = useRouter()
const supabase = inject('supabase', ref(null)) as any

const displayName = ref('')
const bio = ref('')
const className = ref('My class')
const courseCode = ref(TEACHER_COURSES[0].code)

const isCheckingExisting = ref(true)
const isSubmitting = ref(false)
const errorMessage = ref('')
const hasActivePremium = ref(false)
const submitStatus = ref<'idle' | 'opening_checkout' | 'awaiting_payment' | 'creating_profile'>('idle')

// Locked pricing — single Paddle Price ID drives everything.
const TEACHER_MONTHLY_PRICE = 15
const STUDENT_MONTHLY_PRICE = 10
const TEACHER_COMMISSION_PER_STUDENT = 5

const earningsLadder = computed(() => [
  { students: 10, monthly: 10 * TEACHER_COMMISSION_PER_STUDENT },
  { students: 100, monthly: 100 * TEACHER_COMMISSION_PER_STUDENT },
  { students: 200, monthly: 200 * TEACHER_COMMISSION_PER_STUDENT },
])

async function getAuthToken(): Promise<string | null> {
  if (!supabase.value) return null
  const { data: { session } } = await supabase.value.auth.getSession()
  return session?.access_token ?? null
}

async function checkInitialState() {
  const token = await getAuthToken()
  if (!token) {
    isCheckingExisting.value = false
    return
  }
  try {
    // Already a teacher? Bounce to dashboard.
    const teacherRes = await fetch('/api/teacher/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (teacherRes.ok) {
      router.replace('/teach')
      return
    }

    // Premium status drives whether checkout is needed on submit.
    const subRes = await fetch('/api/me/subscription', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (subRes.ok) {
      const data = await subRes.json()
      hasActivePremium.value = data.subscription?.status === 'active'
    }
  } catch {
    // fall through to form
  }
  isCheckingExisting.value = false
}

onMounted(checkInitialState)

async function pollUntilPremium(timeoutMs = 60000): Promise<boolean> {
  const start = Date.now()
  const token = await getAuthToken()
  if (!token) return false
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('/api/me/subscription', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.subscription?.status === 'active') {
          hasActivePremium.value = true
          return true
        }
      }
    } catch {
      // keep polling
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return false
}

async function createTeacherProfile(): Promise<boolean> {
  submitStatus.value = 'creating_profile'
  const token = await getAuthToken()
  if (!token) {
    errorMessage.value = 'Not signed in'
    return false
  }
  const res = await fetch('/api/teacher/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      display_name: displayName.value.trim(),
      bio: bio.value.trim() || null,
      class_name: className.value.trim(),
      course_code: courseCode.value,
      teaching_languages: ['en'],
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    errorMessage.value = data.error || 'Could not create teacher profile'
    return false
  }
  return true
}

async function openPremiumCheckout(): Promise<void> {
  const priceId = paddleConfig.teacherMonthlyPriceId
  if (!priceId) {
    errorMessage.value = 'Premium price not configured'
    return
  }
  const { data: { session } } = await supabase.value.auth.getSession()
  const email = session?.user?.email
  const userId = session?.user?.id
  if (!email || !userId) {
    errorMessage.value = 'Sign in again to start checkout'
    return
  }
  const paddle = await getPaddle()
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customer: { email },
    customData: {
      kind: 'premium',
      supabase_user_id: userId,
      // teacher_id intentionally absent — teacher row is created after the
      // sub goes active, then /api/teacher/signup links it.
    },
    settings: {
      successUrl: `${window.location.origin}/teach/setup?just_subscribed=1`,
    },
  })
}

async function handleSubmit() {
  if (!displayName.value.trim() || !className.value.trim() || !courseCode.value || isSubmitting.value) return
  isSubmitting.value = true
  errorMessage.value = ''

  try {
    // Already premium? Skip Paddle entirely — signup endpoint links the
    // existing subscription via teachers.own_subscription_id.
    if (hasActivePremium.value) {
      const ok = await createTeacherProfile()
      if (ok) router.replace('/teach')
      return
    }

    // Not premium yet: open checkout, wait for the webhook to land the sub,
    // then create the teacher profile.
    submitStatus.value = 'opening_checkout'
    await openPremiumCheckout()
    if (errorMessage.value) return

    submitStatus.value = 'awaiting_payment'
    const becamePremium = await pollUntilPremium()
    if (!becamePremium) {
      errorMessage.value = 'Subscription confirmation timed out. If you completed payment, refresh this page.'
      return
    }

    const ok = await createTeacherProfile()
    if (ok) router.replace('/teach')
  } catch (err: any) {
    errorMessage.value = err.message || 'Something went wrong'
  } finally {
    isSubmitting.value = false
    submitStatus.value = 'idle'
  }
}

const submitButtonLabel = computed(() => {
  switch (submitStatus.value) {
    case 'opening_checkout':
      return 'Opening checkout…'
    case 'awaiting_payment':
      return 'Waiting for payment confirmation…'
    case 'creating_profile':
      return 'Creating your teacher profile…'
    default:
      return hasActivePremium.value
        ? 'Create my teacher profile'
        : 'Continue to payment'
  }
})

</script>

<template>
  <div v-if="isCheckingExisting" class="setup-loading">
    <div class="loading-spinner"></div>
  </div>

  <div v-else class="setup">
    <header class="page-header">
      <div class="title-block">
        <span class="frost-eyebrow">Teacher signup</span>
        <h1 class="frost-display">Run classes. Earn from your students.</h1>
        <p class="lede">
          You pay <strong>£{{ TEACHER_MONTHLY_PRICE }}/month</strong> for the teacher plan
          (up to 10 active classes included). Your students each pay
          <strong>£{{ STUDENT_MONTHLY_PRICE }}/month</strong> — that's £5 less than the
          regular SSi price — and you earn
          <strong>£{{ TEACHER_COMMISSION_PER_STUDENT }}/student/month</strong>.
        </p>
        <p class="guardrail">
          Becoming a teacher means you'll be running classes for others — not just
          a discounted way to use SSi for yourself.
        </p>
      </div>
    </header>

    <FrostCard variant="panel" class="ladder-card">
      <span class="frost-section-title">What this can earn</span>
      <div class="ladder">
        <div v-for="rung in earningsLadder" :key="rung.students" class="ladder-rung">
          <span class="ladder-students frost-mono-nums">{{ rung.students }}</span>
          <span class="ladder-students-label">paying students</span>
          <span class="ladder-arrow">=</span>
          <span class="ladder-amount frost-mono-nums">£{{ rung.monthly.toLocaleString() }}</span>
          <span class="ladder-period">/ month</span>
        </div>
      </div>
      <p class="ladder-foot">
        Your commission is paid out to a Wise account at the end of each month
        (minimum £100 to request a payout).
      </p>
    </FrostCard>

    <FrostCard variant="panel" class="form-card">
      <form class="setup-form" @submit.prevent="handleSubmit">
        <div class="field">
          <label for="display-name">Display name</label>
          <input
            id="display-name"
            v-model="displayName"
            type="text"
            placeholder="e.g. Maria R."
            autocomplete="name"
            required
            autofocus
          />
          <p class="field-hint">This is how students will see you. Real name, nickname, or both.</p>
        </div>

        <div class="field">
          <label for="bio">Short bio <span class="optional">(optional)</span></label>
          <textarea
            id="bio"
            v-model="bio"
            rows="3"
            placeholder="A line or two about who you are and how you teach."
          />
        </div>

        <div class="field">
          <label for="class-name">First class name</label>
          <input
            id="class-name"
            v-model="className"
            type="text"
            placeholder="e.g. Monday Intermediates"
            required
          />
          <p class="field-hint">You'll get a unique link for each class to share with students.</p>
        </div>

        <div class="field">
          <label for="course">Course</label>
          <select id="course" v-model="courseCode" required>
            <option v-for="c in TEACHER_COURSES" :key="c.code" :value="c.code">
              {{ c.label }}
            </option>
          </select>
          <p class="field-hint">What your students will learn. You can add more classes in other courses later (up to 10 total).</p>
        </div>

        <div v-if="errorMessage" class="error">{{ errorMessage }}</div>

        <Button
          type="submit"
          variant="primary"
          size="lg"
          :loading="isSubmitting"
          :disabled="!displayName.trim() || !className.trim() || !courseCode || isSubmitting"
        >
          {{ submitButtonLabel }}
        </Button>
        <p v-if="!hasActivePremium" class="premium-note">
          You'll be charged £{{ TEACHER_MONTHLY_PRICE }}/month after a 7-day free trial. This is the same SSi Premium plan that gives access to all paid courses.
        </p>
      </form>
    </FrostCard>
  </div>
</template>

<style scoped>
.setup {
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
}

.setup-loading {
  display: flex;
  justify-content: center;
  padding: var(--space-20) 0;
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(var(--tone-red), 0.12);
  border-top-color: var(--ssi-red);
  border-radius: var(--radius-full);
  animation: spin 0.8s linear infinite;
}

/* Page header */
.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.title-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.title-block .frost-display {
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

.lede strong {
  color: var(--ink-primary);
}

.guardrail {
  color: var(--ink-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
  margin: 0;
  font-style: italic;
}

/* Earnings ladder */
.ladder-card {
  padding: var(--space-6) var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.ladder {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.ladder-rung {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
}

.ladder-rung:last-child {
  border-bottom: none;
}

.ladder-students {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--ink-primary);
  min-width: 64px;
}

.ladder-students-label {
  color: var(--ink-muted);
  font-size: var(--text-sm);
  flex: 1;
}

.ladder-arrow {
  color: var(--ink-faint);
  font-weight: var(--font-bold);
}

.ladder-amount {
  font-size: var(--text-2xl);
  font-weight: var(--font-bold);
  color: var(--ssi-gold);
}

.ladder-period {
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.ladder-foot {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

/* Form card */
.form-card {
  padding: var(--space-8);
}

.setup-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.optional {
  color: var(--ink-faint);
  font-weight: var(--font-normal);
  text-transform: none;
  letter-spacing: 0;
}

.field input[type='text'],
.field textarea,
.field select {
  padding: var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  color: var(--ink-primary);
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
  resize: vertical;
}

.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.12);
}

.field-hint {
  margin: var(--space-1) 0 0;
  font-size: var(--text-xs);
  color: var(--ink-muted);
  line-height: 1.5;
}

.error {
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.22);
  border-radius: var(--radius-lg);
  color: var(--ssi-red);
  font-size: var(--text-sm);
}

.premium-note {
  margin: var(--space-2) 0 0;
  color: var(--ink-muted);
  font-size: var(--text-xs);
  line-height: 1.5;
  text-align: center;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .ladder-card,
  .form-card {
    padding: var(--space-6);
  }

  .ladder-rung {
    flex-wrap: wrap;
  }

  .ladder-students-label {
    flex-basis: 100%;
    margin-left: calc(64px + var(--space-3));
  }
}
</style>
