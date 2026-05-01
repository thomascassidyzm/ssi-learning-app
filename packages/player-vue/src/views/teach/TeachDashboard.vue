<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import { getPaddle, paddleConfig } from '@/lib/paddle'
import { TEACHER_COURSES, labelForCourse } from '@/lib/teacherCourses'

const router = useRouter()
const supabase = inject('supabase', ref(null)) as any

interface Teacher {
  id: string
  display_name: string
  bio: string | null
  referral_active: boolean
  own_subscription_id: string | null
}

interface TeacherClass {
  id: string
  class_name: string
  course_code: string
  student_join_code: string
  current_seed: number
  is_active: boolean
  created_at: string
}

interface Subscription {
  id: string
  status: string
  planId: string | null
  planName: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  provider: string
}

interface RosterStudent {
  student_user_id: string
  student_name: string
  seeds_completed: number
  legos_mastered: number
  total_practice_seconds: number
  last_active_at: string | null
}

interface PayoutRecipient {
  recipient_id: string
}

const teacher = ref<Teacher | null>(null)
const classes = ref<TeacherClass[]>([])
const subscription = ref<Subscription | null>(null)
const isLoading = ref(true)
const errorMessage = ref('')

// Per-class roster (keyed by class id)
const rosterByClass = ref<Record<string, RosterStudent[]>>({})

// Earnings (placeholder shape — wired to backend in parallel work)
const accruedPence = ref(0)
const payoutRecipient = ref<PayoutRecipient | null>(null)
const isRequestingPayout = ref(false)
const payoutError = ref('')

const isStartingTrial = ref(false)
const isOpeningPortal = ref(false)
const checkoutError = ref('')

const copiedClassId = ref<string | null>(null)

// Inline "create class" panel state (2-field form per §5.4)
const isAddingClass = ref(false)
const newClassName = ref('')
const newClassCourse = ref(TEACHER_COURSES[0].code)
const isCreatingClass = ref(false)
const createClassError = ref('')

const origin = typeof window !== 'undefined' ? window.location.origin : ''

// Locked pricing constants
const TEACHER_MONTHLY_PRICE = 15
const STUDENT_MONTHLY_PRICE = 10
const COMMISSION_PER_STUDENT = 5
const MAX_CLASSES = 10
const MAX_STUDENTS_PER_CLASS = 20
const PAYOUT_THRESHOLD_PENCE = 10000 // £100

const hasSubscription = computed(
  () => !!subscription.value && subscription.value.status !== 'none'
)
const subscriptionStatus = computed(() => subscription.value?.status || 'none')

const nextChargeDate = computed(() => {
  if (!subscription.value?.currentPeriodEnd) return ''
  const d = new Date(subscription.value.currentPeriodEnd)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
})

const totalStudents = computed(() =>
  classes.value.reduce((sum, c) => sum + (rosterByClass.value[c.id]?.length || 0), 0)
)

const monthlyEarningsEstimate = computed(() => totalStudents.value * COMMISSION_PER_STUDENT)

const accruedPounds = computed(() => (accruedPence.value / 100).toFixed(2))
const payoutThresholdPounds = computed(() => (PAYOUT_THRESHOLD_PENCE / 100).toFixed(0))
const payoutProgress = computed(() =>
  Math.min(100, Math.round((accruedPence.value / PAYOUT_THRESHOLD_PENCE) * 100))
)
const canRequestPayout = computed(() => accruedPence.value >= PAYOUT_THRESHOLD_PENCE)

const atClassCap = computed(() => classes.value.length >= MAX_CLASSES)

function shareUrlFor(cls: TeacherClass): string {
  return `${origin}/with/${cls.student_join_code}`
}

function formatLastActive(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const date = new Date(dateStr)
  const diffDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
  return `${Math.floor(diffDays / 30)} months ago`
}

async function getAuthToken(): Promise<string | null> {
  if (!supabase.value) return null
  const { data: { session } } = await supabase.value.auth.getSession()
  return session?.access_token ?? null
}

async function loadTeacher(token: string): Promise<boolean> {
  const res = await fetch('/api/teacher/me', {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (res.status === 404) {
    router.replace('/teach/setup')
    return false
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    errorMessage.value = data.error || `Error ${res.status}`
    return false
  }

  const data = await res.json()
  teacher.value = data.teacher
  classes.value = data.classes || []
  return true
}

async function loadSubscription(token: string): Promise<void> {
  try {
    const res = await fetch('/api/subscription', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      subscription.value = data.subscription
    }
  } catch {
    // Non-fatal
  }
}

async function loadRosters(): Promise<void> {
  if (!supabase.value || classes.value.length === 0) return
  const classIds = classes.value.map((c) => c.id)

  try {
    const { data, error } = await supabase.value
      .from('class_student_progress')
      .select('class_id, student_user_id, student_name, seeds_completed, legos_mastered, total_practice_seconds, last_active_at')
      .in('class_id', classIds)
      .order('student_name')

    if (error) {
      console.warn('[TeachDashboard] roster query failed:', error.message)
      return
    }

    const grouped: Record<string, RosterStudent[]> = {}
    for (const row of data || []) {
      const list = grouped[row.class_id] || (grouped[row.class_id] = [])
      list.push({
        student_user_id: row.student_user_id,
        student_name: row.student_name,
        seeds_completed: row.seeds_completed,
        legos_mastered: row.legos_mastered,
        total_practice_seconds: row.total_practice_seconds || 0,
        last_active_at: row.last_active_at,
      })
    }
    rosterByClass.value = grouped
  } catch (err) {
    console.warn('[TeachDashboard] roster fetch error:', err)
  }
}

async function loadPayoutRecipient(token: string): Promise<void> {
  try {
    const res = await fetch('/api/teacher/payout-recipient', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      payoutRecipient.value = data
    } else if (res.status === 404) {
      payoutRecipient.value = null
    }
  } catch {
    // Non-fatal — payout button will fall back to setup flow
  }
}

async function loadAll() {
  const token = await getAuthToken()
  if (!token) {
    errorMessage.value = 'Not signed in'
    isLoading.value = false
    return
  }

  try {
    const ok = await loadTeacher(token)
    if (ok) {
      await Promise.all([
        loadSubscription(token),
        loadRosters(),
        loadPayoutRecipient(token),
      ])
    }
  } catch (err: any) {
    errorMessage.value = err.message || 'Failed to load'
  } finally {
    isLoading.value = false
  }
}

onMounted(loadAll)

async function startTrial() {
  if (!teacher.value || isStartingTrial.value) return
  const priceId = paddleConfig.teacherMonthlyPriceId
  if (!priceId) {
    checkoutError.value = 'Teacher plan price not configured'
    return
  }

  isStartingTrial.value = true
  checkoutError.value = ''
  try {
    const { data: { session } } = await supabase.value.auth.getSession()
    const email = session?.user?.email
    if (!email) {
      checkoutError.value = 'Sign in again to start checkout'
      return
    }
    const paddle = await getPaddle()
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: { email },
      customData: {
        teacher_id: teacher.value.id,
        kind: 'teacher_plan',
      },
      settings: {
        successUrl: window.location.href,
      },
    })
  } catch (err: any) {
    checkoutError.value = err?.message || 'Failed to open checkout'
  } finally {
    isStartingTrial.value = false
  }
}

async function openPortal() {
  if (isOpeningPortal.value) return
  isOpeningPortal.value = true
  try {
    const token = await getAuthToken()
    if (!token) return
    const res = await fetch('/api/teacher/portal', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      if (data.portalUrl) window.location.href = data.portalUrl
    }
  } finally {
    isOpeningPortal.value = false
  }
}

async function copyShareLink(cls: TeacherClass) {
  try {
    await navigator.clipboard.writeText(shareUrlFor(cls))
    copiedClassId.value = cls.id
    setTimeout(() => {
      if (copiedClassId.value === cls.id) copiedClassId.value = null
    }, 2000)
  } catch {
    // fallback: user can select the input manually
  }
}

function openAddClass() {
  if (atClassCap.value) {
    createClassError.value = `You've reached the ${MAX_CLASSES}-class maximum. Archive a class to add another.`
    return
  }
  newClassName.value = ''
  newClassCourse.value = TEACHER_COURSES[0].code
  createClassError.value = ''
  isAddingClass.value = true
}

function closeAddClass() {
  isAddingClass.value = false
}

async function submitAddClass() {
  if (!newClassName.value.trim() || !newClassCourse.value || isCreatingClass.value) return
  isCreatingClass.value = true
  createClassError.value = ''
  try {
    const token = await getAuthToken()
    if (!token) {
      createClassError.value = 'Not signed in'
      return
    }
    const res = await fetch('/api/teacher/classes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        class_name: newClassName.value.trim(),
        course_code: newClassCourse.value,
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      createClassError.value = data.error || 'Failed to create class'
      return
    }
    classes.value = [...classes.value, data.class]
    closeAddClass()
  } catch (err: any) {
    createClassError.value = err?.message || 'Something went wrong'
  } finally {
    isCreatingClass.value = false
  }
}

async function requestPayout() {
  if (isRequestingPayout.value) return
  isRequestingPayout.value = true
  payoutError.value = ''
  try {
    const token = await getAuthToken()
    if (!token) return

    // Two paths:
    // 1. No Wise recipient yet → call POST /payout-recipient to start setup
    // 2. Recipient exists → payout will be picked up by next cron run; show confirmation
    if (!payoutRecipient.value) {
      const res = await fetch('/api/teacher/payout-recipient', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json()
      if (!res.ok) {
        payoutError.value = data.error || 'Failed to start payout setup'
        return
      }
      payoutRecipient.value = data
    }
    // Once recipient is set up, the payouts cron handles disbursement.
  } catch (err: any) {
    payoutError.value = err?.message || 'Something went wrong'
  } finally {
    isRequestingPayout.value = false
  }
}
</script>

<template>
  <div v-if="isLoading" class="dashboard-loading">
    <div class="loading-spinner"></div>
  </div>

  <FrostCard v-else-if="errorMessage" variant="panel" class="dashboard-error">
    <p>{{ errorMessage }}</p>
  </FrostCard>

  <div v-else-if="teacher" class="dashboard">
    <!-- Page header -->
    <header class="page-header">
      <div class="title-block">
        <h1 class="frost-display">Welcome, {{ teacher.display_name }}.</h1>
        <div class="metrics">
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ classes.length }}</span>
            of {{ MAX_CLASSES }} classes used
          </span>
          <span class="metric">
            <span class="metric-value frost-mono-nums">{{ totalStudents }}</span>
            paying students
          </span>
        </div>
      </div>
      <div class="header-actions">
        <Button
          variant="primary"
          :disabled="atClassCap"
          @click="openAddClass"
        >
          + New class
        </Button>
      </div>
    </header>

    <!-- At-cap notice -->
    <FrostCard v-if="atClassCap" variant="panel" class="cap-notice">
      You've reached the {{ MAX_CLASSES }}-class maximum included in your teacher
      plan. Archive a class to add another.
    </FrostCard>

    <!-- Stones row: classes used / students / monthly estimate / accrued -->
    <div class="stone-row">
      <FrostCard variant="stone" tone="blue">
        <span class="stone-label">Classes</span>
        <span class="stone-value frost-mono-nums">{{ classes.length }}<span class="stone-suffix">/ {{ MAX_CLASSES }}</span></span>
      </FrostCard>
      <FrostCard variant="stone" tone="green">
        <span class="stone-label">Paying students</span>
        <span class="stone-value frost-mono-nums">{{ totalStudents }}</span>
      </FrostCard>
      <FrostCard variant="stone" tone="gold">
        <span class="stone-label">Earning rate</span>
        <span class="stone-value frost-mono-nums">£{{ monthlyEarningsEstimate }}<span class="stone-suffix">/ mo</span></span>
      </FrostCard>
      <FrostCard variant="stone" tone="gold">
        <span class="stone-label">Accrued this month</span>
        <span class="stone-value frost-mono-nums">£{{ accruedPounds }}</span>
      </FrostCard>
    </div>

    <!-- Subscription / billing -->
    <FrostCard variant="panel" class="section-panel">
      <div class="section-head">
        <span class="frost-section-title">Teacher plan</span>
        <p v-if="!hasSubscription" class="section-sub">
          Start your 7-day free trial. Card not charged until day 8. Cancel anytime.
        </p>
        <p v-else class="section-sub">
          £{{ TEACHER_MONTHLY_PRICE }}/month — up to {{ MAX_CLASSES }} classes,
          unlimited students per class up to {{ MAX_STUDENTS_PER_CLASS }} each.
        </p>
      </div>

      <div v-if="checkoutError" class="error">{{ checkoutError }}</div>

      <div v-if="!hasSubscription" class="subscription-cta">
        <div class="price-block">
          <span class="price-amount frost-mono-nums">£{{ TEACHER_MONTHLY_PRICE }}</span>
          <span class="price-period">/ month</span>
        </div>
        <p class="sub-blurb">
          Two paying students at £{{ STUDENT_MONTHLY_PRICE }} cover your
          subscription. Every student after that is profit.
        </p>
        <Button variant="primary" :loading="isStartingTrial" @click="startTrial">
          Start 7-day free trial
        </Button>
      </div>

      <div v-else-if="subscriptionStatus === 'active'" class="sub-status-row">
        <div>
          <p class="sub-status-label">Active</p>
          <p v-if="nextChargeDate" class="sub-status-sub">
            Next charge: <strong>{{ nextChargeDate }}</strong>
          </p>
        </div>
        <Button variant="ghost" :loading="isOpeningPortal" @click="openPortal">
          Manage subscription
        </Button>
      </div>

      <div v-else-if="subscriptionStatus === 'past_due'" class="sub-status-row past-due">
        <div>
          <p class="sub-status-label">Payment failed</p>
          <p class="sub-status-sub">Your card was declined. Please update your payment method.</p>
        </div>
        <Button variant="primary" :loading="isOpeningPortal" @click="openPortal">
          Update payment method
        </Button>
      </div>

      <div v-else-if="subscriptionStatus === 'cancelled'" class="sub-status-row">
        <div>
          <p class="sub-status-label">Cancelled</p>
          <p v-if="nextChargeDate" class="sub-status-sub">
            Access continues until <strong>{{ nextChargeDate }}</strong>.
          </p>
        </div>
        <Button variant="ghost" :loading="isOpeningPortal" @click="openPortal">
          Manage subscription
        </Button>
      </div>
    </FrostCard>

    <!-- Inline create-class panel (§5.4: 2-field form = inline panel) -->
    <FrostCard v-if="isAddingClass" variant="panel" class="section-panel inline-form-panel">
      <div class="section-head">
        <span class="frost-section-title">New class</span>
        <p class="section-sub">Each class gets its own share link and roster.</p>
      </div>

      <form class="inline-form" @submit.prevent="submitAddClass">
        <div class="inline-fields">
          <div class="field">
            <label for="new-class-name">Class name</label>
            <input
              id="new-class-name"
              v-model="newClassName"
              type="text"
              placeholder="e.g. Tuesday Beginners"
              required
              autofocus
            />
          </div>
          <div class="field">
            <label for="new-class-course">Course</label>
            <select id="new-class-course" v-model="newClassCourse" required>
              <option v-for="c in TEACHER_COURSES" :key="c.code" :value="c.code">
                {{ c.label }}
              </option>
            </select>
          </div>
        </div>

        <div v-if="createClassError" class="error">{{ createClassError }}</div>

        <div class="inline-actions">
          <Button type="button" variant="ghost" @click="closeAddClass">Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            :loading="isCreatingClass"
            :disabled="!newClassName.trim() || !newClassCourse || isCreatingClass"
          >
            Create class
          </Button>
        </div>
      </form>
    </FrostCard>

    <!-- Per-class roster panels (the killer feature) -->
    <section v-if="classes.length > 0" class="rosters">
      <FrostCard
        v-for="cls in classes"
        :key="cls.id"
        variant="panel"
        class="section-panel class-panel"
      >
        <header class="class-head">
          <div class="class-meta">
            <h3 class="class-name frost-display">{{ cls.class_name }}</h3>
            <p class="class-course">{{ labelForCourse(cls.course_code) }}</p>
          </div>
          <div class="class-stats">
            <span class="class-stat">
              <span class="class-stat-value frost-mono-nums">
                {{ rosterByClass[cls.id]?.length || 0 }}
              </span>
              of {{ MAX_STUDENTS_PER_CLASS }} students
            </span>
          </div>
        </header>

        <div class="share-row">
          <input
            class="share-input"
            :value="shareUrlFor(cls)"
            readonly
            @focus="($event.target as HTMLInputElement).select()"
          />
          <Button
            variant="ghost"
            size="sm"
            @click="copyShareLink(cls)"
          >
            {{ copiedClassId === cls.id ? 'Copied' : 'Copy link' }}
          </Button>
        </div>

        <!-- Roster table -->
        <div v-if="rosterByClass[cls.id]?.length" class="roster-wrap">
          <table class="roster-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Seeds</th>
                <th>LEGOs mastered</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in rosterByClass[cls.id]" :key="s.student_user_id">
                <td class="cell-student">{{ s.student_name }}</td>
                <td class="frost-mono-nums">{{ s.seeds_completed }}</td>
                <td class="frost-mono-nums">{{ s.legos_mastered }}</td>
                <td class="cell-muted">{{ formatLastActive(s.last_active_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Empty roster (per-class) -->
        <div v-else class="empty">
          <div class="empty-ghost">students</div>
          <div class="empty-copy">
            <strong>No students yet</strong>
            <p>Share the link above to start filling this roster.</p>
          </div>
        </div>
      </FrostCard>
    </section>

    <!-- Empty state when no classes at all -->
    <FrostCard v-else variant="panel" class="section-panel">
      <div class="empty">
        <div class="empty-ghost">classes</div>
        <div class="empty-copy">
          <strong>No classes yet</strong>
          <p>
            Create your first class to get a share link. Every student who joins
            via that link earns you £{{ COMMISSION_PER_STUDENT }}/month.
          </p>
        </div>
        <Button variant="primary" @click="openAddClass">+ New class</Button>
      </div>
    </FrostCard>

    <!-- Earnings -->
    <FrostCard variant="panel" class="section-panel earnings-panel">
      <div class="section-head">
        <span class="frost-section-title">Earnings</span>
        <p class="section-sub">
          You earn £{{ COMMISSION_PER_STUDENT }}/student/month, paid in arrears via
          Wise once your accrued balance reaches £{{ payoutThresholdPounds }}.
        </p>
      </div>

      <div class="earnings-grid">
        <div class="earnings-block">
          <span class="earnings-label">Accrued this month</span>
          <span class="earnings-amount frost-mono-nums">£{{ accruedPounds }}</span>
        </div>
        <div class="earnings-block">
          <span class="earnings-label">Threshold to payout</span>
          <span class="earnings-amount frost-mono-nums">£{{ payoutThresholdPounds }}</span>
        </div>
      </div>

      <div class="threshold-bar" :aria-valuenow="payoutProgress" aria-valuemin="0" aria-valuemax="100" role="progressbar">
        <div class="threshold-fill" :style="{ width: `${payoutProgress}%` }"></div>
      </div>

      <div v-if="payoutError" class="error">{{ payoutError }}</div>

      <div class="payout-actions">
        <Button
          variant="primary"
          :disabled="!canRequestPayout || isRequestingPayout"
          :loading="isRequestingPayout"
          @click="requestPayout"
        >
          {{ payoutRecipient ? 'Request Wise payout' : 'Set up Wise payout' }}
        </Button>
        <p v-if="!canRequestPayout" class="payout-hint">
          Reach £{{ payoutThresholdPounds }} accrued to enable payouts.
        </p>
      </div>
    </FrostCard>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.dashboard-loading {
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

.dashboard-error {
  padding: var(--space-8);
  text-align: center;
  color: var(--ssi-red);
}

/* Page header (§5.1) */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--space-4);
  margin-bottom: var(--space-2);
}

.title-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.title-block .frost-display {
  font-size: var(--text-3xl);
  margin: 0;
  letter-spacing: -0.015em;
}

.metrics {
  display: flex;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.metric {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
}

.metric-value {
  color: var(--ssi-gold);
  font-weight: var(--font-bold);
}

.header-actions {
  display: flex;
  gap: var(--space-3);
}

.cap-notice {
  padding: var(--space-4) var(--space-6);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  background: rgba(var(--tone-gold), 0.08);
  border-color: rgba(var(--tone-gold), 0.22);
}

/* Stones row */
.stone-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}

.stone-row :deep(.frost-card-stone) {
  padding: var(--space-5) var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  justify-content: center;
}

.stone-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--ink-muted);
}

.stone-value {
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  color: var(--ink-primary);
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.stone-suffix {
  font-size: var(--text-sm);
  color: var(--ink-muted);
  font-weight: var(--font-normal);
}

/* Section panels */
.section-panel {
  padding: var(--space-6) var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.section-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.section-head .frost-section-title {
  font-size: var(--text-lg);
  margin: 0;
}

.section-sub {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

/* Subscription */
.subscription-cta {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  align-items: flex-start;
}

.price-block {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}

.price-amount {
  font-size: var(--text-4xl);
  font-weight: var(--font-bold);
  color: var(--ssi-red);
  line-height: 1;
}

.price-period {
  color: var(--ink-muted);
  font-size: var(--text-base);
}

.sub-blurb {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: 1.5;
  max-width: 520px;
}

.sub-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(44, 38, 34, 0.06);
  border-radius: var(--radius-lg);
}

.sub-status-row.past-due {
  background: rgba(var(--tone-red), 0.06);
  border-color: rgba(var(--tone-red), 0.22);
}

.sub-status-label {
  margin: 0 0 var(--space-1);
  font-size: var(--text-base);
  font-weight: var(--font-bold);
  color: var(--ink-primary);
}

.sub-status-row.past-due .sub-status-label {
  color: var(--ssi-red);
}

.sub-status-sub {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--ink-muted);
}

/* Inline form */
.inline-form-panel {
  border-color: rgba(var(--tone-red), 0.18);
}

.inline-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.inline-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

@media (max-width: 640px) {
  .inline-fields {
    grid-template-columns: 1fr;
  }
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

.field input[type='text'],
.field select {
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-family: var(--font-body);
  color: var(--ink-primary);
}

.field input:focus,
.field select:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.12);
}

.inline-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}

/* Class panels */
.rosters {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.class-panel {
  padding: var(--space-6) var(--space-8);
  gap: var(--space-5);
}

.class-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.class-meta {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.class-name {
  font-size: var(--text-2xl);
  margin: 0;
}

.class-course {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
}

.class-stats {
  display: flex;
  gap: var(--space-3);
}

.class-stat {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
}

.class-stat-value {
  color: var(--ssi-gold);
  font-weight: var(--font-bold);
}

.share-row {
  display: flex;
  gap: var(--space-2);
  align-items: stretch;
}

.share-input {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-lg);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--ink-primary);
}

.share-input:focus {
  outline: none;
  border-color: var(--ssi-red);
}

/* Roster table */
.roster-wrap {
  overflow-x: auto;
}

.roster-table {
  width: 100%;
  border-collapse: collapse;
}

.roster-table thead th {
  text-align: left;
  padding: var(--space-3) var(--space-4);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--ink-muted);
  border-bottom: 1px solid rgba(44, 38, 34, 0.08);
}

.roster-table tbody td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid rgba(44, 38, 34, 0.06);
  vertical-align: middle;
  color: var(--ink-primary);
  font-size: var(--text-sm);
}

.roster-table tbody tr:last-child td {
  border-bottom: none;
}

.roster-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.48);
}

.cell-student {
  font-weight: var(--font-semibold);
}

.cell-muted {
  color: var(--ink-muted);
}

/* Empty state (§5.5) */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-10) var(--space-6);
  text-align: center;
}

.empty-ghost {
  font-family: var(--font-display);
  font-size: 88px;
  font-weight: var(--font-bold);
  letter-spacing: -0.03em;
  color: var(--ink-faint);
  opacity: 0.35;
  line-height: 1;
  text-transform: lowercase;
}

.empty-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-width: 420px;
}

.empty-copy strong {
  font-size: var(--text-lg);
  color: var(--ink-primary);
}

.empty-copy p {
  margin: 0;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}

/* Earnings */
.earnings-panel {
  background: var(--glass-bg-strong);
}

.earnings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}

.earnings-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.earnings-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-medium);
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.earnings-amount {
  font-size: var(--text-3xl);
  font-weight: var(--font-bold);
  color: var(--ssi-gold);
}

.threshold-bar {
  width: 100%;
  height: 8px;
  background: rgba(44, 38, 34, 0.08);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.threshold-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ssi-red), var(--ssi-gold));
  border-radius: var(--radius-full);
  transition: width 0.5s ease;
}

.payout-actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.payout-hint {
  margin: 0;
  color: var(--ink-muted);
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

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .section-panel,
  .class-panel {
    padding: var(--space-5);
  }
}
</style>
