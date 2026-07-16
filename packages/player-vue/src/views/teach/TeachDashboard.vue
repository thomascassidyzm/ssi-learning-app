<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import { getPaddle, paddleConfig } from '@/lib/paddle'
import { TEACHER_COURSES, labelForCourse } from '@/lib/teacherCourses'
import { courseLabel, isFreeTier, type LiveCourse } from '@/lib/onboardingTracks'
import { usePlayAsClass } from '@/composables/schools/usePlayAsClass'

const router = useRouter()
const supabase = inject('supabase', ref(null)) as any
const { switchActiveCourseTo } = usePlayAsClass()

interface Teacher {
  id: string
  display_name: string
  bio: string | null
  referral_active: boolean
  own_subscription_id: string | null
  teaching_languages: string[] | null
  platform_status: string | null
  platform_expires_at: string | null
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
// The LIVE full catalogue (same source the onboarding door uses). This is what
// drives the create-class course list + human labels, so any deployed (live or
// beta) course is teachable — not just the ~21 in the static TEACHER_COURSES.
const liveCourses = ref<LiveCourse[]>([])
const subscription = ref<Subscription | null>(null)
const isLoading = ref(true)
const errorMessage = ref('')

// Per-class roster (keyed by class id)
const rosterByClass = ref<Record<string, RosterStudent[]>>({})

// Earnings — hydrated from GET /api/teacher/commissions
const accruedPence = ref(0)
const pendingPence = ref(0)
const lifetimePaidPence = ref(0)
const payoutRecipient = ref<PayoutRecipient | null>(null)
const isRequestingPayout = ref(false)
const payoutError = ref('')
const payoutQueued = ref(false)

// Wise bank-details (recipient) form
const showRecipientForm = ref(false)
const isSavingRecipient = ref(false)
const recipientForm = ref({ account_holder_name: '', sortCode: '', accountNumber: '' })

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
const COMMISSION_PER_STUDENT = 5
const MAX_CLASSES = 10
const MAX_STUDENTS_PER_CLASS = 20
const PAYOUT_THRESHOLD_PENCE = 10000 // £100

// Paid TUTOR-PLATFORM subscription — read from the teacher row's platform
// columns, NOT the generic /api/subscription row: that single-row-per-learner
// record is also written by £15 learner-premium and £10/£5 student purchases,
// so an unscoped check unlocked the full teaching catalogue for a trial tutor
// who merely paid as a STUDENT in someone else's class. past_due counts as
// subscribed (a live Paddle sub mid-dunning — manage it, don't re-buy it).
const hasSubscription = computed(() =>
  ['active', 'past_due'].includes(teacher.value?.platform_status || '')
)
const subscriptionStatus = computed(() => subscription.value?.status || 'none')

// Human label for a course code: prefer the LIVE catalogue (covers every
// deployed course), fall back to the static map while the API loads.
function courseLabelFor(code: string): string {
  const live = liveCourses.value.find((c) => c.course_code === code)
  return live ? courseLabel(live) : labelForCourse(code)
}

// The full SUBSCRIBED catalogue: every deployed (live/beta) course, from the
// live API. Falls back to the static list until the catalogue loads.
const fullCatalogue = computed(() => {
  if (liveCourses.value.length) {
    return liveCourses.value.map((c) => ({ code: c.course_code, label: courseLabel(c) }))
  }
  return TEACHER_COURSES.map((c) => ({ code: c.code, label: c.label }))
})

// On the free TRIAL the tutor can only run classes in the ONE language they
// signed up to teach (teachers.teaching_languages). A paid subscription unlocks
// the full catalogue. If teaching_languages is somehow empty, don't lock them
// out — fall back to the full list.
const availableCourses = computed(() => {
  if (hasSubscription.value) return fullCatalogue.value
  const langs = teacher.value?.teaching_languages || []
  if (!langs.length) return fullCatalogue.value
  return langs.map((code) => ({ code, label: courseLabelFor(code) }))
})
const courseLocked = computed(() => availableCourses.value.length === 1)

const nextChargeDate = computed(() => {
  if (!subscription.value?.currentPeriodEnd) return ''
  const d = new Date(subscription.value.currentPeriodEnd)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
})

const totalStudents = computed(() =>
  classes.value.reduce((sum, c) => sum + (rosterByClass.value[c.id]?.length || 0), 0)
)

// Commission only accrues on PAID student subscriptions — students in
// free/community-course classes never generate one, so counting the whole
// roster promised an earning rate that would never pay out. Until the live
// catalogue loads we can't tell tiers apart; fall back to the naive count.
const monthlyEarningsEstimate = computed(() => {
  if (!liveCourses.value.length) return totalStudents.value * COMMISSION_PER_STUDENT
  const paidCourses = new Set(
    liveCourses.value.filter((c) => !isFreeTier(c)).map((c) => c.course_code)
  )
  return classes.value.reduce(
    (sum, c) =>
      paidCourses.has(c.course_code)
        ? sum + (rosterByClass.value[c.id]?.length || 0) * COMMISSION_PER_STUDENT
        : sum,
    0
  )
})

const accruedPounds = computed(() => (accruedPence.value / 100).toFixed(2))
const pendingPounds = computed(() => (pendingPence.value / 100).toFixed(2))
const lifetimePaidPounds = computed(() => (lifetimePaidPence.value / 100).toFixed(2))
const payoutThresholdPounds = computed(() => (PAYOUT_THRESHOLD_PENCE / 100).toFixed(0))
const payoutProgress = computed(() =>
  Math.min(100, Math.round((accruedPence.value / PAYOUT_THRESHOLD_PENCE) * 100))
)
const canRequestPayout = computed(() => accruedPence.value >= PAYOUT_THRESHOLD_PENCE)

const atClassCap = computed(() => classes.value.length >= MAX_CLASSES)

function shareUrlFor(cls: TeacherClass): string {
  return `${origin}/with/${cls.student_join_code}`
}

// Launch the player inside the teach surface so the teach nav stays above it
// (mirrors the schools ClassDetail "Play as class" → /schools/play). The player
// reads ssi-active-class + ?class to switch to the class's course.
async function playAsClass(cls: TeacherClass) {
  localStorage.setItem('ssi-last-course', cls.course_code)
  localStorage.setItem('ssi-active-class', JSON.stringify({
    id: cls.id,
    name: cls.class_name,
    course_code: cls.course_code,
    current_seed: cls.current_seed,
    timestamp: new Date().toISOString(),
  }))
  // Force the app onto the class's course now — don't rely on PlayerContainer's
  // onMounted to win its race against App.vue's async course-catalogue fetch.
  await switchActiveCourseTo(cls.course_code)
  router.push({ path: '/tutors/dashboard/play', query: { class: cls.id } })
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
    router.replace('/tutors')
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
      // The endpoint returns 200 { recipient_id: null } when no Wise recipient is
      // set up yet (it only 404s for non-teachers). Treat a null recipient_id as
      // "no recipient" so the setup form opens and the button label is correct.
      payoutRecipient.value = data?.recipient_id ? data : null
    } else if (res.status === 404) {
      payoutRecipient.value = null
    }
  } catch {
    // Non-fatal — payout button will fall back to setup flow
  }
}

async function loadCommissions(token: string): Promise<void> {
  try {
    const res = await fetch('/api/teacher/commissions', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      accruedPence.value = data.accrued_pence ?? 0
      pendingPence.value = data.pending_pence ?? 0
      lifetimePaidPence.value = data.lifetime_paid_pence ?? 0
    }
  } catch {
    // Non-fatal — earnings show £0
  }
}

async function loadLiveCourses(): Promise<void> {
  try {
    const res = await fetch('/api/courses/available')
    if (res.ok) liveCourses.value = await res.json()
  } catch {
    // Non-fatal — labels/catalogue fall back to the static TEACHER_COURSES list.
  }
}

async function loadAll() {
  // Catalogue is public and unauthenticated — load it regardless of sign-in.
  loadLiveCourses()

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
        loadCommissions(token),
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
  if (isStartingTrial.value) return
  // Double-subscribe guard: an already-paid tutor must never open a SECOND
  // checkout (that creates a second Paddle subscription = double-bill). Route
  // them to the billing portal to manage the existing one instead. Keyed on
  // the PLATFORM columns (hasSubscription), not the generic subscription row —
  // a learner-premium-only tutor must still be able to buy the platform.
  if (hasSubscription.value) {
    void openPortal()
    return
  }
  // The webhook (kind:'tutor_platform') keys the platform subscription on the
  // teachers-row id, so it MUST be resolved (non-null) before we open checkout.
  // teacher.value is hydrated from GET /api/teacher/me in loadTeacher(); if it's
  // not present yet, block rather than send a null teacher_id.
  const teacherId = teacher.value?.id ?? null
  if (!teacherId) {
    checkoutError.value = 'Still loading your tutor account — try again in a moment'
    return
  }
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
    const userId = session?.user?.id
    if (!email) {
      checkoutError.value = 'Sign in again to start checkout'
      return
    }
    const paddle = await getPaddle()
    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
      customer: { email },
      customData: {
        // Freelance tutor platform subscription. The webhook re-derives price +
        // tier server-side from this kind; the £15 bundles the dashboard AND
        // learner-side premium. supabase_user_id is a resolution fallback so the
        // webhook can find the tutor even if teacher_id ever fails to map.
        kind: 'tutor_platform',
        teacher_id: teacherId,
        supabase_user_id: userId,
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
  checkoutError.value = ''
  try {
    const token = await getAuthToken()
    if (!token) {
      checkoutError.value = 'Sign in again to manage your subscription'
      return
    }
    const res = await fetch('/api/teacher/portal', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      if (data.portalUrl) {
        window.location.href = data.portalUrl
        return
      }
    }
    // Surface the failure — a silent no-op here left declined-card tutors
    // clicking "Update payment method" into the void.
    checkoutError.value = 'Could not open the billing portal — try again or contact us'
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
  newClassCourse.value = (availableCourses.value[0] || TEACHER_COURSES[0]).code
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
    // 1. No Wise recipient yet → open the bank-details form to start setup.
    // 2. Recipient exists → the monthly payouts cron closes the accrued balance
    //    into a Wise batch and disburses it; confirm it's queued (no separate
    //    "request" endpoint exists, so don't pretend to call one).
    if (!payoutRecipient.value) {
      // No Wise recipient yet — open the bank-details form. (The POST needs real
      // account details; an empty body 400s, so we never auto-POST.)
      showRecipientForm.value = true
      return
    }
    payoutQueued.value = true
  } catch (err: any) {
    payoutError.value = err?.message || 'Something went wrong'
  } finally {
    isRequestingPayout.value = false
  }
}

async function submitRecipient() {
  if (isSavingRecipient.value) return
  const name = recipientForm.value.account_holder_name.trim()
  const sortCode = recipientForm.value.sortCode.replace(/\D/g, '')
  const accountNumber = recipientForm.value.accountNumber.replace(/\D/g, '')
  if (!name || sortCode.length !== 6 || accountNumber.length !== 8) {
    payoutError.value = 'Enter a name, 6-digit sort code and 8-digit account number.'
    return
  }
  isSavingRecipient.value = true
  payoutError.value = ''
  try {
    const token = await getAuthToken()
    if (!token) return
    const res = await fetch('/api/teacher/payout-recipient', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        currency: 'GBP',
        account_holder_name: name,
        type: 'sort_code',
        details: { sortCode, accountNumber },
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      payoutError.value = data.error || 'Failed to save payout details'
      return
    }
    payoutRecipient.value = data
    showRecipientForm.value = false
  } catch (err: any) {
    payoutError.value = err?.message || 'Something went wrong'
  } finally {
    isSavingRecipient.value = false
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
          You're on your 1 month free trial. Then it's £{{ TEACHER_MONTHLY_PRICE }}/month —
          your dashboard pauses if the trial lapses. Cancel anytime.
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
          You earn £{{ COMMISSION_PER_STUDENT }} per student — three paying
          students cover your £{{ TEACHER_MONTHLY_PRICE }} subscription. Every
          student after that is profit.
        </p>
        <Button variant="primary" :loading="isStartingTrial" :disabled="!teacher?.id" @click="startTrial">
          Subscribe — £{{ TEACHER_MONTHLY_PRICE }}/month
        </Button>
      </div>

      <!-- Payment trouble first (platform column is authoritative; the generic
           row is a fallback), then cancelled, then a catch-all Active/manage
           row — a paying tutor must ALWAYS have a manage control here. -->
      <div
        v-else-if="teacher?.platform_status === 'past_due' || subscriptionStatus === 'past_due'"
        class="sub-status-row past-due"
      >
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

      <div v-else class="sub-status-row">
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
            <!-- On trial: locked to the one signed-up language. Subscribe to unlock all. -->
            <p v-if="courseLocked" class="locked-course">
              {{ courseLabelFor(newClassCourse) }}
              <span class="locked-hint">Subscribe to teach more languages</span>
            </p>
            <select v-else id="new-class-course" v-model="newClassCourse" required>
              <option v-for="c in availableCourses" :key="c.code" :value="c.code">
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
            <p class="class-course">{{ courseLabelFor(cls.course_code) }}</p>
          </div>
          <div class="class-stats">
            <span class="class-stat">
              <span class="class-stat-value frost-mono-nums">
                {{ rosterByClass[cls.id]?.length || 0 }}
              </span>
              of {{ MAX_STUDENTS_PER_CLASS }} students
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            class="class-play-btn"
            @click="playAsClass(cls)"
          >
            ▶ Play as class
          </Button>
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
          <span class="earnings-label">Pending payout</span>
          <span class="earnings-amount frost-mono-nums">£{{ pendingPounds }}</span>
        </div>
        <div class="earnings-block">
          <span class="earnings-label">Lifetime paid</span>
          <span class="earnings-amount frost-mono-nums">£{{ lifetimePaidPounds }}</span>
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
      <div v-if="payoutQueued" class="payout-queued">
        Payout queued for the next run. We'll send your accrued balance to your
        Wise account at the next monthly payout.
      </div>

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

      <form v-if="showRecipientForm" class="recipient-form" @submit.prevent="submitRecipient">
        <p class="section-sub">
          Enter your UK bank details. Payouts are sent in GBP via Wise.
        </p>
        <div class="field">
          <label for="rcp-name">Account holder name</label>
          <input
            id="rcp-name"
            v-model="recipientForm.account_holder_name"
            type="text"
            placeholder="As it appears on your account"
            required
          />
        </div>
        <div class="inline-fields">
          <div class="field">
            <label for="rcp-sort">Sort code</label>
            <input
              id="rcp-sort"
              v-model="recipientForm.sortCode"
              type="text"
              inputmode="numeric"
              placeholder="00-00-00"
              required
            />
          </div>
          <div class="field">
            <label for="rcp-acct">Account number</label>
            <input
              id="rcp-acct"
              v-model="recipientForm.accountNumber"
              type="text"
              inputmode="numeric"
              placeholder="12345678"
              required
            />
          </div>
        </div>
        <div class="inline-actions">
          <Button type="button" variant="ghost" @click="showRecipientForm = false">Cancel</Button>
          <Button type="submit" variant="primary" :loading="isSavingRecipient">Save payout details</Button>
        </div>
      </form>
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

.locked-course {
  margin: 0;
  font-weight: 600;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.locked-hint {
  font-weight: 400;
  font-size: 0.8rem;
  color: var(--text-muted, #8a8479);
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

.class-play-btn {
  align-self: center;
  flex-shrink: 0;
  white-space: nowrap;
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

.payout-queued {
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-green), 0.08);
  border: 1px solid rgba(var(--tone-green), 0.22);
  border-radius: var(--radius-lg);
  color: var(--ink-secondary);
  font-size: var(--text-sm);
}

.recipient-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-top: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid rgba(44, 38, 34, 0.08);
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
