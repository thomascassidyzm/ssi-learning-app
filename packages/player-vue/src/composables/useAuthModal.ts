import { ref, readonly } from 'vue'

// Shared state at module level (singleton)
const isOpen = ref(false)
// Optional invite code context (for school join flows)
const inviteCodeMode = ref(false)
// Open straight on the password form. A teacher whose school gateway eats our
// code emails is sent here from the redeem page's dead end — landing them on
// "we'll send you a code" would be sending them back at the wall they just hit.
const passwordMode = ref(false)

const open = (opts?: { inviteCode?: boolean; password?: boolean }) => {
  inviteCodeMode.value = opts?.inviteCode ?? false
  passwordMode.value = opts?.password ?? false
  isOpen.value = true
}

const close = () => {
  isOpen.value = false
  inviteCodeMode.value = false
  passwordMode.value = false
}

/**
 * Composable for managing the unified auth modal.
 * Uses module-level state for true singleton behavior.
 * All components calling this share the same refs.
 */
export function useAuthModal() {
  return {
    isOpen: readonly(isOpen),
    inviteCodeMode: readonly(inviteCodeMode),
    passwordMode: readonly(passwordMode),
    open,
    close,
  }
}
