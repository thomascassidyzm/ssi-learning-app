import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { createPlayPublisher, type PlayPublisher } from '../_utils/playPublisher'
import { playPackageName, refreshPlayGrant } from '../_utils/playGrant'
import { resolveServerCourseAccess } from '../_utils/courseAccess'

export function createPlayVerify(publisher: PlayPublisher = createPlayPublisher()) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    const auth = await verifyAuthToken(req)
    if (!auth.valid || !auth.userId) return res.status(401).json({ error: 'Sign in required' })
    const token = req.body?.purchaseToken
    const courseCode = req.body?.courseCode
    if (typeof token !== 'string' || !token.trim() || token.length > 4096 || typeof courseCode !== 'string') {
      return res.status(400).json({ error: 'Purchase token and course code required' })
    }
    try {
      const db = createClient((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim(),
        (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(), { auth: { persistSession: false } })
      const { data: learner, error } = await db.from('learners').select('id').eq('user_id', auth.userId).single()
      if (error || !learner) return res.status(404).json({ error: 'Learner account not found' })
      const { data: course, error: courseError } = await db.from('courses')
        .select('course_code, pricing_tier, is_community, target_lang').eq('course_code', courseCode).single()
      if (courseError || !course) return res.status(404).json({ error: 'Course not found' })
      await refreshPlayGrant(db, publisher, { token, packageName: playPackageName(), callerLearnerId: learner.id })
      const access = await resolveServerCourseAccess(req, db, course)
      return res.status(200).json({ access })
    } catch (error) {
      console.error('[play-verify] verification failed', error instanceof Error ? error.message : 'database error')
      return res.status(503).json({ error: 'Purchase verification unavailable. Try again' })
    }
  }
}
export default createPlayVerify()
