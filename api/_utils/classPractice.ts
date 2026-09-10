/**
 * CLASS PRACTICE — where a class's own practice actually lives.
 *
 * `class_sessions` was the original play-as-class log, inserted client-side by
 * LearningPlayer. On 2026-08-19 the play-as-class spine was re-anchored (owner
 * ruling, see composables/schools/useClassSessionStore.ts): a class is a
 * first-class learner with its own learner id, and its practice is recorded
 * server-side through /api/school/class-progress into `sessions` (learner_id =
 * the class's own learner) and `course_enrollments.last_practiced_at`.
 *
 * Nothing has written `class_sessions` since. Verified against the live DB on
 * 2026-09-10: max(started_at) = 2026-08-19T20:18Z, while 30 of the 103 classes
 * created after that date had class-entity practice, some of it that same day.
 * Every one of them read 0h on the dashboard. Hence this module: one place
 * that answers "how much has this class practised together", off the live
 * spine.
 *
 * TWO SIGNALS, deliberately:
 *   - `sessions` rows carry the DURATION and the session count.
 *   - the class enrollment's `last_practiced_at` is the most reliable "this
 *     class practised" fact — it is stamped by every class progress save,
 *     including the many where no session row was opened or cleanly closed
 *     (live: 30 classes practised in the window, only 12 session rows). It
 *     carries no duration, so it decides RECENCY only, never hours.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chunk } from './schoolScope'

export interface ClassPracticeClass {
  id: string
  class_learner_id?: string | null
}

export interface ClassPracticeSession {
  started_at: string
  ended_at: string | null
  duration_seconds: number
  items_practiced: number
}

export interface ClassPracticeFacts {
  /** The class's own play sessions, newest first. */
  sessions: ClassPracticeSession[]
  /** Newest evidence of any kind that the class practised — session or cursor stamp. */
  lastPractisedAt: string | null
}

const EMPTY: ClassPracticeFacts = { sessions: [], lastPractisedAt: null }

/** Total practice seconds a class has logged. */
export function practiceSeconds(facts: ClassPracticeFacts | undefined): number {
  return (facts?.sessions ?? []).reduce((sum, s) => sum + (Number(s.duration_seconds) || 0), 0)
}

/** Sessions started at or after `since` (epoch ms). */
export function sessionsSince(facts: ClassPracticeFacts | undefined, since: number): number {
  return (facts?.sessions ?? []).filter((s) => new Date(s.started_at).getTime() >= since).length
}

/** Did this class practise at or after `since` (epoch ms)? Either signal counts. */
export function practisedSince(facts: ClassPracticeFacts | undefined, since: number): boolean {
  return !!facts?.lastPractisedAt && new Date(facts.lastPractisedAt).getTime() >= since
}

/**
 * Practice facts for every class given, keyed by CLASS id. A class with no
 * learner identity of its own (pre-re-anchor, or never played) comes back
 * empty rather than missing, so callers never have to null-check.
 */
export async function loadClassPractice(
  svc: SupabaseClient,
  classes: ClassPracticeClass[],
): Promise<Map<string, ClassPracticeFacts>> {
  const out = new Map<string, ClassPracticeFacts>()
  for (const c of classes) out.set(c.id, { sessions: [], lastPractisedAt: null })

  const classIdByLearner = new Map<string, string>()
  for (const c of classes) if (c.class_learner_id) classIdByLearner.set(c.class_learner_id, c.id)
  const learnerIds = [...classIdByLearner.keys()]
  if (learnerIds.length === 0) return out

  const bump = (classId: string, at: string | null | undefined) => {
    if (!at) return
    const facts = out.get(classId)!
    if (!facts.lastPractisedAt || facts.lastPractisedAt < at) facts.lastPractisedAt = at
  }

  await Promise.all([
    ...chunk(learnerIds).map(async (batch) => {
      const { data } = await svc
        .from('sessions')
        .select('learner_id, started_at, ended_at, duration_seconds, items_practiced')
        .in('learner_id', batch)
      for (const r of data ?? []) {
        const classId = classIdByLearner.get((r as any).learner_id as string)
        if (!classId) continue
        out.get(classId)!.sessions.push({
          started_at: String((r as any).started_at),
          ended_at: ((r as any).ended_at as string | null) ?? null,
          duration_seconds: Number((r as any).duration_seconds) || 0,
          items_practiced: Number((r as any).items_practiced) || 0,
        })
        bump(classId, String((r as any).started_at))
      }
    }),
    ...chunk(learnerIds).map(async (batch) => {
      const { data } = await svc
        .from('course_enrollments')
        .select('learner_id, last_practiced_at')
        .in('learner_id', batch)
      for (const r of data ?? []) {
        const classId = classIdByLearner.get((r as any).learner_id as string)
        if (!classId) continue
        bump(classId, (r as any).last_practiced_at as string | null)
      }
    }),
  ])

  for (const facts of out.values()) {
    facts.sessions.sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0))
  }
  return out
}

export { EMPTY as EMPTY_CLASS_PRACTICE }
