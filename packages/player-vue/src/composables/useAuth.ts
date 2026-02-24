/**
 * useAuth - Authentication composable wrapping Clerk with Supabase integration
 *
 * Provides:
 * - Clerk user state
 * - Supabase learner record
 * - Guest mode with local ID
 * - Progress migration when guest signs up
 */

import { ref, computed, watch, type Ref, type ComputedRef } from 'vue'
import { useUser, useClerk } from '@clerk/vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LearnerRecord, LearnerPreferences } from '@ssi/core'

// Local storage keys
const GUEST_ID_KEY = 'ssi-guest-id'
const GUEST_SESSIONS_KEY = 'ssi-guest-sessions-count'
const SIGNUP_PROMPT_SEEN_KEY = 'ssi-signup-prompt-seen'

export interface AuthState {
  /** Clerk user (null if guest) */
  user: Ref<ReturnType<typeof useUser>['user']['value']>
  /** Supabase learner record (null if guest or not yet loaded) */
  learner: Ref<LearnerRecord | null>
  /** Whether user is authenticated with Clerk */
  isAuthenticated: ComputedRef<boolean>
  /** Whether user is a guest (no Clerk account) */
  isGuest: ComputedRef<boolean>
  /** Effective learner ID (Clerk userId or guestId) */
  learnerId: ComputedRef<string | null>
  /** Number of completed sessions (for signup prompt) */
  completedSessionsCount: Ref<number>
  /** Whether signup prompt has been seen */
  hasSeenSignupPrompt: Ref<boolean>
  /** Whether auth is still loading */
  isLoading: Ref<boolean>
}

export interface AuthActions {
  /** Open Clerk sign in modal */
  openSignIn: () => void
  /** Open Clerk sign up modal */
  openSignUp: () => void
  /** Sign out from Clerk */
  signOut: () => Promise<void>
  /** Increment guest session count */
  incrementSessionCount: () => void
  /** Mark signup prompt as seen */
  markSignupPromptSeen: () => void
  /** Migrate guest progress to authenticated user */
  migrateGuestProgress: () => Promise<void>
  /** Initialize auth (call on mount) */
  initialize: (supabaseClient: SupabaseClient) => Promise<void>
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
  // Clerk state
  const { user: clerkUser, isLoaded: clerkLoaded } = useUser()
  const clerk = useClerk()

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

  // Computed state (accounts for god mode where learner is set without Clerk)
  const isAuthenticated = computed(() => !!clerkUser.value || !!learner.value)
  const isGuest = computed(() => !clerkUser.value && !learner.value && !!guestId.value)
  const learnerId = computed(() => {
    if (clerkUser.value) {
      return clerkUser.value.id
    }
    if (learner.value) {
      return learner.value.user_id
    }
    return guestId.value
  })

  /**
   * Fetch or create learner record in Supabase
   */
  async function ensureLearnerExists(): Promise<LearnerRecord | null> {
    if (!supabase.value || !clerkUser.value) return null

    const userId = clerkUser.value.id

    try {
      // Try to fetch existing learner
      const { data: existingLearner, error: fetchError } = await supabase.value
        .from('learners')
        .select('*')
        .eq('user_id', userId)
        .single()

      if (existingLearner) {
        return {
          id: existingLearner.id,
          user_id: existingLearner.user_id,
          display_name: existingLearner.display_name,
          created_at: new Date(existingLearner.created_at),
          updated_at: new Date(existingLearner.updated_at),
          preferences: existingLearner.preferences || defaultPreferences(),
        }
      }

      // Create new learner if not found (PGRST116 = no rows)
      if (fetchError && fetchError.code === 'PGRST116') {
        const displayName = clerkUser.value.firstName
          || clerkUser.value.username
          || 'Learner'

        const { data: newLearner, error: createError } = await supabase.value
          .from('learners')
          .insert({
            user_id: userId,
            display_name: displayName,
            preferences: defaultPreferences(),
          })
          .select()
          .single()

        if (createError) {
          console.error('[useAuth] Failed to create learner:', createError)
          return null
        }

        return {
          id: newLearner.id,
          user_id: newLearner.user_id,
          display_name: newLearner.display_name,
          created_at: new Date(newLearner.created_at),
          updated_at: new Date(newLearner.updated_at),
          preferences: newLearner.preferences || defaultPreferences(),
        }
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
   * Initialize auth state.
   * In god mode (ssi-dev-role set), skips Clerk entirely and uses mock user IDs.
   */
  async function initialize(supabaseClient: SupabaseClient): Promise<void> {
    supabase.value = supabaseClient
    isLoading.value = true

    // God mode bypass: skip Clerk entirely when god mode user is set
    const godModeUser = localStorage.getItem('ssi-god-mode-user')
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
        isLoading.value = false
        console.log('[useAuth] God mode active, using user:', parsed.display_name)
        return
      } catch {
        // Invalid stored user, continue with normal auth
        localStorage.removeItem('ssi-god-mode-user')
      }
    }

    // Legacy dev role bypass — clear old storage key
    if (localStorage.getItem('ssi-dev-role')) {
      localStorage.removeItem('ssi-dev-role')
    }

    // Initialize guest ID
    guestId.value = getOrCreateGuestId()

    // Wait for Clerk to load
    const waitForClerk = new Promise<void>((resolve) => {
      if (clerkLoaded.value) {
        resolve()
        return
      }
      const unwatch = watch(
        () => clerkLoaded.value,
        (loaded) => {
          if (loaded) {
            unwatch()
            resolve()
          }
        },
        { immediate: true }
      )
    })

    await waitForClerk

    // If authenticated, fetch/create learner
    if (clerkUser.value) {
      learner.value = await ensureLearnerExists()

      // Check if there's guest progress to migrate
      const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
      if (hadGuestId) {
        await migrateGuestProgress()
      }
    }

    isLoading.value = false
  }

  /**
   * Watch for auth changes
   */
  watch(
    () => clerkUser.value,
    async (newUser, oldUser) => {
      if (newUser && !oldUser && supabase.value) {
        // User just signed in
        isLoading.value = true
        learner.value = await ensureLearnerExists()

        // Migrate guest progress if any
        const hadGuestId = localStorage.getItem(GUEST_ID_KEY)
        if (hadGuestId) {
          await migrateGuestProgress()
        }

        isLoading.value = false
      } else if (!newUser && oldUser) {
        // User signed out
        learner.value = null
        // Reinitialize guest ID
        guestId.value = getOrCreateGuestId()
      }
    }
  )

  // ============================================
  // ACTIONS
  // ============================================

  function openSignIn(): void {
    clerk.value?.openSignIn()
  }

  function openSignUp(): void {
    clerk.value?.openSignUp()
  }

  async function signOut(): Promise<void> {
    await clerk.value?.signOut()
    learner.value = null
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

  return {
    // State
    user: clerkUser,
    learner,
    isAuthenticated,
    isGuest,
    learnerId,
    completedSessionsCount,
    hasSeenSignupPrompt,
    isLoading,

    // Actions
    openSignIn,
    openSignUp,
    signOut,
    incrementSessionCount,
    markSignupPromptSeen,
    migrateGuestProgress,
    initialize,
  }
}
