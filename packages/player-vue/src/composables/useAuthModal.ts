import { ref, readonly } from 'vue'

type AuthModalView = 'signIn' | 'signUp' | null

const currentView = ref<AuthModalView>(null)

/**
 * Composable for managing auth modal state across the app.
 * Provides a single source of truth for showing sign-in/sign-up modals.
 */
export function useAuthModal() {
  const isSignInOpen = ref(false)
  const isSignUpOpen = ref(false)

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

  const switchToSignIn = () => {
    openSignIn()
  }

  const switchToSignUp = () => {
    openSignUp()
  }

  return {
    // State
    isSignInOpen: readonly(isSignInOpen),
    isSignUpOpen: readonly(isSignUpOpen),
    currentView: readonly(currentView),

    // Actions
    openSignIn,
    openSignUp,
    closeAll,
    switchToSignIn,
    switchToSignUp,
  }
}

// Global singleton for app-wide auth modal state
const globalAuthModal = useAuthModal()

export function useGlobalAuthModal() {
  return globalAuthModal
}
