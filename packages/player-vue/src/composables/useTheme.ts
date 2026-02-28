import { ref, watch, readonly } from 'vue'

export type Theme = 'cosmos' | 'mist'

const THEME_STORAGE_KEY = 'ssi-theme'

// Singleton state
const currentTheme = ref<Theme>('mist')
const isInitialized = ref(false)

/**
 * Apply theme to document
 */
function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return

  if (theme === 'cosmos') {
    // Remove data-theme attribute for default dark theme
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }

  // Also update meta theme-color for browser chrome
  const metaThemeColor = document.querySelector('meta[name="theme-color"]')
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'cosmos' ? '#050508' : '#D9D6D2')
  }
}

/**
 * Initialize theme from localStorage or system preference
 * Also registers the watch handler (only once)
 */
function initTheme() {
  if (isInitialized.value) return

  if (typeof window === 'undefined') {
    isInitialized.value = true
    return
  }

  // Check localStorage first
  const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null
  if (stored && (stored === 'cosmos' || stored === 'mist')) {
    currentTheme.value = stored
  }
  // Could add system preference detection here if desired:
  // else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
  //   currentTheme.value = 'mist'
  // }

  applyTheme(currentTheme.value)

  // Register watch ONCE during initialization (not per-component)
  watch(currentTheme, (theme) => {
    applyTheme(theme)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch (e) {
      console.warn('[useTheme] Failed to persist theme:', e)
    }
  })

  isInitialized.value = true
}

/**
 * Theme composable - provides theme state and toggle
 */
export function useTheme() {
  // Initialize on first use (registers watch only once)
  if (!isInitialized.value) {
    initTheme()
  }

  /**
   * Set theme directly
   */
  function setTheme(theme: Theme) {
    currentTheme.value = theme
  }

  /**
   * Toggle between cosmos and mist
   */
  function toggleTheme() {
    currentTheme.value = currentTheme.value === 'cosmos' ? 'mist' : 'cosmos'
  }

  /**
   * Check if current theme is dark (cosmos)
   */
  const isDark = () => currentTheme.value === 'cosmos'

  return {
    theme: readonly(currentTheme),
    setTheme,
    toggleTheme,
    isDark,
  }
}
