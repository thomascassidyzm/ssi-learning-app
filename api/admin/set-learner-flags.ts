/**
 * POST /api/admin/set-learner-flags — correct a population flag.
 *
 * The verb the verbs half was missing (the room with no hand, 2026-09-10):
 * every number on every question page stands on is_demo and is_internal,
 * and every verb is born with them already set — but nothing could FIX one.
 * A real person wrongly marked demo, a staff member who leaves and becomes
 * a learner, a tester who was a real customer all along: until this, the
 * flag every page depends on could only be corrected by hand in the
 * database. It passes the set's three tests: a human decides it, it is
 * nobody else's job, and it cannot be composed out of two other verbs.
 *
 *   Body: { learner_id, is_demo?: boolean, is_internal?: boolean, reason }
 *
 * Only the flags named are changed. The audit row is written HERE, by the
 * endpoint, naming the admin — never by the page — through the same
 * recordRoleChange every other privilege change uses, with the reason the
 * admin typed carried in `detail`, because a flag flip with no reason is
 * the next person's mystery.
 *
 * WHAT IT DOES NOT DO. It never touches platform_role: turning a tester into
 * a learner is "change their role", verb 8, and that verb marks them
 * internal at birth; this one is what you run afterwards if they were real
 * all along. It never touches is_class_entity: a class account is a class
 * account. And it never touches test_learner_ids(), the canonical
 * definition, which reads these flags and needs no second copy.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { recordRoleChange } from '../_utils/auditRole'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export interface FlagChange { is_demo?: boolean; is_internal?: boolean }

/** The change, validated: only the two flags, only booleans, at least one. */
export function parseFlagChange(body: unknown): { change: FlagChange; reason: string } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const change: FlagChange = {}
  if ('is_demo' in b) {
    if (typeof b.is_demo !== 'boolean') return { error: 'is_demo must be true or false' }
    change.is_demo = b.is_demo
  }
  if ('is_internal' in b) {
    if (typeof b.is_internal !== 'boolean') return { error: 'is_internal must be true or false' }
    change.is_internal = b.is_internal
  }
  if (!('is_demo' in change) && !('is_internal' in change)) return { error: 'name at least one flag: is_demo or is_internal' }
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : ''
  if (!reason) return { error: 'reason is required — say why the flag was wrong' }
  return { change, reason }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }
  const learnerId = (req.body as { learner_id?: unknown } | undefined)?.learner_id
  if (!learnerId || typeof learnerId !== 'string') {
    res.status(400).json({ error: 'learner_id is required' })
    return
  }
  const parsed = parseFlagChange(req.body)
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  const { data: before, error: readError } = await svc
    .from('learners')
    .select('id, user_id, is_demo, is_internal')
    .eq('id', learnerId)
    .maybeSingle()
  if (readError) {
    res.status(500).json({ error: 'Could not read the learner' })
    return
  }
  if (!before) {
    res.status(404).json({ error: 'No such person' })
    return
  }

  const { data: after, error: writeError } = await svc
    .from('learners')
    .update(parsed.change)
    .eq('id', learnerId)
    .select('id, is_demo, is_internal')
    .single()
  if (writeError || !after) {
    res.status(500).json({ error: 'Could not change the flag' })
    return
  }

  // The record, written by the endpoint and naming the human.
  await recordRoleChange(svc, {
    actorUserId: admin.userId,
    targetLearnerId: before.id,
    targetUserId: before.user_id,
    field: 'flags',
    oldValue: JSON.stringify({ is_demo: before.is_demo, is_internal: before.is_internal }),
    newValue: JSON.stringify({ is_demo: after.is_demo, is_internal: after.is_internal }),
    source: 'set-learner-flags',
    detail: { reason: parsed.reason, changed: parsed.change },
  })

  res.status(200).json({ learner: after })
}
