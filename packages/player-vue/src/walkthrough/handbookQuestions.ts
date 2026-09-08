/**
 * handbookQuestions — the page side of the Handbook's ASK loop (job #386).
 *
 * Everything goes through api/handbook-questions.ts with the reader's own
 * bearer token; the table is unreadable from a browser by design. This file
 * is the whole client contract: ask, read your own, and — for a platform
 * admin — read all and answer.
 */
import { getSchoolsClient } from '@/composables/schools/client'

export type HandbookQuestionStatus = 'new' | 'duplicate' | 'answered' | 'in_page' | 'declined'

export interface HandbookQuestion {
  id: string
  created_at: string
  question: string
  status: HandbookQuestionStatus
  /** duplicate: the entry that already answers it. */
  matched_entry_id: string | null
  /** answered: what the asker was told, living in the database until an entry lands. */
  answer: string | null
  answered_at: string | null
  /** in_page: the entry this question became. */
  entry_id: string | null
}

/** The admin's view carries the context the asker's does not. */
export interface HandbookQuestionFull extends HandbookQuestion {
  auth_user_id: string
  node_id: string | null
  persona: string
  route: string
  env: string
  deflected_entry_id: string | null
  answered_by: string | null
}

export interface AskInput {
  question: string
  route: string
  persona: string
  node_id?: string | null
  deflected_entry_id?: string | null
}

export type AskResult = { ok: true; question: HandbookQuestion } | { ok: false; status: number; error: string }

async function authHeaders(): Promise<Record<string, string> | null> {
  const { data: { session } } = await getSchoolsClient().auth.getSession()
  if (!session?.access_token) return null
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }
}

export async function askHandbookQuestion(input: AskInput): Promise<AskResult> {
  const headers = await authHeaders()
  if (!headers) return { ok: false, status: 401, error: 'Sign in to ask' }
  try {
    const r = await fetch('/api/handbook-questions', { method: 'POST', headers, body: JSON.stringify(input) })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, status: r.status, error: String(body?.error ?? 'ask failed') }
    return { ok: true, question: body.question as HandbookQuestion }
  } catch {
    return { ok: false, status: 0, error: 'offline' }
  }
}

/** The reader's own questions, newest first. Empty when signed out or on any failure. */
export async function fetchMyHandbookQuestions(): Promise<HandbookQuestion[]> {
  const headers = await authHeaders()
  if (!headers) return []
  try {
    const r = await fetch('/api/handbook-questions', { headers })
    if (!r.ok) return []
    const body = await r.json()
    return Array.isArray(body?.questions) ? (body.questions as HandbookQuestion[]) : []
  } catch {
    return []
  }
}

/** Every question, for a platform admin. Throws with the route's message on refusal. */
export async function fetchAllHandbookQuestions(): Promise<HandbookQuestionFull[]> {
  const headers = await authHeaders()
  if (!headers) throw new Error('Sign in')
  const r = await fetch('/api/handbook-questions?all=1', { headers })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(String(body?.error ?? `HTTP ${r.status}`))
  return (body.questions ?? []) as HandbookQuestionFull[]
}

export interface AnswerInput {
  id: string
  status: HandbookQuestionStatus
  answer?: string | null
  entry_id?: string | null
  matched_entry_id?: string | null
}

/** A platform admin answering. Throws with the route's message on refusal. */
export async function answerHandbookQuestion(input: AnswerInput): Promise<HandbookQuestionFull> {
  const headers = await authHeaders()
  if (!headers) throw new Error('Sign in')
  const r = await fetch('/api/handbook-questions', { method: 'PATCH', headers, body: JSON.stringify(input) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(String(body?.error ?? `HTTP ${r.status}`))
  return body.question as HandbookQuestionFull
}

/**
 * "8 September" — day first, always. Intl puts the month first for an
 * English locale it reads as American, and the app's own locale codes are
 * three-letter, so the day and the month name are assembled by hand and
 * only the month name is asked of the locale.
 */
export function questionDay(iso: string | null | undefined, locale?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  let month = ''
  try { month = new Intl.DateTimeFormat(locale || 'en-GB', { month: 'long' }).format(d) } catch { month = new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(d) }
  return `${d.getDate()} ${month}`
}

/**
 * Where the page should send a reader whose question the handbook already
 * answers: the entry that matched, or the entry the question became.
 */
export function answeringEntryId(q: Pick<HandbookQuestion, 'status' | 'matched_entry_id' | 'entry_id'>): string | null {
  if (q.status === 'in_page') return q.entry_id ?? q.matched_entry_id ?? null
  if (q.status === 'duplicate') return q.matched_entry_id ?? q.entry_id ?? null
  return null
}
