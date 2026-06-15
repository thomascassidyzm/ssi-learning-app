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
  pricing_tier: string
  new_app_status?: string // 'live' | 'beta' — beta shows a badge
  display_name: string | null
  learner_display_name: string | null
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
    blurb: 'Bring your minority language into every classroom — free for a full year.',
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
