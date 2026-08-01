/**
 * nodeTerminology — the DRESSING layer (founder ruling 2026-08-02: "orgs are
 * groups all the way down; the educational ontology stops being STRUCTURE and
 * becomes VOCABULARY").
 *
 * A node home renders in one of two vocabularies:
 *   · 'neutral'   — group / group leader / learner. The DEFAULT for new orgs.
 *   · 'education' — school / teacher / class / student, layered over the SAME
 *     bones. A school IS a group whose subgroups are called classes and whose
 *     leaders are called teachers.
 *
 * The preset is DERIVED from the data, not stored: a subtree carries the
 * education dressing iff it actually contains school DNA (a school attachment,
 * teachers or classes anywhere in the rollup, or a school above/below it in
 * the rail). Existing school-flavoured orgs therefore keep their vocabulary
 * with zero migration, and a fresh org — Cardiff Council — renders neutral
 * until the day a school genuinely exists inside it. An explicit stored
 * preset (org chooses its vocabulary before any school exists) is a known
 * follow-up, not built yet.
 */

export type TerminologyPreset = 'education' | 'neutral'

function schoolish(x: unknown): boolean {
  const n = x as { hasSchool?: boolean; commercial?: unknown; label?: string } | null
  return !!(n && (n.hasSchool || n.commercial || n.label === 'school'))
}

/** Derive the vocabulary for a /api/groups/:id/home payload. */
export function derivePreset(home: unknown): TerminologyPreset {
  const h = home as {
    kind?: string
    node?: { rollup?: { teacherCount?: number; classCount?: number } } | null
    ancestors?: unknown[]
    children?: unknown[]
  } | null
  if (!h?.node) return 'neutral'
  if (h.kind === 'class') return 'education'
  if (schoolish(h.node)) return 'education'
  const r = h.node.rollup || {}
  if ((r.teacherCount ?? 0) > 0 || (r.classCount ?? 0) > 0) return 'education'
  if ((h.ancestors || []).some(schoolish)) return 'education'
  if ((h.children || []).some(schoolish)) return 'education'
  return 'neutral'
}
