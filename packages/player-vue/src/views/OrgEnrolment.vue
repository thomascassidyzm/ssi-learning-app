<script setup lang="ts">
/**
 * OrgEnrolment — /enrol/:code, the one door into a funded cohort.
 *
 * ONE LINK. The old system had a second link for under-25s, people used the
 * wrong one and landed in the wrong cohort, and nobody could tell afterwards.
 * There is one link here and age is a TICK on this page — which also means we
 * never hold a date of birth to answer a yes/no question.
 *
 * EVERYONE COMES THROUGH IT. Somebody brand new signs in first, with the same
 * email code every other door uses, and then lands on the same enrolment step
 * as somebody who has had an account for three years. The step is the record —
 * of the consent, of the age answer, and of the date their free year starts —
 * so it cannot be skipped by already having an account.
 *
 * THE SUBSCRIPTION LINE. If they already pay, this page TELLS them their
 * subscription needs cancelling and shows the date their free year ends. It
 * does not cancel it, and there is nothing behind this page that would: see
 * the header of api/org/enrolment-cancellation.ts.
 *
 * BACK AND REFRESH ARE SAFE. Every submit is the same idempotent POST; the
 * server's UNIQUE (group_id, learner_id) is what guarantees it, and a replay
 * comes back as `alreadyEnrolled` rather than as an error or a second row.
 */
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { sendSignInCode } from '../auth/sendSignInCode'

type Step = 'loading' | 'invalid' | 'intro' | 'email' | 'otp' | 'terms' | 'submitting' | 'done'

const route = useRoute()
const router = useRouter()
const auth = inject<any>('auth', null)
const supabase = inject<any>('supabase', ref(null))

const step = ref<Step>('loading')
const error = ref('')
const code = ref('')
const orgName = ref('')
const consentStatement = ref('')
const askAgeBand = ref(true)
const ageBandLabel = ref('I am aged 16 to 24')
const freeMonths = ref(12)

const email = ref('')
const otp = ref('')
const ageTicked = ref(false)
const consentTicked = ref(false)

const freeUntil = ref<string | null>(null)
const cancellationNeeded = ref(false)
const priorPlanName = ref<string | null>(null)
const alreadyEnrolled = ref(false)

const isSignedIn = computed(() => auth?.isAuthenticated?.value ?? false)
const canEnrol = computed(() => consentTicked.value && step.value === 'terms')

const prettyEnd = computed(() =>
  freeUntil.value
    ? new Date(freeUntil.value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '',
)

function normalise(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

onMounted(async () => {
  code.value = normalise(String(route.params.code || route.query.code || ''))
  if (!code.value) {
    step.value = 'invalid'
    error.value = 'That link is missing its code.'
    return
  }
  try {
    const res = await fetch(`/api/org/enrol?code=${encodeURIComponent(code.value)}`)
    const body = await res.json()
    if (!body?.found) {
      step.value = 'invalid'
      error.value = 'We do not recognise that link. Check it with whoever sent it to you.'
      return
    }
    orgName.value = body.orgName
    consentStatement.value = body.consentStatement
    askAgeBand.value = !!body.askAgeBand
    ageBandLabel.value = body.ageBandLabel || ageBandLabel.value
    freeMonths.value = body.freeMonths || 12
    step.value = 'intro'
  } catch {
    step.value = 'invalid'
    error.value = 'We could not reach the server. Try again in a moment.'
  }
})

/** Signing in mid-flow drops them straight onto the ticks, not back to the start. */
watch(isSignedIn, (now) => {
  if (now && (step.value === 'email' || step.value === 'otp' || step.value === 'intro')) step.value = 'terms'
})

function begin(): void {
  step.value = isSignedIn.value ? 'terms' : 'email'
}

async function sendCode(): Promise<void> {
  const client = supabase.value
  if (!client || !email.value.includes('@')) return
  error.value = ''
  const { error: sendErr } = await sendSignInCode(client, email.value)
  if (sendErr) {
    error.value = sendErr.message || 'We could not send that code. Try again.'
    return
  }
  step.value = 'otp'
}

async function verifyCode(): Promise<void> {
  const client = supabase.value
  if (!client || otp.value.length < 6) return
  error.value = ''
  const { error: verifyErr } = await client.auth.verifyOtp({ email: email.value, token: otp.value, type: 'email' })
  if (verifyErr) {
    error.value = verifyErr.message || 'That code did not work. Try again.'
    return
  }
  step.value = 'terms'
}

async function enrol(): Promise<void> {
  if (!consentTicked.value) {
    error.value = 'We can only give you free access if you agree to the data-sharing statement.'
    return
  }
  const client = supabase.value
  const token = (await client?.auth?.getSession?.())?.data?.session?.access_token
  step.value = 'submitting'
  error.value = ''
  try {
    const res = await fetch('/api/org/enrol', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        code: code.value,
        ageBand16to24: askAgeBand.value ? ageTicked.value : false,
        dataSharingConsent: consentTicked.value,
      }),
    })
    const body = await res.json()
    if (!body?.success) {
      error.value = body?.error || 'We could not complete your enrolment. Try again.'
      step.value = 'terms'
      return
    }
    freeUntil.value = body.freeAccessUntil
    cancellationNeeded.value = !!body.cancellationNeeded
    priorPlanName.value = body.priorPlanName ?? null
    alreadyEnrolled.value = !!body.alreadyEnrolled
    step.value = 'done'
  } catch {
    error.value = 'We could not reach the server. Your place is not lost — try again.'
    step.value = 'terms'
  }
}

function start(): void {
  router.push('/')
}
</script>

<template>
  <div class="enrol-page">
    <div class="enrol-card">
      <template v-if="step === 'loading'">
        <p class="enrol-lede">One moment…</p>
      </template>

      <template v-else-if="step === 'invalid'">
        <h1 class="enrol-title">That link did not work</h1>
        <p class="enrol-lede">{{ error }}</p>
      </template>

      <template v-else-if="step === 'intro'">
        <h1 class="enrol-title">A free year of SaySomethingin</h1>
        <p class="enrol-lede">
          Because you are on a {{ orgName }} course, your SaySomethingin
          subscription is free for a year. There are two questions to answer and
          then you are away.
        </p>
        <button class="enrol-primary" data-walk="org-enrol-begin" @click="begin">Get started</button>
      </template>

      <template v-else-if="step === 'email'">
        <h1 class="enrol-title">What is your email address?</h1>
        <p class="enrol-lede">We will send you a six-digit code to sign in with. No password to remember.</p>
        <form class="enrol-form" @submit.prevent="sendCode">
          <input v-model="email" class="enrol-input" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" />
          <p v-if="error" class="enrol-error" role="alert">{{ error }}</p>
          <button type="submit" class="enrol-primary" :disabled="!email.includes('@')">Send my code</button>
        </form>
      </template>

      <template v-else-if="step === 'otp'">
        <h1 class="enrol-title">Enter your code</h1>
        <p class="enrol-lede">We sent six digits to {{ email }}.</p>
        <form class="enrol-form" @submit.prevent="verifyCode">
          <input v-model="otp" class="enrol-input enrol-input--code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
          <p v-if="error" class="enrol-error" role="alert">{{ error }}</p>
          <button type="submit" class="enrol-primary" :disabled="otp.length < 6">Continue</button>
        </form>
      </template>

      <template v-else-if="step === 'terms' || step === 'submitting'">
        <h1 class="enrol-title">Two questions</h1>

        <label class="enrol-tick">
          <input v-if="askAgeBand" v-model="ageTicked" type="checkbox" data-walk="org-enrol-age-tick" />
          <span v-if="askAgeBand">{{ ageBandLabel }}</span>
        </label>

        <label class="enrol-tick">
          <input v-model="consentTicked" type="checkbox" data-walk="org-enrol-consent-tick" />
          <span>{{ consentStatement }}</span>
        </label>

        <p class="enrol-note">
          The second one is not optional — we can only give you the free year if
          you agree to it.
        </p>

        <p v-if="error" class="enrol-error" role="alert">{{ error }}</p>
        <button
          class="enrol-primary"
          data-walk="org-enrol-submit"
          :disabled="!canEnrol"
          @click="enrol"
        >
          {{ step === 'submitting' ? 'Setting you up…' : 'Claim my free year' }}
        </button>
      </template>

      <template v-else-if="step === 'done'">
        <h1 class="enrol-title">{{ alreadyEnrolled ? 'You are already in' : 'You are in' }}</h1>
        <p class="enrol-lede">
          Your free year runs until <strong>{{ prettyEnd }}</strong>. We will
          write to you a few weeks before then, never on the day.
        </p>

        <!--
          The one thing on this page that costs somebody money if we get it
          wrong. Said plainly, with the date beside it, and NOT acted on: we
          do not touch anybody's subscription on their behalf.
        -->
        <div v-if="cancellationNeeded" class="enrol-warn" data-walk="org-enrol-cancel-notice">
          <p>
            You are already paying for SaySomethingin<span v-if="priorPlanName"> on the {{ priorPlanName }} plan</span>.
            That subscription will keep charging you unless you cancel it — we
            will not cancel it for you.
          </p>
          <p>
            Cancel it from your account settings whenever you like. Your free
            year is already running and lasts until {{ prettyEnd }} either way.
          </p>
        </div>

        <button class="enrol-primary" @click="start">Start learning</button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.enrol-page {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Standing safe-area rule (CLAUDE.md): edge-anchored on a phone in
     standalone PWA, so clear the notch and the home indicator. */
  padding:
    max(1.5rem, env(safe-area-inset-top, 0px))
    max(1.25rem, env(safe-area-inset-right, 0px))
    max(1.5rem, env(safe-area-inset-bottom, 0px))
    max(1.25rem, env(safe-area-inset-left, 0px));
  background: var(--bg-primary, #e8e3dd);
}
.enrol-card {
  width: 100%;
  max-width: 28rem;
  background: var(--surface-elevated, #fff);
  border-radius: 1rem;
  padding: 1.75rem 1.5rem;
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}
.enrol-title {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.2;
  color: var(--text-primary, #1a1a1a);
}
.enrol-lede {
  margin: 0.5rem 0 1.5rem;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--text-secondary, #555);
}
.enrol-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.enrol-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.875rem 1rem;
  font-size: 1rem;
  border: 1px solid var(--border-subtle, #d5d0c9);
  border-radius: 0.625rem;
  background: var(--bg-primary, #f6f4f1);
  color: var(--text-primary, #1a1a1a);
}
.enrol-input--code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 1.375rem;
  letter-spacing: 0.2em;
  text-align: center;
}
.enrol-tick {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
  margin: 0 0 1rem;
  font-size: 0.9375rem;
  line-height: 1.45;
  color: var(--text-primary, #1a1a1a);
  cursor: pointer;
}
.enrol-tick input {
  /* A tick a thumb can actually hit. */
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.1rem;
  flex: 0 0 auto;
}
.enrol-note {
  margin: 0 0 1.25rem;
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--text-tertiary, #777);
}
.enrol-primary {
  width: 100%;
  padding: 0.875rem 1rem;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 0.625rem;
  background: var(--accent, #6b7f5e);
  color: #fff;
  cursor: pointer;
  min-height: 3rem;
}
.enrol-primary:disabled {
  opacity: 0.45;
  cursor: default;
}
.enrol-error {
  margin: 0.25rem 0 0.5rem;
  font-size: 0.875rem;
  line-height: 1.45;
  color: var(--danger, #a33);
}
.enrol-warn {
  margin: 0 0 1.25rem;
  padding: 0.875rem 1rem;
  border-radius: 0.625rem;
  background: #fdf4e3;
  border: 1px solid #e6d2a8;
  font-size: 0.875rem;
  line-height: 1.5;
  color: #5a4a20;
}
.enrol-warn p {
  margin: 0 0 0.5rem;
}
.enrol-warn p:last-child {
  margin-bottom: 0;
}
</style>
