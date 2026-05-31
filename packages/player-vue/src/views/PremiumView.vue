<script setup lang="ts">
import { ref, computed, inject, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FrostCard from '@/components/schools/shared/FrostCard.vue'
import Button from '@/components/schools/shared/Button.vue'
import AtmosphereBackdrop from '@/components/schools/shared/AtmosphereBackdrop.vue'
import LanguageFlag from '@/components/schools/shared/LanguageFlag.vue'
import { SignInModal } from '@/components/auth'
import { useAuthModal } from '@/composables/useAuthModal'
import { useI18n, getLanguageName, getLanguageEndonym } from '@/composables/useI18n'
import { getPaddle, paddleConfig } from '@/lib/paddle'
import '@/styles/schools-tokens.css'

const route = useRoute()
const router = useRouter()
const supabase = inject('supabase', ref(null)) as any
const auth = inject<any>('auth', null)
useI18n() // ensure locale reactivity for getLanguageName

const isAuthenticated = computed(() => auth?.isAuthenticated?.value ?? false)
const isAuthLoading = computed(() => auth?.isLoading?.value ?? false)

const { open: openAuth, close: closeAuth } = useAuthModal()

// When a signed-out visitor clicks "Start free trial", we open the sign-in
// modal and (on success) chain straight into Paddle checkout — saves them
// a second click and matches the obvious "Sign up → pay" mental model.
const pendingCheckout = ref(false)
const handleAuthSuccess = () => {
  closeAuth()
  if (pendingCheckout.value) {
    pendingCheckout.value = false
    // fetchSubscription runs in the onMounted block; trigger checkout
    // directly here since the modal close beats the auth state refresh.
    startCheckout()
  }
}
function handleSignedOutCta() {
  pendingCheckout.value = true
  openAuth()
}

interface Subscription {
  id: string
  status: string
  plan_name: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  provider: string
}

interface Course {
  course_code: string
  target_lang: string
  known_lang: string
  display_name: string
}

const subscription = ref<Subscription | null>(null)
const isLoadingSub = ref(true)
const isOpeningCheckout = ref(false)
const isPolling = ref(false)
const checkoutError = ref('')
const premiumCourses = ref<Course[]>([])

const PREMIUM_PRICE = 15

const contextCourseCode = computed(() => (route.query.course as string | undefined) || null)

const contextCourse = computed<Course | null>(() => {
  if (!contextCourseCode.value) return null
  return premiumCourses.value.find(c => c.course_code === contextCourseCode.value) || null
})

const contextHeadline = computed(() => {
  const c = contextCourse.value
  if (!c) return null
  const target = getLanguageName(c.target_lang)
  const knownEndonym = getLanguageEndonym(c.known_lang)
  return `${target} for ${knownEndonym} speakers is a Premium course.`
})

const otherPremiumCourses = computed(() => {
  if (!contextCourseCode.value) return premiumCourses.value
  return premiumCourses.value.filter(c => c.course_code !== contextCourseCode.value)
})

// "for" word in each known language, used between the target name and
// the known-language endonym on the Premium-courses list. For languages
// where "for X speakers" doesn't render cleanly as a simple connector
// (CJK, RTL, postpositional languages), we fall back to a middle dot —
// "英語 · 日本語" reads neutrally without forcing awkward grammar.
const FOR_WORD: Record<string, string> = {
  eng: 'for',
  spa: 'para',
  por: 'para',
  fra: 'pour',
  ita: 'per',
  deu: 'für',
  nld: 'voor',
  cat: 'per a',
  glg: 'para',
  ron: 'pentru',
  pol: 'dla',
  rus: 'для',
  ukr: 'для',
  swe: 'för',
  nor: 'for',
  dan: 'til',
  tur: 'için',
  ell: 'για',
}
function forWord(knownLang: string): string {
  return FOR_WORD[knownLang] || '·'
}

function selectContextCourse(c: Course) {
  router.replace({ name: 'premium', query: { course: c.course_code } })
  // Scroll the page back up so the user actually sees the headline echo
  // their pick instead of staring at the list while the change happens
  // off-screen.
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function goBackToFreeCourses() {
  // Send them to the player home AND signal HomeScreen to auto-open the
  // Choose Your Course modal (where the Free section lives). Without the
  // query param they'd just land on the player and have to find the
  // course-picker button themselves.
  router.push({ path: '/', query: { openCourses: '1' } })
}

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
        // Carry the course they were unlocking through the Paddle redirect so
        // the success handler can drop them straight into it (see onMounted).
        successUrl: contextCourseCode.value
          ? `${window.location.origin}/premium?just_subscribed=1&course=${encodeURIComponent(contextCourseCode.value)}`
          : `${window.location.origin}/premium?just_subscribed=1`,
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

async function fetchPremiumCourses() {
  if (!supabase.value) return
  try {
    const { data, error } = await supabase.value
      .from('courses')
      .select('course_code, target_lang, known_lang, display_name')
      .eq('pricing_tier', 'premium')
      .in('new_app_status', ['live', 'beta'])
      .order('target_lang')
    if (!error && data) premiumCourses.value = data
  } catch {
    // non-fatal — page still renders without the list
  }
}

onMounted(async () => {
  fetchPremiumCourses()
  if (isAuthenticated.value) {
    await fetchSubscription()
    if (route.query.just_subscribed && subscription.value?.status !== 'active') {
      await pollUntilActive()
    }
    // Just subscribed and now entitled — don't strand them on the paywall,
    // which still frames their course as "Premium". Send them straight into
    // the course they were unlocking (ideal), or the course chooser if we
    // lost the context. Full navigation so App boot re-resolves with the
    // now-active subscription and the ?course= entitlement gate passes.
    if (route.query.just_subscribed && subscription.value?.status === 'active') {
      const code = contextCourseCode.value
      window.location.assign(code ? `/?course=${encodeURIComponent(code)}` : '/?openCourses=1')
      return
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
        <template v-if="contextHeadline">
          <h1 class="frost-display contextual">{{ contextHeadline }}</h1>
          <p class="lede">
            Plus {{ otherPremiumCourses.length }} other Premium course{{ otherPremiumCourses.length === 1 ? '' : 's' }}. Free for 7 days. £{{ PREMIUM_PRICE }}/month from day 8. Cancel anytime.
          </p>
        </template>
        <template v-else>
          <h1 class="frost-display">All courses. All features.</h1>
          <p class="lede">
            Free for 7 days. £{{ PREMIUM_PRICE }}/month from day 8. Cancel anytime.
          </p>
        </template>
      </header>

      <FrostCard variant="panel" class="state-card">
        <!-- Auth still resolving -->
        <div v-if="isAuthLoading" class="centered">
          <div class="loading-spinner"></div>
        </div>

        <!-- Not signed in -->
        <div v-else-if="!isAuthenticated" class="cta">
          <p>Take it for a test drive — 7 days free, no commitment. £{{ PREMIUM_PRICE }}/month from day 8 unless you cancel. We'll email a one-time code to sign you in — no password to remember.</p>
          <ul class="benefit-list">
            <li>All paid SSi courses, every language pair</li>
            <li>Teacher tools — run your own classes at no extra cost</li>
            <li>Offline-capable, sync across devices</li>
          </ul>
          <Button variant="primary" size="lg" @click="handleSignedOutCta">Start free trial</Button>
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
            <li>Teacher tools — run your own classes at no extra cost</li>
            <li>Offline-capable, sync across devices</li>
          </ul>
          <div v-if="checkoutError" class="error">{{ checkoutError }}</div>
          <Button variant="primary" size="lg" :loading="isOpeningCheckout" @click="startCheckout">Start free trial</Button>
        </div>
      </FrostCard>

      <!-- All Premium courses — social proof + course-swap -->
      <section v-if="premiumCourses.length > 0 && subscription?.status !== 'active'" class="premium-list">
        <h2 class="premium-list__title">
          {{ contextCourseCode ? 'All Premium courses' : 'Includes:' }}
        </h2>
        <div class="premium-list__grid">
          <button
            v-for="c in premiumCourses"
            :key="c.course_code"
            type="button"
            class="premium-list__item"
            :class="{ active: c.course_code === contextCourseCode }"
            @click="selectContextCourse(c)"
          >
            <LanguageFlag :code="c.target_lang" :size="20" />
            <span class="premium-list__text">
              <!-- Render each card in the perspective of the learner the
                   course is for — target language name shown in the
                   known language (e.g. "Inglés" rather than "English"
                   on the Spanish-speaker card) — and the connector
                   word ("for"/"para"/"pour"/…) localized to match. -->
              <span class="premium-list__name">{{ getLanguageName(c.target_lang, c.known_lang) }}</span>
              <span class="premium-list__for">{{ forWord(c.known_lang) }} {{ getLanguageEndonym(c.known_lang) }}</span>
            </span>
          </button>
        </div>
      </section>

      <!-- Page-level escape hatch — well below the upgrade CTA so it doesn't
           compete with it visually. -->
      <div v-if="!isAuthLoading && !isPolling" class="page-back-link-wrap">
        <button type="button" class="back-link" @click="goBackToFreeCourses">
          Or browse our free courses →
        </button>
      </div>

      <!-- Legal links — required publicly-visible by Paddle's domain-approval
           review (terms / privacy / refund policy). Placed on the checkout
           page itself so a reviewer sees them next to the CTA. -->
      <footer class="legal-footer">
        <a href="https://www.saysomethingin.com" target="_blank" rel="noopener">About SaySomethingin</a>
        <span class="legal-sep" aria-hidden="true">·</span>
        <a href="https://www.saysomethingin.com/contact" target="_blank" rel="noopener">Contact</a>
        <span class="legal-sep" aria-hidden="true">·</span>
        <a href="/terms" target="_blank" rel="noopener">Terms of Service</a>
        <span class="legal-sep" aria-hidden="true">·</span>
        <a href="/privacy" target="_blank" rel="noopener">Privacy Notice</a>
        <span class="legal-sep" aria-hidden="true">·</span>
        <a href="/refunds" target="_blank" rel="noopener">Refund Policy</a>
      </footer>
    </main>

    <SignInModal @success="handleAuthSuccess" />
  </div>
</template>

<style scoped>
.premium-page {
  /* body has overflow:hidden + touch-action:none globally (Android bounce
     prevention for the player). The page needs its own fixed-height
     scroll-container or content past the viewport is unreachable.
     Mirrors the TeachContainer pattern. */
  height: 100vh;
  height: 100dvh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
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
  /* On iOS the page is full-bleed (no app header above it), so the
     `SSI PREMIUM` eyebrow sits under the status bar / notch unless we
     pad in the safe-area inset. max() preserves the desktop spacing
     where the inset is 0. */
  padding:
    calc(var(--space-12) + env(safe-area-inset-top, 0px))
    var(--space-6)
    calc(var(--space-12) + env(safe-area-inset-bottom, 0px));
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

.page-header .frost-display.contextual {
  font-size: var(--text-2xl);
  line-height: 1.2;
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

.coming-soon {
  padding: var(--space-4) var(--space-5);
  background: rgba(212, 168, 83, 0.10);
  border: 1px solid rgba(212, 168, 83, 0.35);
  border-radius: var(--radius-lg);
  color: var(--ink-primary);
  font-weight: var(--font-semibold);
  text-align: center;
}

.page-back-link-wrap {
  display: flex;
  justify-content: center;
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid rgba(44, 38, 34, 0.06);
}

.back-link {
  background: transparent;
  border: none;
  padding: var(--space-2) var(--space-3);
  font-family: var(--font-body);
  font-size: var(--text-sm);
  color: var(--ink-muted);
  cursor: pointer;
  transition: color 0.12s ease;
}

.back-link:hover {
  color: var(--ink-primary);
}

.legal-footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-6);
  padding-top: var(--space-4);
  font-size: var(--text-xs);
  color: var(--ink-muted);
}

.legal-footer a {
  color: var(--ink-muted);
  text-decoration: underline;
  text-decoration-color: rgba(44, 38, 34, 0.18);
  text-underline-offset: 2px;
}

.legal-footer a:hover {
  color: var(--ink-primary);
  text-decoration-color: currentColor;
}

.legal-sep {
  opacity: 0.5;
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

.premium-list {
  margin-top: var(--space-2);
}

.premium-list__title {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  margin: 0 0 var(--space-4);
  text-align: center;
}

.premium-list__grid {
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2);
}

@media (min-width: 560px) {
  .premium-list__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

.premium-list__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(44, 38, 34, 0.07);
  border-left: 3px solid rgba(212, 168, 83, 0.55);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  /* Eliminate the iOS tap-delay so the press feels immediate. */
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s ease, border-color 0.12s ease, transform 0.08s ease;
}

.premium-list__item:hover {
  background: rgba(255, 255, 255, 0.85);
  border-left-color: #d4a853;
}

.premium-list__item:active {
  transform: scale(0.98);
}

.premium-list__item.active {
  background: rgba(212, 168, 83, 0.12);
  border-color: rgba(212, 168, 83, 0.55);
  border-left-color: #b8893c;
}

.premium-list__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.premium-list__name {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ink-primary);
  line-height: 1.2;
}

.premium-list__for {
  font-size: 0.6875rem;
  color: var(--ink-muted);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 768px) {
  .content {
    /* Preserve safe-area insets at mobile widths — the desktop rule's
       inset additions would otherwise be wiped out here. */
    padding:
      calc(var(--space-8) + env(safe-area-inset-top, 0px))
      var(--space-4)
      calc(var(--space-8) + env(safe-area-inset-bottom, 0px));
  }

  .state-card {
    padding: var(--space-6);
  }
  /* Keep .premium-list__for visible on mobile — it's the only thing
     that distinguishes 5 'English' cards (English for Arabic,
     for Japanese, for Tamil, etc.). */
}
</style>
