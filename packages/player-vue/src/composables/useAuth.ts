/**
 * useAuth - Authentication composable using Supabase Auth (email OTP)
 *
 * Provides:
 * - Supabase Auth user state
 * - Supabase learner record
 * - Guest mode with local ID
 * - Progress migration when guest signs up
 */

import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { LearnerRecord, LearnerPreferences } from '@ssi/core'
import { useUserRole } from '@/composables/useUserRole'
import { useResolvedSession } from '@/composables/useResolvedSession'
import { useSharedSubscription } from '@/composables/useSubscription'
import { useSharedUserEntitlements } from '@/composables/useUserEntitlements'
import { isPlaceholderEmail } from '@/utils/placeholderEmail'
import { useAccessClaim } from '@/composables/useAccessClaim'
import { writeAuthHandoff, readAndConsumeAuthHandoff, isStandalone } from '@/utils/authHandoff'
import { withNetworkTimeout, NETWORK_TIMEOUT } from '@/config/networkGate'
import {
  readLastKnownIdentity,
  writeLastKnownIdentity,
  clearLastKnownIdentity,
} from '@/composables/lastKnownIdentity'

// Local storage keys
const GUEST_ID_KEY = 'ssi-guest-id'
const GUEST_SESSIONS_KEY = 'ssi-guest-sessions-count'
const SIGNUP_PROMPT_SEEN_KEY = 'ssi-signup-prompt-seen'

// Dead-session recovery (see recoverDeadSession below).
const DEAD_SESSION_NAV_GUARD_KEY = 'ssi-dead-session-nav-guard'
/** SchoolsContainer reads + clears this to show "please sign in again". */
export const SIGNIN_AGAIN_NOTICE_KEY = 'ssi-signin-again-notice'
let isRecoveringDeadSession = false

/**
 * supabase-js only removes its stored session when the server logout call
 * succeeds or fails with an ignorable status — a revoked session's logout
 * can answer otherwise, leaving the dead token in localStorage to
 * resurrect on the next boot. And any concurrent getSession() can
 * re-persist the in-memory session after a purge (both verified live
 * 2026-07-18 in the stale-session recovery check). Purge explicitly.
 */
function purgeSupabaseAuthStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (/^sb-.+-auth-token$/.test(key)) localStorage.removeItem(key)
    }
  } catch { /* storage blocked — nothing to purge */ }
}
/**
 * Navigation indirection so tests can observe/prevent real navigation —
 * jsdom can't perform location.href assignment or reload.
 */
export const deadSessionNav = {
  reload: () => window.location.reload(),
  goto: (url: string) => { window.location.href = url },
  currentPath: () => window.location.pathname,
}

export interface AuthState {
  /** Supabase Auth user (null if guest) */
  user: Ref<User | null>
  /** Supabase learner record (null if guest or not yet loaded) */
  learner: Ref<LearnerRecord | null>
  /** Whether user is authenticated with Supabase Auth */
  isAuthenticated: ComputedRef<boolean>
  /** Whether user is a guest (no account) */
  isGuest: ComputedRef<boolean>
  /** Effective learner ID (Supabase user ID or guestId) */
  learnerId: ComputedRef<string | null>
  /** Supabase Auth user ID — for querying learners.user_id */
  userId: ComputedRef<string | null>
  /** Number of completed sessions (for signup prompt) */
  completedSessionsCount: Ref<number>
  /** Whether signup prompt has been seen */
  hasSeenSignupPrompt: Ref<boolean>
  /** Whether auth is still loading */
  isLoading: Ref<boolean>
  /**
   * True when the identity we are reporting came from the last-known-identity
   * record rather than from a session the server confirmed this boot.
   *
   * The learner IS signed in as far as every UI surface is concerned — that is
   * the whole point of the ruling. This flag exists for the narrow set of
   * consumers that must not act on an unconfirmed identity (privileged
   * server-verified surfaces, anything minting or spending real entitlement).
   * It clears the moment a real session lands behind the learner.
   */
  identityUnverified: Ref<boolean>
}

export interface AuthActions {
  /** Sign out from Supabase Auth */
  signOut: () => Promise<void>
  /** Increment guest session count */
  incrementSessionCount: () => void
  /** Mark signup prompt as seen */
  markSignupPromptSeen: () => void
  /** Migrate guest progress to authenticated user */
  migrateGuestProgress: () => Promise<void>
  /** Initialize auth (call on mount) */
  initialize: (supabaseClient: SupabaseClient) => Promise<void>
  /** Set or change the user's password */
  updatePassword: (newPassword: string) => Promise<{ error?: string }>
  /** Merge a patch into the learner's stored preferences. Resolves false
   *  when there is no learner row to write to (guest / signed out). */
  updatePreferences: (patch: Partial<LearnerPreferences>) => Promise<boolean>
  /** Get the current Supabase session access token */
  getToken: () => Promise<string | null>
  /** Re-sync learner/role from the DB (post-redemption authoritative write) */
  refreshRole: () => Promise<void>
  /**
   * Mirror a learner id into the ssi-user-id cookie /api/player-events reads
   * for attribution. Exposed for play-as-class (owner ruling 2026-07-16):
   * LearningPlayer.vue flips this to the class's own learner id for the
   * duration of a class-mode session, then restores it on exit.
   */
  syncAudioUserCookie: (learnerId: string | null) => void
}

/**
 * Get or create a guest ID
 */
function getOrCreateGuestId(): string {
  let guestId = localStorage.getItem(GUEST_ID_KEY)
  if (!guestId) {
    guestId = `guest-${crypto.randomUUID()}`
    localStorage.setItem(GUEST_ID_KEY, guestId)
  }
  return guestId
}

/**
 * Clear guest data after successful migration
 */
function clearGuestData(): void {
  localStorage.removeItem(GUEST_ID_KEY)
  localStorage.removeItem(GUEST_SESSIONS_KEY)
  localStorage.removeItem(SIGNUP_PROMPT_SEEN_KEY)
}

/**
 * useAuth composable
 */
export function useAuth(): AuthState & AuthActions {
  // Supabase Auth state
  const supabaseUser = ref<User | null>(null)

  // Local state
  const learner = ref<LearnerRecord | null>(null)
  const isLoading = ref(true)
  const supabase = ref<SupabaseClient | null>(null)
  // Set when `learner` was rehydrated from the last-known-identity record and
  // no live session has confirmed it yet. See the AuthState doc comment.
  const identityUnverified = ref(false)

  // Guest state from localStorage
  const guestId = ref<string | null>(null)
  const completedSessionsCount = ref(
    parseInt(localStorage.getItem(GUEST_SESSIONS_KEY) || '0', 10)
  )
  const hasSeenSignupPrompt = ref(
    localStorage.getItem(SIGNUP_PROMPT_SEEN_KEY) === 'true'
  )

  // Computed state. learner is populated from ensureLearnerExists after
  // Supabase Auth resolves; demo flow populates useSchoolContext directly
  // without going through useAuth.
  const isAuthenticated = computed(() => !!supabaseUser.value || !!learner.value)
  const isGuest = computed(() => !supabaseUser.value && !learner.value && !!guestId.value)
  // learnerId = learners table PK — use for FK references (sessions, enrollments, progress)
  // Never fall back to supabaseUser.value.id: that's the auth UID, not the
  // learners.id, and using it as learner_id silently misses every row in
  // course_enrollments / lego_progress / etc. — writes look successful but
  // match no rows. If the learners row hasn't loaded yet (or
  // ensureLearnerExists errored), prefer guestId so isGuestLearner skips
  // the write entirely rather than writing to nothing.
  const learnerId = computed(() => {
    if (learner.value) {
      return learner.value.id
    }
    return guestId.value
  })

  // userId = Supabase Auth UUID — use for querying learners.user_id
  const userId = computed(() => {
    if (supabaseUser.value) {
      return supabaseUser.value.id
    }
    if (learner.value) {
      return learner.value.user_id
    }
    return null
  })

  /**
   * Convert a DB learner row to LearnerRecord
   */
  // Sync the authenticated user's roles into useUserRole. Demo flow writes
  // its own impersonated role directly and overrides this until demo ends
  // (see DemoLauncher / useDemoController). Uses setAuthoritative, not
  // initialize() — this always carries the full, real DB row, so a null
  // here must land as a genuine clear (e.g. a de-platformed ssi_admin),
  // never fall back to the stale cached value the way initialize()'s
  // partial-knowledge guard would.
  function syncRealRoleCache(platformRole: string | null, educationalRole: string | null): void {
    useUserRole().setAuthoritative(platformRole, educationalRole)
  }

  function toLearnerRecord(row: any): LearnerRecord {
    return {
      id: row.id,
      user_id: row.user_id,
      display_name: row.display_name,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
      preferences: row.preferences || defaultPreferences(),
      verified_emails: row.verified_emails || [],
    }
  }

  /**
   * Load verified_emails via RPC (column is revoked from direct SELECT).
   */
  async function loadMyVerifiedEmails(): Promise<string[]> {
    if (!supabase.value) return []
    const { data, error } = await supabase.value.rpc('get_my_verified_emails')
    if (error) {
      console.warn('[useAuth] Failed to load verified emails:', error.message)
      return []
    }
    return data || []
  }

  /**
   * Fetch or create learner record in Supabase.
   *
   * Multi-email identity: if no learner found by auth UUID, checks whether
   * this email appears in another learner's verified_emails. If so, links
   * this auth session to that existing learner (same person, different email).
   */
  async function ensureLearnerExists(): Promise<LearnerRecord | null> {
    if (!supabase.value || !supabaseUser.value) return null

    const userId = supabaseUser.value.id
    const email = supabaseUser.value.email?.toLowerCase().trim()

    try {
      // 1. Try to fetch learner by auth user ID (fast path — same email as before)
      // Note: verified_emails column is revoked from SELECT — load via RPC separately
      const { data: existingLearner, error: fetchError } = await supabase.value
        .from('learners')
        .select('id, user_id, display_name, created_at, updated_at, preferences, platform_role, educational_role')
        .eq('user_id', userId)
        .single()

      if (existingLearner) {
        syncRealRoleCache(existingLearner.platform_role, existingLearner.educational_role)

        // verified_emails enrichment is best-effort. If the RPC or
        // backfill UPDATE throws (e.g. RLS hiccup, schema drift), we
        // STILL return the learner so progress writes work. Letting
        // these throw used to take out the whole function and leave
        // learner.value null — which then fell back to the auth UID
        // and silently missed every persistence row.
        let emails: string[] = []
        try {
          emails = await loadMyVerifiedEmails()
          // Never back-fill a link-auth placeholder into verified_emails — it's
          // not a real inbox and would surface as the user's primary email.
          if (email && !isPlaceholderEmail(email) && !emails.includes(email)) {
            // Server-side append. The direct UPDATE this replaces was the
            // AUTH-CORE-02 hole: UPDATE(verified_emails) was granted to
            // `authenticated`, and own-row RLS constrains WHICH row you write,
            // never the array's CONTENTS — so anyone could plant a third
            // party's address here and inherit their email-allowlist grant
            // (api/access/grant-emails.ts) or family attachment
            // (api/family/invite.ts). The grant was revoked
            // 2026-08-11 (supabase/migrations/20260811_lock_learner_identity_columns.sql);
            // sync_my_verified_emails() derives the address from auth.users
            // instead of trusting the caller.
            const { data: synced, error: syncErr } = await supabase.value.rpc('sync_my_verified_emails')
            if (syncErr) console.warn('[useAuth] sync_my_verified_emails failed (non-fatal):', syncErr.message)
            else emails = synced || emails
          }
        } catch (err) {
          console.warn('[useAuth] verified_emails enrichment failed (non-fatal):', err)
        }

        return toLearnerRecord({ ...existingLearner, verified_emails: emails })
      }

      // 2. No learner for this auth UUID — check if email is linked to another learner
      //    Uses RPC because verified_emails column is revoked from direct SELECT.
      if (fetchError?.code === 'PGRST116' && email) {
        const { data: linkedRows } = await supabase.value
          .rpc('find_learner_by_email', { lookup_email: email })

        const linkedLearner = Array.isArray(linkedRows) ? linkedRows[0] : linkedRows
        if (linkedLearner) {
          // Found! This email belongs to an existing learner — link this auth user to them
          const oldUserId = (linkedLearner as any).user_id
          console.log(`[useAuth] Email ${email} found on learner ${(linkedLearner as any).id} — linking auth user ${userId} (was ${oldUserId})`)
          // learners is RLS-on (own-row) and the linked row still carries the OLD
          // auth uid, so the re-point runs through SECURITY DEFINER claim_learner
          // (secfix_16), gated on this JWT's email being in the learner's
          // verified_emails.
          const { error: claimErr } = await supabase.value.rpc('claim_learner', { p_learner_id: (linkedLearner as any).id })
          if (claimErr) console.warn('[useAuth] claim_learner failed — learner not re-linked to this auth user:', claimErr.message)

          // Cascade user_id to related tables so dashboard queries find the right records.
          // user_tags is RLS-on (own-row): the OLD rows aren't ours yet, so the re-point
          // runs through the SECURITY DEFINER fn relink_user_tags (secfix_15), which
          // asserts the old identity is orphaned (no learners row holds it) before
          // moving its tags to auth.uid(). govt_admins was REVOKEd by 20260521180000,
          // so its cascade goes through /api/auth/cascade-user-id.
          if (oldUserId && oldUserId !== userId) {
            const { error: relinkErr } = await supabase.value.rpc('relink_user_tags', { old_user_id: oldUserId })
            if (relinkErr) console.warn('[useAuth] relink_user_tags failed — tags not migrated:', relinkErr.message)

            try {
              const { data: { session } } = await supabase.value.auth.getSession()
              const token = session?.access_token
              if (token) {
                const resp = await fetch('/api/auth/cascade-user-id', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                  },
                  body: JSON.stringify({ old_user_id: oldUserId }),
                })
                if (!resp.ok) {
                  const data = await resp.json().catch(() => ({}))
                  console.warn('[useAuth] govt_admins cascade failed (non-fatal):', data.error || resp.status)
                }
              }
            } catch (cascadeErr) {
              console.warn('[useAuth] cascade-user-id fetch failed (non-fatal):', cascadeErr)
            }
          }

          const ll = linkedLearner as any
          ll.user_id = userId

          syncRealRoleCache(ll.platform_role, ll.educational_role)

          // Load emails now that this user owns the learner
          const emails = await loadMyVerifiedEmails()

          return toLearnerRecord({ ...ll, verified_emails: emails })
        }
      }

      // 3. Truly new user — create learner with this email in verified_emails
      if (fetchError?.code === 'PGRST116') {
        // A link-auth placeholder must not become the display name ("link-<uuid>")
        // or land in verified_emails — treat it as "no email yet".
        const realEmail = email && !isPlaceholderEmail(email) ? email : ''
        const displayName = realEmail?.split('@')[0] || 'Learner'

        // This insert races api/code/redeem.ts's own learner-creation insert
        // (both fire off the same SIGNED_IN event — see RedeemCode.vue's
        // handlePossessionSubmit race note). Whichever wins must still set
        // needs_verification correctly, since the loser's insert is a
        // no-op against an existing row.
        const needsEmailVerification = supabaseUser.value.user_metadata?.onboarded_via === 'possession'

        const { data: newLearner, error: createError } = await supabase.value
          .from('learners')
          .insert({
            user_id: userId,
            display_name: displayName,
            preferences: defaultPreferences(),
            verified_emails: realEmail ? [realEmail] : [],
            needs_verification: needsEmailVerification,
          })
          .select()
          .single()

        if (createError) {
          console.error('[useAuth] Failed to create learner:', createError)
          return null
        }

        return toLearnerRecord(newLearner)
      }

      if (fetchError) {
        console.error('[useAuth] Failed to fetch learner:', fetchError)
      }
      return null
    } catch (err) {
      console.error('[useAuth] Error in ensureLearnerExists:', err)
      return null
    }
  }

  /**
   * Default learner preferences
   */
  function defaultPreferences(): LearnerPreferences {
    return {
      session_duration_minutes: 30,
      encouragements_enabled: true,
      learning_mode: 'fast',
      volume: 1.0,
    }
  }

  /**
   * Mirror the current learner id into a cookie so /api/player-events
   * can attribute analytics rows to the right user. Same-origin cookies
   * flow automatically with fetch (player-events) and <audio> requests
   * — useful as the auth channel because <audio> elements can't carry
   * custom headers. Cleared on sign-out.
   *
   * Not load-bearing — purely for analytics. Failures are silent.
   */
  function syncAudioUserCookie(learnerId: string | null): void {
    if (typeof document === 'undefined') return
    try {
      if (learnerId) {
        // 30-day cookie; renewed on every auth change.
        const maxAge = 60 * 60 * 24 * 30
        document.cookie = `ssi-user-id=${encodeURIComponent(learnerId)}; path=/; max-age=${maxAge}; SameSite=Lax`
      } else {
        document.cookie = 'ssi-user-id=; path=/; max-age=0; SameSite=Lax'
      }
    } catch { /* document.cookie can throw in some sandboxed contexts */ }
  }

  // Single source of truth for the audio-attribution cookie: whatever
  // `learner.value.id` is at any moment, the cookie reflects it. Covers
  // initial mount (immediate: true), sign-in/out, account switch, future
  // auth flows we haven't built yet — they all just update `learner` and
  // the cookie follows. No need to add explicit syncAudioUserCookie calls
  // anywhere else.
  watch(
    () => learner.value?.id ?? null,
    (id) => syncAudioUserCookie(id),
    { immediate: true },
  )

  /**
   * Remember the identity the server has just confirmed, so the next boot can
   * be truthful about who this is even with no network. Called on every path
   * that sets `learner` from a live read — and only those paths.
   */
  function rememberIdentity(): void {
    if (!learner.value) return
    const { platformRole, educationalRole } = useUserRole()
    writeLastKnownIdentity({
      learner: learner.value,
      authUserId: supabaseUser.value?.id ?? learner.value.user_id ?? null,
      email: supabaseUser.value?.email ?? null,
      platformRole: platformRole.value,
      educationalRole: educationalRole.value,
    })
    identityUnverified.value = false
  }

  /** Definitive sign-out only — never a network failure. */
  function forgetIdentity(): void {
    clearLastKnownIdentity()
    identityUnverified.value = false
  }

  /**
   * Adopt the last identity the server confirmed, so the FIRST paint of a
   * signed-in learner is signed-in — before the network is consulted at all.
   * A live session then confirms it (rememberIdentity) or corrects it
   * (a definitive no-session, or a revoked session's teardown).
   *
   * Returns true when an identity was adopted.
   */
  function adoptLastKnownIdentity(): boolean {
    if (learner.value) return false
    const remembered = readLastKnownIdentity()
    if (!remembered) return false
    learner.value = remembered.learner
    identityUnverified.value = true
    // Roles travel with the identity: useResolvedSession only counts an
    // 'authenticated' status as resolved once the role cache has loaded, so
    // without this an offline signed-in learner would sit on 'pending'
    // forever and every whenResolved() waiter would hang.
    useUserRole().setAuthoritative(remembered.platformRole, remembered.educationalRole)
    return true
  }

  /**
   * Whether supabase-js still holds a stored session locally.
   *
   * This is what separates "the refresh could not reach the server" from "this
   * person is signed out". supabase-js drops its stored session on a definitive
   * refresh rejection but keeps it through a network failure — so a token that
   * is still on disk while getSession() came back empty means we could not ask,
   * not that the answer was no. Reading storage rather than `navigator.onLine`
   * is deliberate: onLine lies on weak signal and captive portals (see
   * config/networkGate.ts).
   */
  function hasStoredSupabaseSession(): boolean {
    try {
      return Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k))
    } catch {
      return false
    }
  }

  /**
   * Handle auth state change (sign in or sign out)
   */
  async function handleAuthChange(user: User | null): Promise<void> {
    const previousUser = supabaseUser.value
    supabaseUser.value = user

    if (user && !previousUser) {
      // User just signed in
      isLoading.value = true
      const row = await ensureLearnerExists()
      if (row) {
        learner.value = row
        rememberIdentity()
      } else if (!identityUnverified.value) {
        learner.value = null
      }
      // else: the row read failed while we are holding a remembered identity.
      // A failed read is not a sign-out — keep who we know they are.

      // Migrate guest progress if any
      const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
      if (hadGuestId) {
        await migrateGuestProgress()
      }

      isLoading.value = false
      useResolvedSession().resolve(true)
    } else if (!user && previousUser) {
      // User signed out — definitive, so the remembered identity goes too.
      learner.value = null
      forgetIdentity()
      // Reinitialize guest ID
      guestId.value = getOrCreateGuestId()
      useResolvedSession().resolve(false)
    }
    // No explicit syncAudioUserCookie here — the watcher above mirrors
    // learner.id reactively, so any path that mutates learner.value
    // automatically updates the audio-attribution cookie.
  }

  /**
   * Initialize auth state.
   *
   * Guest mode is always available immediately — the Supabase session
   * check runs with a timeout so the app is never blocked by network
   * issues. On a real session, learner is loaded and useUserRole is
   * synced; otherwise the app runs as guest until sign-in.
   */
  async function initialize(supabaseClient: SupabaseClient): Promise<void> {
    supabase.value = supabaseClient
    isLoading.value = true

    // Legacy dev role bypass — clear old storage key
    if (localStorage.getItem('ssi-dev-role')) {
      localStorage.removeItem('ssi-dev-role')
    }

    // Initialize guest ID BEFORE any async work — app is usable as guest immediately
    guestId.value = getOrCreateGuestId()

    // Adopt the last identity the server confirmed, BEFORE the network is
    // consulted, so a signed-in learner's first paint is signed-in rather than
    // a guest who gets upgraded a second later (or, offline, never does).
    // Everything below either confirms this or definitively corrects it.
    const adopted = adoptLastKnownIdentity()

    // Listen for auth state changes (sign in, sign out, token refresh)
    // Register listener early so we catch any auth events during session check
    supabaseClient.auth.onAuthStateChange((event, session) => {
      handleAuthChange(session?.user ?? null)
      // Keep the iOS install hand-off bridge current (browser context
      // only; writeAuthHandoff no-ops in standalone). null on sign-out
      // clears it so a logged-out session can't leak into a new install.
      void writeAuthHandoff(
        session?.access_token && session?.refresh_token
          ? { access_token: session.access_token, refresh_token: session.refresh_token }
          : null,
      )
      // On sign-in, claim any email-allowlist (pre-granted) free access.
      // Idempotent and best-effort — never blocks or breaks the auth flow.
      if (event === 'SIGNED_IN' && session?.access_token) {
        void useAccessClaim().claimAccess(session.access_token)
      }
    })

    // Set when the session check could not reach an answer (timeout, throw)
    // rather than answering "no session". The two must never be conflated.
    let couldNotVerify = false

    // Check for existing Supabase Auth session with a timeout.
    try {
      const SESSION_TIMEOUT_MS = 5000
      const sessionPromise = supabaseClient.auth.getSession()
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), SESSION_TIMEOUT_MS)
      )
      const result = await Promise.race([sessionPromise, timeoutPromise])

      if (result && 'data' in result && result.data.session?.user) {
        supabaseUser.value = result.data.session.user
        // ensureLearnerExists handles the syncRealRoleCache call internally
        // (it has the raw DB row with platform_role / educational_role).
        // toLearnerRecord strips those fields from the returned object, so
        // we must NOT re-sync from learner.value here — it would call
        // syncRealRoleCache(null, null) and wipe the correct values out
        // of useUserRole cache.
        // Bounded. getSession() above is already raced against a timeout, but
        // ensureLearnerExists() is a live DB round-trip and was not — so on a
        // weak signal boot stopped HERE, one line past the timeout that was
        // supposed to prevent exactly this. On expiry we carry on with the
        // cached learner record (or none) and let the row settle behind the
        // learner; playback must not wait on it. (Tom 2026-08-15.)
        const learnerRow = await withNetworkTimeout(ensureLearnerExists())
        if (learnerRow === NETWORK_TIMEOUT) {
          console.warn('[useAuth] Learner-row read exceeded its budget — continuing with the remembered record.')
        } else if (learnerRow) {
          learner.value = learnerRow
          rememberIdentity()
        } else if (!identityUnverified.value) {
          // A genuine null with nothing remembered: no row, and nothing to
          // fall back on. (A null while holding a remembered identity means
          // the read failed — keep the identity, see adoptLastKnownIdentity.)
          learner.value = null
        }

        // Keep the install hand-off bridge fresh for an already-signed-in
        // Safari session (no SIGNED_IN event fires for a restored session).
        const s = result.data.session
        void writeAuthHandoff({ access_token: s.access_token, refresh_token: s.refresh_token })

        // Trust-but-verify: getSession() serves the cached session without
        // asking the server, so a session revoked elsewhere (sign-out on
        // another device, refresh-token reuse revocation) keeps an unexpired
        // token that client-direct PostgREST reads accept but GoTrue-verified
        // endpoints reject — a half-dead login where the player works and
        // every admin/server call fails "Auth session missing!" (2026-07-18
        // incident). Validate once in the background; tear down only on the
        // definitive session-gone error, never on network flakes.
        void validateSessionAlive(supabaseClient)

        // Check if there's guest progress to migrate
        // Purely local (clearGuestData) — no network, so it stays awaited.
        const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
        if (hadGuestId) {
          await migrateGuestProgress()
        }

        isLoading.value = false
        useResolvedSession().resolve(true)
        return
      } else if (result === null) {
        // Timed out: we did not learn that there is no session, we learned
        // that we could not ask. Never a reason to downgrade — see the tail.
        couldNotVerify = true
        console.warn('[useAuth] Session check timed out — could not verify identity')
      }

      // No local session. On a freshly-installed iOS Home Screen app the
      // Safari session is in a storage jar we can't see — but Safari may
      // have left tokens in the shared CacheStorage bridge. Consume them
      // once and restore the session so the user isn't bounced to sign-in.
      // Any failure falls through to guest + the normal sign-in flow.
      if (isStandalone()) {
        try {
          const handoff = await readAndConsumeAuthHandoff()
          if (handoff) {
            const { data, error } = await supabaseClient.auth.setSession(handoff)
            if (!error && data.session?.user) {
              supabaseUser.value = data.session.user
              const handoffRow = await ensureLearnerExists()
              if (handoffRow) {
                learner.value = handoffRow
                rememberIdentity()
              }
              const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
              if (hadGuestId) {
                await migrateGuestProgress()
              }
              console.log('[useAuth] Restored session from iOS install hand-off')
              isLoading.value = false
              useResolvedSession().resolve(true)
              return
            }
          }
        } catch (err) {
          console.warn('[useAuth] Install hand-off restore failed, continuing as guest:', err)
        }
      }
    } catch (err) {
      couldNotVerify = true
      console.warn('[useAuth] Session check failed — could not verify identity:', err)
    }

    isLoading.value = false

    // Nothing above produced a live session. Two situations that look identical
    // from here and must NOT be treated the same (Tom, 2026-08-15 — signed in,
    // airplane mode, shown the guest "Save Progress" nudge):
    //
    //   1. We could not ask. The check timed out or threw, or supabase-js still
    //      holds a stored session it could not refresh. We remember who this is,
    //      so they stay signed in, unverified, and the network confirms it later.
    //   2. There is genuinely no session and nothing remembered — a real guest.
    if (adopted && (couldNotVerify || hasStoredSupabaseSession())) {
      identityUnverified.value = true
      console.warn('[useAuth] Continuing as the last known signed-in learner — verification deferred')
      useResolvedSession().resolve(true)
      return
    }

    // Definitively no session. Anything remembered is stale by definition —
    // a signed-out person seeing a stale identity is worse than the bug above.
    if (adopted) {
      learner.value = null
      useUserRole().clear()
    }
    forgetIdentity()
    useResolvedSession().resolve(false)
  }

  // ============================================
  // ACTIONS
  // ============================================

  /**
   * Check the locally-restored session is still alive server-side.
   * GoTrue answers a revoked session's token with session_not_found, which
   * supabase-js surfaces as AuthSessionMissingError — the one error that
   * definitively means "this session no longer exists". Anything else
   * (network flake, timeout) must never sign the user out.
   */
  async function validateSessionAlive(client: SupabaseClient): Promise<void> {
    try {
      const { error } = await client.auth.getUser()
      if (error?.name === 'AuthSessionMissingError') {
        await recoverDeadSession(client)
      }
    } catch {
      // Only the explicit error above may tear down — swallow everything else.
    }
  }

  /**
   * Graceful recovery for a session the server no longer honours (stale
   * pre-deploy sessions, sessions revoked from another device). Without
   * this, admin/schools surfaces sit on a red "Auth session missing!"
   * banner with empty data until the user works out they must sign in
   * again themselves.
   *
   * 1. Try refreshSession() — a refreshable session comes back live with a
   *    new token; reload once so every surface reboots against it (the
   *    in-flight fetches already failed with the dead token).
   * 2. Refresh failed → the session is definitively gone: tear down
   *    locally and, on the server-verified surfaces (/admin, /schools,
   *    /tutors), hard-navigate to the schools sign-in wall with a friendly
   *    "please sign in again" notice. Hard navigation (the same escape
   *    SchoolsContainer.handleSignOut uses) resets module singletons like
   *    the school context, so no half-dead state survives.
   */
  async function recoverDeadSession(client: SupabaseClient): Promise<void> {
    if (isRecoveringDeadSession) return
    isRecoveringDeadSession = true
    try {
      // Loop guard for EVERY recovery navigation (reload or redirect):
      // at most 3 navigations per 5-minute window — verified live
      // 2026-07-18: without a guard, a zombie that survives teardown
      // reload-loops the page sub-second. It legitimately takes up to two
      // recovery navigations to land clean (a concurrent getSession() can
      // re-persist the zombie between purge and navigation), so a one-shot
      // guard strands the user on a half-dead page instead.
      let guard = { n: 0, t: Date.now() }
      try {
        const parsed = JSON.parse(sessionStorage.getItem(DEAD_SESSION_NAV_GUARD_KEY) || '')
        if (parsed && typeof parsed.n === 'number' && Date.now() - parsed.t < 300_000) guard = parsed
      } catch { /* absent or malformed — fresh window */ }
      const canNavigate = guard.n < 3
      const markNavigated = () =>
        sessionStorage.setItem(DEAD_SESSION_NAV_GUARD_KEY, JSON.stringify({ n: guard.n + 1, t: guard.t }))

      const { data, error } = await client.auth.refreshSession()
      if (!error && data?.session) {
        console.warn('[useAuth] Dead session refreshed — reloading to pick up the live token')
        if (canNavigate) {
          markNavigated()
          deadSessionNav.reload()
        }
        return
      }
      console.warn('[useAuth] Session revoked server-side and not refreshable — routing to sign-in')
      await signOut()
      const path = deadSessionNav.currentPath()
      if (/^\/(admin|schools|tutors)(\/|$)/.test(path)) {
        sessionStorage.setItem(SIGNIN_AGAIN_NOTICE_KEY, '1')
        if (canNavigate) {
          markNavigated()
          // Re-purge right before leaving: a concurrent getSession() may
          // have re-persisted the dead session since signOut's purge.
          purgeSupabaseAuthStorage()
          deadSessionNav.goto('/schools')
        }
      }
    } finally {
      isRecoveringDeadSession = false
    }
  }

  async function signOut(): Promise<void> {
    // The network sign-out must NEVER block local teardown. If the Supabase call
    // hangs or throws (flaky network, an already-expired/invalid session), we
    // still clear local auth state below — otherwise the button appears to "do
    // nothing" because the await never resolves and the caller's reload never
    // runs. Bound it with a timeout and swallow errors.
    if (supabase.value) {
      try {
        // scope:'local' — supabase-js defaults to 'global', which revokes the
        // account's sessions on EVERY device. Signing out on a phone (or a
        // test-account private window) then killed the desktop's session
        // server-side while its cached token lived on, so GoTrue-verified
        // endpoints answered "Auth session missing!" (2026-07-18 admin
        // incident). Sign-out means this device only.
        await Promise.race([
          supabase.value.auth.signOut({ scope: 'local' }),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ])
      } catch (err) {
        console.warn('[useAuth] supabase signOut failed (clearing local state anyway):', err)
      }
    }
    // Definitive local teardown — see purgeSupabaseAuthStorage. The remembered
    // identity goes with it: this is the one direction that would be worse than
    // the offline bug it exists to fix.
    purgeSupabaseAuthStorage()
    forgetIdentity()
    supabaseUser.value = null
    learner.value = null
    useUserRole().clear()
    useSharedSubscription().clearCache()
    useSharedUserEntitlements().clearCache()
    // Reinitialize guest
    guestId.value = getOrCreateGuestId()
    // Set directly rather than relying on the SIGNED_OUT event's own
    // handleAuthChange(null) call: that branch only fires resolve(false) when
    // it sees a previousUser, but supabaseUser.value is already cleared above
    // by the time the event lands, so it would no-op here.
    useResolvedSession().resolve(false)
  }

  /**
   * Force a fresh learner/role re-sync from the DB.
   *
   * Used right after an action that changes the learner's role server-side
   * (e.g. redeeming an invite code) to guarantee the role cache reflects the
   * change. Without this, the SIGNED_IN listener's own ensureLearnerExists()
   * call — fired concurrently with the redemption — can read the
   * pre-redemption row and then resolve LATER (it does an extra
   * verified_emails round trip), clobbering the redemption's optimistic
   * role write before the caller navigates. Awaiting this after redemption
   * makes the redemption's own re-fetch the final, authoritative write.
   */
  async function refreshRole(): Promise<void> {
    if (!supabaseUser.value) return
    const row = await ensureLearnerExists()
    if (row) {
      learner.value = row
      rememberIdentity()
    } else if (!identityUnverified.value) {
      learner.value = null
    }
  }

  function incrementSessionCount(): void {
    completedSessionsCount.value++
    localStorage.setItem(GUEST_SESSIONS_KEY, String(completedSessionsCount.value))
  }

  function markSignupPromptSeen(): void {
    hasSeenSignupPrompt.value = true
    localStorage.setItem(SIGNUP_PROMPT_SEEN_KEY, 'true')
  }

  /**
   * Merge a patch into the learner's stored preferences.
   *
   * Signed-out learners have no `learners` row, so callers persist to
   * localStorage themselves and treat this as best-effort: it resolves
   * `false` when there is nothing to write to. Errors are surfaced loudly in
   * the console rather than swallowed (the false-"Saved" class), but never
   * throw — a preference write must not be able to break playback.
   */
  async function updatePreferences(
    patch: Partial<LearnerPreferences>,
  ): Promise<boolean> {
    const current = learner.value
    if (!supabase.value || !current?.id) return false
    const merged = { ...(current.preferences || defaultPreferences()), ...patch }
    const { error: prefError } = await supabase.value
      .from('learners')
      .update({ preferences: merged })
      .eq('id', current.id)
    if (prefError) {
      console.error('[useAuth] Failed to persist preferences:', prefError)
      return false
    }
    learner.value = { ...current, preferences: merged }
    return true
  }

  /**
   * Set or change the user's password
   */
  async function updatePassword(newPassword: string): Promise<{ error?: string }> {
    if (!supabase.value) return { error: 'Not connected' }
    if (!supabaseUser.value) return { error: 'Not signed in' }

    const { error: updateError } = await supabase.value.auth.updateUser({
      password: newPassword,
      data: { has_password: true },
    })

    if (updateError) {
      return { error: updateError.message }
    }

    // Update local user ref so has_password is immediately available
    supabaseUser.value = {
      ...supabaseUser.value,
      user_metadata: { ...supabaseUser.value.user_metadata, has_password: true },
    } as User

    return {}
  }

  /**
   * Migrate guest progress to authenticated user.
   *
   * Reassigns any `sessions` rows still owned by the legacy
   * GUEST_ID_KEY to the now-signed-in learner, then clears the
   * key. Live progress (course_enrollments / lego_progress /
   * seed_progress) writes straight to Supabase keyed by learner id
   * — no client-side replay needed.
   *
   * The original 2024-era implementation also replayed progress out
   * of an IndexedDB OfflineCache, but nothing has written to that
   * store since the Wave 3 cache cleanup, and OfflineCache itself
   * was deleted along with this body's invocation of it.
   */
  async function migrateGuestProgress(): Promise<void> {
    if (!learner.value || !supabase.value) {
      return
    }
    const oldGuestId = localStorage.getItem(GUEST_ID_KEY)
    if (!oldGuestId) {
      return
    }
    // No DB sessions to reassign: guests are localStorage-only, and a
    // `guest-<uuid>` id can't be stored in (or queried against) the uuid
    // sessions.learner_id column — the old UPDATE only ever 400'd. We just
    // clear the guest identity + signup-nudge state now that the learner has
    // a real id. (Learning progress lives under separate keys and is unaffected.)
    clearGuestData()
  }

  /**
   * Get the current Supabase session access token (for API calls that need auth)
   */
  async function getToken(): Promise<string | null> {
    if (!supabase.value) return null
    try {
      const { data: { session } } = await supabase.value.auth.getSession()
      return session?.access_token || null
    } catch {
      return null
    }
  }

  return {
    // State
    user: supabaseUser,
    learner,
    isAuthenticated,
    isGuest,
    learnerId,
    userId,
    completedSessionsCount,
    hasSeenSignupPrompt,
    isLoading,
    identityUnverified,

    // Actions
    signOut,
    getToken,
    incrementSessionCount,
    markSignupPromptSeen,
    migrateGuestProgress,
    initialize,
    updatePassword,
    updatePreferences,
    refreshRole,
    // Exposed for play-as-class (owner ruling 2026-07-16): while a class-mode
    // session is active, /api/player-events must attribute telemetry to the
    // CLASS's learner id, not the driving staff member's own — this is the
    // one function that actually sets the ssi-user-id cookie the endpoint
    // reads. LearningPlayer.vue flips it to the class's id on enter and
    // restores it to the staff member's own on exit.
    syncAudioUserCookie,
  }
}
