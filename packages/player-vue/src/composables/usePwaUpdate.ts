/**
 * Shared PWA update state — read by any component that wants to show an update indicator.
 * Written by PwaUpdatePrompt when a new SW is waiting.
 */
import { ref } from 'vue'

export const updateAvailable = ref(false)
