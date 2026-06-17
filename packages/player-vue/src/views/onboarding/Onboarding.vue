<script setup lang="ts">
import { ref, computed, inject, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import {
  TRACKS,
  coursesForTrack,
  isFreeTier,
  targetLangName,
  targetLabel,
  knownLangName,
  courseLabel,
  type OnboardingTrack,
  type LiveCourse,
} from '@/lib/onboardingTracks'
import '@/styles/schools-tokens.css'

// track is set per route (/schools1 /schools2 /tutors) via router props.
const props = defineProps<{ track: OnboardingTrack }>()
const supabase = inject('supabase', ref(null)) as any

const cfg = computed(() => TRACKS[props.track])

// schools1 (/schools1, route name 'onboard-school-1') is the HERITAGE-languages
// door: it must surface Welsh + Irish first and must NOT default to English. The
// other school door (/schools2) and the tutor door keep the English-first default.
// Keyed off the route NAME because both school doors share track: 'school'.
const route = useRoute()
const isHeritageDoor = computed(() => route.name === 'onboard-school-1')
const HERITAGE_LANGS = ['cym', 'gle'] // Welsh, Irish (Welsh N/S are course variants under 'cym')

type Step = 'choose' | 'otp' | 'done'
const step = ref<Step>('choose')

const liveCourses = ref<LiveCourse[]>([])
// Pick the TARGET (taught) language FIRST — most schools/tutors teach English,
// so it's the dropdown, defaulted to English. The list below then shows the
// KNOWN languages we teach that target FROM (the learners' existing language).
const trackCourses = computed(() => coursesForTrack(liveCourses.value, props.track))
const availableTargetLangs = computed(() => {
  const seen = new Set<string>()
  for (const c of trackCourses.value) if (c.target_lang) seen.add(c.target_lang)
  return Array.from(seen)
})
const targetLang = ref('eng')
const courses = computed(() =>
  trackCourses.value.filter((c) => c.target_lang === targetLang.value)
)
// A learner-language row reads as the plain known-language name ("English") —
// UNLESS the chosen target has 2+ course variants for that SAME known_lang (e.g.
// cym → North/South Welsh, both eng), where two bare "English" rows would be
// indistinguishable. Then we disambiguate with the target variant: "English —
// North Welsh". Used by both list renderings + search.
function rowLabel(c: LiveCourse): string {
  const name = knownLangName(c.known_lang)
  const sameKnown = courses.value.filter((x) => x.known_lang === c.known_lang)
  if (sameKnown.length < 2) return name
  return `${name} — ${targetLabel(c)}`
}
// Search-first only when the list is long; otherwise browse the tiles.
const langQuery = ref('')
const showSearch = computed(() => courses.value.length > 8)
const visibleCourses = computed(() => {
  const q = langQuery.value.trim().toLowerCase()
  if (!q) return courses.value // browse by default; search filters
  return courses.value.filter(
    (c) =>
      rowLabel(c).toLowerCase().includes(q) ||
      knownLangName(c.known_lang).toLowerCase().includes(q) ||
      (c.known_lang || '').toLowerCase().includes(q) ||
      c.course_code.toLowerCase().includes(q)
  )
})
const selectedCourse = ref('')
// Changing the taught language invalidates the learner-language choice + search,
// THEN re-runs the auto-select (a single-learner-language target should collapse
// straight to its one card even when the user switches target after mount).
watch(targetLang, () => {
  // Heritage door selects courses straight from the dropdown — its targetLang
  // changes are part of committing a course, so don't clear that selection.
  if (isHeritageDoor.value) return
  selectedCourse.value = ''
  langQuery.value = ''
  maybeAutoSelect()
})
// Auto-select the lone learner-language whenever the choice is unambiguous:
//   (a) the chosen target offers exactly ONE learner-language (courses.length===1)
//   (b) a search narrows the list to exactly ONE result
// Either way the user shouldn't have to click the only option. Multiple options
// still require an explicit click — browsing/typing never commits a wider choice.
function maybeAutoSelect() {
  // The heritage door has no learner-language list to auto-resolve — selection is
  // explicit via the course-level dropdown, so never auto-commit here.
  if (isHeritageDoor.value) return
  if (selectedCourse.value) return
  if (courses.value.length === 1) {
    selectedCourse.value = courses.value[0].course_code
  } else if (langQuery.value.trim() && visibleCourses.value.length === 1) {
    selectedCourse.value = visibleCourses.value[0].course_code
  }
}
// Watch both lists: courses changes when the target (or catalogue) changes (case
// a); visibleCourses changes as the user types (case b). { immediate } covers the
// catalogue arriving after mount.
watch([courses, visibleCourses], maybeAutoSelect, { immediate: true })

// Custom taught-language dropdown (English pinned first, then A–Z). The dropdown
// is a LANGUAGE picker, so the label is the language name ("Welsh"), NOT a course
// display name — otherwise multi-course targets leaked dialect labels (cym →
// "South Welsh", which hid Welsh from anyone scanning under "W").
const targetOpen = ref(false)
function targetName(code: string): string {
  return targetLangName(code)
}
// The taught-language dropdown. Each option has a stable `value` (the key the
// dropdown selects by), a display `name`, and — on the heritage door only — the
// `courseCode` it commits directly.
//
// HERITAGE DOOR (schools1): the dropdown is COURSE-level, not language-level —
// Welsh (North), Welsh (South), Irish are offered as three separate entries
// (Tom's call: a collapsed "Welsh" hides the dialect choice). Picking one commits
// that course directly. Pinned in HERITAGE_LANGS order, then by label.
// EVERY OTHER DOOR: language-level as before (English pinned first, then A–Z),
// with the learner-language list below resolving the specific course.
const targetOptions = computed(() => {
  if (isHeritageDoor.value) {
    return trackCourses.value
      .filter((c) => HERITAGE_LANGS.includes(c.target_lang))
      .map((c) => ({
        value: c.course_code,
        name: targetLabel(c),
        courseCode: c.course_code,
        lang: c.target_lang,
      }))
      .sort(
        (a, b) =>
          HERITAGE_LANGS.indexOf(a.lang) - HERITAGE_LANGS.indexOf(b.lang) ||
          a.name.localeCompare(b.name)
      )
  }
  const rank = (code: string) => (code === 'eng' ? -1 : 1)
  return [...availableTargetLangs.value]
    .map((code) => ({ value: code, name: targetName(code), courseCode: null as string | null, lang: code }))
    .sort((a, b) => rank(a.value) - rank(b.value) || a.name.localeCompare(b.name))
})
// There will eventually be hundreds of target languages, so the open menu is
// filterable by name (mirrors the learner-language search below).
const targetQuery = ref('')
const visibleTargetOptions = computed(() => {
  const q = targetQuery.value.trim().toLowerCase()
  if (!q) return targetOptions.value
  return targetOptions.value.filter(
    (o) => o.name.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
  )
})
// The dropdown button's current-value label. On the heritage door it reflects the
// chosen course variant (or a prompt before one is picked); elsewhere the language.
const pickerValueLabel = computed(() => {
  if (isHeritageDoor.value) {
    return selectedCourseObj.value ? targetLabel(selectedCourseObj.value) : 'Choose a language'
  }
  return targetName(targetLang.value)
})
function isOptionActive(o: { value: string; courseCode: string | null }): boolean {
  return isHeritageDoor.value ? o.courseCode === selectedCourse.value : o.value === targetLang.value
}
function openTarget() {
  targetOpen.value = !targetOpen.value
  if (targetOpen.value) targetQuery.value = ''
}
function selectTarget(value: string) {
  const opt = targetOptions.value.find((o) => o.value === value)
  if (opt?.courseCode) {
    // Heritage door: the dropdown commits the course variant directly. Set the
    // language first (its watch is a no-op on this door), then the course.
    targetLang.value = opt.lang
    selectedCourse.value = opt.courseCode
  } else {
    targetLang.value = value
  }
  targetOpen.value = false
}
const email = ref('')
const otp = ref('')
// Keep the code to digits only, max 6 — so pasting "8 3 2 7 2 2", "832722\n", or
// any stray characters always normalises cleanly into the six boxes.
watch(otp, (v) => {
  const clean = (v || '').replace(/\D/g, '').slice(0, 6)
  if (clean !== v) otp.value = clean
})
const busy = ref(false)
const error = ref('')
const otpVerified = ref(false)
const coursesLoaded = ref(false)

// done-step state
const trial = ref<{ course_code: string; expires_at: string; days: number } | null>(null)
const redirectTo = ref('/')
const displayName = ref('')
const institution = ref('')
// Returning user (already had an account for this track) — skip the
// finishing-details step and just welcome them back into their dashboard.
const isReturning = ref(false)

const emailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value))
const canSend = computed(() => emailValid.value && !!selectedCourse.value && !busy.value)
const selectedCourseLabel = computed(() => {
  const c = trackCourses.value.find((x) => x.course_code === selectedCourse.value)
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

// The offer is per-COURSE (its pricing_tier), not per-door: Free = free, Premium = trial.
const selectedCourseObj = computed(
  () => trackCourses.value.find((x) => x.course_code === selectedCourse.value) || null
)
// Platform-trial length is decided per course, server-side too (provision.ts):
// Welsh OR any free/community course → 1 year; every other (premium) course →
// 1 month. We don't surface "free vs premium" upfront — the learner picks a
// language, then we tell them their trial.
function trialDaysFor(course: { course_code?: string; pricing_tier?: string } | null): number {
  if (!course) return 30
  const isWelsh = (course.course_code || '').startsWith('cym')
  return isWelsh || isFreeTier(course as any) ? 365 : 30
}
const selectedTrialDays = computed(() => trialDaysFor(selectedCourseObj.value))
const offerLine = computed(() => {
  if (!selectedCourseObj.value) return ''
  return `Free for ${selectedTrialDays.value} days — no card needed`
})

onMounted(async () => {
  try {
    const res = await fetch('/api/courses/available')
    if (res.ok) liveCourses.value = await res.json()
  } catch {
    // Non-fatal — the picker just shows nothing until the catalogue loads.
  } finally {
    coursesLoaded.value = true
  }
  // Default the taught language. The heritage door (schools1) defaults to the first
  // available heritage language (Welsh, then Irish) and NEVER to English; every other
  // door defaults to English (most schools/tutors teach English). Either way, fall
  // back to the first available target if the preferred one isn't deployed.
  const preferred = isHeritageDoor.value ? HERITAGE_LANGS : ['eng']
  targetLang.value =
    preferred.find((code) => availableTargetLangs.value.includes(code)) ||
    availableTargetLangs.value[0] ||
    'eng'
  // Preselect when the chosen target offers exactly one learner-language. The
  // targetLang watch above re-runs maybeAutoSelect when the value actually
  // changes; call it directly too in case it stayed 'eng' (no change → no watch).
  maybeAutoSelect()
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
    // Show the PLATFORM trial window (the school/tutor's free period: 365 or 30
    // days) on the success screen — that's the one that decides when they pay.
    trial.value = data.platform_trial || data.trial
    isReturning.value = !!data.existing
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
          <img class="ob-wordmark" src="/ssi-web-logo.svg" alt="SaySomethingin" />
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
          <p v-if="offerLine" class="ob-trial">{{ offerLine }}</p>

          <h1 class="ob-title">Which language will you teach?</h1>
          <p class="ob-sub">{{ cfg.blurb }}</p>

          <!-- Taught-language switcher — defaulted to English; a custom on-brand
               menu (not the native OS select). Pick the language you'll teach,
               then the list shows who you can teach it to. -->
          <div
            v-if="targetOptions.length > 1"
            class="ob-known-wrap"
            @keyup.escape="targetOpen = false"
          >
            <button
              type="button"
              class="ob-known"
              :aria-expanded="targetOpen"
              aria-haspopup="listbox"
              @click="openTarget"
            >
              <span class="ob-known-label">You'll teach</span>
              <span class="ob-known-value">{{ pickerValueLabel }}</span>
              <svg class="ob-known-caret" :class="{ open: targetOpen }" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 8l5 5 5-5" />
              </svg>
            </button>
            <div v-if="targetOpen" class="ob-known-backdrop" @click="targetOpen = false"></div>
            <div v-if="targetOpen" class="ob-known-menu" role="listbox">
              <!-- Filterable: hundreds of target languages, so the open menu has
                   its own search (mirrors the learner-language search). -->
              <input
                v-model="targetQuery"
                type="search"
                class="ob-input ob-known-search"
                placeholder="Search languages…"
                aria-label="Search taught languages"
                autofocus
              />
              <ul class="ob-known-opts">
                <li v-for="o in visibleTargetOptions" :key="o.value">
                  <button
                    type="button"
                    class="ob-known-opt"
                    :class="{ 'is-on': isOptionActive(o) }"
                    role="option"
                    :aria-selected="isOptionActive(o)"
                    @click="selectTarget(o.value)"
                  >
                    <span>{{ o.name }}</span>
                    <svg v-if="isOptionActive(o)" class="ob-known-tick" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12.5l4.2 4.2L19 7" />
                    </svg>
                  </button>
                </li>
                <li v-if="!visibleTargetOptions.length" class="ob-known-empty">
                  No languages match “{{ targetQuery }}”.
                </li>
              </ul>
            </div>
          </div>

          <!-- Once a language is chosen, collapse the whole picker to the ONE
               selected language. (Single-language tracks auto-select, so this
               shows immediately for them too.) -->
          <div v-if="selectedCourseObj" class="ob-field">
            <FrostCard variant="tile" class="ob-claim is-claimed">
              <span class="ob-claim-eyebrow">You're teaching</span>
              <span class="ob-claim-endonym">{{ courseLabel(selectedCourseObj) }}</span>
              <span class="ob-claim-echo">
                Free for {{ selectedTrialDays }} days
              </span>
              <svg class="ob-claim-check" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.2 4.2L19 7" />
              </svg>
              <button
                v-if="isHeritageDoor || courses.length > 1"
                type="button"
                class="ob-claim-change"
                @click="selectedCourse = ''"
              >Change language</button>
            </FrostCard>
          </div>

          <!-- The learner-language list resolves the specific course on every door
               EXCEPT heritage (schools1), where the course-level dropdown above
               already commits the variant directly. -->
          <fieldset v-else-if="!isHeritageDoor" class="ob-field ob-langset">
            <legend class="ob-label">Your learners speak</legend>

            <!-- LONG list (tutors / non-heritage): browse a compact, scrollable
                 list AND filter with the search box. -->
            <template v-if="showSearch">
              <input
                v-model="langQuery"
                type="search"
                class="ob-input ob-lang-search"
                placeholder="Search languages…"
                aria-label="Search languages"
              />
              <div v-if="visibleCourses.length" class="ob-lang-list" role="radiogroup">
                <label
                  v-for="c in visibleCourses"
                  :key="c.course_code"
                  class="ob-lang-row"
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
                  <span class="ob-lang-dot" :data-lang="c.known_lang"></span>
                  <span class="ob-row-name">{{ rowLabel(c) }}</span>
                  <svg class="ob-row-check" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.2 4.2L19 7" />
                  </svg>
                </label>
              </div>
              <p v-else-if="!coursesLoaded" class="ob-muted">Loading languages…</p>
              <p v-else-if="langQuery" class="ob-muted">No languages match “{{ langQuery }}”.</p>
              <p v-else class="ob-muted">No languages available for this signup yet.</p>
            </template>

            <!-- SHORT showcase (heritage set): a few considered cards. -->
            <template v-else>
              <div v-if="courses.length" class="ob-lang-grid">
                <label
                  v-for="c in courses"
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
                  <span class="ob-lang-dot" :data-lang="c.known_lang"></span>
                  <span class="ob-lang-endonym">{{ rowLabel(c) }}</span>
                  <svg class="ob-lang-check" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.2 4.2L19 7" />
                  </svg>
                </label>
              </div>
              <p v-else-if="!coursesLoaded" class="ob-muted">Loading languages…</p>
              <p v-else class="ob-muted">No languages available for this signup yet.</p>
            </template>
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
              <!-- Each digit is rendered IN its own cell (driven by the model),
                   so alignment can't drift. The input above is transparent and
                   only captures typing/paste. -->
              <div class="ob-otp-cells" aria-hidden="true">
                <span
                  v-for="i in 6"
                  :key="i"
                  class="ob-otp-cell"
                  :class="{ 'is-set': otp.length >= i }"
                >{{ otp[i - 1] || '' }}</span>
              </div>
              <input
                id="ob-otp"
                v-model="otp"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                class="ob-otp-input"
                aria-label="Confirmation code"
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

          <!-- Returning user: straight welcome-back, no finishing form. -->
          <template v-if="isReturning">
            <h1 class="ob-title ob-title-done">Welcome back</h1>
            <p class="ob-sub">You're already set up — let's get you back to your dashboard.</p>
            <div v-if="error" class="ob-error" role="alert">{{ error }}</div>
            <Button variant="primary" size="lg" block :loading="busy" @click="continueIn">
              Go to my dashboard
            </Button>
          </template>

          <!-- New user: confirm + optional details. -->
          <template v-else>
            <h1 class="ob-title ob-title-done">{{ selectedCourseLabel }} is ready</h1>
            <p class="ob-sub">
              Free until <strong class="ob-date">{{ trialEndLabel }}</strong>. No card needed to start.
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
          </template>
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
  /* The app shell pins body { overflow: hidden } (style.css) for the player, so
     this standalone route must be its OWN scroll container — otherwise the form
     column (email + "Send my code") below the fold is unreachable on mobile.
     Same pattern as the teacher-insights .tiv-scroll. */
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
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
.onboard.track-school {
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
  display: block;
  height: 36px;
  width: auto;
}
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
  flex-direction: column;
  /* Top-aligned, not centred: flex centring CLIPS an over-tall form so its bottom
     can't be scrolled to. Top-align + page scroll keeps everything reachable. */
  align-items: center;
  justify-content: flex-start;
  padding: clamp(2.5rem, 6vh, 5rem) clamp(1.5rem, 5vw, 4rem) clamp(2rem, 5vh, 4rem);
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

/* Source-language switcher — a custom on-brand menu (not the native OS select) */
.ob-known-wrap { position: relative; align-self: flex-start; }
.ob-known {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2, 0.5rem);
  padding: 7px 10px 7px 16px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-full, 999px);
  font-family: var(--font-body);
  font-size: var(--text-sm, 0.875rem);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}
.ob-known:hover { background: rgba(255, 255, 255, 0.92); border-color: rgba(44, 38, 34, 0.2); }
.ob-known:focus-visible {
  outline: none;
  border-color: var(--ob-accent-2);
  box-shadow: 0 0 0 3px var(--ob-accent-soft);
}
.ob-known-label { color: var(--text-muted, #6a6360); }
.ob-known-value { color: var(--ob-accent-ink); font-weight: var(--font-semibold, 600); }
.ob-known-caret {
  width: 16px; height: 16px;
  fill: none; stroke: var(--text-muted, #6a6360);
  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
  transition: transform 0.2s ease;
}
.ob-known-caret.open { transform: rotate(180deg); }
.ob-known-backdrop { position: fixed; inset: 0; z-index: 40; }
.ob-known-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 240px;
  margin: 0;
  padding: 6px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(255, 250, 245, 0.96));
  border: 1px solid rgba(44, 38, 34, 0.12);
  border-radius: var(--radius-lg, 16px);
  box-shadow: 0 20px 48px rgba(73, 3, 0, 0.18), 0 4px 12px rgba(73, 3, 0, 0.08);
  -webkit-backdrop-filter: blur(14px) saturate(150%);
  backdrop-filter: blur(14px) saturate(150%);
}
/* Search box pinned at the top; only the option list scrolls beneath it. */
.ob-known-search {
  margin-bottom: 6px;
  padding: 0.55rem 0.75rem;
  font-size: var(--text-sm, 0.875rem);
}
.ob-known-opts {
  max-height: min(320px, 52vh);
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
  -webkit-overflow-scrolling: touch;
}
.ob-known-empty {
  padding: 9px 12px;
  font-family: var(--font-body);
  font-size: var(--text-sm, 0.875rem);
  color: var(--text-muted, #8a8078);
}
.ob-known-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  padding: 9px 12px;
  border: none;
  background: transparent;
  border-radius: var(--radius-md, 8px);
  font-family: var(--font-body);
  font-size: var(--text-base, 1rem);
  color: var(--text-primary, #0f1212);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
}
.ob-known-opt:hover { background: var(--ob-accent-soft); }
.ob-known-opt:focus-visible {
  outline: none;
  background: var(--ob-accent-soft);
  box-shadow: inset 0 0 0 2px var(--ob-accent-2);
}
.ob-known-opt.is-on { color: var(--ob-accent-ink); font-weight: var(--font-semibold, 600); }
.ob-known-tick {
  width: 18px; height: 18px; flex: none;
  fill: none; stroke: var(--ob-accent-ink);
  stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round;
}
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

.ob-claim-change {
  margin-top: var(--space-3, 0.75rem);
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 0.85rem;
  color: var(--ob-accent-ink);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.ob-claim-change:hover { color: var(--ob-accent-2); }

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

/* Free-tier tag — the attractive signal (paid courses just have no tag) */
.ob-tier {
  font-family: var(--font-body);
  font-size: var(--text-xs, 0.75rem);
  font-weight: var(--font-semibold, 600);
  color: #15803d;
  background: rgba(21, 128, 61, 0.10);
  padding: 1px 8px;
  border-radius: var(--radius-full, 999px);
}

/* --- Language grid (native radios styled as tiles) --- */
.ob-lang-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3, 0.75rem);
}

/* Long set (tutors / broad): a compact, scannable, SCROLLABLE list — browse it or
   filter with the search box. Bounded height so the email + button stay in view. */
.ob-lang-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: clamp(220px, 40vh, 420px);
  overflow-y: auto;
  padding: 2px;
  margin: 0 -2px;
  -webkit-overflow-scrolling: touch;
}
.ob-lang-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 9px 14px;
  border-radius: var(--radius-md, 8px);
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(44, 38, 34, 0.08);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.ob-lang-row:hover { background: rgba(255, 255, 255, 0.82); }
.ob-lang-row .ob-lang-dot { position: static; flex: none; width: 9px; height: 9px; }
.ob-row-name {
  font-family: var(--font-display);
  font-weight: 400;
  font-size: var(--text-lg, 1.125rem);
  line-height: 1.2;
  color: var(--text-primary, #0f1212);
}
.ob-row-check {
  margin-left: auto;
  width: 22px;
  height: 22px;
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
  transition: opacity 0.15s ease, transform 0.2s ease;
}
.ob-lang-row.is-selected {
  background: var(--ob-accent-soft);
  border-color: color-mix(in srgb, var(--ob-accent) 55%, transparent);
  box-shadow: 0 0 0 1px var(--ob-accent);
}
.ob-lang-row.is-selected .ob-row-name { color: var(--ob-accent-ink); }
.ob-lang-row.is-selected .ob-row-check { opacity: 1; transform: scale(1); }
.ob-lang-row:focus-within {
  border-color: var(--ob-accent-2);
  box-shadow: 0 0 0 2px var(--ob-accent-soft);
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
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(1.4rem, 6vw, 1.85rem);
  font-weight: var(--font-semibold, 600);
  color: var(--text-primary, #2c2622);
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
/* The input is a TRANSPARENT capture layer over the cells — the visible digits
   are rendered inside each .ob-otp-cell, so they can never drift out of their
   box. The input just holds focus + the value (and a faint caret). */
.ob-otp-input {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  outline: none;
  box-sizing: border-box;
  text-align: center;
  color: transparent;
  caret-color: transparent;
  cursor: pointer;
  font-size: clamp(1.4rem, 6vw, 1.85rem);
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

/* ================================================================
 * MATCH THE LANDING PAGES (saysomethingin.com) — extracted from the
 * deployed design system. Overrides the player tokens above so the
 * signup is a seamless continuation of the marketing site:
 *   Arsenal (serif display) + Open Sans (body); brandRed #db1e17,
 *   gold #fec902, deep red #490300, off-white #fdf5f5.
 * ================================================================ */
.onboard {
  --font-display: "Arsenal", "Georgia", "Times New Roman", serif;
  --font-body: "Open Sans", "Trebuchet MS", "Lucida Sans Unicode", "Lucida Grande", Arial, sans-serif;
  --ssi-red: #db1e17;
  --ssi-red-dark: #900600;
  --ssi-gold: #fec902;
  --ssi-gold-dark: #c99f00;
  --bg-primary: #fdf5f5;
  --text-primary: #0f1212;
  --text-secondary: #333333;
  --text-muted: #6a6360;
  --ob-accent: #fec902;
  --ob-accent-ink: #c99f00;
  --ob-accent-2: #db1e17;
  --ob-accent-soft: rgba(254, 201, 2, 0.18);
  --ob-accent-glow: rgba(254, 201, 2, 0.32);
}
.onboard.track-school {
  --ob-accent: #db1e17;
  --ob-accent-ink: #900600;
  --ob-accent-2: #fec902;
  --ob-accent-soft: rgba(219, 30, 23, 0.10);
  --ob-accent-glow: rgba(219, 30, 23, 0.24);
}
.onboard.track-tutor {
  --ob-accent: #c99f00;
  --ob-accent-ink: #900600;
  --ob-accent-2: #db1e17;
  --ob-accent-soft: rgba(254, 201, 2, 0.18);
  --ob-accent-glow: rgba(254, 201, 2, 0.30);
}
/* Arsenal reads as the landing's elegant serif at weight 400, not 700 */
.onboard .ob-title,
.onboard .ob-wordmark,
.onboard .ob-proof-years,
.onboard .ob-claim-endonym,
.onboard .ob-lang-endonym { font-weight: 400; }
/* Primary CTA — the landing's flat brandRed button, not the player gradient */
.onboard :deep(.btn-primary) { background: #db1e17; border-radius: 8px; }
.onboard :deep(.btn-primary:hover) { background: #900600; }
.onboard :deep(.btn-primary:active) { background: #490300; }
</style>
