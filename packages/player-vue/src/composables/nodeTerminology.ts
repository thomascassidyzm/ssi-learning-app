/**
 * nodeTerminology — the ONE derivation of what kind of institution a node is,
 * and the vocabulary that follows from it.
 *
 * Founder ruling 2026-08-02: "orgs are groups all the way down; the
 * educational ontology stops being STRUCTURE and becomes VOCABULARY".
 * Founder ruling 2026-09-08 (job #409): "ideally we will know the difference
 * between a school and an org by the teachers and/or classes established —
 * orgs will have groups but no teachers or classes". A class is a group that
 * has a teacher.
 *
 * So the KIND of a node is DERIVED FROM ITS STRUCTURE and never from a label
 * anyone picks. There is no stored type that decides wording, no dropdown,
 * no setup question. `groups.type` is a display word a node wears (its own
 * name for itself — "college", "programme", "council"); it decides nothing.
 *
 * SUPERSEDED HISTORY, kept legible on purpose: until 2026-09-08 `schoolish()`
 * also returned true on `label === 'school'` (label-not-type, THE-MODEL
 * §2.1), so a node labelled "school" wore education vocabulary regardless of
 * what it contained. Tom's ruling closes that leg: the label is now the one
 * signal this file refuses to read.
 *
 * The two vocabularies:
 *   · 'neutral'   — organisation / group / group leader / learner.
 *   · 'education' — school / teacher / class / student, layered over the
 *     SAME bones. A school IS a group whose subgroups are called classes and
 *     whose leaders are called teachers.
 *
 * What counts as school STRUCTURE on a node:
 *   · teachers or classes established anywhere in its rollup (Tom's rule);
 *   · a school attachment — a `schools` row hangs off the node (`hasSchool`
 *     / `commercial`). That row is what the schools signup door creates on
 *     day one, before any teacher or class exists, so a school mid-setup
 *     keeps school wording instead of reading as an org until its first
 *     teacher arrives. It is a row, not a word anyone typed.
 * A subtree carries the education vocabulary iff school structure exists on
 * the node itself, on an ancestor, or on a child — a sibling org branch with
 * groups and nothing else stays neutral (mixed subtrees).
 */

export type TerminologyPreset = 'education' | 'neutral'

/** What the structure says a node IS. */
export type InstitutionKind = 'school' | 'org'

/**
 * Chrome badge for a govt_admin (root group leader). 'Govt Admin' was a
 * dressing leak (founder bug 2026-08-02: Cardiff Council's leader badged as
 * government staff) — a root leader makes no government claim in either
 * vocabulary; both presets call them what the invite flow already does. The
 * preset parameter is the seam: header chrome has no node payload to derive
 * from, so it passes nothing and gets the neutral default.
 */
export function leaderRoleLabel(_preset: TerminologyPreset = 'neutral'): string {
  return 'Group Leader'
}

interface StructuralNode {
  hasSchool?: boolean
  commercial?: unknown
  rollup?: { childGroupCount?: number; teacherCount?: number; classCount?: number } | null
}

/**
 * Does this node carry school STRUCTURE — teachers or classes established in
 * its subtree, or a schools row attached? Reads nothing else: not the label,
 * not the name, not who is looking. The subtree rollup is what the home
 * payload carries; ancestors in the map rail carry only the attachment flag,
 * which is enough because an ancestor school makes the subtree educational
 * either way.
 */
export function hasSchoolStructure(x: unknown): boolean {
  const n = x as StructuralNode | null | undefined
  if (!n) return false
  if (n.hasSchool || n.commercial) return true
  const r = n.rollup || {}
  return (r.teacherCount ?? 0) > 0 || (r.classCount ?? 0) > 0
}

/**
 * Is this node ITSELF a school, rather than a container whose subtree holds
 * one? A schools row attached says yes outright. Otherwise a node with no
 * child groups whose teachers or classes are therefore its own is a school by
 * Tom's definition; a node with child groups and teachers somewhere beneath
 * is a group in education dressing (a council over schools), not a school.
 */
export function isSchoolNode(x: unknown): boolean {
  const n = x as StructuralNode | null | undefined
  if (!n) return false
  if (n.hasSchool || n.commercial) return true
  const r = n.rollup || {}
  const ownPeople = (r.teacherCount ?? 0) > 0 || (r.classCount ?? 0) > 0
  return ownPeople && (r.childGroupCount ?? 0) === 0
}

/**
 * The kind of institution a /api/groups/:id/home payload describes.
 * 'school' when school structure exists on the node, above it or below it;
 * 'org' when it is groups all the way down. A class home is school by
 * definition (a class is a group that has a teacher).
 */
export function deriveInstitutionKind(home: unknown): InstitutionKind {
  const h = home as {
    kind?: string
    node?: StructuralNode | null
    ancestors?: unknown[]
    children?: unknown[]
  } | null
  if (!h?.node) return 'org'
  if (h.kind === 'class') return 'school'
  if (hasSchoolStructure(h.node)) return 'school'
  if ((h.ancestors || []).some(hasSchoolStructure)) return 'school'
  if ((h.children || []).some(hasSchoolStructure)) return 'school'
  return 'org'
}

/** The vocabulary a node home renders in — follows from the derived kind. */
export function derivePreset(home: unknown): TerminologyPreset {
  return deriveInstitutionKind(home) === 'school' ? 'education' : 'neutral'
}
