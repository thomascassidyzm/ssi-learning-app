/**
 * Simple i18n composable for SSi Learning App
 *
 * Uses static JSON locale files, keyed by ISO 639-3 language codes.
 * Falls back to English if translation not found.
 */

import { ref, computed, type Ref } from 'vue'

// Import locale files statically for now
// In future, could lazy-load based on known language
// File names use ISO 639-3 codes (3-char)
import eng from '../locales/eng.json'
import spa from '../locales/spa.json'
import cym from '../locales/cym.json'

// Map ISO 639-3 codes to locale files
// Multiple codes can map to same locale (e.g., cym_n and cym_s both use cym)
// Use loose type — locale files may have fewer keys than eng (fallback handles missing)
const LOCALE_MAP: Record<string, Record<string, any>> = {
  eng: eng,
  spa: spa,
  cym: cym,
  cym_n: cym,
  cym_s: cym,
}

// localStorage key for persisting locale preference
const LOCALE_STORAGE_KEY = 'ssi-locale'

// Load saved locale or default to English
const getSavedLocale = (): string => {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY) || 'eng'
  } catch {
    return 'eng'
  }
}

// Current locale state (shared across app)
const savedLocale = getSavedLocale()
const currentLocale: Ref<string> = ref(savedLocale)
const currentMessages: Ref<Record<string, any>> = ref(LOCALE_MAP[savedLocale] || eng)

/**
 * Set the current locale based on the user's known language
 * Persists to localStorage for next visit
 */
export const setLocale = (langCode: string) => {
  currentLocale.value = langCode
  currentMessages.value = LOCALE_MAP[langCode] || eng

  // Persist choice
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, langCode)
  } catch {
    // localStorage might be unavailable
  }
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
      value = eng
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
 * Language flag emoji lookup (ISO 639-3 → flag)
 * Comprehensive: add new languages here once — CourseSelector and LearningPlayer both use this.
 */
const LANGUAGE_FLAGS: Record<string, string> = {
  // Celtic
  eng: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  cym: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  cym_n: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  cym_s: '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  gle: '🇮🇪',
  gla: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  bre: '🇫🇷',  // Breton
  cor: '🏴󠁧󠁢󠁥󠁮󠁧󠁿',  // Cornish
  // Romance
  spa: '🇪🇸',
  fra: '🇫🇷',
  ita: '🇮🇹',
  por: '🇵🇹',
  ron: '🇷🇴',  // Romanian
  cat: '🇪🇸',  // Catalan
  eus: '🇪🇸',  // Basque
  glg: '🇪🇸',  // Galician
  // Germanic
  deu: '🇩🇪',
  nld: '🇳🇱',
  swe: '🇸🇪',
  nor: '🇳🇴',
  nob: '🇳🇴',  // Norwegian Bokmål
  nno: '🇳🇴',  // Norwegian Nynorsk
  dan: '🇩🇰',
  fin: '🇫🇮',
  isl: '🇮🇸',  // Icelandic
  // Slavic
  rus: '🇷🇺',
  pol: '🇵🇱',
  ces: '🇨🇿',  // Czech
  slk: '🇸🇰',  // Slovak
  hrv: '🇭🇷',  // Croatian
  srp: '🇷🇸',  // Serbian
  bos: '🇧🇦',  // Bosnian
  slv: '🇸🇮',  // Slovenian
  ukr: '🇺🇦',  // Ukrainian
  bul: '🇧🇬',  // Bulgarian
  mkd: '🇲🇰',  // Macedonian
  // East Asian
  jpn: '🇯🇵',
  kor: '🇰🇷',
  cmn: '🇨🇳',
  zho: '🇨🇳',
  yue: '🇭🇰',  // Cantonese
  // South/Southeast Asian
  hin: '🇮🇳',  // Hindi
  ben: '🇧🇩',  // Bengali
  urd: '🇵🇰',  // Urdu
  tam: '🇮🇳',  // Tamil
  tel: '🇮🇳',  // Telugu
  tha: '🇹🇭',  // Thai
  vie: '🇻🇳',  // Vietnamese
  msa: '🇲🇾',  // Malay
  ind: '🇮🇩',  // Indonesian
  fil: '🇵🇭',  // Filipino
  // Semitic & Middle Eastern
  ara: '🇸🇦',
  heb: '🇮🇱',
  tur: '🇹🇷',
  fas: '🇮🇷',  // Persian/Farsi
  kur: '🇮🇶',  // Kurdish
  // African
  swa: '🇰🇪',  // Swahili
  amh: '🇪🇹',  // Amharic
  hau: '🇳🇬',  // Hausa
  yor: '🇳🇬',  // Yoruba
  zul: '🇿🇦',  // Zulu
  // Other European
  ell: '🇬🇷',  // Greek
  kat: '🇬🇪',  // Georgian
  hye: '🇦🇲',  // Armenian
  lit: '🇱🇹',  // Lithuanian
  lav: '🇱🇻',  // Latvian
  est: '🇪🇪',  // Estonian
  hun: '🇭🇺',  // Hungarian
  sqi: '🇦🇱',  // Albanian
}

/**
 * Auto-generate flag emoji from ISO 639-3 → ISO 3166-1 alpha-2 country code.
 * Falls back to 🌐 if no mapping exists.
 */
const LANG_TO_COUNTRY: Record<string, string> = {
  // Only needed for languages NOT in LANGUAGE_FLAGS above
  // This is a safety net for new courses
}

function countryCodeToFlag(cc: string): string {
  const upper = cc.toUpperCase()
  if (upper.length !== 2) return '🌐'
  return String.fromCodePoint(
    0x1F1E6 + upper.charCodeAt(0) - 65,
    0x1F1E6 + upper.charCodeAt(1) - 65
  )
}

export const getLanguageFlag = (langCode: string): string => {
  if (LANGUAGE_FLAGS[langCode]) return LANGUAGE_FLAGS[langCode]
  const cc = LANG_TO_COUNTRY[langCode]
  if (cc) return countryCodeToFlag(cc)
  return '🌐'
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
