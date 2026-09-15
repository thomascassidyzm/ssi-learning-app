/**
 * POST /api/report/bug — the learner postbox.
 *
 * ONE WAY. A learner types what went wrong, the app attaches what they cannot
 * tell us, and this route writes ONE row into `bug_reports`. Nothing is ever
 * read back to the learner from here: the response is `{ok:true}` and the
 * "Got it, thank you." is client copy. Tom's ruling, 2026-09-12: "not have
 * agents reply to them because that would soon escalate". The poller on
 * watson-1 (command-surface/tools/bug-reports/poster.cjs) posts each row once
 * into the ssi-learning-app project channel; that is the inbox.
 *
 * TWO HALVES, the same rule as api/support/_shared.ts: the client half
 * (course, position, device, build, shell, route, unflushed events) is useful
 * and never trusted for identity. Identity comes from the verified bearer and
 * is mapped to learners.id server-side. The last five minutes of
 * `player_events` for that learner are pulled HERE, by the server, and merged
 * with the client's still-unflushed buffer so the report carries what the
 * learner just did even if the timed flush had not fired.
 *
 * GUESTS. A guest has no Supabase session, so there is no bearer to verify.
 * A guest may still report (learner_id and auth_user_id both null, and the
 * server cannot pull their events, so only the client buffer is kept). The
 * unauthenticated path is throttled: a per-instance in-memory window keyed on
 * the platform-attested peer (getClientIp) plus a durable fleet-wide cap on
 * guest rows in the last fifteen minutes, counted from the table itself. Not
 * a hardened limiter; a postbox that receives twenty guest reports in a
 * quarter of an hour is already a channel problem, not a storage one.
 *
 * TWO DOORS, ONE POSTBOX (Tom, 2026-09-14): the schools dashboard account menu
 * carries "Report a bug" too, "because the bug might be with the dashboard
 * side of things". Such a report posts here with source 'schools_dashboard'
 * and a `context` of what the dashboard had in view (role, school, group,
 * class, node, page title); the page URL rides in `route` as before. A
 * signed-in caller, learner or staff, is throttled to SIGNED_IN_PER_HOUR rows
 * an hour, counted from the table by auth_user_id. A view-as session (an
 * ssi_admin looking as a persona) carries X-Ssi-View-As and is refused: the
 * menu item is hidden under view-as, and this is the belt to that brace.
 *
 * THREE DOORS (job #652, 2026-09-14): the floating tester widget that testers
 * and ssi_admins see over the learner app used to write its own table,
 * tester_feedback, which nothing polled. Aran's "choose your course not
 * scrolling" sat there unread while the postbox was searched for it. The
 * widget now posts here with source 'tester_widget'; one postbox, one poller.
 *
 * ONE DOOR FOR EVERYONE (Tom, 2026-09-14 15:01Z, job #677). The fourth and last
 * one-way door, the content flag in the player (ReportIssueButton.vue), posts
 * here too with source 'content_flag' and a `context` naming the clip: audio
 * id, lego, seed, and the phrase's known and target text. It keeps its
 * sample_flags upsert because Popty's QA tooling reads that table. A flag is
 * about the course, so the watcher posts it into the Popty room, not the app
 * room.
 *
 * IDENTITY ATTACHED, SERVER-SIDE, AT REPORT TIME (same job). Every row now
 * carries what Tom otherwise has to ask for by screenshot: the account code
 * (supportIdForLearnerId, the same value Settings shows), the signed-in email
 * from the verified bearer, platform_role and educational_role as they stood
 * when the report was sent, and for school staff the resolved school role,
 * school and group from resolveVisibleScope. None of it comes from the client.
 * Roles and emails change, so they are stored on the row rather than joined
 * later. Guests carry nulls. An identity lookup that fails never loses the
 * report: the row is written with what resolved.
 *
 * The watcher that reads this table is command-surface/tools/support/inbox.cjs,
 * one unit on watson-1 (ssi-support-inbox.service) with two lanes: post-only
 * for every source here, and the admins' draft-only support lane for
 * support_messages. The view `support_inbox` unions both for one read.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { getClientIp } from '../_utils/codeAttemptThrottle'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import { envFromDeployment, envFromHost } from '../player-events'
import { resolveVisibleScope, schoolIdForStaffMember } from '../_utils/schoolScope'
import { supportIdForLearnerId } from '../../packages/core/src/identity/supportId'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export const MAX_BODY_CHARS = 2000
export const RECENT_EVENTS_WINDOW_MS = 5 * 60 * 1000
export const RECENT_EVENTS_CAP = 200
const MAX_CLIENT_EVENTS = 200
const MAX_STR = 300

// Guest throttle: per-instance window keyed on the attested peer, plus the
// durable fleet-wide cap below.
const GUEST_WINDOW_MS = 15 * 60 * 1000
const GUEST_PER_IP = 5
const GUEST_FLEET_CAP = 20
const guestHits = new Map<string, number[]>()

// Signed-in throttle: counted durably from the table, per auth uid.
export const SIGNED_IN_WINDOW_MS = 60 * 60 * 1000
export const SIGNED_IN_PER_HOUR = 10

export const SOURCES = ['learner', 'schools_dashboard', 'tester_widget', 'content_flag'] as const
export type ReportSource = (typeof SOURCES)[number]
const CONTEXT_KEYS = ['role', 'school_id', 'school_name', 'group_id', 'class_id', 'node_id', 'page_title'] as const
/** A content flag names the clip so the content team can find it. */
const FLAG_CONTEXT_KEYS = ['audio_id', 'lego_id', 'seed_id', 'known_text', 'target_text'] as const

export interface RecentEvent {
  event_type: string
  occurred_at: string
  payload: unknown
}

function str(v: unknown, max = MAX_STR): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

function pickPosition(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of ['lego_id', 'known_text', 'target_text', 'belt'] as const) {
    const s = str(p[k])
    if (s) out[k] = s
  }
  return Object.keys(out).length ? out : null
}

export function pickSource(v: unknown): ReportSource {
  return (SOURCES as readonly string[]).includes(v as string) ? (v as ReportSource) : 'learner'
}

/**
 * What the dashboard had in view, or which clip was flagged. Only the known
 * keys for that source, only strings; null for the player and tester doors.
 */
export function pickContext(v: unknown, source: ReportSource): Record<string, string> | null {
  const keys: readonly string[] = source === 'schools_dashboard' ? CONTEXT_KEYS : source === 'content_flag' ? FLAG_CONTEXT_KEYS : []
  if (!keys.length || !v || typeof v !== 'object') return null
  const c = v as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of keys) {
    const s = str(c[k], 200)
    if (s) out[k] = s
  }
  return Object.keys(out).length ? out : null
}

function pickDevice(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null
  const d = v as Record<string, unknown>
  return {
    user_agent: str(d.user_agent, 400),
    platform: str(d.platform, 80),
    viewport: str(d.viewport, 40),
    online: typeof d.online === 'boolean' ? d.online : null,
    standalone: typeof d.standalone === 'boolean' ? d.standalone : null,
  }
}

/** The client's unflushed buffer, bounded and shaped like the server rows. */
export function pickClientEvents(v: unknown): RecentEvent[] {
  if (!Array.isArray(v)) return []
  const out: RecentEvent[] = []
  for (const e of v.slice(0, MAX_CLIENT_EVENTS)) {
    if (!e || typeof e !== 'object') continue
    const r = e as Record<string, unknown>
    const event_type = str(r.event_type, 64)
    const occurred_at = str(r.occurred_at, 40)
    if (!event_type || !occurred_at) continue
    out.push({ event_type, occurred_at, payload: r.payload ?? null })
  }
  return out
}

/** Server rows win; client rows fill in what has not landed yet. Dedupe on occurred_at + event_type. */
export function mergeEvents(server: RecentEvent[], client: RecentEvent[]): RecentEvent[] {
  const seen = new Set(server.map((e) => `${e.occurred_at}|${e.event_type}`))
  const merged = [...server]
  for (const e of client) {
    const k = `${e.occurred_at}|${e.event_type}`
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(e)
  }
  merged.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0))
  return merged.slice(-RECENT_EVENTS_CAP)
}

async function recentServerEvents(svc: SupabaseClient, learnerId: string, courseCode: string | null): Promise<RecentEvent[]> {
  const since = new Date(Date.now() - RECENT_EVENTS_WINDOW_MS).toISOString()
  let q = svc
    .from('player_events')
    .select('event_type, occurred_at, payload')
    .eq('user_id', learnerId)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true })
    .limit(RECENT_EVENTS_CAP)
  if (courseCode) q = q.eq('course_code', courseCode)
  const { data, error } = await q
  if (error || !data) return []
  return (data as RecentEvent[]).map((e) => ({ event_type: e.event_type, occurred_at: e.occurred_at, payload: e.payload ?? null }))
}

function guestOverLimit(ip: string): boolean {
  const now = Date.now()
  const hits = (guestHits.get(ip) ?? []).filter((t) => now - t < GUEST_WINDOW_MS)
  if (hits.length >= GUEST_PER_IP) { guestHits.set(ip, hits); return true }
  hits.push(now)
  guestHits.set(ip, hits)
  return false
}

export interface ReporterIdentity {
  account_code: string | null
  reporter_email: string | null
  platform_role: string | null
  educational_role: string | null
  school_role: string | null
  school_id: string | null
  group_id: string | null
}

const NO_IDENTITY: ReporterIdentity = {
  account_code: null, reporter_email: null, platform_role: null, educational_role: null, school_role: null, school_id: null, group_id: null,
}

/**
 * Who sent it, as they stood at that moment, from the verified bearer and the
 * learner row alone. School staff get their resolved scope; a teacher's scope
 * carries no school by design, so their home school is read the way the
 * dashboard reads it. Best effort throughout: a lookup that fails leaves nulls
 * and the report is still written.
 */
export async function resolveReporter(svc: SupabaseClient, authUserId: string | null, email: string | null): Promise<ReporterIdentity & { learnerId: string | null }> {
  if (!authUserId) return { ...NO_IDENTITY, learnerId: null }
  const out: ReporterIdentity & { learnerId: string | null } = { ...NO_IDENTITY, reporter_email: email, learnerId: null }
  try {
    const { data } = await svc.from('learners').select('id, platform_role, educational_role').eq('user_id', authUserId).maybeSingle()
    const l = data as { id?: string; platform_role?: string | null; educational_role?: string | null } | null
    if (!l?.id) return out
    out.learnerId = l.id
    out.account_code = supportIdForLearnerId(l.id)
    out.platform_role = l.platform_role ?? null
    out.educational_role = l.educational_role ?? null
  } catch { return out }
  const staff = out.educational_role === 'teacher' || out.educational_role === 'school_admin' || out.educational_role === 'govt_admin'
  if (!staff) return out
  try {
    const scope = await resolveVisibleScope(svc, authUserId)
    out.school_role = scope.role
    out.school_id = scope.schoolIds[0] ?? null
    out.group_id = scope.groupId
    if (!out.school_id && scope.role === 'teacher') out.school_id = await schoolIdForStaffMember(svc, authUserId)
  } catch { /* the report still goes */ }
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }
  const viewAsRejection = rejectIfViewAs(req)
  if (viewAsRejection) {
    res.status(viewAsRejection.status).json({ error: viewAsRejection.error })
    return
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) {
    res.status(400).json({ error: 'text required' })
    return
  }
  if (text.length > MAX_BODY_CHARS) {
    res.status(400).json({ error: `text too long (max ${MAX_BODY_CHARS} characters)` })
    return
  }

  // Identity: a verified bearer if there is one; otherwise a guest.
  let authUserId: string | null = null
  let authEmail: string | null = null
  const hasBearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
  if (hasBearer) {
    const auth = await verifyAuthToken(req)
    if (!auth.valid || !auth.userId) {
      res.status(401).json({ error: auth.error || 'Unauthorized' })
      return
    }
    authUserId = auth.userId
    authEmail = auth.email ?? null
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  try {
    if (!authUserId) {
      if (guestOverLimit(getClientIp(req))) {
        res.status(429).json({ error: 'Too many reports, try again later' })
        return
      }
      const since = new Date(Date.now() - GUEST_WINDOW_MS).toISOString()
      const { count } = await svc
        .from('bug_reports')
        .select('id', { count: 'exact', head: true })
        .is('auth_user_id', null)
        .gte('created_at', since)
      if ((count ?? 0) >= GUEST_FLEET_CAP) {
        res.status(429).json({ error: 'Too many reports, try again later' })
        return
      }
    }

    const who = await resolveReporter(svc, authUserId, authEmail)
    const learnerId = who.learnerId
    if (authUserId) {
      const since = new Date(Date.now() - SIGNED_IN_WINDOW_MS).toISOString()
      const { count } = await svc
        .from('bug_reports')
        .select('id', { count: 'exact', head: true })
        .eq('auth_user_id', authUserId)
        .gte('created_at', since)
      if ((count ?? 0) >= SIGNED_IN_PER_HOUR) {
        res.status(429).json({ error: 'Too many reports, try again later' })
        return
      }
    }

    const courseCode = str(body.course_code, 40)
    const source = pickSource(body.source)
    const clientEvents = pickClientEvents(body.recent_events)
    const serverEvents = learnerId ? await recentServerEvents(svc, learnerId, courseCode) : []
    const recent = mergeEvents(serverEvents, clientEvents)

    const host = typeof req.headers.host === 'string' ? req.headers.host : undefined
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    const deployment_env = envFromDeployment(process.env) ?? envFromHost(host, origin)

    const { error } = await svc.from('bug_reports').insert({
      learner_id: learnerId,
      auth_user_id: authUserId,
      body: text,
      screenshot_url: str(body.screenshot_url, 600),
      course_code: courseCode,
      position: pickPosition(body.position),
      device: pickDevice(body.device),
      app_version: str(body.app_version, 120),
      app_shell: body.app_shell === 'webview' ? 'webview' : 'web',
      deployment_env,
      recent_events: recent,
      route: str(body.route, 300),
      source,
      context: pickContext(body.context, source),
      account_code: who.account_code,
      reporter_email: who.reporter_email,
      platform_role: who.platform_role,
      educational_role: who.educational_role,
      school_role: who.school_role,
      school_id: who.school_id,
      group_id: who.group_id,
    })
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[report/bug]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
