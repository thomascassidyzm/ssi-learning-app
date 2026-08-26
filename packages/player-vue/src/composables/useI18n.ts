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
  gle: () => import('../locales/gle.json').then(unwrap),
  ga: () => import('../locales/gle.json').then(unwrap), // 639-1 alias
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
  syncDocumentLang()

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
 * Publish the interface language on `<html lang>`.
 *
 * `index.html` ships `lang="en"` and nothing ever moved it, so a Hindi or
 * Yoruba interface still claimed to be English. Two things read this:
 *   - the glyph-coverage CSS (styles/design-tokens.css) — DM Sans cannot spell
 *     Devanagari or the Yoruba dot-belows, and `:lang()` is how those UI
 *     strings reach Noto Sans as a whole run rather than character by
 *     character;
 *   - screen readers and hyphenation, which were being told the wrong thing.
 *
 * BCP 47 where we have the 2-letter code, otherwise the app's own 639-3 code;
 * the CSS matches both forms.
 */
// A `function` declaration, not a `const` arrow, deliberately: setLocale()
// calls this, and the boot-time apply at the foot of the module calls
// setLocale(). A const would sit in its temporal dead zone at that point and
// throw ReferenceError — which is exactly the bug that shipped on 2026-08-18
// (067b8de8) and silently left every non-English learner in English.
export function syncDocumentLang(): void {
  if (typeof document === 'undefined') return
  const code = currentLocale.value
  document.documentElement.lang = ISO3_TO_BCP47[code] || code
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
 * Get a language name in the reading language.
 *
 * Our own locale JSON wins, then Intl.DisplayNames, then the raw code.
 *
 * The JSON has to come first. Intl.DisplayNames does NOT report failure:
 * on a device whose ICU carries no display-name data for the interface
 * language it silently answers in ENGLISH, and an English answer is
 * indistinguishable from a correct one ("Icelandic" is not the code "is",
 * so the old `name !== bcp47` guard accepted it). That is how a Welsh
 * interface produced "Islandeg i siaradwyr English" — the sentence frame
 * comes from cym.json and is always Welsh, while the language name came
 * from Intl and could quietly fall back to English. Our JSON carries
 * curated names for every language we ship, so consulting it first makes
 * the name as device-independent as the sentence around it.
 *
 * By default renders in the current UI locale. Pass `overrideLangCode`
 * (ISO 639-3) to render the name in a specific language instead — used
 * by the Premium-courses list so each card reads in the perspective
 * of the learner who would take that course (e.g. "Inglés" instead of
 * "English" on the Spanish-speaker card).
 */
export const getLanguageName = (langCode: string | null | undefined, overrideLangCode?: string): string => {
  // A display helper must never throw: a course row with no target_lang
  // (e.g. a class pointing at a course code the catalogue can't resolve)
  // crashed the whole player render through this line (2026-07-16).
  if (!langCode) return ''

  // 1. Our own curated names, in the reading language. For an override we
  //    can only use the JSON if that locale's chunk is already loaded —
  //    this helper is synchronous, so an unloaded override falls to Intl.
  const messages = overrideLangCode
    ? loadedLocales[overrideLangCode]
    : currentMessages.value
  const curated = messages?.languages?.[langCode]
  // Dialect keys (cym_n, nob…) carry their full name in the JSON, suffix
  // included — so a hit is returned exactly as authored.
  if (typeof curated === 'string' && curated) return curated

  // 2. Intl.DisplayNames — browser-native, covers anything not in the JSON.
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

  // 3. Last resort: the English JSON (via t()'s own fallback), then the code.
  return t(`languages.${langCode}`, langCode.toUpperCase())
}

/**
 * French elision: `de` + a vowel-initial name contracts to `d'`.
 *
 * "pour les locuteurs de Anglais" is not a sentence a French speaker would
 * write — it reads "de Anglais" where the language demands "d'Anglais".
 * The template can't do this itself: whether it elides depends on the name
 * that lands in the slot, which is chosen at runtime.
 */
const FRENCH_ELIDABLE: Record<string, string> = { de: "d'", le: "l'", la: "l'", que: "qu'" }
const FRENCH_VOWEL_INITIAL = /^[aeiouyàâäéèêëîïíôöòûüùœæ]/i

/**
 * h aspiré blocks elision ("le hongrois"), h muet does not ("l'hébreu") —
 * and nothing about the spelling says which: it is a per-word property of
 * French, so it has to be listed. Only the h-initial language names we ship
 * need a ruling; anything unlisted is treated as aspiré, which leaves the
 * name untouched rather than mangling it.
 */
const FRENCH_MUTE_H = new Set([
  'heb', // hébreu — l'hébreu
  'hin', // hindi — l'hindi
  // Aspiré, deliberately absent: hau (le haoussa), hun (le hongrois).
])

const elidesInFrench = (langCode: string, langName: string): boolean => {
  if (FRENCH_VOWEL_INITIAL.test(langName)) return true
  return /^h/i.test(langName) && FRENCH_MUTE_H.has(langCode)
}

/**
 * Put a language name into a `{lang}` template, honouring the interface
 * language's own rules for composing it.
 *
 * Only French needs a rule today. Spanish/Portuguese "de {lang}" never
 * elides, German compounds with a hyphen, and the rest place the name
 * without a preposition — so everything else is a plain substitution, and
 * the rule is keyed on the interface locale so an English fallback string
 * can never be French-ified.
 */
export const interpolateLanguageName = (
  template: string,
  langCode: string,
  langName: string,
): string => {
  if (currentLocale.value === 'fra' && elidesInFrench(langCode, langName)) {
    for (const [word, contraction] of Object.entries(FRENCH_ELIDABLE)) {
      const elided = template.replace(
        new RegExp(`(^|\\s)${word} \\{lang\\}`),
        `$1${contraction}{lang}`,
      )
      if (elided !== template) return elided.replace('{lang}', langName)
    }
  }
  return template.replace('{lang}', langName)
}

/**
 * The "for X speakers" course subtitle, fully composed: the name in the
 * reading language, inside the reading language's own frame.
 */
export const forSpeakersLabel = (knownLangCode: string | null | undefined): string => {
  if (!knownLangCode) return ''
  const knownName = getLanguageName(knownLangCode)
  const template = t('courseSelector.forSpeakers', 'for {lang} speakers')
  return interpolateLanguageName(template, knownLangCode, knownName)
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
  // Language variants that fly their own flag. Keyed on the target side of the
  // course code (deu_at_for_eng → 'deu_at'); a variant absent from here falls
  // back to its parent language above. SVG equivalents live in
  // components/schools/shared/LanguageFlag.vue.
  deu_at: '🇦🇹',  // Austrian German
  por_br: '🇧🇷',  // Brazilian Portuguese
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

// Boot: publish the saved locale on <html lang> straight away. setLocale() keeps
// it in step from here on; this runs at the foot of the module because it reads
// the ISO3_TO_BCP47 table defined above it.
syncDocumentLang()

// Boot: APPLY the saved locale — i.e. fetch its messages — not just publish it.
// Storing the choice was never the broken half; applying it on the next launch
// was (tester report, 2026-08-25: "setting says Cymraeg, everything reads
// English"). Runs at the foot of the module, after every declaration it can
// reach, so nothing here can hit a temporal dead zone again. Fire-and-forget:
// the UI mounts in English and rerenders when the locale chunk lands
// (~50-200ms). A failure is LOUD — a silent catch is what hid this for a week.
if (savedLocale !== 'eng' && LOCALE_LOADERS[savedLocale]) {
  setLocale(savedLocale).catch((err) => {
    console.warn('[useI18n] Failed to apply saved locale on boot', savedLocale, err)
  })
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
