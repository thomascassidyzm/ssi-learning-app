/**
 * Available courses catalogue — GET /api/courses/available
 *
 * Public (no auth). Returns the courses the app actually deploys to learners —
 * mirroring the in-app catalogue query in App.vue (new_app_status IN
 * ('live','beta'), ordered by display_name). So the signup language pickers
 * offer exactly what the app offers; nothing more, nothing less. As courses
 * move to live/beta this grows automatically.
 *
 * Shape: [{ course_code, target_lang, pricing_tier, new_app_status,
 *           display_name, learner_display_name }]
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const { data, error } = await supabase
      .from('courses')
      .select('course_code, target_lang, pricing_tier, new_app_status, display_name, learner_display_name')
      .in('new_app_status', ['live', 'beta'])
      .order('display_name')

    if (error) {
      console.error('[courses/available] Query failed:', error)
      res.status(500).json({ error: error.message })
      return
    }

    // Short cache: the deployed set changes rarely; avoids hammering the DB on
    // every signup-page load while staying fresh within minutes.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
    res.status(200).json(data || [])
  } catch (error: any) {
    console.error('[courses/available] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
