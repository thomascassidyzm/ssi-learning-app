/**
 * useStartSurface — the optional "Start me at" landing preference.
 *
 * Founder ruling (2026-07-18): REMEMBER PROGRESS, NOT POSITION. The app
 * persists where you are within a course, never which surface you last had
 * open — a stale "last viewed" surface once resurrected a view-as context on
 * a fresh login and trapped the user there. Default landing after login is
 * therefore the user's OWN player, for every role. Staff who *want* to land
 * on a dashboard opt in via this preference (stored in learners.preferences,
 * a deliberate account setting — not inferred navigation state).
 *
 * Module-level singleton, same reachable-from-anywhere shape as useUserRole:
 * the router's post-resolution landing watch runs with no component/injection
 * context, so it can't reach useAuth()'s injected instance. useAuth is the
 * writer (on learner load / sign-out); SettingsScreen writes on user change.
 */

import { ref, computed } from 'vue'
import { useUserRole } from '@/composables/useUserRole'

export type StartSurface = 'player' | 'schools' | 'admin'

const VALID: StartSurface[] = ['player', 'schools', 'admin']

const preferred = ref<StartSurface | null>(null)

export function useStartSurface() {
  const { hasSchoolRole, canAccessAdmin } = useUserRole()

  function setFromPreferences(prefs: { start_surface?: string } | null | undefined): void {
    const v = prefs?.start_surface
    preferred.value = VALID.includes(v as StartSurface) ? (v as StartSurface) : null
  }

  /** Sign-out: the preference belongs to the account, not the browser. */
  function clear(): void {
    preferred.value = null
  }

  /**
   * Where to send a freshly-resolved session sitting on '/'. Null = stay on
   * the player (the default for everyone). A preference only fires if the
   * CURRENT role can actually access that surface — a demoted staff member's
   * stale preference degrades silently to the player, never a bounce-wall.
   */
  const landingPath = computed<string | null>(() => {
    if (preferred.value === 'schools' && hasSchoolRole.value) return '/schools'
    if (preferred.value === 'admin' && canAccessAdmin.value) return '/admin/structure'
    return null
  })

  return { preferred, landingPath, setFromPreferences, clear }
}
