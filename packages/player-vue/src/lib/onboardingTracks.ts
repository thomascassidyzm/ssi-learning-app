/**
 * Onboarding tracks — the three signup doors (/schools1, /schools2, /tutors).
 *
 * Each door is the SAME flow with a different track preset: which languages to
 * offer, how long the free trial is, and what role the account becomes. The
 * trial length + role are re-derived server-side in api/onboarding/provision —
 * this is display + filtering only.
 *
 * Aesthetics/copy here are INTERIM — to be matched to the marketing landing
 * pages (saysomethingin.com) once they land.
 */

export type OnboardingTrack = 'school_minority' | 'school_standard' | 'tutor'

export interface LiveCourse {
  course_code: string
  target_lang: string
  known_lang: string // the language the learner ALREADY speaks (the course's source)
  pricing_tier: string
  new_app_status?: string // 'live' | 'beta' — beta shows a badge
  display_name: string | null
  learner_display_name: string | null
}

// Human names for the "your learners speak …" (known/source) language switcher.
// Falls back to the upper-cased code for anything not listed.
const KNOWN_LANG_NAMES: Record<string, string> = {
  eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian',
  por: 'Portuguese', nld: 'Dutch', zho: 'Chinese', jpn: 'Japanese', kor: 'Korean',
  ara: 'Arabic', hin: 'Hindi', ben: 'Bengali', guj: 'Gujarati', pan: 'Punjabi',
  tam: 'Tamil', tel: 'Telugu', urd: 'Urdu', sin: 'Sinhala', nep: 'Nepali',
  ron: 'Romanian', lit: 'Lithuanian', aze: 'Azerbaijani', yor: 'Yoruba',
  rus: 'Russian', ukr: 'Ukrainian', pol: 'Polish', tur: 'Turkish', ell: 'Greek',
  swe: 'Swedish', cym: 'Welsh', gle: 'Irish',
}
export function knownLangName(code: string): string {
  return KNOWN_LANG_NAMES[code] || (code || '').toUpperCase()
}

// Map a browser locale (e.g. 'en-GB', 'es') to an SSi known_lang code.
const LOCALE_TO_KNOWN: Record<string, string> = {
  en: 'eng', es: 'spa', fr: 'fra', de: 'deu', it: 'ita', pt: 'por', nl: 'nld',
  zh: 'zho', ja: 'jpn', ko: 'kor', ar: 'ara', hi: 'hin', ro: 'ron', lt: 'lit',
  ru: 'rus', uk: 'ukr', pl: 'pol', tr: 'tur', el: 'ell', sv: 'swe',
}
/** Pick the known language to default to: locale match if available, else English, else first. */
export function defaultKnownLang(locale: string, available: string[]): string {
  const two = (locale || 'en').slice(0, 2).toLowerCase()
  const mapped = LOCALE_TO_KNOWN[two]
  if (mapped && available.includes(mapped)) return mapped
  if (available.includes('eng')) return 'eng'
  return available[0] || 'eng'
}

// Minority/heritage target languages — must match the server set in
// api/onboarding/provision.ts. The /schools1 (year-free mission) track.
export const MINORITY_TARGET_LANGS = new Set([
  'cym', 'gle', 'bre', 'gla', 'eus', 'cat', 'glv', 'cor', 'gd',
])

export interface TrackConfig {
  key: OnboardingTrack
  audience: 'school' | 'tutor'
  trialDays: number
  trialLabel: string
  heading: string
  blurb: string
  collectInstitution: boolean
}

export const TRACKS: Record<OnboardingTrack, TrackConfig> = {
  school_minority: {
    key: 'school_minority',
    audience: 'school',
    trialDays: 365,
    trialLabel: '1 year free',
    heading: 'Set up your school',
    blurb: 'A full year free to bring your language to every classroom.',
    collectInstitution: true,
  },
  school_standard: {
    key: 'school_standard',
    audience: 'school',
    trialDays: 30,
    trialLabel: '1 month free',
    heading: 'Set up your school',
    blurb: 'Give every teacher the SSi method and a whole-school dashboard.',
    collectInstitution: true,
  },
  tutor: {
    key: 'tutor',
    audience: 'tutor',
    trialDays: 30,
    trialLabel: '1 month free',
    heading: 'Start teaching',
    blurb: 'Teach the SSi way, in your own classes, and earn from every learner you bring.',
    collectInstitution: false,
  },
}

/** Filter the live catalogue down to the languages this track should offer. */
export function coursesForTrack(courses: LiveCourse[], track: OnboardingTrack): LiveCourse[] {
  if (track === 'tutor') return courses
  const wantMinority = track === 'school_minority'
  return courses.filter((c) => MINORITY_TARGET_LANGS.has(c.target_lang) === wantMinority)
}

export function courseLabel(c: LiveCourse): string {
  return c.learner_display_name || c.display_name || c.course_code
}

/**
 * The TARGET language name only — the source ("for English speakers") is already
 * shown by the known-language switcher, so it's redundant on every tile AND it
 * breaks search (every label contains "Speakers"). "Spanish for English Speakers"
 * → "Spanish"; "Catalán para hispanohablantes" → "Catalán"; variants like
 * "Brazilian Portuguese" / "Welsh (Northern)" are preserved.
 */
export function targetLabel(c: LiveCourse): string {
  const full = courseLabel(c)
  const stripped = full
    .replace(/\s+for\s+.+?\s+speakers?$/i, '')
    .replace(/\s+para\s+\S.*$/i, '')
    .replace(/\s+pour\s+\S.*$/i, '')
    .trim()
  return stripped || full
}
