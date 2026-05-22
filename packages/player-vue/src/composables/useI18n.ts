/**
 * Simple i18n composable for SSi Learning App
 *
 * Uses static JSON locale files, keyed by ISO 639-3 language codes.
 * Falls back to English if translation not found.
 */

import { ref, computed, type Ref } from 'vue'

// Only `eng` is eager — it's the universal fallback (used by t() when a
// key is missing in the current locale), so it needs to be available
// synchronously at module load. Every other locale is lazy-loaded via
// import() so a single-language user (which is most users) doesn't pay
// for ~230KB of locale JSON on first paint. See setLocale() below.
// File names use ISO 639-3 codes (3-char).
import eng from '../locales/eng.json'

type LocaleLoader = () => Promise<Record<string, any>>

const unwrap = (m: any): Record<string, any> => (m && m.default) || m

// Lazy loaders — each one becomes its own Vite chunk; only the locale
// the user actually picks is fetched.
const cymLoader: LocaleLoader = () => import('../locales/cym.json').then(unwrap)
const LOCALE_LOADERS: Record<string, LocaleLoader> = {
  eng: () => Promise.resolve(eng),
  spa: () => import('../locales/spa.json').then(unwrap),
  cym: cymLoader,
  cym_n: cymLoader, // dialect codes share the same locale file
  cym_s: cymLoader,
  ara: () => import('../locales/ara.json').then(unwrap),
  deu: () => import('../locales/deu.json').then(unwrap),
  fra: () => import('../locales/fra.json').then(unwrap),
  ita: () => import('../locales/ita.json').then(unwrap),
  jpn: () => import('../locales/jpn.json').then(unwrap),
  kor: () => import('../locales/kor.json').then(unwrap),
  por: () => import('../locales/por.json').then(unwrap),
  zho: () => import('../locales/zho.json').then(unwrap),
  cmn: () => import('../locales/zho.json').then(unwrap),
  // Indian-subcontinent + Sri Lanka
  sin: () => import('../locales/sin.json').then(unwrap),
  tam: () => import('../locales/tam.json').then(unwrap),
  hin: () => import('../locales/hin.json').then(unwrap),
  ben: () => import('../locales/ben.json').then(unwrap),
  guj: () => import('../locales/guj.json').then(unwrap),
  pan: () => import('../locales/pan.json').then(unwrap),
  urd: () => import('../locales/urd.json').then(unwrap),
  // Other interface languages
  aze: () => import('../locales/aze.json').then(unwrap),
  lit: () => import('../locales/lit.json').then(unwrap),
  yor: () => import('../locales/yor.json').then(unwrap),
}

// Cache resolved locales so re-selecting one doesn't refetch.
const loadedLocales: Record<string, Record<string, any>> = { eng }

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

// Current locale state (shared across app).
// We start with English messages even if the saved locale is something
// else — the real locale loads asynchronously below. Strings render in
// English for the brief window before the chunk arrives, which is the
// same fallback behaviour t() already has for any missing key.
const savedLocale = getSavedLocale()
const currentLocale: Ref<string> = ref(savedLocale)
const currentMessages: Ref<Record<string, any>> = ref(eng)

/**
 * Set the current locale. Persists to localStorage and fetches the
 * locale chunk on demand if it isn't already loaded. Async because
 * non-English locales are dynamic imports; existing callers don't
 * await the promise (fire-and-forget is fine — currentMessages is
 * reactive so the UI re-renders when the chunk lands).
 */
export const setLocale = async (langCode: string): Promise<void> => {
  const loader = LOCALE_LOADERS[langCode]
  if (!loader) return // unknown locale — keep current

  // Persist the choice immediately so a quick refresh keeps the
  // preference even if the chunk download hasn't completed yet.
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, langCode)
  } catch {
    // localStorage might be unavailable
  }
  currentLocale.value = langCode

  // Use cached messages if we've already loaded this locale.
  const cached = loadedLocales[langCode]
  if (cached) {
    currentMessages.value = cached
    return
  }

  try {
    const messages = await loader()
    loadedLocales[langCode] = messages
    // Guard against a race where the user switched again while this
    // load was in flight — only apply if we're still on this locale.
    if (currentLocale.value === langCode) {
      currentMessages.value = messages
    }
  } catch (err) {
    console.warn('[useI18n] Failed to load locale', langCode, err)
    // Stay on English fallback — nothing else to do.
  }
}

// Boot: if the saved locale isn't English, kick off the chunk fetch
// without blocking module evaluation. The UI mounts in English, then
// rerenders once the locale lands (typically within ~50-200ms).
if (savedLocale !== 'eng' && LOCALE_LOADERS[savedLocale]) {
  setLocale(savedLocale).catch(() => {
    /* already logged above */
  })
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
 * ISO 639-3 (3-char) → ISO 639-1 (2-char) mapping for Intl.DisplayNames.
 * Only needed where the codes differ. Most 2-char codes are just the first 2 chars.
 */
const ISO3_TO_BCP47: Record<string, string> = {
  eng: 'en', spa: 'es', fra: 'fr', deu: 'de', ita: 'it', por: 'pt',
  nld: 'nl', pol: 'pl', rus: 'ru', cym: 'cy', gle: 'ga', gla: 'gd',
  jpn: 'ja', zho: 'zh', cmn: 'zh', kor: 'ko', ara: 'ar', hin: 'hi',
  tur: 'tr', swa: 'sw', ron: 'ro', cat: 'ca', eus: 'eu', glg: 'gl',
  swe: 'sv', nor: 'no', nob: 'nb', nno: 'nn', dan: 'da', fin: 'fi',
  isl: 'is', hrv: 'hr', srp: 'sr', bos: 'bs', slv: 'sl', ces: 'cs',
  slk: 'sk', ukr: 'uk', bul: 'bg', mkd: 'mk', ell: 'el', hun: 'hu',
  heb: 'he', sqi: 'sq', lit: 'lt', lav: 'lv', est: 'et', tha: 'th',
  vie: 'vi', ind: 'id', fil: 'tl', ben: 'bn', urd: 'ur', tam: 'ta',
  tel: 'te', msa: 'ms', yue: 'yue', fas: 'fa', kur: 'ku', amh: 'am',
  hau: 'ha', yor: 'yo', zul: 'zu', kat: 'ka', hye: 'hy', bre: 'br',
  cor: 'kw', sin: 'si',
}

/**
 * Map ISO 639-3 to BCP 47 for locale parameter (known language → locale)
 */
const ISO3_TO_LOCALE: Record<string, string> = {
  ...ISO3_TO_BCP47,
  // Variant codes map to base locale
  cym_n: 'cy', cym_s: 'cy',
}

/**
 * Get language name using Intl.DisplayNames.
 *
 * By default renders in the current UI locale. Pass `overrideLangCode`
 * (ISO 639-3) to render the name in a specific language instead — used
 * by the Premium-courses list so each card reads in the perspective
 * of the learner who would take that course (e.g. "Inglés" instead of
 * "English" on the Spanish-speaker card).
 *
 * Falls back to locale JSON files, then to the raw code.
 */
export const getLanguageName = (langCode: string, overrideLangCode?: string): string => {
  // Try Intl.DisplayNames first (browser-native, always up to date)
  // Use explicit mapping if available, otherwise try the raw code (works for many ISO 639-3 codes)
  const bcp47 = ISO3_TO_BCP47[langCode] || langCode
  const localeCode = overrideLangCode
    ? (ISO3_TO_LOCALE[overrideLangCode] || overrideLangCode)
    : (ISO3_TO_LOCALE[currentLocale.value] || 'en')
  try {
    const displayNames = new Intl.DisplayNames([localeCode], { type: 'language' })
    const name = displayNames.of(bcp47)
    if (name && name !== bcp47) {
      // Capitalize first letter (some locales return lowercase)
      const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
      // Append variant suffix for dialect codes like cym_n
      if (langCode === 'cym_n') return `${capitalized} (${t('languages.cym_n_suffix', 'North')})`
      if (langCode === 'cym_s') return `${capitalized} (${t('languages.cym_s_suffix', 'South')})`
      if (langCode === 'nob') return `${capitalized} (Bokmål)`
      if (langCode === 'nno') return `${capitalized} (Nynorsk)`
      return capitalized
    }
  } catch {
    // Intl.DisplayNames not supported or code unknown — fall through
  }

  // Fallback: locale JSON files
  return t(`languages.${langCode}`, langCode.toUpperCase())
}

/**
 * Language endonyms — the name each language calls itself.
 * Used for "I speak" buttons so they're always in the speaker's own language.
 */
const LANGUAGE_ENDONYMS: Record<string, string> = {
  eng: 'English',
  spa: 'Español',
  fra: 'Français',
  deu: 'Deutsch',
  ita: 'Italiano',
  por: 'Português',
  nld: 'Nederlands',
  pol: 'Polski',
  rus: 'Русский',
  cym: 'Cymraeg',
  cym_n: 'Cymraeg (Gogledd)',
  cym_s: 'Cymraeg (De)',
  gle: 'Gaeilge',
  gla: 'Gàidhlig',
  jpn: '日本語',
  zho: '中文',
  cmn: '普通话',
  kor: '한국어',
  ara: 'العربية',
  hin: 'हिन्दी',
  tur: 'Türkçe',
  swa: 'Kiswahili',
  ron: 'Română',
  cat: 'Català',
  eus: 'Euskara',
  glg: 'Galego',
  swe: 'Svenska',
  nor: 'Norsk',
  nob: 'Norsk (Bokmål)',
  nno: 'Norsk (Nynorsk)',
  dan: 'Dansk',
  fin: 'Suomi',
  isl: 'Íslenska',
  hrv: 'Hrvatski',
  srp: 'Српски',
  bos: 'Bosanski',
  slv: 'Slovenščina',
  ces: 'Čeština',
  slk: 'Slovenčina',
  ukr: 'Українська',
  bul: 'Български',
  mkd: 'Македонски',
  ell: 'Ελληνικά',
  hun: 'Magyar',
  heb: 'עברית',
  sqi: 'Shqip',
  lit: 'Lietuvių',
  lav: 'Latviešu',
  est: 'Eesti',
  tha: 'ไทย',
  vie: 'Tiếng Việt',
  ind: 'Bahasa Indonesia',
  fil: 'Filipino',
  ben: 'বাংলা',
  urd: 'اردو',
  tam: 'தமிழ்',
  tel: 'తెలుగు',
  msa: 'Bahasa Melayu',
  yue: '廣東話',
  fas: 'فارسی',
  kur: 'Kurdî',
  amh: 'አማርኛ',
  hau: 'Hausa',
  yor: 'Yorùbá',
  zul: 'isiZulu',
  kat: 'ქართული',
  hye: 'Հայերեն',
  bre: 'Brezhoneg',
  cor: 'Kernewek',
  glv: 'Gaelg',
  sin: 'සිංහල',
  nep: 'नेपाली',
  afr: 'Afrikaans',
}

export const getLanguageEndonym = (langCode: string): string => {
  if (LANGUAGE_ENDONYMS[langCode]) return LANGUAGE_ENDONYMS[langCode]

  // Try Intl.DisplayNames with the language's OWN locale (endonym = self-name)
  const bcp47 = ISO3_TO_BCP47[langCode] || langCode
  try {
    const displayNames = new Intl.DisplayNames([bcp47], { type: 'language' })
    const name = displayNames.of(bcp47)
    if (name && name !== bcp47) {
      return name.charAt(0).toUpperCase() + name.slice(1)
    }
  } catch {
    // Unknown code — fall through
  }

  return getLanguageName(langCode)
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
  bre: '🏴',  // Breton (Gwenn-ha-du — no emoji; use LanguageFlag SVG for proper flag)
  cor: '🏴',  // Cornish (St Piran's — no emoji; use LanguageFlag SVG for proper flag)
  glv: '🇮🇲',  // Manx
  // Romance
  spa: '🇪🇸',
  fra: '🇫🇷',
  ita: '🇮🇹',
  por: '🇵🇹',
  ron: '🇷🇴',  // Romanian
  cat: '🏴',  // Catalan (Senyera — no emoji; use LanguageFlag SVG for proper flag)
  eus: '🏴',  // Basque (Ikurriña — no emoji; use LanguageFlag SVG for proper flag)
  glg: '🏴',  // Galician (no emoji; use LanguageFlag SVG for proper flag)
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
  sin: '🇱🇰',  // Sinhala
  nep: '🇳🇵',  // Nepali
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
  afr: '🇿🇦',  // Afrikaans
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
