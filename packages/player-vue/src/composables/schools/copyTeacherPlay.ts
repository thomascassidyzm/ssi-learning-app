/**
 * copyTeacherPlay — the ONE client for /api/school/copy-teacher-play/*, and
 * the plain-words rendering of what it returns, shared by the class page's
 * CopyTeacherPlayCard (one teacher, picked) and the school home's
 * CopyPlaySweepCard (every mis-played teacher at once, job #662). One fetch,
 * one set of words, so the two surfaces cannot describe the same copy
 * differently.
 *
 * The server owns the copy. Preview and candidates write nothing and work
 * under View-as; apply is refused there with the server's own message, which
 * every caller shows as-is: never a false "Copied".
 */
import { getSchoolsClient } from './client'
import { secondsToMinutes } from './practiceMinutes'

export interface PositionWords { known: string | null; target: string | null }

export interface CopyPreview {
  class_id: string
  course_code: string
  teacher: { user_id: string; name: string; learner_id: string }
  to_copy: Record<string, number>
  total_rows: number
  in_app_seconds: number
  minutes_to_add: number
  prior_runs: number
  nothing_to_copy: boolean
  /** Other classes already holding this teacher's play on this course: a lesson is credited to ONE class (job #792). */
  copied_elsewhere?: { class_ids: string[]; class_names: string[]; rows: number }
  position: {
    teacher: PositionWords
    class: PositionWords
    resulting: PositionWords & { taken_from_teacher: boolean }
  }
}

export interface CopyApplied {
  copied: Record<string, number>
  total_rows: number
  in_app_seconds: number
  cursor_taken_from_teacher: boolean
  position: { class: PositionWords }
}

/** A candidate pair on the sweep: the preview plus the class's name. */
export interface CopyCandidate extends CopyPreview {
  class_name: string
  /** The other classes this same teacher's play is listed under on the sweep; it can only go onto one. */
  also_offered_on?: string[]
}

export interface CopyCandidates {
  school_id: string
  classes_checked: number
  pairs_checked: number
  candidates: CopyCandidate[]
}

type Translate = (key: string, fallback: string) => string

export async function callCopyTeacherPlay(path: 'preview' | 'apply' | 'candidates', body: Record<string, unknown>, t: Translate): Promise<Record<string, any>> {
  const { data: { session } } = await getSchoolsClient().auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error(t('schools.copyPlay.notSignedIn', 'You are not signed in.'))
  const resp = await fetch(`/api/school/copy-teacher-play/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const payload = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(payload.error || `Request failed: ${resp.status}`)
  return payload
}

// Minutes round UP (Tom, 2026-09-14, job #683): 25 seconds of a lesson is 1
// minute on the card, never "0 minutes in the app" beside real sessions.
export function copyMinutes(seconds: number): string {
  return String(secondsToMinutes(seconds))
}

// Plain words for the rows that matter to a leader. Everything else the
// server copies is folded into "and the rest of the record".
export function copyLines(counts: Record<string, number>, t: Translate): string[] {
  const out: string[] = []
  const n = (k: string) => counts[k] ?? 0
  if (n('sessions')) out.push(t('schools.copyPlay.sessions', '{n} sessions').replace('{n}', String(n('sessions'))))
  if (n('player_events')) out.push(t('schools.copyPlay.diary', '{n} moments in the app').replace('{n}', String(n('player_events'))))
  const progress = n('lego_progress') + n('seed_progress') + n('learner_lego_metrics')
  if (progress) out.push(t('schools.copyPlay.progress', '{n} pieces of course progress').replace('{n}', String(progress)))
  const rest = Object.entries(counts).filter(([k]) => !['sessions', 'player_events', 'lego_progress', 'seed_progress', 'learner_lego_metrics'].includes(k)).reduce((a, [, v]) => a + v, 0)
  if (rest) out.push(t('schools.copyPlay.rest', '{n} other records').replace('{n}', String(rest)))
  return out
}

/** The learner-facing form of a position: the LEGO's own content, both languages, or "not started yet". */
export function positionLabel(p: PositionWords | null | undefined, t: Translate): string {
  if (!p?.known && !p?.target) return t('schools.copyPlay.notStarted', 'not started yet')
  return [p.known, p.target].filter(Boolean).join(' / ')
}

/** What was copied, as one clause: "74 sessions, 244 moments in the app, 28 minutes in the app". */
export function copiedClause(applied: CopyApplied, t: Translate): string {
  return [
    ...copyLines(applied.copied, t),
    ...(applied.in_app_seconds > 0 ? [t('schools.copyPlay.minutes', '{n} minutes in the app').replace('{n}', copyMinutes(applied.in_app_seconds))] : []),
  ].join(', ')
}
