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
// Search-first picker for the long tracks; the tile view stays for a handful.
const langQuery = ref('')
const showSearch = computed(() => courses.value.length > 8)
const visibleCourses = computed(() => {
  const q = langQuery.value.trim().toLowerCase()
  // Long lists: wait for a search rather than dumping every language.
  if (showSearch.value && !q) return []
  if (!q) return courses.value
  return courses.value.filter(
    (c) =>
      courseLabel(c).toLowerCase().includes(q) ||
      c.course_code.toLowerCase().includes(q) ||
      (c.target_lang || '').toLowerCase().includes(q)
  )
})
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
  <div class="onboard" :class="`track-${cfg.key}`">
    <!-- Real Mist atmosphere: warm gold light pool + red mist + paper grain.
         Fixed, full-viewport — the same air the player breathes. -->
    <AtmosphereBackdrop />

    <!-- ============================================================
         LEFT — the brand panel. Warm, light, frosted "paper".
         Rendered ONCE; only its evolving line + step marker change,
         so it reads as one continuous identity (the held breath).
         It is NOT aria-hidden wholesale — its decorative bits are,
         but the brand wordmark + mission stay in the a11y tree.
         ============================================================ -->
    <aside class="ob-panel" :class="`is-${step}`">
      <div class="ob-panel-card">
        <!-- Tall accent spine — the one per-track signal, warm not neon -->
        <span class="ob-spine" aria-hidden="true"></span>

        <header class="ob-brand">
          <span class="ob-wordmark">SaySomethingin</span>
          <span class="ob-brand-sub">{{ cfg.heading }}</span>
        </header>

        <!-- The 17-year proof, as a designed editorial moment. -->
        <div class="ob-proof" role="img" aria-label="Seventeen years of proven results">
          <span class="ob-proof-num" aria-hidden="true">17</span>
          <span class="ob-proof-words" aria-hidden="true">
            <span class="ob-proof-years">years</span>
            <span class="ob-proof-line">the most effective way<br />to speak a new language</span>
          </span>
        </div>

        <!-- Evolving line — responds to the chosen language + the step.
             This is what makes the panel "breathe" across steps. -->
        <Transition name="ob-line" mode="out-in">
          <p class="ob-evolve" :key="step + (selectedCourseLabel || '')">
            <template v-if="step === 'choose'">
              Pick your language and we'll open the door — no card, no catch.
            </template>
            <template v-else-if="step === 'otp'">
              One code stands between you and
              <strong>{{ selectedCourseLabel || 'your first words' }}</strong>.
            </template>
            <template v-else>
              Welcome. <strong>{{ selectedCourseLabel }}</strong> is yours to begin.
            </template>
          </p>
        </Transition>

        <!-- Shared step marker — ONE system across all three steps. -->
        <footer class="ob-marker" aria-hidden="true">
          <span class="ob-marker-dot" :class="{ 'is-on': true }"></span>
          <span class="ob-marker-dot" :class="{ 'is-on': step !== 'choose' }"></span>
          <span class="ob-marker-dot" :class="{ 'is-on': step === 'done' }"></span>
          <span class="ob-marker-rail"><span class="ob-marker-fill"></span></span>
        </footer>
      </div>
    </aside>

    <!-- ============================================================
         RIGHT — the form column. Frost material, warm shadows,
         gold/red focus. The surface the user actually touches.
         ============================================================ -->
    <main class="ob-stage">
      <Transition name="ob-swap" mode="out-in">
        <!-- STEP 1: choose language + email -->
        <section v-if="step === 'choose'" key="choose" class="ob-step">
          <p class="ob-trial">{{ cfg.trialLabel }} — <span>free, no card needed</span></p>

          <h1 class="ob-title">Which language will you speak?</h1>
          <p class="ob-sub">{{ cfg.blurb }}</p>

          <!-- Single pre-claimed hero card when the track offers one language -->
          <div v-if="courses.length === 1" class="ob-field">
            <FrostCard variant="tile" class="ob-claim is-claimed">
              <span class="ob-claim-eyebrow">You're learning</span>
              <span class="ob-claim-endonym">{{ courseLabel(courses[0]) }}</span>
              <span class="ob-claim-echo">
                {{ cfg.trialLabel }}
                <span v-if="courses[0].new_app_status === 'beta'" class="ob-beta">in beta</span>
              </span>
              <svg class="ob-claim-check" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.2 4.2L19 7" />
              </svg>
            </FrostCard>
          </div>

          <!-- Grid of language tiles when there are many. Native radios =
               real ARIA + keyboard/arrow navigation for free. -->
          <fieldset v-else class="ob-field ob-langset">
            <legend class="ob-label">Choose your language</legend>
            <input
              v-if="showSearch"
              v-model="langQuery"
              type="search"
              class="ob-input ob-lang-search"
              placeholder="Search languages…"
              aria-label="Search languages"
            />
            <div v-if="visibleCourses.length" class="ob-lang-grid">
              <label
                v-for="c in visibleCourses"
                :key="c.course_code"
                class="ob-lang-tile"
                :class="{ 'is-selected': selectedCourse === c.course_code }"
              >
                <input
                  type="radio"
                  name="ob-language"
                  class="ob-lang-radio"
                  :value="c.course_code"
                  :checked="selectedCourse === c.course_code"
                  @change="selectedCourse = c.course_code"
                />
                <span class="ob-lang-dot" :data-lang="c.target_lang"></span>
                <span class="ob-lang-endonym">{{ courseLabel(c) }}</span>
                <span class="ob-lang-gloss">
                  {{ c.course_code }}
                  <span v-if="c.new_app_status === 'beta'" class="ob-beta ob-beta-sm">beta</span>
                </span>
                <svg class="ob-lang-check" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12.5l4.2 4.2L19 7" />
                </svg>
              </label>
            </div>
            <p v-else-if="!coursesLoaded" class="ob-muted">Loading languages…</p>
            <p v-else-if="showSearch && !langQuery" class="ob-muted">Start typing to find your language.</p>
            <p v-else-if="langQuery" class="ob-muted">No languages match “{{ langQuery }}”.</p>
            <p v-else class="ob-muted">No languages available for this signup yet.</p>
          </fieldset>

          <div class="ob-field">
            <label class="ob-label" for="ob-email">Your email</label>
            <input
              id="ob-email"
              v-model="email"
              type="email"
              class="ob-input"
              placeholder="you@example.com"
              autocomplete="email"
              @keyup.enter="sendCode"
            />
          </div>

          <div v-if="error" class="ob-error" role="alert">{{ error }}</div>

          <Button
            variant="primary"
            size="lg"
            block
            :loading="busy"
            :disabled="!canSend"
            @click="sendCode"
          >
            Send my code
          </Button>
          <p class="ob-fine">We'll email you a 6-digit code to confirm your account.</p>
        </section>

        <!-- STEP 2: OTP -->
        <section v-else-if="step === 'otp'" key="otp" class="ob-step">
          <p class="ob-trial ob-trial-quiet">Almost there</p>
          <h1 class="ob-title">Check your email</h1>
          <p class="ob-sub">
            Enter the 6-digit code we sent to <strong>{{ email }}</strong>.
          </p>

          <div class="ob-field">
            <label class="ob-label" for="ob-otp">Confirmation code</label>
            <div
              class="ob-otp-wrap"
              :class="{ 'is-full': otp.trim().length >= 6 }"
              :style="{ '--ob-filled': otp.trim().length }"
            >
              <div class="ob-otp-cells" aria-hidden="true">
                <span
                  v-for="i in 6"
                  :key="i"
                  class="ob-otp-cell"
                  :class="{ 'is-set': otp.trim().length >= i }"
                ></span>
              </div>
              <input
                id="ob-otp"
                v-model="otp"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                placeholder="••••••"
                class="ob-otp-input"
                aria-describedby="ob-otp-hint"
                @keyup.enter="verify"
              />
            </div>
            <p id="ob-otp-hint" class="ob-fine ob-fine-left">
              Paste the whole code — we'll sort it out.
            </p>
          </div>

          <div v-if="error" class="ob-error" role="alert">{{ error }}</div>

          <Button
            variant="primary"
            size="lg"
            block
            :loading="busy"
            :disabled="otp.trim().length < 6 || busy"
            @click="verify"
          >
            Confirm &amp; start
          </Button>

          <div class="ob-links">
            <button type="button" class="ob-link" @click="step = 'choose'">Change email</button>
            <span class="ob-link-sep" aria-hidden="true">·</span>
            <button type="button" class="ob-link" :disabled="busy" @click="sendCode">Resend code</button>
          </div>
        </section>

        <!-- STEP 3: confirmed + optional profile -->
        <section v-else key="done" class="ob-step ob-step-done">
          <div class="ob-arrival" aria-hidden="true">
            <span class="ob-arrival-ripple"></span>
            <svg class="ob-arrival-ring" viewBox="0 0 96 96">
              <circle class="ob-arrival-circle" cx="48" cy="48" r="44" />
              <path class="ob-arrival-tick" d="M30 49l11 11 25-27" />
            </svg>
          </div>

          <h1 class="ob-title ob-title-done">{{ selectedCourseLabel }} is ready</h1>
          <p class="ob-sub">
            Free until
            <strong class="ob-date">{{ trialEndLabel }}</strong>.
            No card needed to start.
          </p>

          <div class="ob-finishing">
            <p class="ob-finishing-head">A couple of details <span>(optional)</span></p>

            <div class="ob-field">
              <label class="ob-label" for="ob-name">Your name</label>
              <input
                id="ob-name"
                v-model="displayName"
                type="text"
                class="ob-input"
                placeholder="What shall we call you?"
              />
            </div>

            <div v-if="cfg.collectInstitution" class="ob-field">
              <label class="ob-label" for="ob-inst">School / institution</label>
              <input
                id="ob-inst"
                v-model="institution"
                type="text"
                class="ob-input"
                placeholder="e.g. Ysgol Gymraeg…"
              />
            </div>
          </div>

          <div v-if="error" class="ob-error" role="alert">{{ error }}</div>

          <Button variant="primary" size="lg" block :loading="busy" @click="continueIn">
            Continue
          </Button>
          <p class="ob-fine">You can change these anytime in your settings.</p>
        </section>
      </Transition>
    </main>
  </div>
</template>

<style scoped>
/* ================================================================
 * THE THRESHOLD — SSi signup
 *
 * One warm, lit room in the player's "Mist" theme. Both columns sit
 * on the same warm canvas + AtmosphereBackdrop (gold light pool,
 * red mist, paper grain), so crossing into the learning app is
 * seamless — no dark cosmos slab. The left brand panel is warm
 * frosted "paper"; the right column is real frost material with
 * warm shadows and gold/red focus. The 17-year proof leads.
 *
 * Self-sufficient: depends ONLY on globally-loaded tokens
 * (--ssi-*, --text-*, --bg-*, --space-*, --radius-*) with literal
 * fallbacks — never on the .schools-surface-scoped --glass/--ink/
 * --tone tokens, which are not loaded on this standalone route.
 * ================================================================ */

.onboard {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 44fr 56fr;
  background: var(--bg-primary, #e8e3dd);
  color: var(--text-primary, #2c2622);
  isolation: isolate;

  /* The ONE per-track accent. schools1 (cfg.key '') = deliberate
     heritage gold→red, NOT a generic belt colour — it's the anchor. */
  --ob-accent: var(--ssi-gold, #d4a853);
  --ob-accent-ink: var(--ssi-gold-dark, #b8923d);
  --ob-accent-2: var(--ssi-red, #c23a3a);
  --ob-accent-soft: rgba(212, 168, 83, 0.16);
  --ob-accent-glow: rgba(212, 168, 83, 0.30);
}
.onboard.track-school_standard {
  --ob-accent: var(--ssi-red, #c23a3a);
  --ob-accent-ink: var(--ssi-red-dark, #9a2e2e);
  --ob-accent-2: var(--ssi-gold, #d4a853);
  --ob-accent-soft: rgba(194, 58, 58, 0.12);
  --ob-accent-glow: rgba(194, 58, 58, 0.26);
}
.onboard.track-tutor {
  --ob-accent: var(--ssi-gold-dark, #b8923d);
  --ob-accent-ink: #8a6c24;
  --ob-accent-2: var(--ssi-red, #c23a3a);
  --ob-accent-soft: rgba(184, 146, 61, 0.16);
  --ob-accent-glow: rgba(184, 146, 61, 0.30);
}

/* ----------------------------------------------------------------
 * LEFT — the brand panel (warm frosted paper, persists across steps)
 * ---------------------------------------------------------------- */
.ob-panel {
  position: sticky;
  top: 0;
  align-self: start;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  padding: clamp(1.5rem, 3vw, 3rem);
  z-index: 1;
}

.ob-panel-card {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: clamp(1.5rem, 3vh, 2.75rem);
  padding: clamp(2rem, 4vw, 3.5rem);
  padding-left: clamp(2.5rem, 4.5vw, 4rem);
  border-radius: 28px;
  background:
    linear-gradient(165deg, rgba(255, 252, 248, 0.86) 0%, rgba(250, 245, 238, 0.7) 100%);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 1px 2px rgba(44, 38, 34, 0.06),
    0 18px 48px rgba(44, 38, 34, 0.10),
    0 40px 90px rgba(44, 38, 34, 0.07);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  overflow: hidden;
}

/* Soft warm light pooling from the accent — atmosphere, not neon */
.ob-panel-card::before {
  content: '';
  position: absolute;
  inset: -40% -30% auto -20%;
  height: 70%;
  background: radial-gradient(ellipse 55% 60% at 30% 20%, var(--ob-accent-glow) 0%, transparent 62%);
  opacity: 0.55;
  pointer-events: none;
  animation: ob-breathe 14s var(--ease-in-out, ease-in-out) infinite alternate;
}
@keyframes ob-breathe {
  from { transform: translate3d(0, 0, 0) scale(1); opacity: 0.45; }
  to   { transform: translate3d(2%, 1.5%, 0) scale(1.06); opacity: 0.6; }
}

/* The tall accent spine — the per-track signal, anchored to the edge */
.ob-spine {
  position: absolute;
  top: clamp(2rem, 4vw, 3.5rem);
  bottom: clamp(2rem, 4vw, 3.5rem);
  left: clamp(1.4rem, 2.4vw, 2rem);
  width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, var(--ob-accent) 0%, var(--ob-accent-2) 100%);
  box-shadow: 0 0 16px var(--ob-accent-glow);
}

/* --- Brand wordmark --- */
.ob-brand {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  z-index: 1;
}
.ob-wordmark {
  font-family: var(--font-display);
  font-weight: var(--font-bold, 700);
  font-size: var(--text-lg, 1.125rem);
  letter-spacing: -0.01em;
  color: var(--text-primary, #2c2622);
}
.ob-wordmark::first-letter { color: var(--ob-accent-2); }
.ob-brand-sub {
  font-family: var(--font-body);
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-medium, 500);
  line-height: var(--leading-snug, 1.375);
  color: var(--text-secondary, #4a4440);
  text-wrap: balance;
  max-width: 26ch;
}

/* --- The 17-year proof: an editorial centrepiece, not a caption --- */
.ob-proof {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: clamp(0.75rem, 1.6vw, 1.25rem);
  margin-top: auto;
  z-index: 1;
  animation: ob-rise 0.8s var(--ease-out-expo, ease) 0.1s both;
}
.ob-proof-num {
  font-family: var(--font-display);
  font-weight: var(--font-light, 300);
  font-size: clamp(5rem, 13vw, 9.5rem);
  line-height: 0.82;
  letter-spacing: -0.04em;
  color: var(--text-primary, #2c2622);
  background: linear-gradient(160deg, var(--ob-accent-2) 0%, var(--ob-accent-ink) 70%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.ob-proof-words {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding-top: 0.4em;
}
.ob-proof-years {
  font-family: var(--font-display);
  font-weight: var(--font-bold, 700);
  font-size: var(--text-2xl, 1.5rem);
  letter-spacing: -0.02em;
  color: var(--text-primary, #2c2622);
}
.ob-proof-line {
  font-family: var(--font-body);
  font-weight: var(--font-medium, 500);
  font-size: var(--text-sm, 0.875rem);
  line-height: var(--leading-snug, 1.375);
  color: var(--text-secondary, #4a4440);
}

/* --- Evolving line — the panel "breathes" across the three steps --- */
.ob-evolve {
  position: relative;
  z-index: 1;
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-base, 1rem);
  line-height: var(--leading-relaxed, 1.625);
  color: var(--text-secondary, #4a4440);
  max-width: 34ch;
}
.ob-evolve strong { color: var(--ob-accent-ink); font-weight: var(--font-semibold, 600); }

/* --- Shared step marker (ONE system across all steps) --- */
.ob-marker {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.ob-marker-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: rgba(44, 38, 34, 0.16);
  transition: background var(--transition-base, 200ms ease), transform var(--transition-base, 200ms ease);
}
.ob-marker-dot.is-on {
  background: var(--ob-accent);
  transform: scale(1.15);
  box-shadow: 0 0 10px var(--ob-accent-glow);
}
.ob-marker-rail {
  flex: 1;
  height: 2px;
  border-radius: 999px;
  background: rgba(44, 38, 34, 0.10);
  overflow: hidden;
}
.ob-marker-fill {
  display: block;
  height: 100%;
  width: 33%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--ob-accent), var(--ob-accent-2));
  transition: width 0.55s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1));
}
.ob-panel.is-otp .ob-marker-fill { width: 66%; }
.ob-panel.is-done .ob-marker-fill { width: 100%; }

/* Panel evolving-line transition */
.ob-line-enter-active { transition: opacity 0.4s ease, transform 0.4s var(--ease-out-expo, ease); }
.ob-line-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.ob-line-enter-from { opacity: 0; transform: translateY(8px); }
.ob-line-leave-to { opacity: 0; transform: translateY(-6px); }

/* ----------------------------------------------------------------
 * RIGHT — the form column on warm canvas
 * ---------------------------------------------------------------- */
.ob-stage {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(2rem, 5vw, var(--space-12, 3rem)) clamp(1.5rem, 5vw, 4rem);
  min-height: 100vh;
  min-height: 100dvh;
}

.ob-step {
  width: 100%;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: var(--space-5, 1.25rem);
}

/* Step swap — a gentle "breath": settle in, lift out. */
.ob-swap-enter-active { transition: opacity 0.32s var(--ease-out-expo, ease), transform 0.32s var(--ease-out-expo, ease); }
.ob-swap-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.ob-swap-enter-from { opacity: 0; transform: translateY(14px) scale(0.985); }
.ob-swap-leave-to { opacity: 0; transform: translateY(-8px) scale(0.99); }

/* --- Trial line — warm prose, not a SaaS reward chip --- */
.ob-trial {
  margin: 0;
  font-family: var(--font-body);
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-semibold, 600);
  letter-spacing: 0.01em;
  color: var(--ob-accent-ink);
}
.ob-trial span { color: var(--text-muted, #8a8078); font-weight: var(--font-medium, 500); }
.ob-trial-quiet { color: var(--ssi-red, #c23a3a); }

.ob-title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: var(--font-bold, 700);
  font-size: clamp(1.75rem, 3.2vw, 2.25rem);
  line-height: var(--leading-tight, 1.25);
  letter-spacing: var(--tracking-tight, -0.025em);
  color: var(--text-primary, #2c2622);
  text-wrap: balance;
}
.ob-sub {
  margin: 0;
  font-size: var(--text-lg, 1.125rem);
  line-height: var(--leading-relaxed, 1.625);
  color: var(--text-secondary, #4a4440);
}
.ob-sub strong { color: var(--text-primary, #2c2622); font-weight: var(--font-semibold, 600); }
.ob-date {
  font-weight: var(--font-semibold, 600);
  color: var(--ssi-red, #c23a3a);
}
.ob-muted {
  margin: 0;
  color: var(--text-muted, #8a8078);
  font-size: var(--text-sm, 0.875rem);
}

/* --- Fields --- */
.ob-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 0.5rem);
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.ob-langset { gap: var(--space-3, 0.75rem); }
.ob-lang-search { margin-bottom: var(--space-1, 0.25rem); }
.ob-label {
  padding: 0;
  font-family: var(--font-body);
  font-size: var(--text-base, 1rem);
  font-weight: var(--font-medium, 500);
  color: var(--text-secondary, #4a4440);
  text-transform: none;
  letter-spacing: 0;
}

/* Real frost material on the inputs (not flat admin depth) */
.ob-input {
  width: 100%;
  padding: 0.9rem 1rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.78));
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg, 0.75rem);
  font-family: var(--font-body);
  font-size: var(--text-base, 1rem);
  color: var(--text-primary, #2c2622);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 1px 2px rgba(44, 38, 34, 0.05),
    0 6px 16px rgba(44, 38, 34, 0.05);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
.ob-input::placeholder { color: var(--text-muted, #b5aea6); }
.ob-input:focus,
.ob-input:focus-visible {
  outline: none;
  border-color: var(--ob-accent-2);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 0 0 3px var(--ob-accent-soft),
    0 6px 18px rgba(44, 38, 34, 0.08);
}

/* --- Single pre-claimed hero card (single-language tracks) --- */
.ob-claim {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: var(--space-6, 1.5rem);
}
.ob-claim.is-claimed {
  background: linear-gradient(180deg, var(--ob-accent-soft), rgba(255, 255, 255, 0.66));
  border: 1px solid color-mix(in srgb, var(--ob-accent) 45%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 1px 2px rgba(44, 38, 34, 0.06),
    0 10px 28px rgba(44, 38, 34, 0.10),
    0 0 0 1px color-mix(in srgb, var(--ob-accent) 30%, transparent);
}
.ob-claim-eyebrow {
  font-family: var(--font-body);
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-medium, 500);
  color: var(--text-muted, #8a8078);
}
.ob-claim-endonym {
  font-family: var(--font-display);
  font-weight: var(--font-bold, 700);
  font-size: var(--text-4xl, 2.25rem);
  line-height: 1.1;
  letter-spacing: var(--tracking-tight, -0.025em);
  color: var(--text-primary, #2c2622);
}
.ob-claim-echo {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-semibold, 600);
  color: var(--ob-accent-ink);
}
.ob-claim-check {
  position: absolute;
  top: var(--space-5, 1.25rem);
  right: var(--space-5, 1.25rem);
  width: 28px;
  height: 28px;
  padding: 5px;
  border-radius: 50%;
  background: var(--ob-accent);
  fill: none;
  stroke: #fff;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  box-shadow: 0 2px 8px var(--ob-accent-glow);
}

/* Warm word-chip, NOT a 9px mono techy pill */
.ob-beta {
  font-family: var(--font-body);
  font-size: var(--text-xs, 0.75rem);
  font-weight: var(--font-semibold, 600);
  letter-spacing: 0.01em;
  text-transform: none;
  color: var(--ob-accent-ink);
  background: var(--ob-accent-soft);
  padding: 1px 8px;
  border-radius: var(--radius-full, 999px);
}
.ob-beta-sm { font-size: 0.7rem; padding: 0 6px; }

/* --- Language grid (native radios styled as tiles) --- */
.ob-lang-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3, 0.75rem);
}
.ob-lang-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: var(--space-4, 1rem) var(--space-4, 1rem) var(--space-4, 1rem) calc(var(--space-4, 1rem) + 16px);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.62);
  border: 1px solid rgba(44, 38, 34, 0.09);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.85),
    0 1px 2px rgba(44, 38, 34, 0.05);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.ob-lang-tile:hover {
  background: rgba(255, 255, 255, 0.82);
  transform: translateY(-2px);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 8px 24px rgba(44, 38, 34, 0.10);
}
.ob-lang-radio {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  pointer-events: none;
}
.ob-lang-dot {
  position: absolute;
  top: calc(var(--space-4, 1rem) + 5px);
  left: var(--space-4, 1rem);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #b5aea6;
}
.ob-lang-dot[data-lang="cym"] { background: #c23a3a; }
.ob-lang-dot[data-lang="gle"],
.ob-lang-dot[data-lang="gd"],
.ob-lang-dot[data-lang="gla"] { background: #15803d; }
.ob-lang-dot[data-lang="bre"] { background: #1d3a6b; }
.ob-lang-dot[data-lang="eus"] { background: #2e7d32; }
.ob-lang-dot[data-lang="cat"] { background: #b8923d; }
.ob-lang-endonym {
  font-family: var(--font-display);
  font-weight: var(--font-bold, 700);
  font-size: var(--text-2xl, 1.5rem);
  line-height: 1.1;
  letter-spacing: var(--tracking-tight, -0.025em);
  color: var(--text-primary, #2c2622);
  transition: color 0.2s ease;
}
.ob-lang-gloss {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--font-body);
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-muted, #8a8078);
}
.ob-lang-check {
  position: absolute;
  top: var(--space-3, 0.75rem);
  right: var(--space-3, 0.75rem);
  width: 24px;
  height: 24px;
  padding: 4px;
  border-radius: 50%;
  background: var(--ob-accent);
  fill: none;
  stroke: #fff;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
  transform: scale(0.5);
  box-shadow: 0 2px 8px var(--ob-accent-glow);
  transition: opacity 0.2s ease, transform 0.3s var(--ease-out-back, cubic-bezier(0.34, 1.56, 0.64, 1));
}

/* SELECTED — unmistakable: tonal fill + gold-ink endonym + ring + check */
.ob-lang-tile.is-selected {
  background: linear-gradient(180deg, var(--ob-accent-soft), rgba(255, 255, 255, 0.7));
  border-color: color-mix(in srgb, var(--ob-accent) 55%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 8px 24px rgba(44, 38, 34, 0.10),
    0 0 0 2px var(--ob-accent);
}
.ob-lang-tile.is-selected .ob-lang-endonym { color: var(--ob-accent-ink); }
.ob-lang-tile.is-selected .ob-lang-check { opacity: 1; transform: scale(1); }

/* Keyboard focus follows the native radio */
.ob-lang-tile:focus-within {
  border-color: var(--ob-accent-2);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 0 0 3px var(--ob-accent-soft),
    0 8px 24px rgba(44, 38, 34, 0.10);
}

/* --- OTP — one bound input + six cells, ch-based so digits stay put --- */
.ob-otp-wrap {
  --ob-cell: clamp(2.6rem, 13vw, 3.4rem);
  --ob-gap: clamp(0.3rem, 1.4vw, 0.6rem);
  position: relative;
  display: flex;
  justify-content: center;
  height: calc(var(--ob-cell) * 1.25);
}
.ob-otp-cells {
  position: absolute;
  inset: 0;
  display: flex;
  justify-content: center;
  gap: var(--ob-gap);
  pointer-events: none;
}
.ob-otp-cell {
  width: var(--ob-cell);
  height: 100%;
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg, 0.75rem);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.78));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 1px 2px rgba(44, 38, 34, 0.05);
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease, transform 0.2s ease;
}
.ob-otp-cell.is-set {
  border-color: color-mix(in srgb, var(--ob-accent) 55%, transparent);
  background: linear-gradient(180deg, var(--ob-accent-soft), rgba(255, 255, 255, 0.82));
}
/* The input is laid out to match the cells exactly: each glyph box is
   one cell wide, separated by the same gap — so digits never drift. */
.ob-otp-input {
  position: relative;
  z-index: 1;
  width: calc(var(--ob-cell) * 6 + var(--ob-gap) * 5);
  height: 100%;
  border: none;
  background: transparent;
  outline: none;
  text-align: justify;
  text-align-last: justify;
  padding: 0 calc(var(--ob-cell) / 2 - 0.5ch);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(1.4rem, 6vw, 1.85rem);
  font-weight: var(--font-semibold, 600);
  letter-spacing: 0;
  color: var(--text-primary, #2c2622);
  caret-color: var(--ob-accent-2);
}
.ob-otp-input::placeholder {
  color: var(--text-muted, #b5aea6);
  letter-spacing: 0;
}
.ob-otp-wrap:focus-within .ob-otp-cell:not(.is-set) {
  border-color: var(--ob-accent-2);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.9),
    0 0 0 1px var(--ob-accent-2);
}
.ob-otp-wrap.is-full .ob-otp-cell {
  border-color: var(--ob-accent);
  background: linear-gradient(180deg, var(--ob-accent-soft), rgba(255, 255, 255, 0.85));
  transform: translateY(-1px);
}

/* --- Done: arrival seal + sound ripple --- */
.ob-step-done { align-items: flex-start; }
.ob-arrival {
  position: relative;
  width: 76px;
  height: 76px;
}
.ob-arrival-ripple {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid var(--ob-accent);
  opacity: 0;
  animation: ob-ripple 1.4s var(--ease-out-expo, ease) 0.35s 2;
}
.ob-arrival-ring { width: 76px; height: 76px; position: relative; }
.ob-arrival-circle {
  fill: none;
  stroke: var(--ob-accent);
  stroke-width: 4;
  stroke-dasharray: 277;
  stroke-dashoffset: 277;
  animation: ob-draw 0.7s var(--ease-out-expo, ease) 0.1s forwards;
}
.ob-arrival-tick {
  fill: none;
  stroke: var(--ob-accent-ink);
  stroke-width: 5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 60;
  stroke-dashoffset: 60;
  animation: ob-draw 0.4s var(--ease-out-back, ease) 0.55s forwards;
}
@keyframes ob-draw { to { stroke-dashoffset: 0; } }
@keyframes ob-ripple {
  from { opacity: 0.5; transform: scale(0.8); }
  to   { opacity: 0; transform: scale(1.9); }
}

.ob-finishing {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
  padding-top: var(--space-3, 0.75rem);
  border-top: 1px solid rgba(44, 38, 34, 0.1);
}
.ob-finishing-head {
  margin: 0;
  font-size: var(--text-sm, 0.875rem);
  font-weight: var(--font-semibold, 600);
  color: var(--text-secondary, #4a4440);
}
.ob-finishing-head span { color: var(--text-muted, #8a8078); font-weight: var(--font-normal, 400); }

/* --- Errors, fine print, links --- */
.ob-error {
  padding: var(--space-3, 0.75rem) var(--space-4, 1rem);
  background: rgba(194, 58, 58, 0.08);
  border: 1px solid rgba(194, 58, 58, 0.22);
  border-radius: var(--radius-lg, 0.75rem);
  color: var(--ssi-red, #c23a3a);
  font-size: var(--text-sm, 0.875rem);
  line-height: var(--leading-snug, 1.375);
}
.ob-fine {
  margin: 0;
  color: var(--text-muted, #8a8078);
  font-size: var(--text-xs, 0.75rem);
  text-align: center;
}
.ob-fine-left { text-align: left; }

.ob-links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3, 0.75rem);
}
.ob-link {
  background: none;
  border: none;
  padding: 4px 2px;
  color: var(--text-muted, #8a8078);
  font-family: var(--font-body);
  font-size: var(--text-sm, 0.875rem);
  cursor: pointer;
  transition: color 0.15s ease;
}
.ob-link:hover { color: var(--ssi-red, #c23a3a); }
.ob-link:disabled { opacity: 0.5; cursor: default; }
.ob-link:focus-visible {
  outline: none;
  color: var(--ssi-red, #c23a3a);
  text-decoration: underline;
}
.ob-link-sep { color: var(--text-muted, #b5aea6); }

@keyframes ob-rise {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ----------------------------------------------------------------
 * RESPONSIVE — panel collapses to a rich header band, never dropped
 * ---------------------------------------------------------------- */
@media (max-width: 900px) {
  .onboard {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }
  .ob-panel {
    position: relative;
    min-height: 0;
    padding: clamp(1rem, 4vw, 1.75rem);
  }
  .ob-panel-card {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: clamp(1rem, 3vw, 1.75rem);
    padding: clamp(1.5rem, 5vw, 2.25rem);
    padding-left: clamp(2rem, 6vw, 3rem);
  }
  .ob-brand { flex: 1 1 14rem; }
  .ob-proof { margin-top: 0; }
  .ob-proof-num { font-size: clamp(3.5rem, 16vw, 5.5rem); }
  .ob-evolve { flex: 1 1 100%; max-width: none; }
  .ob-marker { flex: 1 1 100%; }
  .ob-spine {
    top: clamp(1.5rem, 5vw, 2.25rem);
    bottom: clamp(1.5rem, 5vw, 2.25rem);
    left: clamp(1rem, 3vw, 1.4rem);
  }
  .ob-stage {
    min-height: 0;
    padding: clamp(1.75rem, 7vw, 2.75rem);
    align-items: flex-start;
  }
  .ob-step { max-width: none; }
  .ob-panel-card::before { animation: none; }
}

@media (max-width: 440px) {
  .ob-lang-grid { grid-template-columns: 1fr; }
  .ob-proof-line { display: none; }
}

/* ----------------------------------------------------------------
 * REDUCED MOTION — everything becomes an instant, calm swap
 * ---------------------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .ob-panel-card::before,
  .ob-proof,
  .ob-arrival-ripple { animation: none !important; }
  .ob-arrival-circle,
  .ob-arrival-tick { stroke-dashoffset: 0; animation: none !important; }
  .ob-marker-fill { transition: none; }
  .ob-swap-enter-active,
  .ob-swap-leave-active { transition: opacity 0.12s linear; }
  .ob-swap-enter-from,
  .ob-swap-leave-to { transform: none; }
  .ob-line-enter-active,
  .ob-line-leave-active { transition: opacity 0.12s linear; }
  .ob-line-enter-from,
  .ob-line-leave-to { transform: none; }
  .ob-lang-check { transition: opacity 0.12s linear; }
  .ob-lang-tile:hover { transform: none; }
}
</style>
