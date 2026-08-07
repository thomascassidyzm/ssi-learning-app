/**
 * assignTeacherClasses — the PEOPLE-FIRST half of teacher↔class assignment.
 *
 * ClassDetail's Teachers rail answers "who teaches THIS class?". A school
 * leader looking at their staff list is asking the other question: "which
 * classes does THIS teacher take?" — and moving a teacher from 6B to 7A, or
 * dropping a supply teacher onto three classes for a fortnight, is one
 * thought, not five page visits.
 *
 * So the control is a tick-list of the school's classes with the teacher's
 * current classes pre-ticked, and confirm applies the DIFF. That makes
 * assign and reassign the same interaction.
 *
 * Everything here is pure/injected so it can be tested without a component:
 * the writes arrive as the two useClassesData helpers, which are the ONLY
 * sanctioned path (they call the service-role endpoint
 * api/teacher/class-teachers.ts — the client must never write user_tags,
 * the live user_tags_insert policy forbids it).
 */

/** A class as the picker sees it. */
export interface AssignableClass {
  id: string
  class_name: string
  /** The teacher being assigned already teaches this class. */
  isMember: boolean
  /** The class already has at least one active teacher (so a new one joins as a co-teacher). */
  hasActiveTeacher: boolean
}

export interface AssignmentDiff {
  add: string[]
  remove: string[]
}

export interface AssignmentOutcome {
  classId: string
  className: string
  action: 'add' | 'remove'
  ok: boolean
  /** The SERVER's own message on failure — never a rewritten reassurance. */
  error: string | null
}

type WriteResult = { ok: boolean; error: string | null }

/**
 * Ticked-minus-current = add; current-minus-ticked = remove. Order follows
 * the class list the caller passed, so the report reads in the order the
 * leader saw the boxes.
 */
export function computeAssignmentDiff(current: string[], ticked: string[]): AssignmentDiff {
  const currentSet = new Set(current)
  const tickedSet = new Set(ticked)
  return {
    add: ticked.filter(id => !currentSet.has(id)),
    remove: current.filter(id => !tickedSet.has(id)),
  }
}

/**
 * Whether an add should also point the class's LEAD pointer at this teacher.
 *
 * Rule (this feature's contract): assigning an ADDITIONAL teacher to a class
 * that already has an active teacher never touches the lead — they join as a
 * co-teacher. Handing the lead over stays where it already is, the "Make
 * lead" action on class detail. A class with NOBODY on it would otherwise
 * gain a teacher and stay leaderless, so there the assignee becomes lead.
 */
export function shouldSetLead(cls: Pick<AssignableClass, 'hasActiveTeacher'>): boolean {
  return !cls.hasActiveTeacher
}

/**
 * Apply the diff one write at a time and report EVERY write's own fate.
 *
 * Deliberately not Promise.all-with-one-catch: if four classes save and one
 * fails, the leader has to be told which one and why (RLS doctrine rule 8 —
 * this codebase bans the false-"Saved"). Adds run before removes so a move
 * never leaves the destination class briefly unstaffed.
 */
export async function applyAssignmentDiff(opts: {
  teacherUserId: string
  diff: AssignmentDiff
  classes: AssignableClass[]
  addClassTeacher: (classId: string, userId: string, o?: { lead?: boolean }) => Promise<WriteResult>
  removeClassTeacher: (classId: string, userId: string) => Promise<WriteResult>
}): Promise<AssignmentOutcome[]> {
  const byId = new Map(opts.classes.map(c => [c.id, c]))
  const outcomes: AssignmentOutcome[] = []

  const name = (id: string) => byId.get(id)?.class_name ?? 'That class'

  for (const classId of opts.diff.add) {
    const cls = byId.get(classId)
    const lead = cls ? shouldSetLead(cls) : false
    let result: WriteResult
    try {
      result = await opts.addClassTeacher(classId, opts.teacherUserId, lead ? { lead: true } : undefined)
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
    }
    outcomes.push({ classId, className: name(classId), action: 'add', ok: !!result?.ok, error: result?.ok ? null : (result?.error ?? 'Something went wrong') })
  }

  for (const classId of opts.diff.remove) {
    let result: WriteResult
    try {
      result = await opts.removeClassTeacher(classId, opts.teacherUserId)
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' }
    }
    outcomes.push({ classId, className: name(classId), action: 'remove', ok: !!result?.ok, error: result?.ok ? null : (result?.error ?? 'Something went wrong') })
  }

  return outcomes
}

/**
 * One honest sentence about what happened — partial success stays visibly
 * partial. Callers render the per-class failures underneath it.
 */
export function summariseOutcomes(outcomes: AssignmentOutcome[], teacherName: string): string {
  const done = outcomes.filter(o => o.ok)
  const failed = outcomes.filter(o => !o.ok)
  const verb = (o: AssignmentOutcome) => (o.action === 'add' ? 'added to' : 'removed from')
  if (!outcomes.length) return 'Nothing changed.'
  if (!failed.length) {
    const added = done.filter(o => o.action === 'add').length
    const removed = done.filter(o => o.action === 'remove').length
    const parts: string[] = []
    if (added) parts.push(`added to ${added} ${added === 1 ? 'class' : 'classes'}`)
    if (removed) parts.push(`removed from ${removed} ${removed === 1 ? 'class' : 'classes'}`)
    return `${teacherName} ${parts.join(' and ')}.`
  }
  if (!done.length) {
    return `Nothing was changed — ${failed.length} ${failed.length === 1 ? 'change' : 'changes'} failed.`
  }
  return `Partly done — ${done.length} of ${outcomes.length} ${outcomes.length === 1 ? 'change' : 'changes'} saved. ${teacherName} was ${verb(done[0])} ${done[0].className}${done.length > 1 ? ' and others' : ''}, but the changes below did NOT save.`
}
