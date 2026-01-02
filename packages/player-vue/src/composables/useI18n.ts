/**
 * Simple i18n composable for SSi Learning App
 *
 * Uses static JSON locale files, keyed by ISO 639-3 language codes.
 * Falls back to English if translation not found.
 */

import { ref, computed, type Ref } from 'vue'

// Import locale files statically for now
// In future, could lazy-load based on known language
import en from '../locales/en.json'
import es from '../locales/es.json'
import cy from '../locales/cy.json'

// Map ISO 639-3 codes to locale files
// Multiple codes can map to same locale (e.g., cym_n and cym_s both use cy)
const LOCALE_MAP: Record<string, typeof en> = {
  eng: en,
  spa: es,
  cym: cy,
  cym_n: cy,
  cym_s: cy,
}

// Current locale state (shared across app)
const currentLocale: Ref<string> = ref('eng')
const currentMessages: Ref<typeof en> = ref(en)

/**
 * Set the current locale based on the user's known language
 */
export const setLocale = (langCode: string) => {
  currentLocale.value = langCode
  currentMessages.value = LOCALE_MAP[langCode] || en
}

/**
 * Get a translation by key path (e.g., 'courseSelector.title')
 */
export const t = (key: string, fallback?: string): string => {
  const parts = key.split('.')
  let value: any = currentMessages.value

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part]
    } else {
      // Try English fallback
      value = en
      for (const p of parts) {
        if (value && typeof value === 'object' && p in value) {
          value = value[p]
        } else {
          return fallback || key
        }
      }
      return typeof value === 'string' ? value : fallback || key
    }
  }

  return typeof value === 'string' ? value : fallback || key
}

/**
 * Get language name in current locale
 */
export const getLanguageName = (langCode: string): string => {
  return t(`languages.${langCode}`, langCode.toUpperCase())
}

/**
 * Composable for use in Vue components
 */
export function useI18n() {
  return {
    locale: computed(() => currentLocale.value),
    setLocale,
    t,
    getLanguageName,
    // Direct access to messages for v-for scenarios
    messages: computed(() => currentMessages.value),
  }
}

export default useI18n
