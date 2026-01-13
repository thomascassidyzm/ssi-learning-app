import { ref, readonly } from 'vue'

type AuthModalView = 'signIn' | 'signUp' | null

// Shared state at module level (singleton)
const isSignInOpen = ref(false)
const isSignUpOpen = ref(false)
const currentView = ref<AuthModalView>(null)

const openSignIn = () => {
  currentView.value = 'signIn'
  isSignInOpen.value = true
  isSignUpOpen.value = false
}

const openSignUp = () => {
  currentView.value = 'signUp'
  isSignUpOpen.value = true
  isSignInOpen.value = false
}

const closeAll = () => {
  currentView.value = null
  isSignInOpen.value = false
  isSignUpOpen.value = false
}

const closeSignIn = () => {
  isSignInOpen.value = false
  if (currentView.value === 'signIn') {
    currentView.value = null
  }
}

const closeSignUp = () => {
  isSignUpOpen.value = false
  if (currentView.value === 'signUp') {
    currentView.value = null
  }
}

const switchToSignIn = () => {
  openSignIn()
}

const switchToSignUp = () => {
  openSignUp()
}

/**
 * Composable for managing auth modal state across the app.
 * Uses module-level state for true singleton behavior.
 * All components calling this share the same refs.
 */
export function useAuthModal() {
  return {
    // State (writable refs for direct binding)
    isSignInOpen,
    isSignUpOpen,
    currentView: readonly(currentView),

    // Actions
    openSignIn,
    openSignUp,
    closeAll,
    closeSignIn,
    closeSignUp,
    switchToSignIn,
    switchToSignUp,
  }
}

// Alias for clarity - same function, same shared state
export const useGlobalAuthModal = useAuthModal
