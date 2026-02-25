import { ref, readonly } from 'vue'

// Shared state at module level (singleton)
const isOpen = ref(false)
// Optional invite code context (for school join flows)
const inviteCodeMode = ref(false)

const open = (opts?: { inviteCode?: boolean }) => {
  inviteCodeMode.value = opts?.inviteCode ?? false
  isOpen.value = true
}

const close = () => {
  isOpen.value = false
  inviteCodeMode.value = false
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
    open,
    close,
  }
}

// Alias for clarity - same function, same shared state
export const useGlobalAuthModal = useAuthModal
