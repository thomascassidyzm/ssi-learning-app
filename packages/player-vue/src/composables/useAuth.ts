/**
 * useAuth - Authentication composable using Supabase Auth (email OTP)
 *
 * Provides:
 * - Supabase Auth user state
 * - Supabase learner record
 * - Guest mode with local ID
 * - Progress migration when guest signs up
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { LearnerRecord, LearnerPreferences } from '@ssi/core'
import { useUserRole } from '@/composables/useUserRole'
import { useSharedSubscription } from '@/composables/useSubscription'
import { useSharedUserEntitlements } from '@/composables/useUserEntitlements'

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

  // Computed state (accounts for god mode where learner is set without Supabase Auth)
  const isAuthenticated = computed(() => !!supabaseUser.value || !!learner.value)
  const isGuest = computed(() => !supabaseUser.value && !learner.value && !!guestId.value)
  // learnerId = learners table PK — use for FK references (sessions, enrollments, progress)
  const learnerId = computed(() => {
    if (learner.value) {
      return learner.value.id
    }
    if (supabaseUser.value) {
      return supabaseUser.value.id
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
  // Sync the real user's roles into useUserRole, but only if a legitimate
  // god-mode impersonation isn't currently active. godMode.selectUser has
  // already written the impersonated role to the cache; overwriting with
  // the real roles would bounce ssi_admins out of the impersonated
  // dashboard (their own {ssi_admin, null} fails canAccessSchools).
  function syncRealRoleCache(platformRole: string | null, educationalRole: string | null): void {
    const godModeStored = !!(
      sessionStorage.getItem('ssi-god-mode-user') ||
      localStorage.getItem('ssi-god-mode-user')
    )
    const canUseGodMode = platformRole === 'ssi_admin' || educationalRole === 'god'
    if (godModeStored && canUseGodMode) return // leave impersonation in place
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

        // Load verified_emails via RPC (column revoked from direct SELECT)
        let emails = await loadMyVerifiedEmails()

        // Ensure this email is in verified_emails (backfill for existing accounts)
        if (email && !emails.includes(email)) {
          emails = [...emails, email]
          await supabase.value
            .from('learners')
            .update({ verified_emails: emails })
            .eq('id', existingLearner.id)
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

          // Cascade user_id to related tables so dashboard queries find the right records
          if (oldUserId && oldUserId !== userId) {
            await supabase.value.from('govt_admins').update({ user_id: userId }).eq('user_id', oldUserId)
            await supabase.value.from('user_tags').update({ user_id: userId }).eq('user_id', oldUserId)
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
  }

  /**
   * Initialize auth state.
   * In god mode (ssi-god-mode-user set), skips Supabase Auth entirely and uses mock user IDs.
   *
   * Guest mode is always available immediately — the Supabase session check
   * runs with a timeout so the app is never blocked by network issues.
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
    })

    // Check for existing Supabase Auth session with a timeout.
    // Real auth sessions ALWAYS take priority over god mode.
    try {
      const SESSION_TIMEOUT_MS = 5000
      const sessionPromise = supabaseClient.auth.getSession()
      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), SESSION_TIMEOUT_MS)
      )
      const result = await Promise.race([sessionPromise, timeoutPromise])

      if (result && 'data' in result && result.data.session?.user) {
        supabaseUser.value = result.data.session.user
        learner.value = await ensureLearnerExists()

        // Check if there's guest progress to migrate
        const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
        if (hadGuestId) {
          await migrateGuestProgress()
        }

        const platformRole = (learner.value as any)?.platform_role ?? null
        const educationalRole = (learner.value as any)?.educational_role ?? null

        // Unauthorized god-mode storage → wipe (shared-browser leak guard).
        // Authorized impersonation is preserved by syncRealRoleCache below.
        const godModeStored = !!(
          sessionStorage.getItem('ssi-god-mode-user') ||
          localStorage.getItem('ssi-god-mode-user')
        )
        const canUseGodMode = platformRole === 'ssi_admin' || educationalRole === 'god'
        if (godModeStored && !canUseGodMode) {
          localStorage.removeItem('ssi-god-mode-user')
          sessionStorage.removeItem('ssi-god-mode-user')
        }

        // Role cache sync is a no-op when legitimate impersonation is active.
        syncRealRoleCache(platformRole, educationalRole)
        isLoading.value = false
        return
      } else if (result === null) {
        console.warn('[useAuth] Session check timed out, continuing as guest')
      }
    } catch (err) {
      console.warn('[useAuth] Session check failed, continuing as guest:', err)
    }

    // No real Supabase session — check for god mode (demo/admin impersonation)
    const godModeUser = sessionStorage.getItem('ssi-god-mode-user') || localStorage.getItem('ssi-god-mode-user')
    if (godModeUser) {
      try {
        const parsed = JSON.parse(godModeUser)
        guestId.value = null
        learner.value = {
          id: parsed.learner_id || parsed.user_id,
          user_id: parsed.user_id,
          display_name: parsed.display_name,
          created_at: new Date(),
          updated_at: new Date(),
          preferences: defaultPreferences(),
        } as any
        // Sync roles to useUserRole so router guard works in god mode
        const { initialize: initRole } = useUserRole()
        initRole(parsed.platform_role ?? null, parsed.educational_role ?? null)
        isLoading.value = false
        console.log('[useAuth] God mode active, using user:', parsed.display_name)
        return
      } catch {
        // Invalid stored user, continue with normal auth
        localStorage.removeItem('ssi-god-mode-user')
      }
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
    // Clear any god-mode impersonation so it can't leak to the next user
    // on a shared browser. initialize() no longer wipes this on sign-in
    // (it needs to survive the reload-based GOD panel flow), so signOut
    // is the right hook.
    localStorage.removeItem('ssi-god-mode-user')
    sessionStorage.removeItem('ssi-god-mode-user')
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
   * Migrate guest progress to authenticated user
   * This reads from OfflineCache and uploads to Supabase
   */
  async function migrateGuestProgress(): Promise<void> {
    if (!learner.value || !supabase.value) {
      console.log('[useAuth] Cannot migrate: no learner or supabase')
      return
    }

    const oldGuestId = localStorage.getItem(GUEST_ID_KEY)
    if (!oldGuestId) {
      console.log('[useAuth] No guest data to migrate')
      return
    }

    console.log('[useAuth] Migrating guest progress to learner:', learner.value.id)

    try {
      // Import OfflineCache dynamically to avoid circular deps
      const { createOfflineCache } = await import('@ssi/core')
      const cache = createOfflineCache()

      // Get all guest progress from IndexedDB
      const guestProgress = await cache.getProgressByLearner(oldGuestId)

      if (!guestProgress || guestProgress.length === 0) {
        console.log('[useAuth] No guest progress found')
        clearGuestData()
        return
      }

      console.log(`[useAuth] Found ${guestProgress.length} course(s) to migrate`)

      for (const progress of guestProgress) {
        // Check if user already has progress for this course (skip if so)
        const { data: existing } = await supabase.value
          .from('course_enrollments')
          .select('id')
          .eq('learner_id', learner.value.id)
          .eq('course_id', progress.courseId)
          .single()

        if (existing) {
          console.log(`[useAuth] Skipping ${progress.courseId} - already has cloud progress`)
          continue
        }

        // Create enrollment
        await supabase.value
          .from('course_enrollments')
          .insert({
            learner_id: learner.value.id,
            course_id: progress.courseId,
            helix_state: progress.helixState,
          })

        // Migrate LEGO progress
        if (progress.legoProgress.length > 0) {
          const legoRecords = progress.legoProgress.map(lp => ({
            learner_id: learner.value!.id,
            lego_id: lp.lego_id,
            course_id: lp.course_id,
            thread_id: lp.thread_id,
            fibonacci_position: lp.fibonacci_position,
            skip_number: lp.skip_number,
            reps_completed: lp.reps_completed,
            is_retired: lp.is_retired,
            last_practiced_at: lp.last_practiced_at,
          }))

          await supabase.value
            .from('lego_progress')
            .upsert(legoRecords, { onConflict: 'learner_id,lego_id' })
        }

        // Migrate SEED progress
        if (progress.seedProgress.length > 0) {
          const seedRecords = progress.seedProgress.map(sp => ({
            learner_id: learner.value!.id,
            seed_id: sp.seed_id,
            course_id: sp.course_id,
            thread_id: sp.thread_id,
            is_introduced: sp.is_introduced,
            introduced_at: sp.introduced_at,
          }))

          await supabase.value
            .from('seed_progress')
            .upsert(seedRecords, { onConflict: 'learner_id,seed_id' })
        }

        console.log(`[useAuth] Migrated progress for ${progress.courseId}`)
      }

      // Migrate belt progress from localStorage to Supabase enrollment
      try {
        for (const progress of guestProgress) {
          const beltKey = `ssi_belt_progress_${progress.courseId}`
          const beltData = localStorage.getItem(beltKey)
          if (beltData) {
            const parsed = JSON.parse(beltData)
            if (parsed.highestLegoId) {
              await supabase.value
                .from('course_enrollments')
                .update({ last_completed_lego_id: parsed.highestLegoId })
                .eq('learner_id', learner.value!.id)
                .eq('course_id', progress.courseId)
              console.log(`[useAuth] Migrated belt progress for ${progress.courseId}: ${parsed.highestLegoId}`)
            }
          }
        }
      } catch (beltErr) {
        console.warn('[useAuth] Belt progress migration failed (non-critical):', beltErr)
      }

      // Migrate guest sessions to authenticated user
      try {
        const { count } = await supabase.value
          .from('sessions')
          .update({ learner_id: learner.value!.id }, { count: 'exact' })
          .eq('learner_id', oldGuestId)
        if (count && count > 0) {
          console.log(`[useAuth] Migrated ${count} guest session(s)`)
        }
      } catch (sessionErr) {
        console.warn('[useAuth] Session migration failed (non-critical):', sessionErr)
      }

      // Clear guest data from IndexedDB
      await cache.deleteProgressByLearner(oldGuestId)

      // Clear local storage guest data
      clearGuestData()

      console.log('[useAuth] Migration complete')
    } catch (err) {
      console.error('[useAuth] Migration failed:', err)
      // Don't clear guest data on failure - let them try again
    }
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
