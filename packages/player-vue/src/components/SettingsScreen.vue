<script setup lang="ts">
import { ref, computed, inject, watch, onMounted } from 'vue'
import { unregisterAllServiceWorkers, clearAllCaches } from '../composables/useServiceWorkerSafety'
import { getAudioCache } from '../cache/createAudioCache'
import { useBeltProgress } from '../composables/useBeltProgress'
import { useTheme } from '../composables/useTheme'
import { useInviteCode, type InviteCodeContext } from '../composables/useInviteCode'
import { useAuthModal } from '../composables/useAuthModal'
import { useUserRole } from '../composables/useUserRole'
import { useRouter } from 'vue-router'
import { getLanguageName, getLanguageEndonym, setLocale, useI18n } from '../composables/useI18n'
import { useSharedSubscription } from '../composables/useSubscription'
import { useCheckout } from '../composables/useCheckout'
import { useSharedUserEntitlements } from '../composables/useUserEntitlements'
import { useReleaseNotes } from '../composables/useReleaseNotes'
import { updateAvailable as pwaUpdateAvailable } from '../composables/usePwaUpdate'
import { formatFurthestPoint, canRecoverToFurthest, parseLegoPosition } from '../utils/furthestProgress'

const emit = defineEmits(['close', 'openExplorer', 'openListening', 'settingChanged'])

const props = defineProps({
  course: {
    type: Object,
    default: null
  }
})

// Inject auth and data providers
const auth = inject('auth', null)
const supabase = inject('supabase', null)
const courseDataProvider = inject('courseDataProvider', null)

// Get belt progress for current seed position
const courseCode = computed(() => props.course?.course_code || 'demo')
const beltProgressInstance = useBeltProgress(courseCode.value)
const { completedRounds, currentBelt, totalLearningMinutes, totalSessionCount, highestLegoId } = beltProgressInstance

// Reset progress state
const showResetConfirm = ref(false)
const isResetting = ref(false)
const resetError = ref(null)
const resetSuccess = ref(false)

// Current course info for reset
const courseName = computed(() => {
  if (props.course?.target_lang) return getLanguageName(props.course.target_lang)
  return props.course?.course_code || 'this course'
})

// Data for reset confirmation — show what will be lost
const seedsCompleted = computed(() => {
  if (!highestLegoId.value) return 0
  const match = highestLegoId.value.match(/^S(\d{4})L/)
  return match ? parseInt(match[1], 10) : 0
})
const hasProgress = computed(() => seedsCompleted.value > 0 || totalLearningMinutes.value > 0)

// ============================================================================
// FURTHEST-POINT RECOVERY (catastrophe recovery — settings-only, opt-in)
//
// Reads the ratcheted ceiling (course_enrollments.highest_completed_lego_id /
// highest_completed_round_index) directly — this is deliberately NOT the same
// as useBeltProgress's `highestLegoId`, which mirrors the cursor under the
// 2026-07-04 cursor-only model. The ceiling is the one value that only ever
// moves forward and is written by the DB ratchet trigger, so it survives an
// uninstall + fresh login even if the local cursor is lost. See
// utils/furthestProgress.ts for the "highest incomplete LEGO" definition.
//
// Read-only here: this never writes the ceiling, and never moves the cursor
// except through the explicit confirmRecover action below.
// ============================================================================
const furthestLegoId = ref<string | null>(null)
const furthestRoundIndex = ref<number | null>(null)
const cursorLegoId = ref<string | null>(null)

// Seed sentences (known-language) for the furthest/cursor readouts — best
// effort only. A miss here (course_seeds row not found, query error) just
// falls back to the coordinate-only display; it never blocks the recovery
// action, which only needs the lego id + round index above.
const furthestSeedText = ref<string | null>(null)
const cursorSeedText = ref<string | null>(null)

const loadFurthestProgress = async () => {
  if (!supabase?.value || !auth?.learnerId?.value || auth.learnerId.value.startsWith('guest-') || !courseCode.value) {
    return
  }
  try {
    const { data, error } = await supabase.value
      .from('course_enrollments')
      .select('last_completed_lego_id, highest_completed_lego_id, highest_completed_round_index')
      .eq('learner_id', auth.learnerId.value)
      .eq('course_id', courseCode.value)
      .maybeSingle()

    if (error) {
      console.warn('[Settings] Failed to load furthest progress:', error.message)
      return
    }

    cursorLegoId.value = data?.last_completed_lego_id ?? null
    furthestLegoId.value = data?.highest_completed_lego_id ?? null
    furthestRoundIndex.value = typeof data?.highest_completed_round_index === 'number'
      ? data.highest_completed_round_index
      : null

    loadSeedTexts()
  } catch (err) {
    console.warn('[Settings] Failed to load furthest progress:', err)
  }
}

// Best-effort lookup of the known-language sentence for the furthest/cursor
// seed numbers, so the readout can say what those positions actually mean.
const loadSeedTexts = async () => {
  if (!supabase?.value || !courseCode.value) return

  const seedNumbers = [...new Set(
    [furthestLegoId.value, cursorLegoId.value]
      .map(id => parseLegoPosition(id)?.seed)
      .filter((n): n is number => typeof n === 'number')
  )]
  if (seedNumbers.length === 0) return

  try {
    const { data, error } = await supabase.value
      .from('course_seeds')
      .select('seed_number, known_text')
      .eq('course_code', courseCode.value)
      .in('seed_number', seedNumbers)

    if (error || !data) return

    const textBySeed = new Map<number, string>(data.map((row: any) => [row.seed_number, row.known_text]))
    const furthestSeed = parseLegoPosition(furthestLegoId.value)?.seed
    const cursorSeed = parseLegoPosition(cursorLegoId.value)?.seed
    furthestSeedText.value = (furthestSeed !== undefined ? textBySeed.get(furthestSeed) : null) ?? null
    cursorSeedText.value = (cursorSeed !== undefined ? textBySeed.get(cursorSeed) : null) ?? null
  } catch (err) {
    console.warn('[Settings] Failed to load seed text (non-fatal):', err)
  }
}

// Position is never shown as "Seed N" — only the sentence (when resolved) or
// generic "your furthest point" wording. `hasFurthestPoint` (not the display
// string, which may be null when the sentence lookup hasn't resolved) gates
// whether the feature row appears at all.
const furthestPointDisplay = computed(() => formatFurthestPoint(furthestLegoId.value, furthestSeedText.value))
const cursorPointDisplay = computed(() => formatFurthestPoint(cursorLegoId.value, cursorSeedText.value))
const hasFurthestPoint = computed(() => !!furthestLegoId.value)
const canRecover = computed(() =>
  canRecoverToFurthest(cursorLegoId.value, furthestLegoId.value) && furthestRoundIndex.value !== null
)
const recoverDescription = computed(() => {
  const furthest = furthestPointDisplay.value
  const cursor = cursorPointDisplay.value
  if (canRecover.value) {
    const base = furthest
      ? `If this device's progress ever resets, jump back to your furthest point: ${furthest}.`
      : `If this device's progress ever resets, jump back to your furthest point.`
    return cursor ? `${base} You are currently at: ${cursor}.` : base
  }
  return furthest
    ? `You're at your furthest point: ${furthest}.`
    : `You're at your furthest point.`
})
const recoverConfirmText = computed(() => furthestPointDisplay.value
  ? `This will move your position to your furthest point: ${furthestPointDisplay.value} — continue?`
  : 'This will move your position to your furthest point — continue?'
)

onMounted(loadFurthestProgress)

// Recover-to-furthest confirmation state
const showRecoverConfirm = ref(false)
const isRecovering = ref(false)
const recoverError = ref<string | null>(null)
const recoverSuccess = ref(false)

const handleRecoverClick = () => {
  if (!canRecover.value) return
  showRecoverConfirm.value = true
  recoverError.value = null
  recoverSuccess.value = false
}

const cancelRecover = () => {
  showRecoverConfirm.value = false
}

const confirmRecover = async () => {
  if (!supabase?.value || !auth?.learnerId?.value || !courseCode.value || !furthestLegoId.value || furthestRoundIndex.value === null) {
    recoverError.value = 'Unable to recover position'
    return
  }

  isRecovering.value = true
  recoverError.value = null

  try {
    const { error } = await supabase.value
      .from('course_enrollments')
      .update({
        last_completed_lego_id: furthestLegoId.value,
        last_completed_round_index: furthestRoundIndex.value,
        current_cycle_index: 0,
        last_practiced_at: new Date().toISOString(),
      })
      .eq('learner_id', auth.learnerId.value)
      .eq('course_id', courseCode.value)

    if (error) throw error

    // The device's cached position (localStorage) is checked BEFORE the
    // server cursor on resume — clear it so the reload below actually picks
    // up the recovered position instead of re-serving a stale local cache.
    try {
      localStorage.removeItem(`ssi_learning_position_${courseCode.value}`)
    } catch { /* ignore — best-effort */ }

    recoverSuccess.value = true
    setTimeout(() => {
      showRecoverConfirm.value = false
      recoverSuccess.value = false
      window.location.reload()
    }, 1200)
  } catch (err) {
    console.error('[Settings] Recover-to-furthest error:', err)
    recoverError.value = 'Failed to recover position'
  } finally {
    isRecovering.value = false
  }
}

const formattedLearningTime = computed(() => {
  const mins = totalLearningMinutes.value
  if (mins <= 0) return null
  if (mins < 60) return `${mins} min learned`
  const hours = Math.floor(mins / 60)
  const remaining = mins % 60
  if (remaining === 0) return `${hours} hr learned`
  return `${hours} hr ${remaining} min learned`
})

// App info
const buildNumber = typeof __BUILD_NUMBER__ !== 'undefined' ? __BUILD_NUMBER__ : 'dev'
const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''
const formattedBuildTime = computed(() => {
  if (!buildTime) return ''
  try {
    const d = new Date(buildTime)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
})
const versionDisplay = computed(() => {
  const sha = buildNumber || 'dev'
  return formattedBuildTime.value ? `${sha} · ${formattedBuildTime.value}` : sha
})

// What's new — latest curated release notes from Supabase
const { notes: releaseNotes, isLoading: notesLoading, load: loadReleaseNotes } = useReleaseNotes()
const showAllNotes = ref(false)
const visibleNotes = computed(() => showAllNotes.value ? releaseNotes.value : releaseNotes.value.slice(0, 1))
function formatReleaseDate(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '' }
}

// Per-note bullet expansion — a note can carry ~15 bullets and swamp the whole
// screen, so each note collapses to the first few with its own Read-more toggle.
// State is keyed by note.id so expanding one note never expands another. This is
// independent of showAllNotes (the earlier-updates toggle above).
const BULLET_PREVIEW_COUNT = 4
const expandedNoteIds = ref<Set<string>>(new Set())
function isNoteExpanded(id: string): boolean {
  return expandedNoteIds.value.has(id)
}
function toggleNoteExpanded(id: string): void {
  const next = new Set(expandedNoteIds.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  expandedNoteIds.value = next
}
function visibleBullets(note: { id: string; bullets: string[] }): string[] {
  const all = note.bullets || []
  if (isNoteExpanded(note.id) || all.length <= BULLET_PREVIEW_COUNT) return all
  return all.slice(0, BULLET_PREVIEW_COUNT)
}

// Newer-version flag — does the latest published note describe a build NEWER than
// the one running? Version strings are git SHAs (NOT orderable), so SHA-equality
// is the "you're current" short-circuit and released_at-vs-buildTime decides the
// rest. Guarded so dev builds (no buildTime / SHA 'dev') never flag.
//
// SHAs must be compared on a normalised prefix, NOT exact string ==: buildNumber
// is sliced to 7 chars (VERCEL_GIT_COMMIT_SHA.slice(0,7)) but release-note
// versions are stored at a different length (e.g. 8 chars). Exact == therefore
// NEVER matched even on the build a note describes, so the "you're current"
// short-circuit never fired → released_at (always after buildTime, since notes
// are written post-deploy) produced a PERMANENT false "Update available" that
// tapping couldn't clear. Compare on the shorter prefix to be length-agnostic.
const latestNote = computed(() => releaseNotes.value[0] || null)
function shaPrefixEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const n = Math.min(a.length, b.length)
  return n > 0 && a.slice(0, n) === b.slice(0, n)
}
const onLatestNoteVersion = computed(() => !!latestNote.value && shaPrefixEq(latestNote.value.version, buildNumber))
const noteIndicatesNewer = computed(() => {
  const n = latestNote.value
  if (!n || onLatestNoteVersion.value) return false
  // PROD-only nudge: dev/staging run DIFFERENT SHAs than the prod-stamped note
  // (same content, different commits), so version !== buildNumber there and the
  // date check below would false-fire a permanent "Update available". The newer-
  // version nudge only makes sense for real prod learners — gate to the production
  // host (same hostname convention as LearningPlayer.vue's env detection).
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  if (host !== 'saysomethingin.app' && host !== 'www.saysomethingin.app') return false
  if (!buildTime || buildNumber === 'dev') return false
  const bt = Date.parse(buildTime)
  if (Number.isNaN(bt)) return false
  return new Date(n.released_at).getTime() > bt + 5 * 60 * 1000 /* 5-min tolerance */
})
// Build-row badge fires on either the service-worker signal or a note that
// describes a build the user doesn't have yet.
const showUpdateBadge = computed(() => pwaUpdateAvailable.value || noteIndicatesNewer.value)

// Practice mode visibility (default: off — unlocked via settings or notification)
const showListeningMode = ref(false)
const showPronunciationMode = ref(false)

// Speed setting
// Interface language
const { t } = useI18n()

const INTERFACE_LANGUAGES = [
  { code: 'eng', label: 'English' },
  { code: 'gle', label: 'Gaeilge' },
  { code: 'cym', label: 'Cymraeg' },
  { code: 'spa', label: 'Español' },
  { code: 'fra', label: 'Français' },
  { code: 'deu', label: 'Deutsch' },
  { code: 'ita', label: 'Italiano' },
  { code: 'por', label: 'Português' },
  { code: 'jpn', label: '日本語' },
  { code: 'kor', label: '한국어' },
  { code: 'zho', label: '中文' },
  { code: 'ara', label: 'العربية' },
  { code: 'hin', label: 'हिन्दी' },
  { code: 'ben', label: 'বাংলা' },
  { code: 'tam', label: 'தமிழ்' },
  { code: 'urd', label: 'اردو' },
  { code: 'guj', label: 'ગુજરાતી' },
  { code: 'pan', label: 'ਪੰਜਾਬੀ' },
  { code: 'sin', label: 'සිංහල' },
]

const currentInterfaceLang = ref(localStorage.getItem('ssi-locale') || 'eng')
const showLangPicker = ref(false)

const setInterfaceLanguage = (code: string) => {
  currentInterfaceLang.value = code
  setLocale(code)
  showLangPicker.value = false
}

const currentLangLabel = computed(() => {
  return INTERFACE_LANGUAGES.find(l => l.code === currentInterfaceLang.value)?.label || 'English'
})

const speedOptions = [
  { value: 0.7, label: 'Slowest' },
  { value: 0.8, label: 'Slower' },
  { value: 0.9, label: 'Slow' },
  { value: 1.0, label: 'Normal' },
  { value: 1.1, label: 'Faster' },
  { value: 1.25, label: 'Fast' },
]
const learnerSpeed = ref(parseFloat(localStorage.getItem('learner_speed') || '1.0'))
function setLearnerSpeed(value: number) {
  learnerSpeed.value = value
  if (value === 1.0) {
    localStorage.removeItem('learner_speed')
  } else {
    localStorage.setItem('learner_speed', String(value))
  }
}

// Display settings
const showFirePath = ref(true)

// Developer settings (hidden from regular users, useful for debugging)
const showViewScript = ref(false)
const showFragileProgressWarning = ref(true) // Default: show the warning to guests
const enableQaMode = ref(false) // Show Report Issue button
const enableAdaptation = ref(false) // Personalised pacing via microphone
const showDebugOverlay = ref(false) // Show phase/round/LEGO info overlay
const enableVerboseLogging = ref(false) // Detailed console logs
const showListeningAudit = ref(false) // Reveal the 9-stage progression audit mode in Listening → Dialogues

// Theme settings (uses shared composable)
const { theme, toggleTheme: doToggleTheme, isDark } = useTheme()
const isDarkMode = computed(() => isDark())

// Display name management
const showDisplayNameForm = ref(false)
const displayNameInput = ref('')
const displayNameError = ref('')
const displayNameSuccess = ref(false)
const isSavingDisplayName = ref(false)

const handleSaveDisplayName = async () => {
  displayNameError.value = ''
  displayNameSuccess.value = false

  const name = displayNameInput.value.trim()
  if (!name) {
    displayNameError.value = 'Name cannot be empty'
    return
  }

  if (!supabase?.value || !auth?.learnerId?.value) {
    displayNameError.value = 'Not connected'
    return
  }

  isSavingDisplayName.value = true
  try {
    // Update Supabase Auth metadata
    const { error: authError } = await supabase.value.auth.updateUser({
      data: { display_name: name }
    })
    if (authError) {
      displayNameError.value = authError.message
      return
    }

    // Update learners table. Key on the auth uid only — learners.user_id holds
    // auth.uid()::text, so falling back to learnerId (the learners PK / a
    // guest id) matches nothing AND fails the own-row RLS WITH CHECK.
    if (auth.userId?.value) {
      await supabase.value
        .from('learners')
        .update({ display_name: name })
        .eq('user_id', auth.userId.value)
    }

    // Update local auth user metadata
    if (auth.user?.value) {
      auth.user.value = {
        ...auth.user.value,
        user_metadata: { ...auth.user.value.user_metadata, display_name: name }
      }
    }

    displayNameSuccess.value = true
    showDisplayNameForm.value = false
  } catch {
    displayNameError.value = 'Failed to update name'
  } finally {
    isSavingDisplayName.value = false
  }
}

// Subscription management
const {
  openPortal,
  isLoading: isPortalLoading,
  error: portalError,
  subscription,
  isSubscribed,
  cancelSubscription,
  refresh: refreshSubscription,
} = useSharedSubscription()
const portalFeedback = ref('')

const handleManageSubscription = async () => {
  portalFeedback.value = ''
  try {
    await openPortal()
  } catch {
    portalFeedback.value = 'Unable to open billing portal. You may not have an active subscription.'
  }
}

// In-app cancellation — keeps users in the app for the common action. The
// hosted Paddle portal is only needed for the rare card-update / invoice case.
const showCancelConfirm = ref(false)
const isCancelling = ref(false)
const cancelError = ref('')

const subscriptionEndsAt = computed(() => {
  const end = subscription.value?.currentPeriodEnd
  if (!end) return null
  return new Date(end).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
})
const isCancelScheduled = computed(() => !!subscription.value?.cancelAtPeriodEnd)

function openCancelConfirm() {
  cancelError.value = ''
  showCancelConfirm.value = true
}
function dismissCancelConfirm() {
  showCancelConfirm.value = false
}
async function confirmCancel() {
  isCancelling.value = true
  cancelError.value = ''
  const res = await cancelSubscription()
  isCancelling.value = false
  if (res.ok) {
    showCancelConfirm.value = false
  } else {
    cancelError.value = res.error || 'Could not cancel. Please try Payment & invoices instead.'
  }
}
const { startCheckout } = useCheckout()
function goPremium() {
  // Open the single Premium checkout directly (signed-out users get the auth
  // modal first, then auto-continue into Paddle). No marketing page.
  startCheckout({ courseCode: props.course?.course_code || null })
}

// Account management state
const showDeleteConfirm = ref(false)
const isDeleting = ref(false)
const deleteError = ref(null)
const deleteConfirmInput = ref('')
const deleteConfirmMatch = computed(() => deleteConfirmInput.value.trim().toUpperCase() === 'DELETE')

// Check if user is signed in
const isSignedIn = computed(() => auth?.user?.value != null)
const userEmail = computed(() => auth?.user?.value?.email || '')
const userName = computed(() => auth?.user?.value?.user_metadata?.display_name || '')

// Roles from DB (learners.platform_role)
const { isSsiAdmin: isAdmin, isTester } = useUserRole()

const { open: openAuth } = useAuthModal()
const router = useRouter()

// Install app link — only show when running in browser (not installed PWA)
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as any).standalone === true

// School role check
const SCHOOL_ROLES = ['teacher', 'school_admin', 'govt_admin']
const educationalRole = ref<string | null>(null)
const platformRole = ref<string | null>(null)
const hasSchoolRole = computed(() => educationalRole.value != null && SCHOOL_ROLES.includes(educationalRole.value))
const hasAdminRole = computed(() => platformRole.value === 'ssi_admin')

watch(isSignedIn, async (signedIn) => {
  // Key on the auth uid only — learners.user_id holds auth.uid()::text; the
  // learnerId fallback queried the wrong identity and (under RLS) returned
  // nothing, leaving roles null for everyone.
  if (signedIn && supabase?.value && auth?.userId?.value) {
    try {
      const { data } = await supabase.value
        .from('learners')
        .select('educational_role, platform_role')
        .eq('user_id', auth.userId.value)
        .single()
      educationalRole.value = data?.educational_role || null
      platformRole.value = data?.platform_role || null
    } catch {
      educationalRole.value = null
      platformRole.value = null
    }
  } else {
    educationalRole.value = null
    platformRole.value = null
  }
}, { immediate: true })

// Join school/class via invite code
const { validateCode, redeemCode, pendingCode, clearPendingCode } = useInviteCode()
const showJoinCode = ref(false)
const joinCodeInput = ref('')
const joinError = ref('')
const joinContext = ref<InviteCodeContext | null>(null)
const isJoinValidating = ref(false)
const isJoinRedeeming = ref(false)
const joinSuccess = ref(false)

const handleJoinCodeInput = (event: Event) => {
  const target = event.target as HTMLInputElement
  let val = target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  if (val.length === 4 && !val.includes('-')) {
    val = val.slice(0, 3) + '-' + val.slice(3)
  }
  if (val.length > 7) val = val.slice(0, 7)
  joinCodeInput.value = val
}

const handleJoinValidate = async () => {
  joinError.value = ''
  joinContext.value = null
  isJoinValidating.value = true
  try {
    const valid = await validateCode(joinCodeInput.value)
    if (valid && pendingCode.value) {
      joinContext.value = { ...pendingCode.value }
    } else {
      joinError.value = 'Invalid or expired code'
    }
  } catch {
    joinError.value = 'Failed to validate code'
  } finally {
    isJoinValidating.value = false
  }
}

const joinContextRole = computed(() => {
  if (!joinContext.value) return ''
  if (joinContext.value.codeKind === 'entitlement') {
    return joinContext.value.label || 'Access Code'
  }
  const map: Record<string, string> = { ssi_admin: 'SSi Admin', govt_admin: 'Group Admin', school_admin: 'School Admin', school_admin_join: 'School Admin', teacher: 'Teacher', student: 'Student', tester: 'Beta Tester' }
  return map[joinContext.value.codeType || ''] || joinContext.value.codeType || ''
})

const joinContextDetail = computed(() => {
  if (!joinContext.value) return ''
  const ctx = joinContext.value
  if (ctx.codeKind === 'entitlement') {
    const parts = []
    if (ctx.accessDescription) parts.push(ctx.accessDescription)
    if (ctx.durationDescription) parts.push(ctx.durationDescription)
    return parts.join(', ')
  }
  if (ctx.schoolName) return `at ${ctx.schoolName}`
  if (ctx.groupName) return `for ${ctx.groupName}`
  if (ctx.className) return ctx.className
  return ''
})

const { refresh: refreshEntitlements } = useSharedUserEntitlements()

const handleJoinRedeem = async () => {
  isJoinRedeeming.value = true
  joinError.value = ''
  try {
    const token = await auth?.getToken?.()
    if (!token) {
      joinError.value = 'Not signed in'
      return
    }
    const result = await redeemCode(token)
    if (result.success) {
      joinSuccess.value = true
      joinContext.value = null
      clearPendingCode()
      // Refresh entitlements if an entitlement code was redeemed
      if (result.codeKind === 'entitlement') {
        refreshEntitlements()
      }
    } else {
      joinError.value = result.error || 'Failed to join'
    }
  } catch {
    joinError.value = 'Failed to redeem code'
  } finally {
    isJoinRedeeming.value = false
  }
}

// Sign out — the reload must always run, even if signOut throws, so the button
// never appears to "do nothing".
const handleSignOut = async () => {
  try {
    if (auth?.signOut) {
      await auth.signOut()
    }
  } finally {
    window.location.reload()
  }
}

// Password management
const showPasswordForm = ref(false)
const passwordInput = ref('')
const passwordConfirm = ref('')
const passwordError = ref('')
const passwordSuccess = ref(false)
const isSavingPassword = ref(false)
const hasPassword = computed(() => auth?.user?.value?.user_metadata?.has_password === true)

const handleSavePassword = async () => {
  passwordError.value = ''
  passwordSuccess.value = false

  if (passwordInput.value.length < 6) {
    passwordError.value = 'Password must be at least 6 characters'
    return
  }
  if (passwordInput.value !== passwordConfirm.value) {
    passwordError.value = 'Passwords do not match'
    return
  }

  isSavingPassword.value = true
  try {
    const result = await auth?.updatePassword?.(passwordInput.value)
    if (result?.error) {
      passwordError.value = result.error
    } else {
      passwordSuccess.value = true
      passwordInput.value = ''
      passwordConfirm.value = ''
      showPasswordForm.value = false
    }
  } catch {
    passwordError.value = 'Failed to update password'
  } finally {
    isSavingPassword.value = false
  }
}

// Verified emails management
const showAddEmailForm = ref(false)
const addEmailInput = ref('')
const addEmailOtp = ref('')
const addEmailError = ref('')
const addEmailStep = ref<'email' | 'otp'>('email')
const isSendingOtp = ref(false)
const isVerifyingOtp = ref(false)
const addEmailSuccess = ref(false)

const verifiedEmails = computed(() => auth?.learner?.value?.verified_emails || [])
const primaryEmail = computed(() => auth?.user?.value?.email || '')

const handleSendAddEmailOtp = async () => {
  addEmailError.value = ''
  const email = addEmailInput.value.trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    addEmailError.value = 'Please enter a valid email address'
    return
  }

  if (verifiedEmails.value.includes(email)) {
    addEmailError.value = 'This email is already linked to your account'
    return
  }

  if (!supabase?.value) {
    addEmailError.value = 'Not connected'
    return
  }

  isSendingOtp.value = true
  try {
    // Use Supabase Auth to send an OTP to the new email
    // This creates an auth user for this email if one doesn't exist
    const { error: otpError } = await supabase.value.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    })
    if (otpError) {
      addEmailError.value = otpError.message || 'Failed to send verification code'
    } else {
      addEmailStep.value = 'otp'
    }
  } catch {
    addEmailError.value = 'Failed to send verification code'
  } finally {
    isSendingOtp.value = false
  }
}

const handleVerifyAddEmail = async () => {
  addEmailError.value = ''
  const email = addEmailInput.value.trim().toLowerCase()
  const token = addEmailOtp.value.trim()

  if (!token || token.length < 6) {
    addEmailError.value = 'Please enter the 6-digit code'
    return
  }

  if (!supabase?.value || !auth?.learnerId?.value) {
    addEmailError.value = 'Not connected'
    return
  }

  isVerifyingOtp.value = true
  try {
    // Verify via server API to avoid disrupting current session
    const session = await supabase.value.auth.getSession()
    const authToken = session.data?.session?.access_token

    const res = await fetch('/api/email/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ email, token }),
    })

    const data = await res.json()

    if (!res.ok || !data.success) {
      addEmailError.value = data.error || 'Verification failed'
      return
    }

    // Update local state
    const currentEmails = verifiedEmails.value
    const updated = [...new Set([...currentEmails, email])]
    if (auth.learner?.value) {
      auth.learner.value = { ...auth.learner.value, verified_emails: updated }
    }

    addEmailSuccess.value = true
    addEmailInput.value = ''
    addEmailOtp.value = ''
    addEmailStep.value = 'email'
    setTimeout(() => {
      addEmailSuccess.value = false
      showAddEmailForm.value = false
    }, 2000)
  } catch {
    addEmailError.value = 'Verification failed'
  } finally {
    isVerifyingOtp.value = false
  }
}

// Handle delete account
const handleDeleteClick = () => {
  showDeleteConfirm.value = true
  deleteError.value = null
  deleteConfirmInput.value = ''
}

const cancelDelete = () => {
  showDeleteConfirm.value = false
  deleteConfirmInput.value = ''
}

const confirmDelete = async () => {
  if (!supabase?.value || !auth?.learnerId?.value) {
    deleteError.value = 'Unable to delete - not signed in'
    return
  }

  isDeleting.value = true
  deleteError.value = null

  try {
    const learnerId = auth.learnerId.value

    // Delete all user data from all tables
    const tables = [
      'response_metrics',
      'spike_events',
      'lego_progress',
      'seed_progress',
      'sessions',
      'course_enrollments',
    ]

    for (const table of tables) {
      await supabase.value
        .from(table)
        .delete()
        .eq('learner_id', learnerId)
    }

    // Delete learner record
    await supabase.value
      .from('learners')
      .delete()
      .eq('id', learnerId)

    // Sign out (Supabase Auth)
    if (auth?.signOut) {
      await auth.signOut()
    }

    console.log('[Settings] Account deleted successfully')
    // Clear local storage
    localStorage.clear()
    // Reload to go back to welcome screen
    window.location.reload()
  } catch (err) {
    console.error('[Settings] Delete error:', err)
    deleteError.value = 'Failed to delete account. Please contact support.'
  } finally {
    isDeleting.value = false
  }
}

// Toggle dark/light mode — useTheme handles persistence and DOM update
const toggleTheme = () => {
  doToggleTheme()
}

onMounted(async () => {
  // Lazy-load release notes for the What's New panel — cached in the
  // composable singleton across openings, so this is a one-off per session.
  loadReleaseNotes()

  // Load practice mode visibility
  showListeningMode.value = localStorage.getItem('ssi-mode-listening') === 'true'
  showPronunciationMode.value = localStorage.getItem('ssi-mode-pronunciation') === 'true'

  // Load saved display settings
  showFirePath.value = localStorage.getItem('ssi-show-fire-path') !== 'false'

  // Load developer settings
  showViewScript.value = localStorage.getItem('ssi-show-view-script') === 'true'
  showFragileProgressWarning.value = localStorage.getItem('ssi-show-fragile-warning') !== 'false' // Default true
  enableQaMode.value = localStorage.getItem('ssi-enable-qa-mode') === 'true'
  enableAdaptation.value = localStorage.getItem('ssi-adaptation-consent') === 'true'
  showDebugOverlay.value = localStorage.getItem('ssi-show-debug-overlay') === 'true'
  enableVerboseLogging.value = localStorage.getItem('ssi-verbose-logging') === 'true'
  showListeningAudit.value = localStorage.getItem('ssi-listening-audit') === 'true'

  // Pull fresh subscription state so the panel reflects any cancel/renew change.
  refreshSubscription()
})

const toggleListeningMode = () => {
  showListeningMode.value = !showListeningMode.value
  localStorage.setItem('ssi-mode-listening', showListeningMode.value ? 'true' : 'false')
  dispatchSettingChanged('showListeningMode', showListeningMode.value)
}

const togglePronunciationMode = () => {
  showPronunciationMode.value = !showPronunciationMode.value
  localStorage.setItem('ssi-mode-pronunciation', showPronunciationMode.value ? 'true' : 'false')
  dispatchSettingChanged('showPronunciationMode', showPronunciationMode.value)
}

const toggleFirePath = () => {
  showFirePath.value = !showFirePath.value
  localStorage.setItem('ssi-show-fire-path', showFirePath.value ? 'true' : 'false')
  // Dispatch custom event for same-tab reactivity
  window.dispatchEvent(new CustomEvent('ssi-setting-changed', {
    detail: { key: 'showFirePath', value: showFirePath.value }
  }))
  emit('settingChanged', { key: 'showFirePath', value: showFirePath.value })
}

const toggleViewScript = () => {
  showViewScript.value = !showViewScript.value
  localStorage.setItem('ssi-show-view-script', showViewScript.value ? 'true' : 'false')
}

const toggleFragileProgressWarning = () => {
  showFragileProgressWarning.value = !showFragileProgressWarning.value
  localStorage.setItem('ssi-show-fragile-warning', showFragileProgressWarning.value ? 'true' : 'false')
  dispatchSettingChanged('showFragileProgressWarning', showFragileProgressWarning.value)
}

const toggleQaMode = () => {
  enableQaMode.value = !enableQaMode.value
  localStorage.setItem('ssi-enable-qa-mode', enableQaMode.value ? 'true' : 'false')
  dispatchSettingChanged('enableQaMode', enableQaMode.value)
}

const toggleAdaptation = () => {
  enableAdaptation.value = !enableAdaptation.value
  localStorage.setItem('ssi-adaptation-consent', enableAdaptation.value ? 'true' : 'false')
  dispatchSettingChanged('adaptationConsent', enableAdaptation.value)
}

const toggleDebugOverlay = () => {
  showDebugOverlay.value = !showDebugOverlay.value
  localStorage.setItem('ssi-show-debug-overlay', showDebugOverlay.value ? 'true' : 'false')
  dispatchSettingChanged('showDebugOverlay', showDebugOverlay.value)
}

const toggleVerboseLogging = () => {
  enableVerboseLogging.value = !enableVerboseLogging.value
  localStorage.setItem('ssi-verbose-logging', enableVerboseLogging.value ? 'true' : 'false')
  dispatchSettingChanged('enableVerboseLogging', enableVerboseLogging.value)
}

const toggleListeningAudit = () => {
  showListeningAudit.value = !showListeningAudit.value
  localStorage.setItem('ssi-listening-audit', showListeningAudit.value ? 'true' : 'false')
  dispatchSettingChanged('listeningAudit', showListeningAudit.value)
}

// Clear all caches and reload (less destructive than ?reset=1 — preserves
// Supabase auth so the user stays signed in across the wipe).
//
// 2026-05-23: this button is gated behind sign-in (it lives in Settings),
// so wiping the auth token alongside everything else immediately signed
// the user out — a circular UX trap that made the recovery tool useless
// for debugging without a re-login round-trip. Auth tokens are signed by
// Supabase and remain valid across localStorage clear if we restore them
// afterwards. ?reset=1 stays as the nuclear option that does wipe auth
// too (different intent: full factory reset).
// ── Troubleshooting (cache / service-worker recovery) ───────────────────────
// The core UX win here is LEGIBILITY: a recovery action used to fire silently
// and then maybe reload, leaving the user staring at an unchanged screen unsure
// if anything happened. Instead every action runs a staged, screen-owning
// "Fixing things…" overlay that narrates each step (✓ as it completes) and ends
// in a definite reload — never dead air. Two graduated actions:
//   • Update to the latest version — light: activate the waiting SW + reload.
//     Keeps audio + progress. Fixes the common "stuck on an old version" case.
//   • Clear cache & reload — heavy: wipe local data (gated behind a confirm that
//     warns about paid offline downloads and unbacked-up guest progress).

type FixStepStatus = 'pending' | 'running' | 'done'
interface FixStep { key: string; label: string; status: FixStepStatus }
const fixOverlayOpen = ref(false)
const fixOverlayTitle = ref('Fixing things…')
const fixSteps = ref<FixStep[]>([])
const fixNote = ref('')

// Guarded reload — the SKIP_WAITING / controllerchange dance can fire a reload
// from more than one place; this makes sure it only happens once.
let _reloading = false
const guardedReload = () => {
  if (_reloading) return
  _reloading = true
  window.location.reload()
}

// Known IndexedDB databases — the fallback for browsers without
// indexedDB.databases() (Safari/iOS WebKit before ~14.5). Without this, those
// users — exactly the ones most likely to hit cache bugs — would have NOTHING
// cleared. Keep in sync with the app's DB names (audio cache, course bundles,
// script cache, the dead sync queue).
const KNOWN_IDB_NAMES = ['ssi-audio-cache-v2', 'ssi-course-bundles-v1', 'ssi-script-cache', 'ssi-sync-queue']

// Delete one IndexedDB database, resolving even if it's blocked by an open
// connection (a blocked delete is what used to make the wipe "appear to hang").
const deleteDatabaseSafely = (name: string): Promise<void> =>
  new Promise<void>((resolve) => {
    let settled = false
    const finish = () => { if (!settled) { settled = true; resolve() } }
    try {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = finish
      req.onerror = finish
      req.onblocked = finish
    } catch { finish() }
    setTimeout(finish, 2000) // never hang the flow on a blocked DB
  })

// Delete IndexedDB databases matching `match`. Uses indexedDB.databases() where
// available, else falls back to the known names so older iOS/WebKit still gets
// cleared. Never throws.
const deleteIndexedDbs = async (match: (name: string) => boolean): Promise<void> => {
  let names: string[] = []
  try {
    if (window.indexedDB?.databases) {
      const dbs = await indexedDB.databases()
      names = dbs.map((d) => d.name).filter((n): n is string => !!n)
    }
  } catch { /* enumeration unavailable/blocked */ }
  if (names.length === 0) names = KNOWN_IDB_NAMES   // fallback for browsers without databases()
  await Promise.all(names.filter(match).map((n) => deleteDatabaseSafely(n)))
}

// Run a list of async steps with visible per-step progress, then reload.
const runFixFlow = async (
  title: string,
  steps: Array<{ key: string; label: string; run: () => Promise<void> }>,
  note = '',
) => {
  fixOverlayTitle.value = title
  fixNote.value = note
  fixSteps.value = steps.map((s) => ({ key: s.key, label: s.label, status: 'pending' }))
  fixOverlayOpen.value = true
  for (let i = 0; i < steps.length; i++) {
    fixSteps.value[i].status = 'running'
    try { await steps[i].run() } catch (err) { console.warn('[Troubleshoot] step failed:', steps[i].key, err) }
    fixSteps.value[i].status = 'done'
    // A short beat so each ✓ is actually seen on a fast device — the point is
    // that the user watches it work, not that it's instant.
    await new Promise((r) => setTimeout(r, 320))
  }
  guardedReload()
}

// Light action — get the newest version without touching audio or progress.
const handleUpdateToLatest = () => {
  if (fixOverlayOpen.value) return
  void runFixFlow('Getting the latest version…', [
    {
      key: 'check', label: 'Checking for the latest version',
      run: async () => {
        const reg = await navigator.serviceWorker?.getRegistration?.()
        if (reg) { try { await reg.update() } catch { /* offline / no SW */ } }
      },
    },
    {
      key: 'apply', label: 'Switching to the latest version',
      run: async () => {
        // Drop the navigation/runtime caches FIRST so the fresh shell is fetched
        // (NOT the audio cache — keep the downloads). This MUST happen before
        // SKIP_WAITING: activating the new SW fires `controllerchange`, on which
        // vite-plugin-pwa reloads the page itself — so anything after the post
        // here can be skipped by that reload.
        try {
          const keys = await caches.keys()
          await Promise.all(keys.filter((k) => !/audio/i.test(k)).map((k) => caches.delete(k)))
        } catch { /* Cache API unavailable */ }
        const reg = await navigator.serviceWorker?.getRegistration?.()
        if (reg?.waiting) {
          // Activate the waiting SW. vite-plugin-pwa owns the reload on
          // controllerchange; runFixFlow's guardedReload below is the fallback
          // for when there's no waiting SW (or controllerchange never fires).
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      },
    },
  ], 'Still stuck? Fully close the app and open it again.')
}

// Heavy action — full local wipe, gated behind a confirm dialog.
const showClearConfirm = ref(false)
const offlineMb = ref(0)            // size of paid offline downloads, for the warning
// Guest = genuinely not signed in. Key off the positive isSignedIn signal, NOT
// the learnerId guest- fallback (learnerId returns a 'guest-' id while a real
// learner's row is still loading, which would wrongly flash the guest warning at
// a signed-in user). auth null → not signed in → guest, which is the safe side.
const isGuestLearner = computed(() => !isSignedIn.value)

// Transparency: how much audio is downloaded for offline, shown at rest so the
// learner can SEE what's stored before they touch anything ("it's not clear
// what's going on" was the original complaint).
const downloadedMb = ref<number | null>(null)
onMounted(async () => {
  try {
    const s = await getAudioCache().stats()
    downloadedMb.value = Math.round((s.persistent.bytes || 0) / 1e6)
  } catch { /* best-effort */ }
})

const openClearConfirm = async () => {
  if (fixOverlayOpen.value) return
  offlineMb.value = 0
  showClearConfirm.value = true
  try {
    const s = await getAudioCache().stats()
    offlineMb.value = Math.round((s.persistent.bytes || 0) / 1e6)
  } catch { /* stats best-effort */ }
}
const cancelClearConfirm = () => { showClearConfirm.value = false }
// Close the confirm AND the settings overlay before opening auth — the auth
// modal renders behind settings, so without emit('close') it'd be invisible
// (same pattern as the "Sign In" CTA above).
const createAccountFromClear = () => { showClearConfirm.value = false; emit('close'); openAuth() }

const confirmClearCache = () => {
  showClearConfirm.value = false
  // Snapshot Supabase auth so a signed-in user stays signed in across the wipe.
  const authKeys: Array<[string, string]> = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (key.startsWith('sb-')) {
      const value = localStorage.getItem(key)
      if (value !== null) authKeys.push([key, value])
    }
  }
  void runFixFlow('Fixing things…', [
    {
      key: 'audio', label: 'Clearing downloaded audio',
      run: async () => {
        await deleteIndexedDbs((name) => /audio|bundle/i.test(name))
      },
    },
    {
      key: 'data', label: 'Clearing app data',
      run: async () => {
        localStorage.clear()
        sessionStorage.clear()
        // Restore auth IMMEDIATELY — before the IndexedDB work below, so that a
        // rejecting indexedDB.databases() (possible on a wedged browser, which is
        // exactly when this tool gets used) can never strand a signed-in user
        // logged out. The IDB step doesn't touch localStorage, so order is free.
        for (const [key, value] of authKeys) { try { localStorage.setItem(key, value) } catch { /* quota */ } }
        await deleteIndexedDbs(() => true)
      },
    },
    {
      key: 'version', label: 'Getting the latest version',
      run: async () => {
        await Promise.all([
          unregisterAllServiceWorkers().catch(() => {}),
          clearAllCaches().catch(() => {}),
        ])
      },
    },
  ], 'Still stuck? Fully close the app and open it again.')
}

// Helper to dispatch setting change events
const dispatchSettingChanged = (key: string, value: boolean) => {
  window.dispatchEvent(new CustomEvent('ssi-setting-changed', {
    detail: { key, value }
  }))
}

// Reset progress functions
const handleResetClick = () => {
  showResetConfirm.value = true
  resetError.value = null
  resetSuccess.value = false
}

const cancelReset = () => {
  showResetConfirm.value = false
}

const confirmReset = async () => {
  if (!courseCode.value) {
    resetError.value = 'No course selected'
    return
  }

  isResetting.value = true
  resetError.value = null

  try {
    const course = courseCode.value

    // Clear Supabase tables if signed in
    if (supabase?.value && auth?.learnerId?.value && !auth.learnerId.value.startsWith('guest-')) {
      const learnerId = auth.learnerId.value

      // Delete from tables in order (respecting FK constraints)
      const tables = [
        'response_metrics',
        'spike_events',
        'lego_progress',
        'seed_progress',
        'sessions',
      ]

      for (const table of tables) {
        const { error } = await supabase.value
          .from(table)
          .delete()
          .eq('learner_id', learnerId)
          .eq('course_id', course)

        if (error) {
          console.warn(`[Reset] Error clearing ${table}:`, error.message)
        }
      }

      // Reset enrollment stats for this course only. Also clear the legacy
      // ratcheted "furthest reached" fields (highest_completed_lego_id,
      // highest_completed_round_index, completed_pod_rounds,
      // infplay_round_index) alongside the resume cursor. These columns are
      // being retired (2026-07-04 cursor-only decision) but are still
      // written by the DB ratchet trigger / pod scheduler for stale-PWA
      // compatibility, so a deliberate restart nulls them too rather than
      // leaving inconsistent legacy state behind.
      await supabase.value
        .from('course_enrollments')
        .update({
          total_practice_minutes: 0,
          last_practiced_at: null,
          highest_completed_seed: 0,
          last_completed_lego_id: null,
          highest_completed_lego_id: null,
          last_completed_round_index: null,
          highest_completed_round_index: null,
          completed_pod_rounds: 0,
          pod_activation_round: null,
          infplay_round_index: 0,
          current_mode: 'main',
        })
        .eq('learner_id', learnerId)
        .eq('course_id', course)
    }

    // Always reset local belt progress (localStorage + session history)
    beltProgressInstance.resetProgress()

    resetSuccess.value = true
    console.log('[Settings] Progress reset complete for course:', course)

    // Close dialog after brief success message, then reload to reset player state
    setTimeout(() => {
      showResetConfirm.value = false
      resetSuccess.value = false
      window.location.reload()
    }, 1500)
  } catch (err) {
    console.error('[Settings] Reset error:', err)
    resetError.value = 'Failed to reset progress'
  } finally {
    isResetting.value = false
  }
}
</script>

<template>
  <div class="settings-screen">
    <!-- Reset Confirmation Dialog -->
    <Transition name="fade">
      <div v-if="showResetConfirm" class="reset-overlay">
        <div class="reset-dialog">
          <div class="reset-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 9v4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
            </svg>
          </div>
          <h3 class="reset-title">Reset {{ courseName }}?</h3>
          <div v-if="hasProgress" class="reset-stats">
            <div v-if="currentBelt.index > 0" class="reset-stat">
              <span class="reset-stat-value" :style="{ color: currentBelt.color }">{{ currentBelt.name }} belt</span>
            </div>
            <div v-if="seedsCompleted > 0" class="reset-stat">
              <span class="reset-stat-value">{{ seedsCompleted }} seeds learned</span>
            </div>
            <div v-if="totalLearningMinutes > 0" class="reset-stat">
              <span class="reset-stat-value">{{ totalLearningMinutes }} min practiced</span>
            </div>
            <div v-if="totalSessionCount > 0" class="reset-stat">
              <span class="reset-stat-value">{{ totalSessionCount }} {{ totalSessionCount === 1 ? 'session' : 'sessions' }}</span>
            </div>
          </div>
          <p class="reset-desc">
            This will clear all progress for this course and start you from the beginning. Other courses are not affected. This cannot be undone.
          </p>
          <p v-if="resetError" class="reset-error">{{ resetError }}</p>
          <p v-if="resetSuccess" class="reset-success">Progress reset!</p>
          <div class="reset-actions">
            <button class="reset-btn reset-btn--cancel" @click="cancelReset" :disabled="isResetting">
              Cancel
            </button>
            <button class="reset-btn reset-btn--confirm" @click="confirmReset" :disabled="isResetting">
              {{ isResetting ? 'Resetting...' : 'Reset Progress' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Recover-to-furthest confirm dialog -->
    <Transition name="fade">
      <div v-if="showRecoverConfirm" class="reset-overlay">
        <div class="reset-dialog">
          <div class="reset-icon recover-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 19V5M5 12l7-7 7 7"/>
            </svg>
          </div>
          <h3 class="reset-title">Move to your furthest point?</h3>
          <p class="reset-desc">
            {{ recoverConfirmText }}
          </p>
          <p v-if="recoverError" class="reset-error">{{ recoverError }}</p>
          <p v-if="recoverSuccess" class="reset-success">Position recovered!</p>
          <div class="reset-actions">
            <button class="reset-btn reset-btn--cancel" @click="cancelRecover" :disabled="isRecovering">
              Cancel
            </button>
            <button class="reset-btn reset-btn--recover" @click="confirmRecover" :disabled="isRecovering">
              {{ isRecovering ? 'Moving...' : 'Move Position' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Clear Cache confirm dialog -->
    <Transition name="fade">
      <div v-if="showClearConfirm" class="reset-overlay">
        <div class="reset-dialog">
          <div class="reset-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 9v4M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/>
            </svg>
          </div>
          <h3 class="reset-title">Clear cache and reload?</h3>
          <p class="reset-desc">
            This clears the app's stored data and reloads from scratch. It fixes most audio and loading problems, and you'll stay signed in.
          </p>
          <p v-if="offlineMb > 0" class="clear-warn">
            Your offline downloads (~{{ offlineMb }} MB) will be removed — you'll need to download them again over the internet.
          </p>
          <div v-if="isGuestLearner" class="clear-warn clear-warn--guest">
            You're not signed in, so your progress on this device isn't backed up. Clearing now will reset it.
            <button class="clear-account-btn" @click="createAccountFromClear">Create a free account to keep it</button>
          </div>
          <div class="reset-actions">
            <button class="reset-btn reset-btn--cancel" @click="cancelClearConfirm">Cancel</button>
            <button class="reset-btn reset-btn--confirm" @click="confirmClearCache">Clear cache</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Staged "Fixing things…" overlay — owns the screen and narrates each step
         so the user always sees something happening, then reloads. -->
    <Transition name="fade">
      <div v-if="fixOverlayOpen" class="fix-overlay">
        <div class="fix-dialog">
          <h3 class="fix-title">{{ fixOverlayTitle }}</h3>
          <ul class="fix-steps">
            <li v-for="step in fixSteps" :key="step.key" class="fix-step" :class="`is-${step.status}`">
              <span class="fix-step-mark" aria-hidden="true">
                <svg v-if="step.status === 'done'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 13l4 4L19 7"/></svg>
                <span v-else-if="step.status === 'running'" class="fix-spinner"></span>
                <span v-else class="fix-dot"></span>
              </span>
              <span class="fix-step-label">{{ step.label }}</span>
            </li>
          </ul>
          <p v-if="fixSteps.length && fixSteps.every(s => s.status === 'done')" class="fix-reloading">Reloading…</p>
          <p v-if="fixNote" class="fix-note">{{ fixNote }}</p>
        </div>
      </div>
    </Transition>

    <!-- Delete Account Confirmation Dialog -->
    <Transition name="fade">
      <div v-if="showDeleteConfirm" class="reset-overlay">
        <div class="reset-dialog">
          <div class="reset-icon delete-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              <line x1="10" y1="11" x2="10" y2="17"/>
              <line x1="14" y1="11" x2="14" y2="17"/>
            </svg>
          </div>
          <h3 class="reset-title">Delete Account?</h3>
          <p class="reset-desc">
            This will permanently delete your account and all your learning progress across all courses. This action cannot be undone.
          </p>
          <div class="delete-confirm-field">
            <label class="inline-label">Type DELETE to confirm</label>
            <input
              v-model="deleteConfirmInput"
              type="text"
              class="inline-input"
              placeholder="DELETE"
              autocomplete="off"
            />
          </div>
          <p v-if="deleteError" class="reset-error">{{ deleteError }}</p>
          <div class="reset-actions">
            <button class="reset-btn reset-btn--cancel" @click="cancelDelete" :disabled="isDeleting">
              Cancel
            </button>
            <button class="reset-btn reset-btn--confirm" @click="confirmDelete" :disabled="isDeleting || !deleteConfirmMatch">
              {{ isDeleting ? 'Deleting...' : 'Delete Account' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Cancel Subscription Confirmation Dialog -->
    <Transition name="fade">
      <div v-if="showCancelConfirm" class="reset-overlay">
        <div class="reset-dialog">
          <h3 class="reset-title">Cancel subscription?</h3>
          <p class="reset-desc">
            You'll stay on Premium until {{ subscriptionEndsAt || 'the end of your current period' }}, then it ends and you won't be charged again. You can re-subscribe any time.
          </p>
          <p v-if="cancelError" class="reset-error">{{ cancelError }}</p>
          <div class="reset-actions">
            <button class="reset-btn reset-btn--cancel" @click="dismissCancelConfirm" :disabled="isCancelling">
              Keep Premium
            </button>
            <button class="reset-btn reset-btn--confirm" @click="confirmCancel" :disabled="isCancelling">
              {{ isCancelling ? 'Cancelling...' : 'Cancel subscription' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Header -->
    <header class="header">
      <div class="header-spacer" />
      <div class="header-center">
        <h1 class="title">Settings</h1>
        <span v-if="formattedLearningTime" class="learning-time">{{ formattedLearningTime }}</span>
      </div>
      <button class="close-btn" @click="emit('close')" aria-label="Close settings">✕</button>
    </header>

    <!-- Main Content -->
    <main class="main">
      <!-- Build / version — tappable: runs the staged "get the latest version"
           flow (the prominent update affordance). Badges when a new version is
           waiting. The "what's new" changelog sits right below. -->
      <button
        type="button"
        class="build-card clickable"
        :class="{ 'has-update': showUpdateBadge }"
        :aria-label="showUpdateBadge ? 'Update available — tap to update' : 'Tap to update to the latest version'"
        @click="handleUpdateToLatest"
      >
        <span class="build-card-version">
          <span class="build-sha">{{ buildNumber || 'dev' }}</span>
          <span v-if="formattedBuildTime" class="build-time">{{ formattedBuildTime }}</span>
        </span>
        <span class="build-card-action">
          <span v-if="showUpdateBadge" class="build-update-badge">Update available</span>
          <span v-else class="build-update-hint">Tap to update</span>
          <svg class="build-card-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
        </span>
      </button>

      <!-- What's New — admin-curated release notes (see /admin/release-notes) -->
      <section v-if="releaseNotes.length > 0" class="section whats-new">
        <h3 class="section-title">{{ t('settings.whatsNew') }}</h3>
        <div class="card">
          <div v-for="(note, idx) in visibleNotes" :key="note.id" class="whats-new-entry">
            <div class="whats-new-head">
              <span class="whats-new-date">{{ formatReleaseDate(note.released_at) }}</span>
              <span v-if="note.version && note.version !== formatReleaseDate(note.released_at)" class="whats-new-version">{{ note.version }}</span>
            </div>
            <p v-if="note.headline" class="whats-new-headline">{{ note.headline }}</p>
            <!-- "In the latest version" marker — only on the newest note, only when
                 it describes a build the user doesn't have yet. -->
            <p v-if="note.id === latestNote?.id && noteIndicatesNewer" class="whats-new-newer">
              ✦ In the latest version — tap the version above to update.
            </p>
            <ul class="whats-new-bullets">
              <li v-for="(bullet, bi) in visibleBullets(note)" :key="bi">{{ bullet }}</li>
            </ul>
            <button
              v-if="note.bullets.length > BULLET_PREVIEW_COUNT"
              type="button"
              class="whats-new-readmore"
              @click="toggleNoteExpanded(note.id)"
            >{{ isNoteExpanded(note.id) ? 'Show less' : `Read more (${note.bullets.length - BULLET_PREVIEW_COUNT} more)…` }}</button>
            <hr v-if="idx < visibleNotes.length - 1" class="whats-new-sep" />
          </div>
          <button
            v-if="releaseNotes.length > 1"
            class="whats-new-toggle"
            @click="showAllNotes = !showAllNotes"
          >{{ showAllNotes ? 'Show latest only' : `See ${releaseNotes.length - 1} earlier update${releaseNotes.length - 1 === 1 ? '' : 's'}` }}</button>
        </div>
      </section>
      <section v-else-if="notesLoading" class="section whats-new">
        <h3 class="section-title">{{ t('settings.whatsNew') }}</h3>
        <div class="card whats-new-loading">Loading…</div>
      </section>

      <!-- Account Section (guest - not signed in) -->
      <section class="section" v-if="!isSignedIn">
        <h3 class="section-title">{{ t('settings.account') }}</h3>
        <div class="card">
          <div class="auth-cta-row">
            <p class="auth-cta-text">Sign in to save your progress across devices</p>
            <div class="auth-cta-buttons">
              <button class="auth-cta-btn primary" @click="emit('close'); openAuth()">Sign In</button>
            </div>
          </div>
        </div>
      </section>

      <!-- Account Section (signed-in users) -->
      <section class="section" v-if="isSignedIn">
        <h3 class="section-title">{{ t('settings.account') }}</h3>
        <div class="card">
          <!-- User Info / Display Name -->
          <div class="setting-row clickable" v-if="userName || userEmail" @click="showDisplayNameForm = !showDisplayNameForm; displayNameInput = userName; displayNameError = ''; displayNameSuccess = false">
            <div class="setting-info">
              <span class="setting-label">{{ userName || 'User' }}</span>
              <span class="setting-desc">{{ userEmail }}</span>
            </div>
            <svg class="chevron" :class="{ rotated: showDisplayNameForm }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <!-- Display Name inline form -->
          <div v-if="showDisplayNameForm" class="inline-form">
            <div class="inline-form-field">
              <label class="inline-label">Display name</label>
              <input
                v-model="displayNameInput"
                type="text"
                class="inline-input"
                placeholder="Your name"
                autocomplete="name"
              />
            </div>
            <div v-if="displayNameError" class="inline-error">{{ displayNameError }}</div>
            <div v-if="displayNameSuccess" class="inline-success">Name saved</div>
            <button
              class="inline-save-btn"
              :disabled="isSavingDisplayName || !displayNameInput.trim()"
              @click="handleSaveDisplayName"
            >
              {{ isSavingDisplayName ? 'Saving...' : 'Save' }}
            </button>
          </div>

          <div class="divider" v-if="userName || userEmail"></div>

          <!-- Set / Change Password -->
          <div class="setting-row clickable" @click="showPasswordForm = !showPasswordForm; passwordError = ''; passwordSuccess = false">
            <div class="setting-info">
              <span class="setting-label">{{ hasPassword ? 'Change Password' : 'Set Password' }}</span>
              <span class="setting-desc">{{ hasPassword ? 'Update your login password' : 'Add a password for easier sign-in' }}</span>
            </div>
            <svg class="chevron" :class="{ rotated: showPasswordForm }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <!-- Password inline form -->
          <div v-if="showPasswordForm" class="inline-form">
            <div class="inline-form-field">
              <label class="inline-label">New password</label>
              <input
                v-model="passwordInput"
                type="password"
                class="inline-input"
                placeholder="At least 6 characters"
                autocomplete="new-password"
              />
            </div>
            <div class="inline-form-field">
              <label class="inline-label">Confirm password</label>
              <input
                v-model="passwordConfirm"
                type="password"
                class="inline-input"
                placeholder="Type it again"
                autocomplete="new-password"
              />
            </div>
            <div v-if="passwordError" class="inline-error">{{ passwordError }}</div>
            <div v-if="passwordSuccess" class="inline-success">Password saved</div>
            <button
              class="inline-save-btn"
              :disabled="isSavingPassword || !passwordInput || !passwordConfirm"
              @click="handleSavePassword"
            >
              {{ isSavingPassword ? 'Saving...' : 'Save Password' }}
            </button>
          </div>

          <div class="divider"></div>

          <!-- Linked Emails -->
          <div class="setting-row clickable" @click="showAddEmailForm = !showAddEmailForm; addEmailError = ''; addEmailSuccess = false; addEmailStep = 'email'; addEmailInput = ''; addEmailOtp = ''">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.linkedEmails') }}</span>
              <span class="setting-desc">{{ verifiedEmails.length > 1 ? `${verifiedEmails.length} emails linked` : 'Add another email to sign in with' }}</span>
            </div>
            <svg class="chevron" :class="{ rotated: showAddEmailForm }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <!-- Linked emails list + add form -->
          <div v-if="showAddEmailForm" class="inline-form">
            <!-- Show existing verified emails -->
            <div v-if="verifiedEmails.length" class="verified-emails-list">
              <div v-for="em in verifiedEmails" :key="em" class="verified-email-item">
                <span class="verified-email-text">{{ em }}</span>
                <span v-if="em === primaryEmail" class="verified-email-badge">primary</span>
              </div>
            </div>

            <!-- Step 1: Enter email -->
            <template v-if="addEmailStep === 'email'">
              <div class="inline-form-field">
                <label class="inline-label">Add another email</label>
                <input
                  v-model="addEmailInput"
                  type="email"
                  class="inline-input"
                  placeholder="another@example.com"
                  autocomplete="email"
                />
              </div>
              <div v-if="addEmailError" class="inline-error">{{ addEmailError }}</div>
              <button
                class="inline-save-btn"
                :disabled="isSendingOtp || !addEmailInput"
                @click="handleSendAddEmailOtp"
              >
                {{ isSendingOtp ? 'Sending...' : 'Send verification code' }}
              </button>
            </template>

            <!-- Step 2: Enter OTP -->
            <template v-else-if="addEmailStep === 'otp'">
              <div class="inline-form-field">
                <label class="inline-label">Enter the code sent to {{ addEmailInput }}</label>
                <input
                  v-model="addEmailOtp"
                  type="text"
                  inputmode="numeric"
                  class="inline-input"
                  placeholder="000000"
                  maxlength="6"
                  autocomplete="one-time-code"
                />
              </div>
              <div v-if="addEmailError" class="inline-error">{{ addEmailError }}</div>
              <div v-if="addEmailSuccess" class="inline-success">Email verified and linked</div>
              <button
                class="inline-save-btn"
                :disabled="isVerifyingOtp || addEmailOtp.length < 6"
                @click="handleVerifyAddEmail"
              >
                {{ isVerifyingOtp ? 'Verifying...' : 'Verify' }}
              </button>
            </template>
          </div>

          <!-- Sign Out -->
          <div class="divider"></div>
          <div class="setting-row clickable sign-out-row" @click="handleSignOut">
            <div class="setting-info">
              <span class="setting-label sign-out-label">Sign Out</span>
            </div>
            <svg class="sign-out-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- Dashboards Section (role-gated, prominent placement) -->
      <section class="section" v-if="isSignedIn && (hasSchoolRole || hasAdminRole)">
        <h3 class="section-title">{{ t('settings.dashboards') }}</h3>
        <div class="card">
          <!-- Schools Dashboard -->
          <div v-if="hasSchoolRole" class="setting-row clickable" @click="router.push('/schools')">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.schoolsDashboard') }}</span>
              <span class="setting-desc">Manage your classes and students</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <div v-if="hasSchoolRole && hasAdminRole" class="divider"></div>

          <!-- Admin Dashboard -->
          <div v-if="hasAdminRole" class="setting-row clickable" @click="router.push('/admin')">
            <div class="setting-info">
              <span class="setting-label">Admin Dashboard</span>
              <span class="setting-desc">Platform users, activity, and course analytics</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- Interface Language — globe icon is a language-agnostic anchor so the
           setting stays findable even if the UI is set to an unreadable script. -->
      <section class="section">
        <h3 class="section-title">
          <svg class="section-title-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          {{ t('settings.languageSection') }}
        </h3>
        <div class="card">
          <div class="setting-row clickable" @click="showLangPicker = !showLangPicker">
            <svg class="setting-globe-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-label="Language" role="img">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.interfaceLanguage') }}</span>
              <span class="setting-desc">{{ currentLangLabel }}</span>
            </div>
            <svg class="chevron" :class="{ rotated: showLangPicker }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
          <div v-if="showLangPicker" class="lang-picker">
            <button
              v-for="lang in INTERFACE_LANGUAGES"
              :key="lang.code"
              class="lang-option"
              :class="{ active: currentInterfaceLang === lang.code }"
              @click="setInterfaceLanguage(lang.code)"
            >
              {{ lang.label }}
            </button>
          </div>
        </div>
      </section>

      <!-- Practice Modes Section -->
      <section class="section">
        <h3 v-if="isTester" class="section-title">Speed</h3>
        <div v-if="isTester" class="card">
          <div class="setting-row">
            <div class="setting-info">
              <span class="setting-label">Learning Speed</span>
              <span class="setting-desc">Adjust how fast target language audio plays. Does not affect your known language.</span>
            </div>
          </div>
          <div class="speed-options">
            <button
              v-for="opt in speedOptions"
              :key="opt.value"
              @click="setLearnerSpeed(opt.value)"
              :class="['speed-btn', { active: learnerSpeed === opt.value }]"
            >
              <span class="speed-value">{{ opt.value }}x</span>
              <span class="speed-label">{{ opt.label }}</span>
            </button>
          </div>
        </div>

        <h3 class="section-title">{{ t('settings.tools') }}</h3>
        <div class="card">
          <template v-if="showViewScript">
            <div class="divider"></div>

            <div class="setting-row clickable" @click="emit('openExplorer')">
              <div class="setting-info">
                <span class="setting-label">View Script</span>
                <span class="setting-desc">Browse course rounds and lego sequences</span>
              </div>
              <svg class="tool-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <path d="M14 2v6h6"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
            </div>
          </template>

          <template v-if="hasAdminRole">
            <div class="divider"></div>

            <div class="setting-row clickable" @click="toggleQaMode">
              <div class="setting-info">
                <span class="setting-label">QA Mode</span>
                <span class="setting-desc">Flag phrases that don't sound right. Feedback goes directly to the content team.</span>
              </div>
              <div class="toggle-switch" :class="{ 'is-on': enableQaMode }">
                <div class="toggle-track">
                  <div class="toggle-thumb"></div>
                </div>
              </div>
            </div>
          </template>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="toggleAdaptation">
            <div class="setting-info">
              <span class="setting-label">Personalised pacing</span>
              <span class="setting-desc">Uses your microphone to detect when you speak, adapting pause lengths to your rhythm. No audio is recorded or stored.</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': enableAdaptation }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Offline Section -->
      <!-- Enter Code Section (only for signed-in users) -->
      <section class="section" v-if="isSignedIn">
        <h3 class="section-title">{{ t('settings.codes') }}</h3>
        <div class="card">
          <div class="setting-row" v-if="!showJoinCode">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.enterACode') }}</span>
              <span class="setting-desc">Enter an invite or access code</span>
            </div>
            <button class="text-btn" @click="showJoinCode = true">Enter Code</button>
          </div>
          <div v-else class="join-code-form">
            <div class="join-code-input-row">
              <input
                v-model="joinCodeInput"
                @input="handleJoinCodeInput"
                type="text"
                placeholder="ABC-123"
                maxlength="7"
                class="join-code-input"
              />
              <button
                class="text-btn"
                :disabled="joinCodeInput.length < 5 || isJoinValidating"
                @click="handleJoinValidate"
              >
                {{ isJoinValidating ? '...' : 'Go' }}
              </button>
            </div>
            <p v-if="joinError" class="join-error">{{ joinError }}</p>
            <!-- Context confirmation -->
            <div v-if="joinContext" class="join-context">
              <p class="join-context-text">
                <strong>{{ joinContextRole }}</strong>
                <span v-if="joinContextDetail"> {{ joinContextDetail }}</span>
              </p>
              <div class="join-context-actions">
                <button class="text-btn" :disabled="isJoinRedeeming" @click="handleJoinRedeem">
                  {{ isJoinRedeeming ? 'Joining...' : 'Confirm' }}
                </button>
                <button class="text-btn text-btn--secondary" @click="joinContext = null; joinCodeInput = ''">Cancel</button>
              </div>
            </div>
            <p v-if="joinSuccess" class="join-success">Joined successfully!</p>
            <button class="text-btn text-btn--secondary" @click="showJoinCode = false; joinCodeInput = ''; joinError = ''; joinContext = null; joinSuccess = false">Close</button>
          </div>
        </div>
      </section>

      <!-- Subscription Section (only for signed-in users) -->
      <section class="section" v-if="isSignedIn">
        <h3 class="section-title">{{ t('settings.subscription') }}</h3>
        <div class="card">
          <template v-if="isSubscribed">
            <!-- Status -->
            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-label">{{ subscription?.planName || 'SSi Premium' }}</span>
                <span class="setting-desc">
                  <template v-if="isCancelScheduled">Ends {{ subscriptionEndsAt }} — you keep access until then</template>
                  <template v-else-if="subscriptionEndsAt">Renews {{ subscriptionEndsAt }}</template>
                  <template v-else>Active</template>
                </span>
              </div>
            </div>
            <!-- Cancel (in-app) — hidden once a cancellation is scheduled -->
            <template v-if="!isCancelScheduled">
              <div class="divider"></div>
              <div class="setting-row clickable danger" @click="openCancelConfirm">
                <div class="setting-info">
                  <span class="setting-label">{{ t('settings.cancelSubscription') }}</span>
                  <span class="setting-desc">Stay Premium until {{ subscriptionEndsAt || 'the period ends' }}, then stop</span>
                </div>
                <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </div>
            </template>
            <div class="divider"></div>
            <!-- Hosted portal: card updates / invoices (rare) -->
            <div class="setting-row clickable" @click="handleManageSubscription">
              <div class="setting-info">
                <span class="setting-label">{{ isPortalLoading ? 'Opening...' : 'Payment & invoices' }}</span>
                <span class="setting-desc">{{ portalFeedback || 'Update card or view invoices (opens Paddle)' }}</span>
              </div>
              <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </template>
          <!-- Not subscribed -->
          <div v-else class="setting-row clickable" @click="goPremium">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.goPremium') }}</span>
              <span class="setting-desc">£15/month — unlimited access to all languages</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- Data Section -->
      <section class="section">
        <h3 class="section-title">{{ t('settings.data') }}</h3>
        <div class="card">
          <div class="setting-row clickable danger" @click="handleResetClick">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.resetProgress') }}</span>
              <span class="setting-desc">Start fresh for this course</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <div class="divider" v-if="isSignedIn"></div>

          <div class="setting-row clickable danger" @click="handleDeleteClick" v-if="isSignedIn">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.deleteAccount') }}</span>
              <span class="setting-desc">Permanently delete your account and all data</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- Developer Section -->
      <section class="section" v-if="isAdmin">
        <h3 class="section-title">Developer</h3>
        <div class="card">
          <!-- Tools -->
          <div class="setting-row clickable" @click="toggleViewScript">
            <div class="setting-info">
              <span class="setting-label">View Script</span>
              <span class="setting-desc">Show script browser in Tools section</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': showViewScript }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="toggleDebugOverlay">
            <div class="setting-info">
              <span class="setting-label">Debug Overlay</span>
              <span class="setting-desc">Show phase, round, and LEGO info on screen</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': showDebugOverlay }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="toggleVerboseLogging">
            <div class="setting-info">
              <span class="setting-label">Verbose Logging</span>
              <span class="setting-desc">Enable detailed console logs</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': enableVerboseLogging }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <div class="setting-row clickable" @click="toggleListeningAudit">
            <div class="setting-info">
              <span class="setting-label">Listening Progression Audit</span>
              <span class="setting-desc">Add a "Progression" mode to Listening → Dialogues that walks each line through all 9 acquisition stages, live from the Popty listening config</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': showListeningAudit }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>

          <div class="divider"></div>

          <!-- UI Visibility -->
          <div class="setting-row clickable" @click="toggleFragileProgressWarning">
            <div class="setting-info">
              <span class="setting-label">Fragile Progress Warning</span>
              <span class="setting-desc">Show "progress is fragile" banner for guests</span>
            </div>
            <div class="toggle-switch" :class="{ 'is-on': showFragileProgressWarning }">
              <div class="toggle-track">
                <div class="toggle-thumb"></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Troubleshooting — always-visible recovery tool (moved out of the
           admin-gated Developer section 2026-05-23 so any user hitting
           cache-related bugs can reach it). Two graduated actions, each running
           the staged "Fixing things…" overlay so the user always sees progress:
           a light "Update to the latest version" and a gated "Clear cache &
           reload". Both preserve Supabase auth so signed-in users stay signed
           in; the heavy one warns about offline downloads + guest progress. -->
      <section class="section">
        <h3 class="section-title">{{ t('settings.troubleshooting') }}</h3>
        <div class="card">
          <!-- At-rest transparency: what version you're on + what's stored -->
          <div class="troubleshoot-status">
            App version {{ buildNumber || 'dev' }}<template v-if="downloadedMb"> · {{ downloadedMb }} MB downloaded for offline</template>
          </div>

          <!-- Light: get the latest version, keeps audio + progress -->
          <div class="setting-row clickable" @click="handleUpdateToLatest">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.updateLatest') }}</span>
              <span class="setting-desc">Reloads with the newest version. Your downloads and progress are kept.</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <!-- Heavy: full wipe, gated behind a confirm -->
          <div class="setting-row clickable danger" @click="openClearConfirm">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.clearCacheReload') }}</span>
              <span class="setting-desc">Fixes most audio and loading problems. You stay signed in.</span>
            </div>
            <svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>

          <!-- Quiet catastrophe-recovery affordance — deliberately understated
               and buried here, not a top-level feature. Only for the rare case
               where a device loses its position (uninstall, fresh login, a
               reset gone wrong); most learners never need this. Read-only
               display + explicit tap + confirm — never auto-moves anyone. -->
          <template v-if="isSignedIn && hasFurthestPoint">
            <div class="divider"></div>
            <div
              class="setting-row"
              :class="{ clickable: canRecover }"
              @click="canRecover && handleRecoverClick()"
            >
              <div class="setting-info">
                <span class="setting-label">{{ t('settings.recoverPosition', 'Recover a lost position') }}</span>
                <span class="setting-desc">{{ recoverDescription }}</span>
              </div>
              <svg v-if="canRecover" class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </div>
          </template>
        </div>
      </section>

      <!-- Install App (only in browser, not when already installed as PWA) -->
      <section v-if="!isStandalone" class="section">
        <div class="card">
          <div class="setting-row clickable" @click="router.push('/install')">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.installApp') }}</span>
              <span class="setting-hint">Add to your home screen for faster, offline access</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </div>
        </div>
      </section>

      <!-- Legal — links to the marketing site (saysomethingin.com is an
           already-approved Paddle domain; pages live there, not on .app).
           Open in a new tab so the app session is preserved. When the
           production marketing site replaces the stage subdomain, swap the
           three URL prefixes. -->
      <section class="section">
        <h3 class="section-title">{{ t('settings.legal') }}</h3>
        <div class="card">
          <a href="/terms" target="_blank" rel="noopener" class="setting-row clickable legal-link">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.terms') }}</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="external-icon" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
          <a href="/privacy" target="_blank" rel="noopener" class="setting-row clickable legal-link">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.privacy') }}</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="external-icon" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
          <a href="/refunds" target="_blank" rel="noopener" class="setting-row clickable legal-link">
            <div class="setting-info">
              <span class="setting-label">{{ t('settings.refund') }}</span>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="external-icon" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        </div>
      </section>

      <!-- Brand Footer -->
      <footer class="brand-footer">
        <div class="brand">
          <span class="logo-say">Say</span><span class="logo-something">Something</span><span class="logo-in">in</span>
        </div>
        <p class="copyright">Made with love for language learners</p>
        <p class="legal-entity">© 2026 SaySomethingIn Cyf · Glaslyn, Ffordd y Parc, Bangor, Gwynedd LL57 4FE, Wales</p>
      </footer>
    </main>
  </div>
</template>

<style scoped>
/* Fonts loaded globally in style.css */

.settings-screen {
  display: flex;
  flex-direction: column;
  font-family: var(--font-body);
  position: relative;
  padding-bottom: calc(80px + env(safe-area-inset-bottom, 0px));
}

/* Header */
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: linear-gradient(to bottom, var(--bg-primary) 0%, transparent 100%);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-bottom: 1px solid var(--border-subtle);
}

.header-spacer {
  width: 2rem;
}

.close-btn {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1rem;
  cursor: pointer;
  border-radius: 50%;
  transition: color 0.2s, background 0.2s;
}

.close-btn:hover {
  color: var(--text-primary);
  background: var(--bg-secondary, rgba(255,255,255,0.08));
}

.header-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.125rem;
}

.title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.learning-time {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 400;
}

.build-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  padding: 0.625rem 1rem;
  margin-bottom: 1rem;
  background: var(--bg-card);
  border-radius: 12px;
  border: 1px solid var(--border-subtle);
  box-shadow: var(--shadow-sm);
  font: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.build-card:hover { border-color: var(--border-medium); }
.build-card:active { transform: scale(0.995); }
.build-card.has-update { border-color: #16a34a; }
.build-card-version { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.build-card-action { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
.build-update-hint { font-size: 0.78rem; color: var(--text-muted); }
.build-update-badge {
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
  background: #16a34a;
  padding: 0.15rem 0.5rem;
  border-radius: 999px;
  animation: build-update-pulse 1.6s ease-in-out infinite;
}
@keyframes build-update-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) { .build-update-badge { animation: none; } }
.build-card-chevron { width: 16px; height: 16px; color: var(--text-muted); }

.build-sha {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.03em;
}

.build-time {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 400;
}

/* Main */
.main {
  flex: 1;
  padding: 1rem 1.5rem 2rem;
  position: relative;
  z-index: 10;
  overflow-y: auto;
}

/* Section */
.section {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem 0.25rem;
}

/* Globe anchor on the Language section — keeps it findable in any script. */
.section-title-globe {
  width: 0.95rem;
  height: 0.95rem;
  vertical-align: -2px;
  margin-right: 0.35rem;
}
.setting-globe-icon {
  width: 1.5rem;
  height: 1.5rem;
  flex: 0 0 auto;
  margin-right: 0.85rem;
  color: var(--accent, var(--text-muted));
}

/* Card — iOS-style elevated white on warm canvas */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

/* What's new — release-notes panel under the build-card */
.whats-new .card { padding: 0.875rem 1rem; }
.whats-new-loading { color: var(--text-muted); font-size: 0.85rem; }
.whats-new-entry { padding: 0.25rem 0; }
.whats-new-head {
  display: flex; align-items: baseline; gap: 0.6rem;
  margin-bottom: 0.25rem;
}
.whats-new-date {
  font-size: 0.8rem; font-weight: 600;
  color: var(--text-secondary, var(--text-muted));
}
.whats-new-version {
  font-size: 0.72rem; color: var(--text-muted);
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
}
.whats-new-headline {
  margin: 0.1rem 0 0.4rem;
  font-size: 0.92rem; font-weight: 500;
  color: var(--text-primary);
  font-style: italic;
}
/* Bullets — a scannable list, not a paragraph blob. Custom warm-grey markers,
   comfortable row spacing and a readable line-height. */
.whats-new-bullets {
  margin: 0.2rem 0 0;
  padding: 0;
  list-style: none;
  font-size: 0.88rem;
  color: var(--text-secondary, var(--text-primary));
}
.whats-new-bullets li {
  position: relative;
  padding-left: 1.1rem;
  margin: 0.45rem 0;
  line-height: 1.45;
}
.whats-new-bullets li::before {
  content: '•';
  position: absolute;
  left: 0.15rem;
  top: -0.02em;
  color: var(--text-muted);
  font-size: 1em;
  line-height: 1.45;
}
/* "In the latest version" marker — subtle accent tint, sits under the headline. */
.whats-new-newer {
  margin: 0 0 0.4rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--accent, var(--ssi-red, #c23a3a));
}
/* Per-note Read more / Show less — quieter than the earlier-updates toggle. */
.whats-new-readmore {
  background: none; border: 0; padding: 0.3rem 0 0;
  font: inherit; font-size: 0.8rem; font-weight: 500;
  color: var(--text-secondary, var(--text-muted));
  cursor: pointer;
}
.whats-new-readmore:hover { color: var(--text-primary); text-decoration: underline; }
.whats-new-sep {
  border: 0; height: 1px; background: var(--border-subtle);
  margin: 0.7rem -0.25rem;
}
.whats-new-toggle {
  background: none; border: 0; padding: 0.4rem 0 0;
  font: inherit; font-size: 0.82rem;
  color: var(--ssi-red, #c23a3a);
  cursor: pointer;
}
.whats-new-toggle:hover { text-decoration: underline; }

.divider {
  height: 1px;
  background: var(--border-subtle);
  margin: 0 1rem;
}

/* Setting Row */
.setting-row {
  display: flex;
  align-items: center;
  padding: 0.875rem 1rem;
  gap: 1rem;
}

.setting-row.clickable {
  cursor: pointer;
  transition: background 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.setting-row.clickable:hover {
  background: var(--bg-elevated);
}

.setting-row.clickable:active {
  background: var(--bg-card);
}

.setting-row.danger .setting-label {
  color: #ef4444;
}

.sign-out-label {
  color: var(--text-secondary);
}

.sign-out-icon {
  width: 20px;
  height: 20px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-label {
  display: block;
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 0.125rem;
}

.setting-desc {
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.setting-value {
  font-family: 'Space Mono', monospace;
  font-size: 0.8125rem;
  color: var(--text-muted);
}

.speed-options {
  display: flex;
  gap: 6px;
  padding: 0 16px 16px;
}

.speed-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  border-radius: 10px;
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  background: transparent;
  cursor: pointer;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.speed-btn .speed-value {
  font-family: 'Space Mono', monospace;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-muted);
}

.speed-btn .speed-label {
  font-size: 0.625rem;
  color: var(--text-muted);
  opacity: 0.6;
}

.speed-btn.active {
  border-color: var(--ssi-red);
  background: rgba(194, 58, 58, 0.1);
}

.speed-btn.active .speed-value {
  color: var(--ssi-red);
}

.speed-btn.active .speed-label {
  color: var(--ssi-red);
  opacity: 0.8;
}

.chevron {
  width: 20px;
  height: 20px;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.chevron.rotated {
  transform: rotate(90deg);
}

/* Language picker */
.lang-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding: 0.75rem 1rem 1rem;
}

.lang-option {
  padding: 0.5rem 0.875rem;
  background: var(--bg-secondary);
  border: 1.5px solid var(--border-subtle);
  border-radius: 100px;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.lang-option:hover {
  border-color: var(--ssi-red);
  color: var(--text-primary);
}

.lang-option.active {
  background: rgba(194, 58, 58, 0.12);
  border-color: var(--ssi-red);
  color: var(--ssi-red);
  font-weight: 600;
}

/* Inline forms for account management */
.inline-form {
  padding: 0 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.inline-form-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.inline-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.inline-input {
  padding: 0.625rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 0.9375rem;
  outline: none;
  transition: border-color 0.2s ease;
}

.inline-input:focus {
  border-color: var(--ssi-red);
}

.inline-input::placeholder {
  color: var(--text-muted);
}

.inline-error {
  font-size: 0.8125rem;
  color: var(--error, #ef4444);
}

.inline-success {
  font-size: 0.8125rem;
  color: var(--success, #22c55e);
}

.inline-save-btn {
  align-self: flex-start;
  padding: 0.5rem 1.25rem;
  background: linear-gradient(135deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.inline-save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.inline-save-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.verified-emails-list {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-bottom: 0.25rem;
}

.verified-email-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0;
}

.verified-email-text {
  font-size: 0.875rem;
  color: var(--text-primary);
}

.verified-email-badge {
  font-size: 0.6875rem;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.08);
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tool-icon {
  width: 22px;
  height: 22px;
  color: var(--text-muted);
  flex-shrink: 0;
  transition: color 0.2s ease;
}

.setting-row.clickable:hover .tool-icon {
  color: var(--gold);
}

.tool-icon.headphones {
  color: var(--gold);
}

/* Auth CTA */
.auth-cta-row {
  padding: 1rem;
  text-align: center;
}

.auth-cta-text {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin: 0 0 1rem;
}

.auth-cta-buttons {
  display: flex;
  gap: 0.75rem;
}

.auth-cta-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 10px;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.auth-cta-btn.primary {
  background: linear-gradient(135deg, var(--ssi-red) 0%, var(--ssi-red-dark) 100%);
  border: none;
  color: white;
}

.auth-cta-btn.primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 15px rgba(194, 58, 58, 0.4);
}

.auth-cta-btn.secondary {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: var(--text-secondary);
}

.auth-cta-btn.secondary:hover {
  border-color: rgba(255, 255, 255, 0.3);
  color: var(--text-primary);
}

/* Toggle Switch */
.toggle-switch {
  width: 48px;
  height: 28px;
  flex-shrink: 0;
}

.toggle-track {
  width: 100%;
  height: 100%;
  background: var(--bg-elevated);
  border-radius: 14px;
  border: 1px solid var(--border-subtle);
  position: relative;
  transition: all 0.3s ease;
}

.toggle-switch.is-on .toggle-track {
  background: var(--accent);
  border-color: var(--accent);
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  background: var(--bg-primary);
  border-radius: 50%;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow: var(--shadow-sm);
}

.toggle-switch.is-on .toggle-thumb {
  transform: translateX(20px);
}

/* Brand Footer */
.brand-footer {
  text-align: center;
  padding: 2rem 0;
  margin-top: 1rem;
}

.brand {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.02em;
  margin-bottom: 0.5rem;
}

.logo-say, .logo-in { color: var(--accent); }
.logo-something { color: var(--text-primary); }

.copyright {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0;
}

.legal-entity {
  font-size: 0.6875rem;
  color: var(--text-muted);
  margin: 0.5rem 0 0;
  line-height: 1.5;
  opacity: 0.75;
}

/* Legal links — match setting-row styling on an <a> */
.legal-link,
.legal-link:link,
.legal-link:visited {
  text-decoration: none;
  color: inherit;
}

.external-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

/* Reset Dialog */
.reset-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg);
  backdrop-filter: blur(8px);
  padding: 1.5rem;
}

/* Troubleshooting — at-rest status line + confirm warnings + staged overlay */
.troubleshoot-status {
  padding: 0.75rem 1rem 0.6rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-medium);
}
.clear-warn {
  margin: 0.6rem 0 0;
  padding: 0.6rem 0.75rem;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--text-primary);
  background: rgba(239, 68, 68, 0.08);
  border-radius: 0.6rem;
  text-align: left;
}
.clear-warn--guest { background: rgba(234, 179, 8, 0.12); }
.clear-account-btn {
  display: block;
  margin-top: 0.5rem;
  padding: 0;
  border: none;
  background: none;
  color: #16a34a;
  font-weight: 600;
  font-size: 0.85rem;
  cursor: pointer;
  text-decoration: underline;
}
.fix-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;          /* above the confirm dialogs (1000) */
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--overlay-bg);
  backdrop-filter: blur(8px);
  padding: 1.5rem;
}
.fix-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border-medium);
  border-radius: 1rem;
  padding: 1.75rem 1.75rem 1.5rem;
  max-width: 340px;
  width: 100%;
}
.fix-title {
  margin: 0 0 1.1rem;
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
  text-align: center;
}
.fix-steps {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
}
.fix-step {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 0.95rem;
  color: var(--text-secondary);
  transition: color 0.2s ease, opacity 0.2s ease;
}
.fix-step.is-running,
.fix-step.is-done { color: var(--text-primary); }
.fix-step.is-pending { opacity: 0.5; }
.fix-step-mark {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  color: #16a34a;
}
.fix-step-mark svg { width: 18px; height: 18px; }
.fix-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-medium);
}
.fix-spinner {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--border-medium);
  border-top-color: #16a34a;
  animation: fix-spin 0.7s linear infinite;
}
@keyframes fix-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .fix-spinner { animation: none; }
}
.fix-reloading {
  margin: 1.1rem 0 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
}
.fix-note {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  text-align: center;
}

.reset-dialog {
  background: var(--bg-secondary);
  border: 1px solid var(--border-medium);
  border-radius: 1rem;
  padding: 2rem;
  max-width: 340px;
  text-align: center;
}

.reset-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 1rem;
  color: #ef4444;
}

.reset-icon svg {
  width: 100%;
  height: 100%;
}

.recover-icon {
  color: var(--accent);
}

.reset-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 0.75rem;
}

.reset-stats {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem 1rem;
  margin: 0 0 1rem;
  padding: 0.75rem;
  background: var(--bg-elevated);
  border-radius: 0.5rem;
}

.reset-stat-value {
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.reset-desc {
  font-size: 0.875rem;
  color: var(--text-muted);
  line-height: 1.5;
  margin: 0 0 1.5rem;
}

.delete-confirm-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 1rem;
}

.reset-error {
  font-size: 0.875rem;
  color: #ef4444;
  margin: -0.5rem 0 1rem;
}

.reset-success {
  font-size: 0.875rem;
  color: #22c55e;
  margin: -0.5rem 0 1rem;
}

.reset-actions {
  display: flex;
  gap: 0.75rem;
}

.reset-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.reset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.reset-btn--cancel {
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.reset-btn--cancel:hover:not(:disabled) {
  background: var(--bg-card);
  color: var(--text-primary);
}

.reset-btn--confirm {
  background: #ef4444;
  color: var(--text-on-accent);
}

.reset-btn--confirm:hover:not(:disabled) {
  background: #dc2626;
}

.reset-btn--recover {
  background: var(--accent);
  color: var(--text-on-accent);
}

.reset-btn--recover:hover:not(:disabled) {
  filter: brightness(0.9);
}

/* Offline Download Styles */
.is-offline {
  color: #ef4444;
}

.download-section {
  border-bottom: none;
}

.download-options {
  padding: 0.5rem 1rem 1rem;
}

.download-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.download-option input {
  display: none;
}

.option-radio {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid var(--text-muted);
  flex-shrink: 0;
  position: relative;
  transition: border-color 0.2s ease;
}

.download-option input:checked + .option-radio {
  border-color: var(--accent);
}

.download-option input:checked + .option-radio::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.option-content {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.option-label {
  font-size: 0.9375rem;
  color: var(--text-primary);
}

.option-size {
  font-family: 'Space Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.download-action {
  padding: 0.5rem 1rem 1rem;
}

.download-btn {
  width: 100%;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  background: var(--accent);
  color: var(--text-on-accent);
}

.download-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.download-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--bg-elevated);
  color: var(--text-muted);
}

.download-progress {
  padding: 1rem;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.progress-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.progress-percent {
  font-family: 'Space Mono', monospace;
  font-size: 0.875rem;
  color: var(--accent);
}

.progress-bar {
  height: 6px;
  background: var(--bg-elevated);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 1rem;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
  transition: width 0.2s ease;
}

.cancel-btn {
  width: 100%;
  padding: 0.625rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
  background: var(--bg-elevated);
  color: var(--text-secondary);
}

.cancel-btn:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.download-error {
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  border-top: 1px solid var(--border-subtle);
}

/* Fade transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ═══════════════════════════════════════════════════════════════
   RESPONSIVE - Simplified 2-breakpoint system
   Base: Mobile (0-767px)
   768px+: Tablet/Desktop
   ═══════════════════════════════════════════════════════════════ */

/* Tablet and Desktop (768px+) */
@media (min-width: 768px) {
  .main {
    padding: 1rem 2rem 2rem;
  }

  .section {
    margin-bottom: 2rem;
  }

  .card {
    border-radius: 20px;
  }

  .setting-row {
    padding: 1rem 1.25rem;
  }

  .setting-label {
    font-size: 1rem;
  }

  .setting-desc {
    font-size: 0.875rem;
  }

  .reset-dialog {
    padding: 2.5rem;
    max-width: 400px;
  }
}

/* Landscape phones - compact vertical spacing */
@media (orientation: landscape) and (max-height: 500px) {
  .settings-screen {
    padding-bottom: calc(60px + env(safe-area-inset-bottom, 0px));
  }

  .header {
    padding: 0.5rem 1rem;
    position: relative;
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border-bottom: none;
  }

  .title {
    font-size: 1rem;
  }

  .main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem 1rem;
    align-items: start;
    max-width: none;
    padding: 0.5rem 1rem 1rem;
  }

  .section {
    margin-bottom: 0;
  }

  .section-title {
    font-size: 0.6875rem;
    margin-bottom: 0.5rem;
  }

  .card {
    border-radius: 12px;
  }

  .setting-row {
    padding: 0.5rem 0.75rem;
  }

  .setting-label {
    font-size: 0.8125rem;
  }

  .setting-desc {
    font-size: 0.6875rem;
  }

  .toggle-switch {
    width: 40px;
    height: 24px;
  }

  .toggle-thumb {
    width: 16px;
    height: 16px;
  }

  .toggle-switch.is-on .toggle-thumb {
    transform: translateX(16px);
  }

  .brand-footer {
    grid-column: 1 / -1;
    padding: 1rem 0;
    margin-top: 0;
  }

  .brand {
    font-size: 0.875rem;
  }

  .copyright {
    font-size: 0.6875rem;
  }

  /* Hide less essential sections in landscape */
  .download-options,
  .download-action {
    display: none;
  }
}

/* Join code form */
.join-code-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
}

.join-code-input-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.join-code-input {
  flex: 1;
  padding: 0.625rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 1.125rem;
  letter-spacing: 0.2em;
  text-align: center;
  text-transform: uppercase;
  font-family: var(--font-mono);
  outline: none;
}

.join-code-input:focus {
  border-color: var(--ssi-red);
  box-shadow: 0 0 0 2px rgba(194, 58, 58, 0.15);
}

.join-error {
  color: var(--error);
  font-size: 0.8125rem;
  margin: 0;
}

.join-success {
  color: var(--success);
  font-size: 0.8125rem;
  margin: 0;
}

.join-context {
  padding: 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

.join-context-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0 0 0.5rem;
}

.join-context-actions {
  display: flex;
  gap: 0.5rem;
}

.text-btn {
  padding: 0.375rem 0.75rem;
  background: rgba(194, 58, 58, 0.15);
  border: 1px solid rgba(194, 58, 58, 0.3);
  border-radius: 6px;
  color: var(--ssi-red);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.text-btn:hover:not(:disabled) {
  background: rgba(194, 58, 58, 0.25);
}

.text-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.text-btn--secondary {
  background: transparent;
  border-color: rgba(255, 255, 255, 0.15);
  color: var(--text-muted);
}

.text-btn--secondary:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
}
</style>

<!-- Mist theme: paper surfaces instead of glass -->
<style>
:root[data-theme="mist"] .settings-screen .header {
  background: #ffffff;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  box-shadow: 0 1px 4px rgba(44, 38, 34, 0.12);
}

:root[data-theme="mist"] .settings-screen .reset-overlay {
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

:root[data-theme="mist"] .settings-screen .reset-dialog {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid rgba(0, 0, 0, 0.04);
  box-shadow: 0 4px 16px rgba(44, 38, 34, 0.14), 0 24px 64px rgba(44, 38, 34, 0.14);
}

:root[data-theme="mist"] .inline-input {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.15);
  color: #2C2622;
}

:root[data-theme="mist"] .inline-input::placeholder {
  color: #A09A94;
}
</style>
