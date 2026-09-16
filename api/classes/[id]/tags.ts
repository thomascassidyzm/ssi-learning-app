/**
 * PATCH /api/classes/:id/tags — confirm or clear a class's YEAR / DEPARTMENT.
 *
 *   body { year?: string | null, department?: string | null }
 *
 * The only writer of classes.tags. A key absent from the body is left alone;
 * null clears it. What is written is a CONFIRMED value — the page shows the
 * derived guess until a person taps to confirm or corrects it in place, and
 * only then does a comparison at that level exist (api/_utils/classTags.ts).
 *
 * Who may write: an ssi_admin, or anyone whose visible scope carries the
 * class — its teachers, its school's admins, a leader whose subtree holds it.
 * View As is read-only here as everywhere (refuseViewAsWrite).
 *
 * Answers the fresh tag view so the page repaints from the server's truth.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin, verifyAuthToken } from '../../_utils/auth'
import { resolveVisibleScope } from '../../_utils/schoolScope'
import { applyCors } from '../../_utils/cors'
import { refuseViewAsWrite } from '../../_utils/actAsGuard'
import { classTagsView, normaliseTagValue, readStoredTags } from '../../_utils/classTags'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'PATCH' })) return
  if (req.method !== 'PATCH') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }
  if (refuseViewAsWrite(req, res)) return

  const classId = String(req.query.id || '').trim()
  if (!classId) {
    res.status(400).json({ error: 'Class id required' })
    return
  }
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(body, k)
  if (!has('year') && !has('department')) {
    res.status(400).json({ error: 'Nothing to change — send year and/or department' })
    return
  }
  for (const k of ['year', 'department']) {
    if (has(k) && body[k] !== null && typeof body[k] !== 'string') {
      res.status(400).json({ error: `${k} must be a string or null` })
      return
    }
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  try {
    const adminResult = await verifyAdmin(req)
    let authUid: string | null = null
    let isAdmin = false
    if (!('error' in adminResult)) {
      isAdmin = true
      authUid = adminResult.userId
    } else if (adminResult.userId) {
      authUid = adminResult.userId
    } else {
      const auth = await verifyAuthToken(req)
      if (!auth.valid || !auth.userId) {
        res.status(401).json({ error: auth.error || 'Unauthorized' })
        return
      }
      authUid = auth.userId
    }

    const { data: cls } = await svc
      .from('classes')
      .select('id, class_name, course_code, tags')
      .eq('id', classId)
      .maybeSingle()
    if (!cls) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    if (!isAdmin) {
      const scope = await resolveVisibleScope(svc, authUid!)
      if (!scope.classIds.includes(classId)) {
        res.status(403).json({ error: 'That class is outside your visible scope' })
        return
      }
    }

    const next = { ...readStoredTags((cls as any).tags) }
    if (has('year')) next.year = normaliseTagValue(body.year)
    if (has('department')) next.department = normaliseTagValue(body.department)
    const stored: Record<string, string> = {}
    if (next.year) stored.year = next.year
    if (next.department) stored.department = next.department

    const { error } = await svc.from('classes').update({ tags: stored }).eq('id', classId)
    if (error) {
      console.error('[class-tags] update failed:', error.message)
      res.status(500).json({ error: 'Could not save the tag' })
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ ok: true, tags: classTagsView((cls as any).class_name, (cls as any).course_code, stored) })
  } catch (err) {
    console.error('[class-tags] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
