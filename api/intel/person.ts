/**
 * GET /api/intel/person?id=<learners.id> — question 6.
 *
 * "What is this one person's story, and what has gone wrong for them?" The
 * support console: everything the 2,100-line user detail page kept that
 * answers a support call, in one read — identity and support id, whether
 * they count as a real person and why not if not, what they can actually
 * play and through which door, where they are in each course, what they
 * did last, and on what.
 *
 * ONE PERSON, SO NO K-FLOOR AND NO POPULATION COUNT — but the population
 * RULE still applies and is stated: the response says whether this person
 * is in the surface's numbers, and every reason they are not, so a page
 * about a demo account can never look like a page about a customer.
 *
 * ACCESS IS THE PLAYER'S OWN ANSWER. Three of the four layers of access are
 * derived — the cascade, class cover, org cover — and have no row to read,
 * so this runs the same resolver the player runs rather than reading the
 * entitlements table and calling that the truth (the Chepstow report,
 * 2026-09-09).
 *
 * POSITION IS A LEGO, NEVER A SEED NUMBER. Each course position is the last
 * LEGO played, shown as its own text in both languages.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveRealLearners, STAFF_PLATFORM_ROLES } from '../_utils/realLearnerPopulation'
import { resolveMoneyStandings, type MoneyStanding } from '../_utils/entitlementCohort'
import { resolveActiveEntitlements, isDerivedEntitlementId } from '../_utils/resolveEntitlements'
import { supportIdForLearnerId } from '../../packages/core/src/identity/supportId'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export type ExclusionReason = 'demo' | 'internal' | 'class-account' | 'staff-role' | 'test-school-or-address'

export interface PersonResponse {
  id: string
  authUserId: string
  supportId: string | null
  name: string | null
  emails: { email: string; primary: boolean; verified: boolean }[]
  createdAt: string
  platformRole: string | null
  educationalRole: string | null
  flags: { isDemo: boolean; isInternal: boolean; isClassEntity: boolean }
  /** In the surface's numbers, or every reason they are not. */
  counted: boolean
  excludedBecause: ExclusionReason[]
  standing: MoneyStanding
  subscriptions: { provider: string | null; status: string | null; periodEnd: string | null; cancelling: boolean }[]
  /** What they can actually play, the player's own answer; derived layers named. */
  access: { id: string; accessType: string; courses: string[] | null; expiresAt: string | null; derived: boolean }[]
  memberships: { kind: string; id: string; role: string }[]
  positions: { course: string; legoId: string | null; knownText: string | null; targetText: string | null; lastPractisedAt: string | null }[]
  practice: { sessions30: number; days30: number; lastSessionAt: string | null }
  recent: { at: string; type: string; course: string | null; device: string | null; country: string | null; build: string | null }[]
  devices: string[]
  countries: string[]
  countedAt: string
}

/** Why a person is out of the numbers, from their own row and the canonical set. */
export function exclusionReasons(
  l: { is_demo: boolean | null; is_internal: boolean | null; is_class_entity: boolean | null; platform_role: string | null },
  inCanonicalTestSet: boolean,
): ExclusionReason[] {
  const out: ExclusionReason[] = []
  if (l.is_demo) out.push('demo')
  if (l.is_internal) out.push('internal')
  if (l.is_class_entity) out.push('class-account')
  if (l.platform_role && (STAFF_PLATFORM_ROLES as readonly string[]).includes(l.platform_role)) out.push('staff-role')
  if (inCanonicalTestSet && !l.is_demo && !l.is_internal) out.push('test-school-or-address')
  return out
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }
  const id = typeof req.query.id === 'string' ? req.query.id.slice(0, 64) : ''
  if (!id) {
    res.status(400).json({ error: 'id is required' })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const { data: l, error } = await svc
    .from('learners')
    .select('id, user_id, display_name, created_at, platform_role, educational_role, is_demo, is_internal, is_class_entity')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    res.status(500).json({ error: 'Could not read this person' })
    return
  }
  if (!l) {
    res.status(404).json({ error: 'No such person' })
    return
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [{ realIds, excludedIds }, { data: emails }, { data: subs }, standings, access, { data: tags }, { data: enrolments }, { data: sessions }, { data: events }] = await Promise.all([
    resolveRealLearners(svc),
    svc.from('learner_emails').select('email, is_primary, verified').eq('learner_id', id).order('is_primary', { ascending: false }),
    svc.from('subscriptions').select('provider, status, current_period_end, cancel_at_period_end').eq('learner_id', id),
    resolveMoneyStandings(svc, [id]),
    resolveActiveEntitlements(svc, l.user_id, l.id),
    svc.from('user_tags').select('tag_type, tag_value, role_in_context').eq('user_id', l.user_id).is('removed_at', null),
    svc.from('course_enrollments').select('course_id, highest_completed_lego_id, last_completed_lego_id, last_practiced_at').eq('learner_id', id),
    svc.from('sessions').select('started_at').eq('learner_id', id).gte('started_at', thirtyDaysAgo),
    svc.from('player_events').select('occurred_at, event_type, course_code, device_type, ip_country, client_version').eq('learner_id', id).order('occurred_at', { ascending: false }).limit(25),
  ])

  // The LEGO each position sits on, as its own text.
  const positions = ((enrolments ?? []) as { course_id: string; highest_completed_lego_id: string | null; last_completed_lego_id: string | null; last_practiced_at: string | null }[])
    .map((e) => ({ course: e.course_id, legoId: e.highest_completed_lego_id || e.last_completed_lego_id || null, lastPractisedAt: e.last_practiced_at }))
  const legoText = new Map<string, { known: string | null; target: string | null }>()
  const legoIds = positions.map((p) => p.legoId).filter((x): x is string => !!x)
  if (legoIds.length) {
    const { data: legos } = await svc.from('course_legos').select('course_code, lego_id, known_text, target_text').in('lego_id', legoIds)
    for (const g of (legos ?? []) as { course_code: string; lego_id: string; known_text: string | null; target_text: string | null }[]) {
      legoText.set(`${g.course_code}:${g.lego_id}`, { known: g.known_text, target: g.target_text })
    }
  }

  const excludedBecause = exclusionReasons(l, excludedIds.has(id) && !realIds.has(id))
  const sessionRows = (sessions ?? []) as { started_at: string }[]
  const recent = ((events ?? []) as { occurred_at: string; event_type: string; course_code: string | null; device_type: string | null; ip_country: string | null; client_version: string | null }[])
    .map((e) => ({ at: e.occurred_at, type: e.event_type, course: e.course_code, device: e.device_type, country: e.ip_country, build: e.client_version }))

  const body: PersonResponse = {
    id: l.id,
    authUserId: l.user_id,
    supportId: supportIdForLearnerId(l.id),
    name: l.display_name || null,
    emails: ((emails ?? []) as { email: string; is_primary: boolean; verified: boolean }[]).map((e) => ({ email: e.email, primary: e.is_primary, verified: e.verified })),
    createdAt: l.created_at,
    platformRole: l.platform_role,
    educationalRole: l.educational_role,
    flags: { isDemo: !!l.is_demo, isInternal: !!l.is_internal, isClassEntity: !!l.is_class_entity },
    counted: realIds.has(id),
    excludedBecause,
    standing: standings.get(id) ?? 'free',
    subscriptions: ((subs ?? []) as { provider: string | null; status: string | null; current_period_end: string | null; cancel_at_period_end: boolean | null }[])
      .map((s) => ({ provider: s.provider, status: s.status, periodEnd: s.current_period_end, cancelling: !!s.cancel_at_period_end })),
    access: access.map((e) => ({ id: e.id, accessType: e.access_type, courses: e.granted_courses, expiresAt: e.expires_at, derived: isDerivedEntitlementId(e.id) })),
    memberships: ((tags ?? []) as { tag_type: string; tag_value: string; role_in_context: string }[]).map((t) => ({ kind: t.tag_type, id: t.tag_value, role: t.role_in_context })),
    positions: positions.map((p) => {
      const t = p.legoId ? legoText.get(`${p.course}:${p.legoId}`) : undefined
      return { ...p, knownText: t?.known ?? null, targetText: t?.target ?? null }
    }),
    practice: {
      sessions30: sessionRows.length,
      days30: new Set(sessionRows.map((s) => s.started_at.slice(0, 10))).size,
      lastSessionAt: sessionRows.map((s) => s.started_at).sort().at(-1) ?? null,
    },
    recent,
    devices: [...new Set(recent.map((e) => e.device).filter((x): x is string => !!x))],
    // A person's own countries are facts about them; a Finnish learner is in Finland (job #325).
    countries: [...new Set(recent.map((e) => e.country).filter((x): x is string => !!x))],
    countedAt: new Date().toISOString(),
  }
  res.status(200).json(body)
}
