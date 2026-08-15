<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useInviteCode } from '../composables/useInviteCode'
import { useSharedUserEntitlements } from '../composables/useUserEntitlements'
import { useUserRole } from '../composables/useUserRole'
import { useSchoolContext } from '../composables/schools/useSchoolContext'
import { useAuthModal } from '../composables/useAuthModal'
import { hasLiveSessionFor, useLoginCodeAudit } from '../auth/loginCode'

// variant='landing' is a PRESENTATION-ONLY switch (region-tier-design.md
// §1a/§1b, owner addendum 2026-07-13): the /group/:code landing route uses
// the exact same redemption machinery below (validate → OTP → redeem) as the
// bare /redeem/:code and /try/:code doors, just with a signup-page hero
// instead of a centered card, so a leader's invite link looks like the
// /schools1 / /tutors landing doors rather than a bare form.
const props = withDefaults(defineProps<{ variant?: 'bare' | 'landing' }>(), { variant: 'bare' })

const route = useRoute()
const router = useRouter()
const auth = inject<any>('auth', null)
const supabase = inject<any>('supabase', ref(null))
const loginCodeAudit = useLoginCodeAudit('redeem-code')
// App.vue's own course-switch machinery (used by CourseSelector picks): the
// ONLY path that both re-resolves activeCourse/courseDataProvider on an SPA
// navigation (App.vue's own boot-time fetchEnrolledCourses runs once, before
// this page's redemption completes, so a plain localStorage write is never
// re-read) AND persists to learners.preferences for cross-device/next-sign-in
// default. Plain localStorage-only writes here were the root cause of a
// student's class course getting silently dropped after redemption
// (2026-07-15 owner finding: student landed in the catalogue default course
// instead of their class's).
const handleCourseSelect = inject<((course: any) => Promise<void>) | null>('handleCourseSelect', null)
const enrolledCourses = inject<{ value: any[] } | null>('enrolledCourses', null)
const { validateCode, redeemCode, possessionRedeem, linkPossessionRedeem, pendingCode, clearPendingCode, validationError } = useInviteCode()
const { refresh: refreshEntitlements } = useSharedUserEntitlements()

// Possession-based onboarding (docs/schools/email-deliverability-plan.md,
// Option A): these invite types skip the OTP round-trip entirely by default
// — the invite link itself is already the trust boundary. Mirrors the
// server-side allowlist in api/auth/possession-redeem.ts; ssi_admin/tester/
// entitlement codes stay OTP-only there regardless of what the client sends,
// so this is purely a client-side "which default screen to show" choice.
const POSSESSION_ELIGIBLE_CODE_TYPES = new Set(['teacher', 'school_admin', 'school_admin_join', 'govt_admin', 'student'])

// --- State ---
// 'details' = the identity-capture screen (named roles: name + email;
// founder ruling 2026-07-20 — the ONE screen between click and dashboard).
// 'name' = the lighter pupil capture (student/learner links: name only, no
// email — young learners have none to give).
const step = ref<'validating' | 'enter-code' | 'invalid' | 'confirm' | 'details' | 'name' | 'already-registered' | 'auth' | 'otp' | 'redeeming' | 'success'>('validating')
const error = ref('')
const email = ref('')
const displayName = ref('')
const otpCode = ref('')
const isLoading = ref(false)
const redeemLabel = ref('')
const redirectUrl = ref('/')

// School email gateways (Microsoft quarantine, most often) silently swallow
// a lot of OTP mail with nothing bounced and nothing a teacher can whitelist.
// Reveal the "it's not just slow" fallback after a wait, or immediately on
// resend (that click already IS the signal something's wrong).
const showDeliveryHint = ref(false)
let deliveryHintTimer: ReturnType<typeof setTimeout> | null = null
onUnmounted(() => { if (deliveryHintTimer) clearTimeout(deliveryHintTimer) })

// Manual code entry (bare /redeem, no :code in the URL) — the classroom
// whiteboard case: a teacher reads a code aloud/writes it up rather than
// sharing a link. Reuses the exact same validate → auth → redeem machinery
// below; the only difference is where the code string comes from.
const manualCode = ref('')

// /group supports both /group/:code and /group?code=XYZ.
const code = computed(() => (route.params.code as string) || (route.query.code as string) || '')

// Landing-page hero copy (variant='landing' only — today that's /group, the
// govt_admin door). Falls back to a generic line for any other code type
// landing might one day carry.
const landingEyebrow = computed(() => 'SSi for groups')
const landingHeading = computed(() => 'Bring SSi to your group')
const landingSub = computed(() => {
  const groupName = pendingCode.value?.groupName
  if (groupName) return `You've been invited to lead ${groupName}'s SSi rollout.`
  return "You've been invited to lead a group's SSi rollout — schools, academy chains, counties, whole countries."
})
const landingFacts = [
  'Invite schools with one shareable link — no spreadsheets to maintain',
  'Every school you add shows up on your dashboard automatically',
  'See progress across your whole group, roll up or drill into one school',
]
const isSignedIn = computed(() => auth?.isAuthenticated?.value ?? false)
const userEmail = computed(() => auth?.user?.value?.email || '')

// Display info from validation
const displayTitle = computed(() => {
  if (!pendingCode.value) return ''
  if (pendingCode.value.codeKind === 'entitlement') {
    return pendingCode.value.label || 'Access Code'
  }
  const map: Record<string, string> = {
    ssi_admin: 'SSi Admin Invite',
    govt_admin: 'Group Admin Invite',
    school_admin: 'School Admin Invite',
    school_admin_join: 'School Admin Invite',
    teacher: 'Teacher Invite',
    student: 'Student Invite',
    tester: 'Beta Tester Invite',
  }
  return map[pendingCode.value.codeType || ''] || 'Invite Code'
})

const displayDetail = computed(() => {
  if (!pendingCode.value) return ''
  if (pendingCode.value.codeKind === 'entitlement') {
    const parts = []
    if (pendingCode.value.accessDescription) parts.push(pendingCode.value.accessDescription)
    if (pendingCode.value.durationDescription) parts.push(pendingCode.value.durationDescription)
    return parts.join(' · ')
  }
  const ctx = pendingCode.value
  if (ctx.schoolName) return ctx.schoolName
  if (ctx.groupName) return ctx.groupName
  if (ctx.className) return ctx.className
  return ''
})

const isEmailValid = computed(() => {
  if (!email.value) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)
})

const isPossessionEligible = computed(() => {
  const pc = pendingCode.value
  return !!(pc?.codeKind === 'invite' && pc.codeType && POSSESSION_ELIGIBLE_CODE_TYPES.has(pc.codeType))
})

// --- Role-specific copy ---
// The capture screen leads with WHO you are here ("You've been invited as a
// teacher at Ysgol y Garn") — plain words, the role and the place, never
// "invite code"/"redeem" jargon (§1.12 verbs-on-top).
const captureHeading = computed(() => {
  const pc = pendingCode.value
  if (!pc) return 'Welcome'
  const place = pc.schoolName || pc.groupName || ''
  switch (pc.codeType) {
    case 'teacher':
      return place ? `You've been invited as a teacher at ${place}` : "You've been invited as a teacher"
    case 'govt_admin':
      return place ? `You've been invited to lead ${place}` : "You've been invited as a group leader"
    case 'school_admin':
      return place ? `You've been invited to set up ${place}` : "You've been invited to set up your school"
    case 'school_admin_join':
      return place ? `You've been invited to help lead ${place}` : "You've been invited as a school leader"
    case 'student': {
      if (pc.className) return `You're joining ${pc.className}`
      return place ? `You're joining ${place}` : "You're joining your group"
    }
    default:
      return 'Welcome'
  }
})

const captureSub = computed(() => {
  const pc = pendingCode.value
  if (pc?.codeType === 'student') {
    return pc.className && pc.schoolName ? pc.schoolName : ''
  }
  return ''
})

// Quiet, one-line reason the capture screen is asking at all (Tom's founder
// finding, 2026-07-30: legibility, not a behaviour change — a personal link
// never reaches 'details'/'name', so this is always true when shown).
const captureExplainer = computed(() => {
  if (step.value === 'details') return "It's a shareable link, so we ask new arrivals to say who they are."
  if (step.value === 'name') return "It's a shareable link, so we ask new arrivals for their name."
  return ''
})

const authInstructionText = computed(() => {
  const pc = pendingCode.value
  if (!pc) return 'Enter your email to get started'
  if (pc.codeKind === 'entitlement') return 'Enter your email to activate your access'
  switch (pc.codeType) {
    case 'teacher': return 'Enter your email to set up your teacher account'
    case 'student': {
      const cls = pc.className
      return cls ? `Enter your email to join ${cls}` : 'Enter your email to join this class'
    }
    case 'school_admin': return 'Enter your email to set up your school account'
    case 'school_admin_join': return 'Enter your email to join this school as an admin'
    case 'govt_admin': return 'Enter your email to set up your group admin account'
    default: return 'Enter your email to get started'
  }
})

const successHeading = computed(() => {
  const pc = pendingCode.value
  if (!pc) return "You're all set!"
  if (pc.codeKind === 'entitlement') return 'Access activated!'
  switch (pc.codeType) {
    case 'teacher': return 'Welcome! Your teacher account is ready'
    case 'student': return "You've joined the class!"
    case 'school_admin': return 'Your school account is ready'
    case 'school_admin_join': return 'Your school admin account is ready'
    case 'govt_admin': return 'Your group admin account is ready'
    default: return "You're all set!"
  }
})

const successSubtext = computed(() => {
  const pc = pendingCode.value
  if (!pc) return 'Redirecting...'
  if (pc.codeKind === 'entitlement') return 'Taking you to the app...'
  switch (pc.codeType) {
    case 'teacher': return 'Taking you to your classroom dashboard...'
    case 'student': return 'Taking you to your first lesson...'
    case 'school_admin': return 'Taking you to your school overview...'
    case 'school_admin_join': return 'Taking you to your school overview...'
    case 'govt_admin': return 'Taking you to your group overview...'
    default: return 'Redirecting...'
  }
})

// --- Step 1: Validate on mount ---
onMounted(async () => {
  // This page owns the whole invite-code flow inline (auth/details/OTP steps
  // below) — close the global sign-in modal if App.vue's boot-time pendingCode
  // check raced ahead of this mount and opened it (see App.vue onMounted),
  // so it never sits stranded over this page or the post-redemption redirect.
  useAuthModal().close()
  if (!code.value) {
    // Landing (/group) links always carry a code; a bare /group with none is
    // genuinely broken. Bare /redeem with no code is the whiteboard case —
    // offer manual entry instead of a dead end.
    if (props.variant === 'landing') {
      error.value = "This link is missing its invite code — check the link you were sent, or ask for a new one."
      step.value = 'invalid'
      return
    }
    step.value = 'enter-code'
    return
  }
  await validateAndProceed(code.value)
})

async function validateAndProceed(rawCode: string): Promise<void> {
  // Pass the session's token (when there is one) so the server can tell us
  // if THIS user already redeemed this code — a re-clicked personal link
  // then goes straight to their surface, no confirm, no second code spend.
  let sessionToken: string | undefined
  if (isSignedIn.value && supabase.value) {
    try {
      const { data: { session } } = await supabase.value.auth.getSession()
      sessionToken = session?.access_token
    } catch { /* validate still works without it */ }
  }
  const valid = await validateCode(rawCode, sessionToken)
  if (!valid) {
    // Surface the API's specific reason ('Code expired' / 'Code fully used' /
    // 'Invalid code') when available, rather than a generic catch-all.
    error.value = validationError.value || 'This code is invalid or has expired'
    step.value = 'invalid'
    return
  }
  // Already redeemed by this signed-in user — straight to their surface
  // (founder ruling 2026-07-20: subsequent redeems of a personal link have
  // zero ceremony).
  if (isSignedIn.value && pendingCode.value?.alreadyRedeemed) {
    const surface = pendingCode.value.redirectTo || '/'
    clearPendingCode()
    router.replace(surface)
    return
  }
  // PERSONAL link (species 1): the code is bound to a pre-provisioned
  // account — the link IS that person's login. ZERO screens: sign straight
  // into the bound account and land on the role surface. A different
  // pre-existing session doesn't gate this (nothing is being spent or
  // granted — this is a sign-in, and the link's whole meaning is "log me in
  // as the person this was minted for"); the server binds the account from
  // the code row, never from anything the client sends.
  if (pendingCode.value?.personal) {
    await handlePersonalSignIn()
    return
  }
  // Valid code — check auth state. A session already present does NOT mean
  // it's the RIGHT session (a govt_admin link opened in a browser still
  // signed into a personal/learner account is the trap this guards against)
  // — confirm identity before ever spending the one-shot code.
  if (isSignedIn.value) {
    step.value = 'confirm'
    return
  }
  // The link is the credential — no OTP, no email round-trip (§1.13). But
  // named roles (teacher/leader/school admin) get ONE identity-capture screen
  // on first redeem (name + email, founder ruling 2026-07-20) so the account
  // is real — never a link-<uuid> ghost. Pupil links (student/learner) keep
  // the lighter capture: name only. The email/OTP flow stays as the fallback
  // for code types that need it (entitlement/ssi_admin/tester).
  if (isPossessionEligible.value) {
    step.value = pendingCode.value?.codeType === 'student' ? 'name' : 'details'
    return
  }
  step.value = 'auth'
}

// --- Step 1p (personal link, species 1): zero screens, the link is the login ---
// Mint a session for the account this code was bound to at mint time and land
// directly on the role surface. Repeatable until revoked/expired. A stale
// different-account session is replaced — the personal link's meaning is
// "sign in as the person this was minted for".
async function handlePersonalSignIn() {
  const client = supabase.value
  if (!client) {
    error.value = 'App not ready. Please try again.'
    step.value = 'invalid'
    return
  }
  step.value = 'redeeming'
  error.value = ''
  try {
    if (isSignedIn.value) {
      await client.auth.signOut({ scope: 'local' }).catch(() => {})
    }
    const result = await linkPossessionRedeem()
    if (result.success && result.session) {
      const { error: setSessionError } = await client.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      })
      if (!setSessionError) {
        await auth?.refreshRole?.()
        // A personal class-student link carries the class's course in the
        // validate context — switch onto it NOW, exactly like the open-link
        // redemption path does (App.vue resolved its course before this
        // session existed, so without this the pupil lands on the catalogue
        // default instead of their class course).
        if (pendingCode.value?.courseName) {
          await switchActiveCourseTo(pendingCode.value.courseName).catch(() => {})
        }
        const surface = pendingCode.value?.redirectTo || '/'
        clearPendingCode()
        useSchoolContext().clear()
        router.replace(surface)
        return
      }
    }
    error.value = result.error || 'This link could not sign you in. Ask for a new one.'
    step.value = 'invalid'
  } catch {
    error.value = 'This link could not sign you in. Ask for a new one.'
    step.value = 'invalid'
  }
}

// --- Step 1c (pupil path): name-only capture, then in ---
// Student/learner links: the link is the credential and young learners have
// no email to give — capture a name, mint the account server-side against a
// placeholder address (replaced when they add a real one later), and land
// them in the player.
async function handlePupilSubmit() {
  if (!displayName.value.trim()) return
  const client = supabase.value
  if (!client) {
    error.value = 'App not ready. Please try again.'
    return
  }
  isLoading.value = true
  error.value = ''
  try {
    const result = await linkPossessionRedeem(displayName.value.trim())
    if (result.success && result.session) {
      const { error: setSessionError } = await client.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      })
      if (setSessionError) {
        error.value = setSessionError.message || 'Could not sign you in. Please try again.'
        return
      }
      await doRedeem()
      return
    }
    error.value = result.error || 'Something went wrong. Please try again.'
  } catch (err: any) {
    error.value = err.message || 'Something went wrong. Please try again.'
  } finally {
    isLoading.value = false
  }
}

// --- Step 1b (whiteboard path): manual code entry ---
async function handleManualCodeSubmit() {
  if (!manualCode.value.trim()) return
  isLoading.value = true
  error.value = ''
  try {
    // Push the code into the URL so it's shareable/refreshable and `code`
    // resolves from the route like the click-a-link path does.
    router.replace({ name: 'redeem-code', params: { code: manualCode.value.trim() } })
    await validateAndProceed(manualCode.value.trim())
  } finally {
    isLoading.value = false
  }
}

// Watch for auth state changes (e.g. after OTP verify propagates). This can
// race handleVerifyOtp's own direct doRedeem() call below (Supabase's
// onAuthStateChange can fire before verifyOtp()'s own promise resolves) —
// useInviteCode's redeemCode() single-flights, so whichever call gets here
// first wins and the other just gets its result back, no double POST.
watch(isSignedIn, async (signedIn) => {
  if (signedIn && step.value === 'otp') {
    await doRedeem()
  }
})

// --- Step 1b: Confirm identity / switch account ---
async function useDifferentEmail() {
  const client = supabase.value
  isLoading.value = true
  try {
    await client?.auth.signOut({ scope: 'local' })
  } finally {
    isLoading.value = false
    email.value = ''
    error.value = ''
    // After signing out, the natural door for a possession-eligible invite is
    // the capture screen (the link is the credential) — OTP only for the code
    // types that require it.
    step.value = isPossessionEligible.value
      ? (pendingCode.value?.codeType === 'student' ? 'name' : 'details')
      : 'auth'
  }
}

// --- Step 1c (default path): possession-based onboarding, no OTP wait ---
async function handlePossessionSubmit() {
  if (!isEmailValid.value) return
  const client = supabase.value
  if (!client) {
    error.value = 'App not ready. Please try again.'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const result = await possessionRedeem(email.value, displayName.value.trim())
    if (result.success && result.session) {
      const { error: setSessionError } = await client.auth.setSession({
        access_token: result.session.access_token,
        refresh_token: result.session.refresh_token,
      })
      if (setSessionError) {
        error.value = setSessionError.message || 'Could not sign you in. Please try again.'
        return
      }
      await doRedeem()
      return
    }
    if (result.reason === 'already_registered') {
      step.value = 'already-registered'
      return
    }
    error.value = result.error || 'Something went wrong. Please try again.'
  } finally {
    isLoading.value = false
  }
}

// "prefer to verify by email code now" — secondary path off the details
// screen, and off invalid states doPossessionSubmit can hit (rate-limited etc).
function switchToEmailCode() {
  error.value = ''
  step.value = 'auth'
}

// Already-registered fallback (security rail: possession never signs in as
// a pre-existing account) — send that account a real sign-in code instead.
async function handleSignInInstead() {
  step.value = 'auth'
  error.value = ''
  await handleSendOtp()
}

// --- Step 2: Send OTP ---
async function handleSendOtp() {
  if (!isEmailValid.value) return
  const client = supabase.value
  if (!client) {
    error.value = 'App not ready. Please try again.'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const { error: otpError } = await client.auth.signInWithOtp({ email: email.value })
    if (otpError) {
      error.value = otpError.message || 'Unable to send code. Please try again.'
      return
    }
    step.value = 'otp'
    showDeliveryHint.value = false
    if (deliveryHintTimer) clearTimeout(deliveryHintTimer)
    deliveryHintTimer = setTimeout(() => { showDeliveryHint.value = true }, 20000)
  } catch (err: any) {
    error.value = err.message || 'Unable to send code. Please try again.'
  } finally {
    isLoading.value = false
  }
}

// --- Step 2b: Verify OTP ---
async function handleVerifyOtp() {
  if (otpCode.value.length < 6) return
  const client = supabase.value
  if (!client) {
    error.value = 'App not ready. Please try again.'
    return
  }

  isLoading.value = true
  error.value = ''

  try {
    const { error: verifyError } = await client.auth.verifyOtp({
      email: email.value,
      token: otpCode.value,
      type: 'email',
    })
    if (verifyError) {
      // A double-tap re-sends a token Supabase has already consumed, and its
      // one generic "expired or invalid" covers that case too — so ask whether
      // the sign-in ALREADY worked before calling it a failure. Same spirit as
      // Onboarding.vue's per-address otpVerified guard.
      if (await hasLiveSessionFor(client, email.value)) {
        loginCodeAudit.alreadySignedIn(email.value)
        // The redemption may already be under way from the tap that won the
        // race, or from the isSignedIn watcher above — same condition it uses,
        // so we drive it only when nothing else has.
        if (step.value === 'otp') await doRedeem()
        return
      }
      loginCodeAudit.failed(email.value, verifyError.message)
      error.value = verifyError.message || 'Invalid code. Please try again.'
      return
    }
    // Auth state will update via onAuthStateChange — doRedeem called from watcher.
    // But also try directly in case watcher doesn't fire fast enough (both are
    // intentional; the single-flight guard in useInviteCode.redeemCode() is
    // what keeps this from double-redeeming).
    await doRedeem()
  } catch (err: any) {
    error.value = err.message || 'Verification failed. Please try again.'
  } finally {
    isLoading.value = false
  }
}

/** Force the app onto the class's course right now — not just next boot.
 *  App.vue's fetchEnrolledCourses resolves activeCourse ONCE at mount, which
 *  happens before this page's redemption completes; a localStorage write
 *  alone is never re-read on the SPA `router.push` redirect below, so the
 *  class course silently loses to whatever App.vue picked at cold boot
 *  (2026-07-15 finding). Mirrors the CourseSelector pick path exactly. */
async function switchActiveCourseTo(courseCode: string): Promise<void> {
  if (!handleCourseSelect) return
  let courseRow = enrolledCourses?.value?.find((c: any) => c.course_code === courseCode) || null
  if (!courseRow && supabase.value) {
    const { data } = await supabase.value
      .from('courses')
      .select('*')
      .eq('course_code', courseCode)
      .maybeSingle()
    courseRow = data || null
  }
  if (courseRow) {
    await handleCourseSelect(courseRow)
  }
}

function backToDetails() {
  error.value = ''
  otpCode.value = ''
  step.value = 'details'
}

// --- Step 2c: Resend OTP ---
async function handleResendOtp() {
  const client = supabase.value
  if (!client) return

  showDeliveryHint.value = true
  try {
    const { error: otpError } = await client.auth.signInWithOtp({ email: email.value })
    if (otpError) {
      error.value = 'Unable to resend code. Please try again.'
    } else {
      error.value = ''
    }
  } catch {
    error.value = 'Unable to resend code. Please try again.'
  }
}

// --- Step 3: Redeem ---
async function doRedeem() {
  step.value = 'redeeming'
  error.value = ''

  try {
    const client = supabase.value
    if (!client) {
      error.value = 'App not ready.'
      step.value = 'auth'
      return
    }

    const { data: { session } } = await client.auth.getSession()
    const token = session?.access_token
    if (!token) {
      // Not actually signed in yet — wait for auth propagation
      step.value = 'auth'
      return
    }

    const result = await redeemCode(token)
    if (result.success) {
      redeemLabel.value = result.label || displayTitle.value
      if (result.codeKind === 'entitlement') {
        refreshEntitlements()
      }
      // Update role immediately so feedback widget appears without reload
      if (pendingCode.value?.codeType === 'tester') {
        useUserRole().initialize('tester', null)
      } else if (pendingCode.value?.codeType === 'ssi_admin') {
        useUserRole().initialize('ssi_admin', null)
      } else if (pendingCode.value?.codeType) {
        useUserRole().initialize(null, pendingCode.value.codeType)
      }
      // Re-sync from the DB now the redemption write has committed — this
      // is the authoritative write. The SIGNED_IN auth listener's own
      // ensureLearnerExists() call started concurrently with the
      // redemption and can resolve later with pre-redemption data,
      // clobbering the optimistic role set above before the redirect
      // below fires. See useAuth.refreshRole for the full race.
      await auth?.refreshRole?.()
      // Student class-invite redemption: force the app onto the class's
      // course right now (not just "next boot") — the localStorage-only
      // write (finding #3, 2026-07-13 audit) was necessary but not
      // sufficient, since App.vue only reads it once at initial mount,
      // before this redemption completes (2026-07-15 finding: a student who
      // joined a Welsh class landed in the catalogue default course anyway).
      if (result.courseCode) {
        await switchActiveCourseTo(result.courseCode)
      }
      // useSchoolContext.loadFromAuth is idempotent for an already-loaded
      // 'self' scope of the SAME auth user (deliberately, to avoid
      // redundant refetches) — but a redemption just changed THIS user's
      // school/class assignment server-side. Clear the singleton so
      // SchoolsContainer's mount-time loadFromAuth actually refetches
      // instead of serving stale pre-redemption data (finding #2f,
      // 2026-07-13 audit).
      useSchoolContext().clear()
      step.value = 'success'
      redirectUrl.value = result.redirectTo || '/'
      setTimeout(() => {
        router.push(redirectUrl.value)
      }, 4000)
    } else {
      error.value = result.error || 'Failed to redeem code'
      step.value = 'auth'
    }
  } catch {
    error.value = 'Something went wrong'
    step.value = 'auth'
  }
}

function goToRedirect() {
  router.push(redirectUrl.value)
}

function goHome() {
  clearPendingCode()
  router.push('/')
}
</script>

<template>
  <div class="redeem-page" :class="{ 'is-landing': props.variant === 'landing' }">
    <div v-if="props.variant === 'landing'" class="landing-hero">
      <img class="landing-logo" src="/ssi-web-logo.svg" alt="SaySomethingin" />
      <span class="landing-eyebrow">{{ landingEyebrow }}</span>
      <h1 class="landing-heading">{{ landingHeading }}</h1>
      <p class="landing-sub">{{ landingSub }}</p>
      <ul v-if="step !== 'success'" class="landing-facts">
        <li v-for="f in landingFacts" :key="f">{{ f }}</li>
      </ul>
    </div>
    <div class="redeem-card">

      <!-- Step 1: Validating -->
      <div v-if="step === 'validating'" class="redeem-section">
        <div class="spinner"></div>
        <p class="status-text">Checking code...</p>
      </div>

      <!-- Manual code entry (bare /redeem — the whiteboard case) -->
      <form v-else-if="step === 'enter-code'" class="auth-form" @submit.prevent="handleManualCodeSubmit">
        <h2 class="code-title">Enter your code</h2>
        <p class="detail-text">Type the code your teacher or admin gave you.</p>

        <Transition name="error-fade">
          <div v-if="error" class="error-banner">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {{ error }}
          </div>
        </Transition>

        <div class="input-group">
          <label for="redeem-manual-code" class="input-label">Code</label>
          <div class="input-wrapper">
            <input
              id="redeem-manual-code"
              v-model="manualCode"
              type="text"
              placeholder="ABC-123"
              autocapitalize="characters"
              autocomplete="off"
              autofocus
              required
            />
          </div>
        </div>

        <button type="submit" class="btn btn--primary" :class="{ loading: isLoading }" :disabled="isLoading || !manualCode.trim()">
          <span v-if="!isLoading">Continue</span>
          <span v-else class="btn-spinner"></span>
        </button>
      </form>

      <!-- Invalid code -->
      <div v-else-if="step === 'invalid'" class="redeem-section">
        <div class="icon-circle icon-circle--error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <h2>Invalid Code</h2>
        <p class="detail-text">{{ error }}</p>
        <button v-if="props.variant !== 'landing'" class="btn btn--secondary" @click="step = 'enter-code'; error = ''">Try another code</button>
        <button class="btn btn--secondary" @click="goHome">Go to App</button>
      </div>

      <!-- Redeeming spinner -->
      <div v-else-if="step === 'redeeming'" class="redeem-section">
        <h2 class="code-title">{{ displayTitle }}</h2>
        <p v-if="displayDetail" class="detail-text">{{ displayDetail }}</p>
        <div class="spinner" style="margin-top: 1.5rem"></div>
        <p class="status-text">Activating your code...</p>
      </div>

      <!-- Success -->
      <div v-else-if="step === 'success'" class="redeem-section">
        <div class="icon-circle icon-circle--success">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <h2 class="success-title">{{ successHeading }}</h2>
        <p class="detail-text">{{ redeemLabel }}</p>
        <p class="redirect-text">{{ successSubtext }}</p>
        <button class="btn btn--primary btn--continue" @click="goToRedirect">Continue</button>
      </div>

      <!-- Auth + OTP flow -->
      <template v-else>
        <!-- Capture steps lead with the role + place in plain words; the
             other steps keep the code-type title. -->
        <h2 class="code-title">{{ step === 'details' || step === 'name' ? captureHeading : displayTitle }}</h2>
        <p v-if="step === 'details' || step === 'name' ? captureSub : displayDetail" class="detail-text">{{ step === 'details' || step === 'name' ? captureSub : displayDetail }}</p>

        <!-- Confirm identity — a session already exists; make sure it's the
             RIGHT one before spending the one-shot code (owner ruling
             2026-07-13: never redeem silently under a pre-existing session). -->
        <div v-if="step === 'confirm'" class="redeem-section">
          <p class="signed-in-text">You're signed in as <strong>{{ userEmail }}</strong></p>
          <button class="btn btn--primary" :class="{ loading: isLoading }" :disabled="isLoading" @click="doRedeem">
            Continue as {{ userEmail }}
          </button>
          <button type="button" class="link-action" :disabled="isLoading" @click="useDifferentEmail">
            Use a different email
          </button>
        </div>

        <!-- Details (step === 'details') — THE identity-capture screen for
             named roles (founder ruling 2026-07-20): one friendly screen
             (your name, your email), then in. No OTP, no email round-trip —
             the link is still the credential; the email is recorded
             unverified and confirmed later from Settings. -->
        <form v-else-if="step === 'details'" class="auth-form" @submit.prevent="handlePossessionSubmit">
          <p class="instruction-text">Tell us who you are and you're in — no password, no code to wait for.</p>
          <p class="capture-explainer">{{ captureExplainer }}</p>

          <Transition name="error-fade">
            <div v-if="error" class="error-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {{ error }}
            </div>
          </Transition>

          <div class="input-group">
            <label for="redeem-name" class="input-label">Your name</label>
            <div class="input-wrapper">
              <input
                id="redeem-name"
                v-model="displayName"
                type="text"
                placeholder="e.g. Sian Jones"
                autocomplete="name"
                required
              />
            </div>
          </div>

          <div class="input-group">
            <label for="redeem-details-email" class="input-label">Email</label>
            <div class="input-wrapper" :class="{ invalid: email && !isEmailValid }">
              <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M22 6l-10 7L2 6"/>
              </svg>
              <input
                id="redeem-details-email"
                v-model="email"
                type="email"
                placeholder="you@example.com"
                autocomplete="email"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            class="btn btn--primary"
            :class="{ loading: isLoading }"
            :disabled="!displayName.trim() || !isEmailValid || isLoading"
          >
            <span v-if="!isLoading">Continue</span>
            <span v-else class="btn-spinner"></span>
          </button>

          <p class="resend-text">
            Prefer to verify with an emailed code first?
            <button type="button" :disabled="isLoading" @click="switchToEmailCode">Use email code instead</button>
          </p>
        </form>

        <!-- Pupil capture (step === 'name') — student/learner links: name
             only, no email (young learners have none to give). The link is
             the credential; one field, then straight into the player. -->
        <form v-else-if="step === 'name'" class="auth-form" @submit.prevent="handlePupilSubmit">
          <p class="instruction-text">{{ pendingCode?.className ? "What's your name? Your teacher will see it on the class list." : "What's your name?" }}</p>
          <p class="capture-explainer">{{ captureExplainer }}</p>

          <Transition name="error-fade">
            <div v-if="error" class="error-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {{ error }}
            </div>
          </Transition>

          <div class="input-group">
            <label for="redeem-pupil-name" class="input-label">Your name</label>
            <div class="input-wrapper">
              <input
                id="redeem-pupil-name"
                v-model="displayName"
                type="text"
                placeholder="e.g. Alys"
                autocomplete="name"
                autofocus
                required
              />
            </div>
          </div>

          <button
            type="submit"
            class="btn btn--primary"
            :class="{ loading: isLoading }"
            :disabled="!displayName.trim() || isLoading"
          >
            <span v-if="!isLoading">Start learning</span>
            <span v-else class="btn-spinner"></span>
          </button>
        </form>

        <!-- Already registered (step === 'already-registered') — security
             rail: possession onboarding never signs in as a pre-existing
             account, so this hands off to a real sign-in code instead. -->
        <div v-else-if="step === 'already-registered'" class="redeem-section">
          <p class="detail-text">An account already exists for <strong>{{ email }}</strong>.</p>
          <button class="btn btn--primary" :class="{ loading: isLoading }" :disabled="isLoading" @click="handleSignInInstead">
            Sign in instead
          </button>
          <button type="button" class="link-action" :disabled="isLoading" @click="step = 'details'; error = ''">
            Use a different email
          </button>
        </div>

        <!-- Email input (step === 'auth') — the OTP-gated path: secondary for
             possession-eligible invites (chosen from the details screen), the
             default for code types that stay OTP-only (entitlement/ssi_admin/
             tester). -->
        <form v-else-if="step === 'auth'" class="auth-form" @submit.prevent="handleSendOtp">
          <p class="instruction-text">{{ authInstructionText }}</p>

          <Transition name="error-fade">
            <div v-if="error" class="error-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {{ error }}
            </div>
          </Transition>

          <div class="input-group">
            <label for="redeem-email" class="input-label">Email</label>
            <div class="input-wrapper" :class="{ invalid: email && !isEmailValid }">
              <svg class="input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M22 6l-10 7L2 6"/>
              </svg>
              <input
                id="redeem-email"
                v-model="email"
                type="email"
                placeholder="you@example.com"
                autocomplete="email"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            class="btn btn--primary"
            :class="{ loading: isLoading }"
            :disabled="!isEmailValid || isLoading"
          >
            <span v-if="!isLoading">Continue</span>
            <span v-else class="btn-spinner"></span>
          </button>
        </form>

        <!-- OTP input (step === 'otp') -->
        <form v-else-if="step === 'otp'" class="auth-form" @submit.prevent="handleVerifyOtp">
          <div class="otp-info">
            <div class="icon-circle icon-circle--mail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="4" width="20" height="16" rx="2"/>
                <path d="M22 6l-10 7L2 6"/>
              </svg>
            </div>
            <p class="instruction-text">Check your email for a 6-digit code</p>
            <p class="email-highlight">{{ email }}</p>
            <p class="otp-helper-text">It may take a moment to arrive. Check your spam folder if needed.</p>
          </div>

          <Transition name="error-fade">
            <div v-if="error" class="error-banner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {{ error }}
            </div>
          </Transition>

          <div class="input-group">
            <label for="redeem-otp" class="input-label">Verification Code</label>
            <div class="input-wrapper otp-input-wrapper">
              <input
                id="redeem-otp"
                v-model="otpCode"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="6"
                placeholder="000000"
                autocomplete="one-time-code"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            class="btn btn--primary"
            :class="{ loading: isLoading }"
            :disabled="otpCode.length < 6 || isLoading"
          >
            <span v-if="!isLoading">Verify</span>
            <span v-else class="btn-spinner"></span>
          </button>

          <p class="resend-text">
            Didn't get the code?
            <button type="button" @click="handleResendOtp">Resend</button>
          </p>

          <Transition name="error-fade">
            <div v-if="showDeliveryHint" class="delivery-hint">
              <p v-if="isPossessionEligible">
                Still nothing? School email filters often block these codes outright.
                <button type="button" class="delivery-hint-link" @click="backToDetails">Go back and skip the email code</button>
                — you won't need to wait for anything. Still stuck? Email
                <a href="mailto:admin@saysomethingin.com">admin@saysomethingin.com</a>.
              </p>
              <p v-else>
                Still nothing? School email filters often block these codes outright.
                Try entering a personal email address instead — you can add your school
                email later — or ask whoever sent your invite to re-share the link.
                Still stuck? Email <a href="mailto:admin@saysomethingin.com">admin@saysomethingin.com</a>.
              </p>
            </div>
          </Transition>

          <button type="button" class="back-link" @click="step = 'auth'; error = ''; otpCode = ''">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back
          </button>
        </form>
      </template>
    </div>
  </div>
</template>

<style scoped>
.redeem-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-primary, #0a0a0f);
  padding: 1rem;
  font-family: 'Noto Sans', sans-serif;
}

.redeem-card {
  background: var(--bg-card, #141420);
  border-radius: 16px;
  padding: 2.5rem 2rem;
  max-width: 420px;
  width: 100%;
  text-align: center;
  color: var(--text-primary, #e0e0e0);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.redeem-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

/* --- Landing variant (/group) --- */

.redeem-page.is-landing {
  flex-direction: column;
  justify-content: flex-start;
  gap: 2.5rem;
  padding: 4rem 1.5rem;
  background: radial-gradient(ellipse 80% 60% at 50% -10%, rgba(194, 58, 58, 0.18) 0%, transparent 60%),
    var(--bg-primary, #0a0a0f);
}

.landing-hero {
  max-width: 560px;
  width: 100%;
  text-align: center;
  color: var(--text-primary, #e0e0e0);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.landing-logo {
  height: 32px;
  margin-bottom: 0.5rem;
}

.landing-eyebrow {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ssi-gold, #d4a853);
}

.landing-heading {
  margin: 0;
  font-size: 2.25rem;
  font-weight: 800;
  line-height: 1.15;
}

.landing-sub {
  margin: 0;
  color: var(--text-secondary, #aaa);
  font-size: 1.0625rem;
  line-height: 1.5;
}

.landing-facts {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
}

.landing-facts li {
  position: relative;
  padding-left: 1.5rem;
  color: var(--text-secondary, #ccc);
  font-size: 0.9375rem;
}

.landing-facts li::before {
  content: '✓';
  position: absolute;
  left: 0;
  color: var(--ssi-gold, #d4a853);
  font-weight: 700;
}

/* --- Typography --- */

.code-title {
  margin: 0 0 0.25rem;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.redeem-card h2 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text-primary, #fff);
}

.detail-text {
  color: var(--text-secondary, #aaa);
  margin: 0;
  font-size: 0.9375rem;
}

.status-text {
  color: var(--text-secondary, #aaa);
  font-size: 0.9375rem;
  margin: 0;
}

.instruction-text {
  color: var(--text-secondary, #aaa);
  font-size: 0.9375rem;
  margin: 0;
}

.capture-explainer {
  color: var(--text-muted, #666);
  font-size: 0.8125rem;
  margin: -0.5rem 0 0;
}

.signed-in-text {
  color: var(--text-secondary, #aaa);
  font-size: 0.9375rem;
  margin: 0.75rem 0 1.25rem;
}

.signed-in-text strong {
  color: var(--text-primary, #fff);
}

.redirect-text {
  color: var(--text-secondary, #aaa);
  font-size: 0.875rem;
  margin: 0.5rem 0 0;
}

.success-title {
  color: #66bb6a !important;
}

.otp-helper-text {
  color: var(--text-muted, #666);
  font-size: 0.8125rem;
  margin: 0.25rem 0 0;
}

.delivery-hint {
  padding: 0.75rem 1rem;
  background: rgba(212, 168, 83, 0.08);
  border: 1px solid rgba(212, 168, 83, 0.25);
  border-radius: 12px;
  text-align: left;
}

.delivery-hint p {
  margin: 0;
  color: var(--text-secondary, #aaa);
  font-size: 0.8125rem;
  line-height: 1.5;
}

.delivery-hint a {
  color: var(--ssi-gold, #d4a853);
  font-weight: 600;
}

.delivery-hint-link {
  color: var(--ssi-gold, #d4a853);
  font-weight: 600;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: 'Noto Sans', sans-serif;
  font-size: inherit;
  text-decoration: underline;
}

.btn--continue {
  margin-top: 0.75rem;
}

/* --- Spinner --- */

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(194, 58, 58, 0.2);
  border-top-color: #c23a3a;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* --- Icon circles --- */

.icon-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.5rem;
}

.icon-circle svg {
  width: 32px;
  height: 32px;
}

.icon-circle--error {
  background: rgba(239, 83, 80, 0.15);
  color: #ef5350;
}

.icon-circle--success {
  background: rgba(102, 187, 106, 0.15);
  color: #66bb6a;
}

.icon-circle--mail {
  background: linear-gradient(135deg, rgba(194, 58, 58, 0.2), rgba(212, 168, 83, 0.2));
  color: var(--ssi-gold, #d4a853);
}

/* --- Auth form --- */

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  margin-top: 1.5rem;
}

/* --- Error banner --- */

.error-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 12px;
  color: #ef5350;
  font-size: 0.875rem;
  text-align: left;
}

.error-banner svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.error-fade-enter-active,
.error-fade-leave-active {
  transition: all 0.2s ease;
}

.error-fade-enter-from,
.error-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* --- Inputs --- */

.input-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  text-align: left;
}

.input-label {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary, #aaa);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.input-wrapper:hover {
  border-color: rgba(255, 255, 255, 0.2);
}

.input-wrapper:focus-within {
  border-color: #c23a3a;
  box-shadow: 0 0 0 3px rgba(194, 58, 58, 0.15), 0 0 20px rgba(194, 58, 58, 0.1);
}

.input-wrapper.invalid {
  border-color: #ef5350;
}

.input-icon {
  position: absolute;
  left: 1rem;
  width: 18px;
  height: 18px;
  color: var(--text-muted, #666);
  pointer-events: none;
  transition: color 0.2s ease;
}

.input-wrapper:focus-within .input-icon {
  color: #c23a3a;
}

.input-wrapper input {
  flex: 1;
  padding: 0.875rem 1rem 0.875rem 2.75rem;
  background: transparent;
  border: none;
  color: var(--text-primary, #e0e0e0);
  font-size: 1rem;
  font-family: 'Noto Sans', sans-serif;
  outline: none;
}

.input-wrapper input::placeholder {
  color: var(--text-muted, #666);
}

/* OTP input */
.otp-input-wrapper input {
  text-align: center;
  font-size: 1.5rem;
  letter-spacing: 0.5em;
  padding: 1rem !important;
  font-family: var(--font-mono, monospace);
}

.otp-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.email-highlight {
  color: var(--text-primary, #fff);
  font-weight: 600;
  font-size: 0.9375rem;
  margin: 0;
}

/* --- Buttons --- */

.btn {
  padding: 0.875rem 1.5rem;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 600;
  font-family: 'Noto Sans', sans-serif;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  position: relative;
}

.btn--primary {
  background: linear-gradient(135deg, #c23a3a 0%, #a02e2e 100%);
  color: white;
}

.btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 25px rgba(194, 58, 58, 0.4);
}

.btn--primary:active:not(:disabled) {
  transform: translateY(0);
}

.btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn--primary.loading {
  pointer-events: none;
}

.btn--secondary {
  background: var(--bg-card-hover, #1e1e2e);
  color: var(--text-primary, #e0e0e0);
  border: 1px solid var(--border, #333);
}

.btn--secondary:hover {
  background: var(--bg-hover, #2a2a3e);
}

.btn-spinner {
  display: inline-block;
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* --- Resend / back --- */

.resend-text {
  text-align: center;
  font-size: 0.875rem;
  color: var(--text-muted, #666);
  margin: 0;
}

.resend-text button {
  color: var(--ssi-gold, #d4a853);
  font-weight: 600;
  background: none;
  border: none;
  cursor: pointer;
  font-family: 'Noto Sans', sans-serif;
  font-size: 0.875rem;
  padding: 0;
  transition: color 0.2s ease;
}

.resend-text button:hover {
  color: var(--ssi-gold-light, #e0c080);
}

.back-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  color: var(--text-muted, #666);
  font-size: 0.875rem;
  font-family: 'Noto Sans', sans-serif;
  background: none;
  border: none;
  cursor: pointer;
  transition: color 0.2s ease;
}

.back-link:hover {
  color: var(--text-secondary, #aaa);
}

.back-link svg {
  width: 18px;
  height: 18px;
}

/* --- Confirm identity --- */

.link-action {
  color: var(--ssi-gold, #d4a853);
  font-weight: 600;
  background: none;
  border: none;
  cursor: pointer;
  font-family: 'Noto Sans', sans-serif;
  font-size: 0.875rem;
  padding: 0.25rem;
  transition: color 0.2s ease;
}

.link-action:hover:not(:disabled) {
  color: var(--ssi-gold-light, #e0c080);
}

.link-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
