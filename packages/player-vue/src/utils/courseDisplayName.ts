/**
 * The learner-facing name of a course's TARGET side — the one string the
 * player, the resting screen, the explorer and the course menu all show.
 *
 * The bug this exists to kill: everything inside a session named the course
 * from `getLanguageName(target_lang)`, and a variant course carries its BASE
 * language code — `deu_at_for_eng.target_lang` is `deu`. So a learner who
 * picked Austrian German, Brazilian Portuguese, Mexican Spanish or Egyptian
 * Arabic saw "German" / "Portuguese" / "Spanish" / "Arabic" everywhere once
 * they were in the session, with nothing telling them which variant they were
 * actually learning.
 *
 * Order of preference:
 *  1. `variant_label` composed with the localised language name — the Welsh
 *     shape, "Welsh (Northern)". Stays in the reading language, so a Spanish
 *     speaker still gets "Galés (Northern)" rather than an English title.
 *  2. For a variant course code (`<lang>_<variant>_for_<known>`) with no
 *     label, the authored course title from the DB minus its source-language
 *     suffix: "Austrian German for English Speakers" → "Austrian German".
 *     Authored names are reused, never invented.
 *  3. Otherwise the localised language name, exactly as before.
 */

import { getLanguageName } from '@/composables/useI18n'

export interface CourseNameFields {
  course_code?: string | null
  target_lang?: string | null
  variant_label?: string | null
  display_name?: string | null
  learner_display_name?: string | null
}

/**
 * Drop the "…for English Speakers" / "…para hispanohablantes" /
 * "…pour francophones" / "… — 日本語話者向け" tail from an authored course
 * title, leaving the target side alone. The source language is already known
 * to the learner — it is the language they are reading the app in.
 */
export function stripSourceSuffix(name: string): string {
  const stripped = (name || '')
    .replace(/\s+for\s+.+?\s+speakers?$/i, '')
    .replace(/\s+para\s+\S.*$/i, '')
    .replace(/\s+pour\s+\S.*$/i, '')
    .replace(/\s+—\s+\S.*$/, '')
    .trim()
  return stripped || (name || '').trim()
}

/** `deu_at_for_eng` yes, `deu_for_eng` no, `eng_for_ara` no. */
export function isVariantCourseCode(code: string | null | undefined): boolean {
  return /^[a-z]{2,3}_(?!for_)[a-z]{1,6}_for_/.test(code || '')
}

/** The name to show a learner for this course's target side. */
export function courseTargetName(course: CourseNameFields | null | undefined): string {
  if (!course) return ''
  const lang = course.target_lang || String(course.course_code || '').split('_')[0] || ''
  const base = getLanguageName(lang)

  if (course.variant_label) {
    return base ? `${base} (${course.variant_label})` : course.variant_label
  }

  if (isVariantCourseCode(course.course_code)) {
    const authored = stripSourceSuffix(course.learner_display_name || course.display_name || '')
    if (authored) return authored
  }

  return base
}
