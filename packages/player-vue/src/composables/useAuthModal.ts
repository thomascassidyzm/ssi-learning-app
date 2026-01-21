import { ref, readonly } from 'vue'

type AuthModalView = 'signIn' | 'signUp' | null

// Shared state at module level (singleton)
const isSignInOpen = ref(false)
const isSignUpOpen = ref(false)
const currentView = ref<AuthModalView>(null)
// Shared email for preserving across sign-in/sign-up switches
const sharedEmail = ref('')

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
  sharedEmail.value = '' // Clear email on full close
}

const closeSignIn = () => {
  isSignInOpen.value = false
  if (currentView.value === 'signIn') {
    currentView.value = null
    sharedEmail.value = '' // Clear email when closing (not switching)
  }
}

const closeSignUp = () => {
  isSignUpOpen.value = false
  if (currentView.value === 'signUp') {
    currentView.value = null
    sharedEmail.value = '' // Clear email when closing (not switching)
  }
}

const switchToSignIn = (email?: string) => {
  if (email) sharedEmail.value = email
  openSignIn()
}

const switchToSignUp = (email?: string) => {
  if (email) sharedEmail.value = email
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
    sharedEmail, // Email preserved when switching between sign-in/sign-up

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
