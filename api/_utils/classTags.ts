/**
 * Class tags — YEAR and DEPARTMENT, the two containers a class sits in below
 * its school (Tom's ruling, 2026-09-16, relayed by RBF):
 *
 *   OPTIONAL    no tag, no comparison at that level, drawn as absence.
 *   DERIVABLE   year from the class name, department from the course.
 *   CORRECTABLE shown as a guess a teacher fixes in place, never a form
 *               filled first. Never forced.
 *
 * Only CONFIRMED values are stored (classes.tags, jsonb). A derived guess is
 * computed on every read and never written: the moment it is written it
 * would look confirmed, and a misread "8A" would move a cohort with no
 * visible cause — the job #978 failure. So a comparison at year or
 * department level is drawn only between classes whose tag is CONFIRMED, and
 * the viewed class's own tag must be confirmed before its rung is offered.
 */
import { languageName } from '../../packages/core/src/courses/displayName'

export type TagKind = 'year' | 'department'

export interface TagView {
  /** The value in force — confirmed if there is one, else the guess, else null. */
  value: string | null
  /** True only when a person wrote this value. */
  confirmed: boolean
  /** What the name/course suggests, whether or not confirmed. */
  derived: string | null
}

export interface ClassTagsView { year: TagView; department: TagView }

/** What is stored: confirmed values only. Unknown keys are ignored on read. */
export interface StoredTags { year?: string | null; department?: string | null }

const MAX_TAG_LEN = 40

export function normaliseTagValue(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/\s+/g, ' ')
  if (!s) return null
  return s.slice(0, MAX_TAG_LEN)
}

export function readStoredTags(raw: unknown): StoredTags {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  return { year: normaliseTagValue(o.year), department: normaliseTagValue(o.department) }
}

/**
 * The YEAR a class name suggests. "Year 7 Welsh", "Yr 8", "Grade 6A", "8A",
 * "Blwyddyn 9", "11P", "Y10 French" all read; "Room 12", "2024 intake" and a
 * bare "Welsh club" do not. Two-digit years cap at 13 so a room number or a
 * cohort year is never mistaken for one. The value is the bare number, so
 * "Grade 6A" and "Year 6 Hindi" share a year.
 */
export function deriveYear(className: string | null | undefined): string | null {
  const name = String(className ?? '').trim()
  if (!name) return null
  const worded = name.match(/\b(?:year|yr|y|grade|gr|blwyddyn|bl|class|std|standard|form)\s*\.?\s*(\d{1,2})(?!\d)/i)
  const leading = name.match(/^(\d{1,2})\s*[A-Za-z]{1,2}(?![A-Za-z])/)
  const m = worded ?? leading
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n < 1 || n > 13) return null
  return String(n)
}

/** The DEPARTMENT a course suggests — its target language, "Welsh", "English". */
export function deriveDepartment(courseCode: string | null | undefined): string | null {
  const code = String(courseCode ?? '').trim().toLowerCase()
  if (!code) return null
  const target = code.split('_for_')[0]
  if (!target) return null
  const name = languageName(target)
  return name ? name.replace(/\s*\(.*\)$/, '') : null
}

export function classTagsView(
  className: string | null | undefined,
  courseCode: string | null | undefined,
  stored: unknown,
): ClassTagsView {
  const s = readStoredTags(stored)
  const yearDerived = deriveYear(className)
  const deptDerived = deriveDepartment(courseCode)
  return {
    year: { value: s.year ?? yearDerived, confirmed: !!s.year, derived: yearDerived },
    department: { value: s.department ?? deptDerived, confirmed: !!s.department, derived: deptDerived },
  }
}

/** The confirmed value only — what a cohort at that level may be built on. */
export function confirmedTag(stored: unknown, kind: TagKind): string | null {
  const s = readStoredTags(stored)
  return (kind === 'year' ? s.year : s.department) ?? null
}

export function tagRungLabel(kind: TagKind, value: string): string {
  return kind === 'year' ? `Year ${value} average` : `${value} department average`
}
