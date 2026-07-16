/**
 * Course catalogue exposed in the Teach flow.
 *
 * Hardcoded for v1 — covers the most likely teacher-offer use cases (English
 * as target for non-English speakers, plus the classic X-for-English SSi
 * courses). Extend / replace with a DB lookup when we get feedback on what
 * teachers actually need.
 */

export interface TeacherCourse {
  code: string
  label: string
}

export const TEACHER_COURSES: TeacherCourse[] = [
  // English as target (primary teacher-offer audience)
  { code: 'eng_for_spa', label: 'English — for Spanish speakers' },
  { code: 'eng_for_fra', label: 'English — for French speakers' },
  { code: 'eng_for_zho', label: 'English — for Chinese speakers' },
  { code: 'eng_for_jpn', label: 'English — for Japanese speakers' },
  { code: 'eng_for_hin', label: 'English — for Hindi speakers' },
  { code: 'eng_for_tam', label: 'English — for Tamil speakers' },
  { code: 'eng_for_ara', label: 'English — for Arabic speakers' },
  // Celtic languages. Codes MUST exist in the `courses` table — the old
  // entries here (cym_for_eng_north/south, glv_for_eng) matched no course
  // row, so every class created with them was born broken: play-as-class
  // couldn't switch the player onto the course (verified against the live
  // catalogue, 2026-07-16).
  { code: 'cym_n_for_eng', label: 'Welsh (Northern)' },
  { code: 'cym_s_for_eng', label: 'Welsh (Southern)' },
  { code: 'cor_for_eng', label: 'Cornish' },
  // Others for English speakers
  { code: 'spa_for_eng', label: 'Spanish' },
  { code: 'fra_for_eng', label: 'French' },
  { code: 'deu_for_eng', label: 'German' },
  { code: 'ita_for_eng', label: 'Italian' },
  { code: 'por_for_eng', label: 'Portuguese' },
  { code: 'nld_for_eng', label: 'Dutch' },
  { code: 'jpn_for_eng', label: 'Japanese' },
  { code: 'zho_for_eng', label: 'Chinese' },
  { code: 'kor_for_eng', label: 'Korean' },
  { code: 'ara_for_eng', label: 'Arabic' },
]

export function labelForCourse(code: string): string {
  return TEACHER_COURSES.find((c) => c.code === code)?.label || code
}
