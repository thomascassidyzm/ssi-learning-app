import { ref, readonly } from 'vue'

export type Theme = 'cosmos' | 'mist'

const THEME_STORAGE_KEY = 'ssi-theme'

// Singleton state — mist forced for all users (dark mode deprecated)
const currentTheme = ref<Theme>('mist')
const isInitialized = ref(false)

/**
 * Apply theme to document
 */
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', 'mist')

  // Also update meta theme-color for browser chrome
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', '#D9D6D2')
  }
}

/**
 * Initialize theme — always mist (dark mode deprecated)
 */
function initTheme() {
  if (isInitialized.value) return

  if (typeof window === 'undefined') {
    isInitialized.value = true
    return
  }

  // Force mist, clear any stored cosmos preference
  try {
    localStorage.setItem(THEME_STORAGE_KEY, 'mist')
  } catch (e) {
    // Ignore storage errors
  }

  applyTheme('mist')
  isInitialized.value = true
}

/**
 * Theme composable - provides theme state (mist only, toggle is no-op)
 */
export function useTheme() {
  // Initialize on first use
  if (!isInitialized.value) {
    initTheme()
  }

  /**
   * Set theme — no-op, mist is forced
   */
  function setTheme(_theme: Theme) {
    // Dark mode deprecated — always mist
  }

  /**
   * Toggle — no-op, mist is forced
   */
  function toggleTheme() {
    // Dark mode deprecated — always mist
  }

  /**
   * Check if current theme is dark (always false now)
   */
  const isDark = () => false

  return {
    theme: readonly(currentTheme),
    setTheme,
    toggleTheme,
    isDark,
  }
}
