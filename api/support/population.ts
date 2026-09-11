/**
 * GET /api/support/population?signal=<key> — INTEGERS ONLY.
 *
 * "Is anyone else seeing this?" is answered by a count whose response shape
 * is { schools: n, since } and which cannot carry a school id, a name or a
 * region — so "nine other schools" is reachable and "yes, Ysgol X" is not
 * expressible (spec §10 constraint 2). The shape is asserted by a test.
 *
 * The count is of OTHER schools: the caller's own school is excluded, so the
 * number reads as the sentence the agent will say.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { applyCors } from '../_utils/cors'
import { resolveSupportScope } from './_shared'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export const POPULATION_WINDOW_DAYS = 7
const SIGNAL_KEY = /^[a-z][a-z0-9-]*:[A-Za-z0-9 _.;:@/+-]{1,120}$/

export interface PopulationResponse {
  schools: number
  since: string
}

/**
 * The ONLY way a population answer is built. Takes a list of school ids and
 * returns a count and a date — nothing about the ids survives.
 */
export function populationShape(schoolIds: Iterable<string>, ownSchoolId: string | null, since: Date): PopulationResponse {
  const others = new Set<string>()
  for (const id of schoolIds) if (id && id !== ownSchoolId) others.add(id)
  return { schools: others.size, since: since.toISOString() }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET' })) return
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const signal = typeof req.query.signal === 'string' ? req.query.signal : ''
  if (!SIGNAL_KEY.test(signal)) {
    res.status(400).json({ error: 'signal required' })
    return
  }

  const svc = createClient(supabaseUrl, supabaseServiceKey)
  try {
    const scope = await resolveSupportScope(svc, auth.userId)
    if (!scope) {
      res.status(403).json({ error: 'Support is for school and organisation admins' })
      return
    }
    const since = new Date(Date.now() - POPULATION_WINDOW_DAYS * 86400000)
    const { data: rows } = await svc
      .from('support_signals')
      .select('school_id')
      .eq('signal_key', signal)
      .gte('last_seen_at', since.toISOString())
    const ids = ((rows ?? []) as Array<{ school_id: string }>).map((r) => r.school_id)
    const own = scope.kind === 'school' ? scope.schoolId : null
    res.status(200).json(populationShape(ids, own, since))
  } catch (err) {
    console.error('[support/population]', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected error' })
  }
}
