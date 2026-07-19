// Honest-delete warning lines (founder pass C, 2026-07-19): the confirm
// dialog states the ACTUAL consequence of the cascade with names and counts —
// "the warning should at least say that its sub-groups are now going to be
// orphaned and will bubble up to root — unless they ARE deleted in which case
// we should be precise". The true semantics (api/_utils/schoolGroupDeletion):
// descendant groups ARE deleted; schools whose own node is inside the subtree
// die with it; legacy-attached schools survive but appear at top level;
// learner/teacher ACCOUNTS are never deleted — they lose their place here.
// One formatter for both the group impact (/api/groups/:id) and the school
// impact (/api/admin/update-school), keyed off which fields are present.

export interface DeleteImpact {
  classCount?: number
  schoolCount?: number
  schoolNames?: string[]
  descendantGroupCount?: number
  descendantGroupNames?: string[]
  orphanedSchoolCount?: number
  orphanedSchoolNames?: string[]
  sessionCount: number
  learnerCount: number
  teacherCount: number
  hasRealActivity: boolean
}

const MAX_NAMES = 5

function nameList(names: string[] | undefined, count: number): string {
  const list = (names || []).slice(0, MAX_NAMES)
  if (!list.length) return ''
  const more = count - list.length
  return `: ${list.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}

function plural(n: number, word: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? word : (pluralWord || `${word}s`)}`
}

export function formatDeleteImpactLines(impact: DeleteImpact | null): string[] {
  if (!impact) return []
  const lines: string[] = []

  if (impact.descendantGroupCount) {
    lines.push(
      `Also permanently deletes ${plural(impact.descendantGroupCount, 'sub-group')} inside it` +
      nameList(impact.descendantGroupNames, impact.descendantGroupCount),
    )
  }
  if (impact.schoolCount) {
    lines.push(
      `Also permanently deletes ${plural(impact.schoolCount, 'school')} and everything in them` +
      nameList(impact.schoolNames, impact.schoolCount),
    )
  }
  if (impact.orphanedSchoolCount) {
    lines.push(
      `${plural(impact.orphanedSchoolCount, 'school is', 'schools are')} attached here without their own place in the tree — ` +
      `they are kept but will appear at top level` +
      nameList(impact.orphanedSchoolNames, impact.orphanedSchoolCount),
    )
  }
  if (impact.classCount) {
    lines.push(`Deletes ${plural(impact.classCount, 'class', 'classes')} and ${plural(impact.sessionCount, 'recorded session')}`)
  } else if (impact.sessionCount) {
    lines.push(`Deletes ${plural(impact.sessionCount, 'recorded session')}`)
  }
  if (impact.learnerCount || impact.teacherCount) {
    lines.push(
      `${plural(impact.learnerCount, 'learner')} and ${plural(impact.teacherCount, 'teacher')} lose their place here — their accounts are kept`,
    )
  }
  if (!lines.length) {
    lines.push('Nothing else is inside it — only this is deleted.')
  }
  return lines
}
