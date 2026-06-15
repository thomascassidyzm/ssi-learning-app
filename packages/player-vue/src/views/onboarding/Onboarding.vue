<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import {
  TRACKS,
  coursesForTrack,
  courseLabel,
  type OnboardingTrack,
  type LiveCourse,
} from '@/lib/onboardingTracks'
import '@/styles/schools-tokens.css'

// track is set per route (/schools1 /schools2 /tutors) via router props.
const props = defineProps<{ track: OnboardingTrack }>()
const supabase = inject('supabase', ref(null)) as any

const cfg = computed(() => TRACKS[props.track])

type Step = 'choose' | 'otp' | 'done'
const step = ref<Step>('choose')

const liveCourses = ref<LiveCourse[]>([])
const courses = computed(() => coursesForTrack(liveCourses.value, props.track))
const selectedCourse = ref('')
const email = ref('')
const otp = ref('')
const busy = ref(false)
const error = ref('')
const otpVerified = ref(false)
const coursesLoaded = ref(false)

// done-step state
const trial = ref<{ course_code: string; expires_at: string; days: number } | null>(null)
const redirectTo = ref('/')
const displayName = ref('')
const institution = ref('')

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value))
const canSend = computed(() => emailValid.value && !!selectedCourse.value && !busy.value)
const selectedCourseLabel = computed(() => {
  const c = courses.value.find((x) => x.course_code === selectedCourse.value)
  return c ? courseLabel(c) : ''
})
const trialEndLabel = computed(() =>
  trial.value
    ? new Date(trial.value.expires_at).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : ''
)

onMounted(async () => {
  try {
    const res = await fetch('/api/courses/available')
    if (res.ok) liveCourses.value = await res.json()
  } catch {
    // Non-fatal — the picker just shows nothing until the catalogue loads.
  } finally {
    coursesLoaded.value = true
  }
  // Preselect when the track offers exactly one language (e.g. Welsh-only today).
  if (!selectedCourse.value && courses.value.length === 1) {
    selectedCourse.value = courses.value[0].course_code
  }
})

async function authToken(): Promise<string | null> {
  if (!supabase.value) return null
  const { data } = await supabase.value.auth.getSession()
  return data?.session?.access_token ?? null
}

async function sendCode() {
  if (!canSend.value || !supabase.value) return
  busy.value = true
  error.value = ''
  try {
    const { error: e } = await supabase.value.auth.signInWithOtp({ email: email.value.trim() })
    if (e) {
      error.value = e.message || 'Could not send your code'
      return
    }
    step.value = 'otp'
  } catch (e: any) {
    error.value = e?.message || 'Could not send your code'
  } finally {
    busy.value = false
  }
}

async function verify() {
  if (otp.value.trim().length < 6 || !supabase.value) return
  busy.value = true
  error.value = ''
  try {
    // Verify the OTP once. If it succeeds but provisioning then fails, a retry must
    // NOT re-run verifyOtp (the token is already consumed) — it re-runs provision only.
    if (!otpVerified.value) {
      const { error: e } = await supabase.value.auth.verifyOtp({
        email: email.value.trim(),
        token: otp.value.trim(),
        type: 'email',
      })
      if (e) {
        error.value = e.message || 'That code did not work'
        return
      }
      otpVerified.value = true
    }
    // Account is verified — confirm the account + activate the free trial.
    const token = await authToken()
    const res = await fetch('/api/onboarding/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ track: props.track, course_code: selectedCourse.value }),
    })
    const data = await res.json()
    if (!res.ok) {
      error.value = data.error || 'We could not finish setting up your account'
      return
    }
    trial.value = data.trial
    redirectTo.value = data.redirect || '/'
    step.value = 'done'
  } catch (e: any) {
    error.value = e?.message || 'Something went wrong'
  } finally {
    busy.value = false
  }
}

async function continueIn() {
  busy.value = true
  error.value = ''
  try {
    const dn = displayName.value.trim()
    const inst = institution.value.trim()
    if (dn || inst) {
      const token = await authToken()
      await fetch('/api/onboarding/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ display_name: dn || undefined, institution: inst || undefined }),
      })
    }
    // Full navigation (not SPA) so the app re-initialises and reads the just-written
    // role + entitlement fresh — avoids the role-cache singleton lagging behind the
    // freshly-created school_admin and bouncing them to a "no access" screen.
    window.location.href = redirectTo.value
  } catch (e: any) {
    error.value = e?.message || 'Something went wrong'
    busy.value = false
  }
}
</script>

<template>
  <div class="onboard">
    <AtmosphereBackdrop />
    <FrostCard variant="panel" class="onboard-card">
      <!-- STEP 1: choose language + email -->
      <template v-if="step === 'choose'">
        <header class="ob-head">
          <span class="ob-trial">{{ cfg.trialLabel }}</span>
          <h1 class="frost-display">{{ cfg.heading }}</h1>
          <p class="ob-blurb">{{ cfg.blurb }}</p>
        </header>

        <div class="field">
          <label>Choose your language</label>
          <div v-if="courses.length" class="lang-grid">
            <button
              v-for="c in courses"
              :key="c.course_code"
              type="button"
              class="lang-chip"
              :class="{ selected: selectedCourse === c.course_code }"
              @click="selectedCourse = c.course_code"
            >
              {{ courseLabel(c) }}
              <span v-if="c.new_app_status === 'beta'" class="beta-tag">beta</span>
            </button>
          </div>
          <p v-else-if="!coursesLoaded" class="ob-muted">Loading languages…</p>
          <p v-else class="ob-muted">No languages available for this signup yet.</p>
        </div>

        <div class="field">
          <label for="ob-email">Your email</label>
          <input
            id="ob-email"
            v-model="email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            @keyup.enter="sendCode"
          />
        </div>

        <div v-if="error" class="ob-error">{{ error }}</div>

        <Button variant="primary" :loading="busy" :disabled="!canSend" @click="sendCode">
          Send my code
        </Button>
        <p class="ob-fine">We'll email you a 6-digit code to confirm your account.</p>
      </template>

      <!-- STEP 2: OTP -->
      <template v-else-if="step === 'otp'">
        <header class="ob-head">
          <h1 class="frost-display">Check your email</h1>
          <p class="ob-blurb">Enter the 6-digit code we sent to <strong>{{ email }}</strong>.</p>
        </header>

        <div class="field">
          <label for="ob-otp">Confirmation code</label>
          <input
            id="ob-otp"
            v-model="otp"
            type="text"
            inputmode="numeric"
            maxlength="6"
            placeholder="000000"
            class="otp-input"
            @keyup.enter="verify"
          />
        </div>

        <div v-if="error" class="ob-error">{{ error }}</div>

        <Button variant="primary" :loading="busy" :disabled="otp.trim().length < 6 || busy" @click="verify">
          Confirm &amp; start my {{ cfg.trialLabel.toLowerCase() }}
        </Button>
        <button type="button" class="ob-link" @click="step = 'choose'">Back</button>
      </template>

      <!-- STEP 3: confirmed + optional profile -->
      <template v-else>
        <header class="ob-head">
          <span class="ob-trial ob-trial-go">You're in 🎉</span>
          <h1 class="frost-display">{{ selectedCourseLabel }} is ready</h1>
          <p class="ob-blurb">
            Free access until <strong>{{ trialEndLabel }}</strong>
            ({{ cfg.trialLabel.toLowerCase() }}). No card needed to start.
          </p>
        </header>

        <div class="field">
          <label for="ob-name">Your name <span class="ob-opt">(optional)</span></label>
          <input id="ob-name" v-model="displayName" type="text" placeholder="How should we greet you?" />
        </div>

        <div v-if="cfg.collectInstitution" class="field">
          <label for="ob-inst">School / institution <span class="ob-opt">(optional)</span></label>
          <input id="ob-inst" v-model="institution" type="text" placeholder="e.g. Ysgol Gymraeg…" />
        </div>

        <div v-if="error" class="ob-error">{{ error }}</div>

        <Button variant="primary" :loading="busy" @click="continueIn">Continue</Button>
        <p class="ob-fine">You can change these anytime in your settings.</p>
      </template>
    </FrostCard>
  </div>
</template>

<style scoped>
.onboard {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
}

.onboard-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 460px;
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.ob-head {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.ob-head .frost-display {
  font-size: var(--text-3xl);
  margin: 0;
  letter-spacing: -0.015em;
}

.ob-trial {
  align-self: flex-start;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: var(--font-bold);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--ssi-gold);
  background: rgba(var(--tone-gold), 0.12);
  border: 1px solid rgba(var(--tone-gold), 0.28);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
}

.ob-trial-go {
  color: var(--ssi-green, #2f855a);
  background: rgba(47, 133, 90, 0.12);
  border-color: rgba(47, 133, 90, 0.28);
}

.ob-blurb {
  margin: 0;
  color: var(--ink-secondary);
  font-size: var(--text-sm);
  line-height: 1.55;
}

.ob-muted {
  color: var(--ink-muted);
  font-size: var(--text-sm);
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

.ob-opt {
  text-transform: none;
  letter-spacing: 0;
  color: var(--ink-faint);
}

.field input {
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.10);
  border-radius: var(--radius-lg);
  font-size: var(--text-base);
  font-family: var(--font-body);
  color: var(--ink-primary);
}

.field input:focus {
  outline: none;
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 3px rgba(var(--tone-red), 0.12);
}

.otp-input {
  font-family: var(--font-mono);
  font-size: var(--text-2xl);
  letter-spacing: 0.3em;
  text-align: center;
}

.lang-grid {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.lang-chip {
  padding: var(--space-2) var(--space-4);
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  color: var(--ink-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.lang-chip:hover {
  border-color: var(--ssi-red);
}

.lang-chip.selected {
  background: var(--ssi-red);
  border-color: var(--ssi-red);
  color: white;
  font-weight: var(--font-semibold);
}

.beta-tag {
  margin-left: var(--space-2);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: var(--font-bold);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  opacity: 0.6;
  vertical-align: middle;
}

.ob-error {
  padding: var(--space-3) var(--space-4);
  background: rgba(var(--tone-red), 0.08);
  border: 1px solid rgba(var(--tone-red), 0.22);
  border-radius: var(--radius-lg);
  color: var(--ssi-red);
  font-size: var(--text-sm);
}

.ob-fine {
  margin: 0;
  color: var(--ink-faint);
  font-size: var(--text-xs);
  text-align: center;
}

.ob-link {
  background: none;
  border: none;
  color: var(--ink-muted);
  font-size: var(--text-sm);
  cursor: pointer;
  align-self: center;
  text-decoration: underline;
}
</style>
