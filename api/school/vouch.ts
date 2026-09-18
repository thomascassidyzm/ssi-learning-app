/**
 * An admin vouches for a school — GET/POST /api/school/vouch
 *
 * TOM'S RULING 1 (job #195, 2026-09-18): an unproven school "can build but
 * not enrol ... until the mailbox is proven or an admin vouches." This is the
 * vouch. api/_utils/schoolProof.ts reads it.
 *
 * WHO MAY VOUCH — somebody who already answers for the school and is not the
 * person being vouched for:
 *   - a platform admin (ssi_admin), from the admin read-view of the school;
 *   - a govt / group leader whose group contains the school;
 *   - a second admin of the school whose own mailbox is proven.
 * The founder can never vouch for herself: the stamp lives in app_metadata,
 * which only the service role writes, and this route refuses the founder by
 * id before it writes anything.
 *
 * WHAT IT WRITES. `app_metadata.school_vouch = { school_id, by, at }` on the
 * founder's auth user. Nothing about the mailbox is asserted — the banner
 * stays until the code lands — only that a person who answers for the school
 * says its children may be enrolled. Idempotent: vouching twice is one vouch.
 *
 * GET answers { held, vouched } for the same callers, so the admin read-view
 * shows the button only when there is something to vouch for.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyCors } from '../_utils/cors'
import { verifyAuthToken } from '../_utils/auth'
import { rejectIfViewAs } from '../_utils/actAsGuard'
import { isPlatformAdmin, isLeaderAboveClass } from '../_utils/classTeacherAuth'
import { isMailboxUnproven } from '../_utils/mailboxProof'
import { schoolEnrolmentHeld, SCHOOL_VOUCH_KEY } from '../_utils/schoolProof'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

async function mayVouch(svc: SupabaseClient, callerId: string, schoolId: string, founderId: string | null): Promise<boolean> {
  if (founderId && callerId === founderId) return false
  if (await isPlatformAdmin(svc, callerId)) return true
  // isLeaderAboveClass covers both the school's own admins (either spelling)
  // and any govt leader whose group contains the school.
  const above = await isLeaderAboveClass(svc, callerId, { id: '', teacher_user_id: null, school_id: schoolId, group_id: null })
  if (!above) return false
  // A co-admin vouching must herself be reachable: an unproven admin vouching
  // for an unproven founder would be the door vouching for itself.
  const { data: caller } = await svc.auth.admin.getUserById(callerId)
  if (!caller?.user) return false
  return !isMailboxUnproven(caller.user.user_metadata as Record<string, unknown> | undefined)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET, POST' })) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const viewAs = rejectIfViewAs(req)
  if (viewAs) {
    res.status(viewAs.status).json({ error: viewAs.error })
    return
  }
  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  const schoolId = String((req.method === 'GET' ? req.query?.school_id : req.body?.school_id) || '')
  if (!schoolId) {
    res.status(400).json({ error: 'school_id is required' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }
  const svc = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  try {
    const { data: school } = await svc.from('schools').select('id, admin_user_id').eq('id', schoolId).maybeSingle()
    if (!school) {
      res.status(404).json({ error: 'School not found' })
      return
    }
    const founderId = (school as { admin_user_id?: string | null }).admin_user_id ?? null
    if (!(await mayVouch(svc, auth.userId, schoolId, founderId))) {
      res.status(403).json({ error: 'Not authorised to vouch for this school' })
      return
    }
    const held = await schoolEnrolmentHeld(svc, schoolId)
    if (req.method === 'GET') {
      res.status(200).json({ held })
      return
    }
    if (!held) {
      res.status(200).json({ vouched: false, held: false, already_open: true })
      return
    }
    if (!founderId) {
      res.status(200).json({ vouched: false, held: false, already_open: true })
      return
    }
    const { data: founder } = await svc.auth.admin.getUserById(founderId)
    const existing = (founder?.user?.app_metadata as Record<string, unknown> | undefined) || {}
    const { error } = await svc.auth.admin.updateUserById(founderId, {
      app_metadata: { ...existing, [SCHOOL_VOUCH_KEY]: { school_id: schoolId, by: auth.userId, at: new Date().toISOString() } },
    })
    if (error) {
      res.status(500).json({ error: 'Could not record the vouch. Please try again.' })
      return
    }
    res.status(200).json({ vouched: true, held: false })
  } catch (err) {
    console.error('[school/vouch] Error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
