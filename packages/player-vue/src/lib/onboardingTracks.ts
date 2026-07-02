/**
 * Onboarding tracks — the signup doors. Two roles only: a SCHOOL (admin +
 * dashboard) or a TUTOR. Every door shows ALL deployed languages; the OFFER is
 * read per-course from its pricing_tier (Free → free; Premium → paid), NOT from
 * a per-door trial or a "minority languages" list. The role is re-derived
 * server-side in api/onboarding/provision.
 *
 * Aesthetics/copy here are INTERIM — to be matched to the marketing landing
 * pages (saysomethingin.com) once they land.
 */

export type OnboardingTrack = 'school' | 'tutor'

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

// Human names for the "you'll teach" (target) language dropdown. The dropdown is
// a LANGUAGE picker, so it must show the language name ("Welsh"), NOT a specific
// course's display name — for multi-course targets, picking the first course's
// label leaked dialect/region (cym → "South Welsh", which also hid Welsh from
// anyone scanning under "W"). Target and known languages share ISO codes, so we
// extend the known-language names with the extra targets we deploy.
const TARGET_LANG_NAMES: Record<string, string> = {
  ...KNOWN_LANG_NAMES,
  cat: 'Catalan', eus: 'Basque', afr: 'Afrikaans', bul: 'Bulgarian',
  ces: 'Czech', dan: 'Danish', est: 'Estonian', fas: 'Persian',
  heb: 'Hebrew', hun: 'Hungarian', hye: 'Armenian', isl: 'Icelandic',
  lav: 'Latvian', nor: 'Norwegian', srp: 'Serbian', swa: 'Swahili',
  tha: 'Thai', hrv: 'Croatian',
}
export function targetLangName(code: string): string {
  return TARGET_LANG_NAMES[code] || (code || '').toUpperCase()
}

export interface TrackConfig {
  key: OnboardingTrack
  audience: 'school' | 'tutor'
  heading: string
  blurb: string
  collectInstitution: boolean
}

export const TRACKS: Record<OnboardingTrack, TrackConfig> = {
  school: {
    key: 'school',
    audience: 'school',
    heading: 'Set up your school',
    blurb: 'Bring SSi to every classroom. Choose your language to get started — no card needed.',
    collectInstitution: true,
  },
  tutor: {
    key: 'tutor',
    audience: 'tutor',
    heading: 'Start teaching',
    blurb: 'Teach the SSi way, in your own classes, and earn from every learner you bring.',
    collectInstitution: false,
  },
}

/** Every door shows ALL deployed languages — the offer is per-course (pricing_tier),
 *  not per-door. Kept as a hook in case a door ever needs to scope the list. */
export function coursesForTrack(courses: LiveCourse[], _track: OnboardingTrack): LiveCourse[] {
  return courses
}

/** Free-to-learn tiers (no payment, no trial). Premium is the paid path. */
export function isFreeTier(c: LiveCourse): boolean {
  return c.pricing_tier === 'free' || c.pricing_tier === 'community'
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
