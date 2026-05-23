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
import { useSharedSubscription } from '@/composables/useSubscription'
import { useSharedUserEntitlements } from '@/composables/useUserEntitlements'
import { writeAuthHandoff, readAndConsumeAuthHandoff, isStandalone } from '@/utils/authHandoff'

// Local storage keys
const GUEST_ID_KEY = 'ssi-guest-id'
const GUEST_SESSIONS_KEY = 'ssi-guest-sessions-count'
const SIGNUP_PROMPT_SEEN_KEY = 'ssi-signup-prompt-seen'

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
  /** Get the current Supabase session access token */
  getToken: () => Promise<string | null>
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
  // (see DemoLauncher / useDemoController).
  function syncRealRoleCache(platformRole: string | null, educationalRole: string | null): void {
    useUserRole().initialize(platformRole, educationalRole)
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
          if (email && !emails.includes(email)) {
            emails = [...emails, email]
            await supabase.value
              .from('learners')
              .update({ verified_emails: emails })
              .eq('id', existingLearner.id)
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
          await supabase.value
            .from('learners')
            .update({ user_id: userId })
            .eq('id', (linkedLearner as any).id)

          // Cascade user_id to related tables so dashboard queries find the right records.
          // user_tags is still client-writable; govt_admins was REVOKEd
          // by 20260521180000, so its cascade goes through /api/auth/cascade-user-id.
          if (oldUserId && oldUserId !== userId) {
            await supabase.value.from('user_tags').update({ user_id: userId }).eq('user_id', oldUserId)

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
        const displayName = email?.split('@')[0] || 'Learner'

        const { data: newLearner, error: createError } = await supabase.value
          .from('learners')
          .insert({
            user_id: userId,
            display_name: displayName,
            preferences: defaultPreferences(),
            verified_emails: email ? [email] : [],
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
      turbo_mode_enabled: false,
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
   * Handle auth state change (sign in or sign out)
   */
  async function handleAuthChange(user: User | null): Promise<void> {
    const previousUser = supabaseUser.value
    supabaseUser.value = user

    if (user && !previousUser) {
      // User just signed in
      isLoading.value = true
      learner.value = await ensureLearnerExists()

      // Migrate guest progress if any
      const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
      if (hadGuestId) {
        await migrateGuestProgress()
      }

      isLoading.value = false
    } else if (!user && previousUser) {
      // User signed out
      learner.value = null
      // Reinitialize guest ID
      guestId.value = getOrCreateGuestId()
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

    // Listen for auth state changes (sign in, sign out, token refresh)
    // Register listener early so we catch any auth events during session check
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      handleAuthChange(session?.user ?? null)
      // Keep the iOS install hand-off bridge current (browser context
      // only; writeAuthHandoff no-ops in standalone). null on sign-out
      // clears it so a logged-out session can't leak into a new install.
      void writeAuthHandoff(
        session?.access_token && session?.refresh_token
          ? { access_token: session.access_token, refresh_token: session.refresh_token }
          : null,
      )
    })

    // Check for existing Supabase Auth session with a timeout.
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
        learner.value = await ensureLearnerExists()

        // Keep the install hand-off bridge fresh for an already-signed-in
        // Safari session (no SIGNED_IN event fires for a restored session).
        const s = result.data.session
        void writeAuthHandoff({ access_token: s.access_token, refresh_token: s.refresh_token })

        // Check if there's guest progress to migrate
        const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
        if (hadGuestId) {
          await migrateGuestProgress()
        }

        isLoading.value = false
        return
      } else if (result === null) {
        console.warn('[useAuth] Session check timed out, continuing as guest')
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
              learner.value = await ensureLearnerExists()
              const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
              if (hadGuestId) {
                await migrateGuestProgress()
              }
              console.log('[useAuth] Restored session from iOS install hand-off')
              isLoading.value = false
              return
            }
          }
        } catch (err) {
          console.warn('[useAuth] Install hand-off restore failed, continuing as guest:', err)
        }
      }
    } catch (err) {
      console.warn('[useAuth] Session check failed, continuing as guest:', err)
    }

    isLoading.value = false
  }

  // ============================================
  // ACTIONS
  // ============================================

  async function signOut(): Promise<void> {
    if (supabase.value) {
      await supabase.value.auth.signOut()
    }
    supabaseUser.value = null
    learner.value = null
    useUserRole().clear()
    useSharedSubscription().clearCache()
    useSharedUserEntitlements().clearCache()
    // Reinitialize guest
    guestId.value = getOrCreateGuestId()
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
    try {
      const { count } = await supabase.value
        .from('sessions')
        .update({ learner_id: learner.value.id }, { count: 'exact' })
        .eq('learner_id', oldGuestId)
      if (count && count > 0) {
        console.log(`[useAuth] Reassigned ${count} guest session(s) to learner ${learner.value.id}`)
      }
    } catch (sessionErr) {
      console.warn('[useAuth] Session reassignment failed (non-critical):', sessionErr)
    }
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

    // Actions
    signOut,
    getToken,
    incrementSessionCount,
    markSignupPromptSeen,
    migrateGuestProgress,
    initialize,
    updatePassword,
  }
}
