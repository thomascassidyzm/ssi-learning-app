/**
 * Trial duration — derived from the COURSE PICKED, not a generic tier.
 *
 * Founder ruling (2026-07-19): the length of a free trial depends on the
 * commercial class of the course being trialled, not merely its pricing tier:
 *
 *   - COMMERCIAL course (a "Big 10" target language — the paid, commercially
 *     valuable set) → 30-day trial.
 *   - HERITAGE course (everything else — Welsh and the non-commercial minority
 *     languages: Irish, Catalan, Cornish, Manx, Breton, Gaelic, …) → 365-day
 *     trial.
 *
 * This generalises (and deletes) the old `course_code.startsWith('cym')` Welsh
 * special-case: Welsh is priced `premium` (you pay for it) yet is HERITAGE for
 * trial-length purposes, and target-language classification captures that
 * without a fragile prefix check — Welsh's target `cym` simply isn't Big-10.
 * Any future heritage course promoted to premium inherits the 365-day trial
 * automatically, with no code change.
 */

import { isBig10Language } from './constants';

/** Trial length for a commercially-valuable (Big-10 target) course, in days. */
export const TRIAL_DAYS_COMMERCIAL = 30;

/** Trial length for a heritage / non-commercial course, in days. */
export const TRIAL_DAYS_HERITAGE = 365;

export interface TrialCourse {
  /** ISO 639-3 target language code (e.g. 'spa', 'cym'). Preferred signal. */
  target_lang?: string | null;
  /** Course code (e.g. 'cym_s_for_eng') — used to infer the target if target_lang is absent. */
  course_code?: string | null;
}

/**
 * Extract the target language code from a course code of the form
 * `<target>[_<variant>]_for_<known>` (e.g. 'cym_s_for_eng' → 'cym',
 * 'spa_for_eng' → 'spa'). Returns '' if it can't be parsed.
 */
export function targetLangFromCourseCode(courseCode: string | null | undefined): string {
  if (!courseCode) return '';
  const beforeFor = courseCode.split('_for_')[0];
  return beforeFor.split('_')[0] || '';
}

/**
 * Is this a COMMERCIAL course — i.e. does it teach a Big-10 (paid, commercially
 * valuable) target language? Heritage courses (Welsh + minority languages) are
 * everything else.
 */
export function isCommercialCourse(course: TrialCourse): boolean {
  const target = (course.target_lang || targetLangFromCourseCode(course.course_code)).toLowerCase();
  return isBig10Language(target);
}

/**
 * Trial length in days for the given course: 30 for commercial (Big-10 target),
 * 365 for heritage. The single source of truth for both the granted expiry
 * (server) and the "N-day trial" copy shown live in the picker (client).
 */
export function trialDaysForCourse(course: TrialCourse): number {
  return isCommercialCourse(course) ? TRIAL_DAYS_COMMERCIAL : TRIAL_DAYS_HERITAGE;
}
