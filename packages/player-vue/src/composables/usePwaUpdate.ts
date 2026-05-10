/**
 * Shared PWA update state.
 *
 * Visibility strategy:
 *   - needRefresh && !userDismissed → banner (PwaUpdatePrompt)
 *   - needRefresh &&  userDismissed → blue dot on the logo (LearningPlayer)
 *   - Click either → applyUpdate()
 */
import { ref } from 'vue'

// True while a new service worker is waiting to take control.
export const updateAvailable = ref(false)

// True after the user clicks Dismiss on the banner — the dot takes over.
// Reset to false whenever a new update notification arrives.
export const userDismissed = ref(false)

// Action that activates the waiting SW and reloads. Populated by
// PwaUpdatePrompt on mount.
export let applyUpdate: (() => void) | null = null

export function setApplyUpdate(fn: () => void) {
  applyUpdate = fn
}
