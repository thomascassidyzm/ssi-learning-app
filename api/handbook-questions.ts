/**
 * Handbook questions — the ASK loop of the schools Handbook (job #386).
 *
 * A reader who could not find something on /schools/handbook asks here; the
 * question is written down once and answered back onto the page. The shape
 * follows api/player-events.ts, the one telemetry write path in this repo
 * built properly: browser → this route → service-role insert, identity
 * verified server-side from the bearer token, the table itself unreadable
 * from a browser (RLS on, zero client policies — see
 * supabase/migrations/20260908_handbook_questions.sql).
 *
 *   POST  /api/handbook-questions   { question, route, persona, node_id?, deflected_entry_id? }
 *         — the asker's own question. auth_user_id is STAMPED from the token;
 *           nothing identity-shaped is read from the body. A handful a day
 *           per person: it is a support box, not a chat.
 *   GET   /api/handbook-questions            — the asker's own questions, newest first
 *   GET   /api/handbook-questions?all=1      — every question, platform admins only
 *   PATCH /api/handbook-questions   { id, status, answer?, entry_id?, matched_entry_id? }
 *         — a platform admin answering. answered_by is 'human'; no batch
 *           answerer exists yet, and this route is where one would write.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken, verifyAdmin } from './_utils/auth'
import { applyCors } from './_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** The most one person may ask in a rolling day. */
export const ASKS_PER_DAY = 5
const DAY_MS = 24 * 60 * 60 * 1000
export const QUESTION_MIN = 3
export const QUESTION_MAX = 600
export const STATUSES = ['new', 'duplicate', 'answered', 'in_page', 'declined'] as const
export type QuestionStatus = (typeof STATUSES)[number]
const PERSONAS = ['admin', 'leader', 'school_admin', 'teacher', 'learner']

/** The columns an asker sees. env and node_id are the answerer's, not theirs. */
const OWN_COLUMNS = 'id, created_at, question, status, matched_entry_id, answer, answered_at, entry_id'
const ALL_COLUMNS = `${OWN_COLUMNS}, auth_user_id, node_id, persona, route, env, deflected_entry_id, answered_by`

/**
 * Deployment environment from the request host — same derivation as
 * player-events, and for the same reason: one database serves dev, staging
 * and production, so a question must say which of them it was asked on.
 */
function getEnv(host: string | undefined, origin: string | undefined): 'production' | 'staging' | 'dev' {
  let h = (host || '').toLowerCase().trim()
  if (!h && origin) {
    try { h = new URL(origin).host.toLowerCase() } catch { /* malformed origin */ }
  }
  h = h.replace(/:\d+$/, '')
  if (h === 'staging.saysomethingin.app') return 'staging'
  if (h === 'saysomethingin.app' || h === 'www.saysomethingin.app') return 'production'
  return 'dev'
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<VercelResponse | void> {
  if (applyCors(req, res, { methods: 'GET, POST, PATCH' })) return
  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Service role not configured' })
  }

  // Every method needs a real person: a question from nobody cannot be
  // answered back to anybody.
  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) return res.status(401).json({ error: 'Sign in to ask' })
  const userId = auth.userId
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') return handleGet(req, res, supabase, userId)
  if (req.method === 'POST') return handlePost(req, res, supabase, userId)
  if (req.method === 'PATCH') return handlePatch(req, res, supabase)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function handleGet(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient, userId: string) {
  const all = req.query?.all === '1'
  if (all) {
    const admin = await verifyAdmin(req)
    if ('error' in admin) return res.status(admin.status).json({ error: admin.error })
    const { data, error } = await supabase
      .from('handbook_questions')
      .select(ALL_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) {
      console.warn('[handbook-questions] admin read failed:', error.message)
      return res.status(500).json({ error: 'read failed' })
    }
    return res.status(200).json({ questions: data ?? [] })
  }
  // OWN ROWS ONLY — the filter lives here, where it is tested, because the
  // table has no client policies to lean on.
  const { data, error } = await supabase
    .from('handbook_questions')
    .select(OWN_COLUMNS)
    .eq('auth_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) {
    console.warn('[handbook-questions] read failed:', error.message)
    return res.status(500).json({ error: 'read failed' })
  }
  return res.status(200).json({ questions: data ?? [] })
}

async function handlePost(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient, userId: string) {
  const body = (req.body ?? {}) as Record<string, unknown>
  const question = str(body.question, QUESTION_MAX)
  if (!question || question.length < QUESTION_MIN) {
    return res.status(400).json({ error: `question must be ${QUESTION_MIN} to ${QUESTION_MAX} characters` })
  }
  const persona = str(body.persona, 32)
  if (!persona || !PERSONAS.includes(persona)) return res.status(400).json({ error: 'persona required' })
  const route = str(body.route, 200) ?? '/schools/handbook'

  // THE THROTTLE, keyed on the verified person, counted in the table itself:
  // no second table, no IP hash, nothing an attacker can rotate. The current
  // question is not counted — it is refused before it exists.
  const { count, error: countError } = await supabase
    .from('handbook_questions')
    .select('id', { count: 'exact', head: true })
    .eq('auth_user_id', userId)
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString())
  if (countError) {
    console.warn('[handbook-questions] throttle count failed:', countError.message)
    return res.status(500).json({ error: 'ask failed' })
  }
  if ((count ?? 0) >= ASKS_PER_DAY) {
    return res.status(429).json({ error: `You have asked ${ASKS_PER_DAY} questions today — the answers are on their way. Try again tomorrow.` })
  }

  const row = {
    auth_user_id: userId,
    node_id: str(body.node_id, 64),
    persona,
    route,
    env: getEnv(req.headers?.host as string | undefined, req.headers?.origin as string | undefined),
    question,
    deflected_entry_id: str(body.deflected_entry_id, 120),
  }
  const { data, error } = await supabase.from('handbook_questions').insert(row).select(OWN_COLUMNS).single()
  if (error) {
    console.warn('[handbook-questions] insert failed:', error.message, error.code)
    return res.status(500).json({ error: 'ask failed' })
  }
  return res.status(201).json({ question: data })
}

async function handlePatch(req: VercelRequest, res: VercelResponse, supabase: SupabaseClient) {
  const admin = await verifyAdmin(req)
  if ('error' in admin) return res.status(admin.status).json({ error: admin.error })
  const body = (req.body ?? {}) as Record<string, unknown>
  const id = str(body.id, 64)
  const status = str(body.status, 16) as QuestionStatus | null
  if (!id) return res.status(400).json({ error: 'id required' })
  if (!status || !STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` })
  const answer = str(body.answer, 4000)
  const patch: Record<string, unknown> = {
    status,
    answer,
    entry_id: str(body.entry_id, 120),
    matched_entry_id: str(body.matched_entry_id, 120),
  }
  // An answer is dated and signed when it is given, not every time the row
  // is touched — the page renders "Answered on <date>" from this.
  if (status !== 'new') {
    patch.answered_at = new Date().toISOString()
    patch.answered_by = 'human'
  } else {
    patch.answered_at = null
    patch.answered_by = null
  }
  const { data, error } = await supabase
    .from('handbook_questions')
    .update(patch)
    .eq('id', id)
    .select(ALL_COLUMNS)
    .maybeSingle()
  if (error) {
    console.warn('[handbook-questions] update failed:', error.message)
    return res.status(500).json({ error: 'answer failed' })
  }
  if (!data) return res.status(404).json({ error: 'no such question' })
  return res.status(200).json({ question: data })
}
