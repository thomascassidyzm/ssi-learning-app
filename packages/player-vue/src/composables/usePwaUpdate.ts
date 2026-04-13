/**
 * Shared PWA update state.
 * - updateAvailable: true when a new SW is waiting (blue dot shows)
 * - applyUpdate: call to activate the new SW and reload
 */
import { ref } from 'vue'

export const updateAvailable = ref(false)
export let applyUpdate: (() => void) | null = null

export function setApplyUpdate(fn: () => void) {
  applyUpdate = fn
}
