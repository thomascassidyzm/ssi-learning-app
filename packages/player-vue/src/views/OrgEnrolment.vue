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
import { t } from '../composables/useI18n'

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
const payingOnAnotherAccount = ref(false)
const alreadyEnrolled = ref(false)

const isSignedIn = computed(() => auth?.isAuthenticated?.value ?? false)
const canEnrol = computed(() => consentTicked.value && step.value === 'terms')

const prettyEnd = computed(() =>
  freeUntil.value
    ? new Date(freeUntil.value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : '',
)

/** t() with {placeholders} filled — the same shape SettingsScreen.vue uses. */
function fill(key: string, vars: Record<string, string>): string {
  let out = t(key)
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v)
  return out
}

function normalise(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

onMounted(async () => {
  code.value = normalise(String(route.params.code || route.query.code || ''))
  if (!code.value) {
    step.value = 'invalid'
    error.value = t('enrol.errorNoCode')
    return
  }
  try {
    const res = await fetch(`/api/org/enrol?code=${encodeURIComponent(code.value)}`)
    const body = await res.json()
    if (!body?.found) {
      step.value = 'invalid'
  error.value = t('enrol.errorUnknownLink')
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
    error.value = t('enrol.errorNoServer')
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
    error.value = sendErr.message || t('enrol.errorSendFailed')
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
    error.value = verifyErr.message || t('enrol.errorBadOtp')
    return
  }
  step.value = 'terms'
}

async function enrol(): Promise<void> {
  if (!consentTicked.value) {
    error.value = t('enrol.errorConsentRequired')
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
      error.value = body?.error || t('enrol.errorSubmitFailed')
      step.value = 'terms'
      return
    }
    freeUntil.value = body.freeAccessUntil
    cancellationNeeded.value = !!body.cancellationNeeded
    priorPlanName.value = body.priorPlanName ?? null
    payingOnAnotherAccount.value = !!body.payingOnAnotherAccount
    alreadyEnrolled.value = !!body.alreadyEnrolled
    step.value = 'done'
  } catch {
    error.value = t('enrol.errorNoServerMidFlow')
    step.value = 'terms'
  }
}

/**
 * The cancellation sentence, which has to be true in three different
 * situations or it sends somebody hunting for a subscription that is not
 * where we said. The one that matters is the third: the live database really
 * does hold people with two learner records against one email address, and on
 * the old system a subscription sitting on the other one was never noticed
 * and is, a year later, still charging them.
 */
const cancelNotice = computed(() => {
  const plan = priorPlanName.value ? fill('enrol.cancelOnPlan', { plan: priorPlanName.value }) : ''
  if (payingOnAnotherAccount.value) return fill('enrol.cancelNoticeOtherAccount', { plan })
  return priorPlanName.value
    ? fill('enrol.cancelNoticeWithPlan', { plan: priorPlanName.value })
    : t('enrol.cancelNotice')
})

function start(): void {
  router.push('/')
}
</script>

<template>
  <div class="enrol-page">
    <div class="enrol-card">
      <template v-if="step === 'loading'">
        <p class="enrol-lede">{{ t('enrol.loading') }}</p>
      </template>

      <template v-else-if="step === 'invalid'">
        <h1 class="enrol-title">{{ t('enrol.invalidTitle') }}</h1>
        <p class="enrol-lede">{{ error }}</p>
      </template>

      <template v-else-if="step === 'intro'">
        <h1 class="enrol-title">{{ t('enrol.introTitle') }}</h1>
        <p class="enrol-lede">{{ fill('enrol.introBody', { org: orgName }) }}</p>
        <button class="enrol-primary" @click="begin">{{ t('enrol.getStarted') }}</button>
      </template>

      <template v-else-if="step === 'email'">
        <h1 class="enrol-title">{{ t('enrol.emailTitle') }}</h1>
        <p class="enrol-lede">{{ t('enrol.emailBody') }}</p>
        <form class="enrol-form" @submit.prevent="sendCode">
          <input
            v-model="email"
            class="enrol-input"
            type="email"
            inputmode="email"
            autocomplete="email"
            :placeholder="t('enrol.emailPlaceholder')"
          />
          <p v-if="error" class="enrol-error" role="alert">{{ error }}</p>
          <button type="submit" class="enrol-primary" :disabled="!email.includes('@')">
            {{ t('enrol.sendCode') }}
          </button>
        </form>
      </template>

      <template v-else-if="step === 'otp'">
        <h1 class="enrol-title">{{ t('enrol.otpTitle') }}</h1>
        <p class="enrol-lede">{{ fill('enrol.otpBody', { email }) }}</p>
        <form class="enrol-form" @submit.prevent="verifyCode">
          <input
            v-model="otp"
            class="enrol-input enrol-input--code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="123456"
          />
          <p v-if="error" class="enrol-error" role="alert">{{ error }}</p>
          <button type="submit" class="enrol-primary" :disabled="otp.length < 6">
            {{ t('enrol.continue') }}
          </button>
        </form>
      </template>

      <template v-else-if="step === 'terms' || step === 'submitting'">
        <h1 class="enrol-title">{{ t('enrol.ticksTitle') }}</h1>

        <label v-if="askAgeBand" class="enrol-tick">
          <input v-model="ageTicked" type="checkbox" />
          <span>{{ ageBandLabel }}</span>
        </label>

        <label class="enrol-tick">
          <input v-model="consentTicked" type="checkbox" />
          <span>{{ consentStatement }} <span class="enrol-required" aria-hidden="true">*</span></span>
        </label>

        <p class="enrol-note">{{ t('enrol.consentIsRequired') }}</p>

        <p v-if="error" class="enrol-error" role="alert">{{ error }}</p>
        <button class="enrol-primary" :disabled="!canEnrol" @click="enrol">
          {{ step === 'submitting' ? t('enrol.settingUp') : t('enrol.claim') }}
        </button>
      </template>

      <template v-else-if="step === 'done'">
        <h1 class="enrol-title">
          {{ alreadyEnrolled ? t('enrol.doneTitleAlready') : t('enrol.doneTitle') }}
        </h1>
        <p class="enrol-lede">{{ fill('enrol.doneBody', { date: prettyEnd }) }}</p>

        <!--
          The one thing on this page that costs somebody money if we get it
          wrong. Said plainly, with the date beside it, and NOT acted on: we
          do not touch anybody's subscription on their behalf.
        -->
        <div v-if="cancellationNeeded" class="enrol-warn">
          <p>{{ cancelNotice }}</p>
          <p>{{ fill('enrol.cancelHow', { date: prettyEnd }) }}</p>
        </div>

        <button class="enrol-primary" @click="start">{{ t('enrol.startLearning') }}</button>
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
.enrol-title + .enrol-tick {
  /* The "terms" step goes straight from the title to the first question,
     with no lede paragraph to carry the usual gap. */
  margin-top: 1rem;
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
.enrol-required {
  color: var(--danger, #a33);
  font-weight: 700;
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
