/**
 * Per-course practice minutes for a set of learners —
 * POST /api/school/practice-by-course   { learner_ids?: string[] }
 *
 * WHY THIS EXISTS. `admin_practice_minutes_by_course()` is a SECURITY DEFINER
 * function that was granted to `authenticated` so four browser callers could
 * read it directly. Its no-argument (platform-wide) path was gated to
 * ssi_admin on 2026-08-25 (SEC25-D-02), but its NAMED-LEARNER path was not:
 * any signed-in user who knew a learner UUID could pull that person's whole
 * per-course practice history. Verified live 2026-09-07 as an ordinary test
 * learner: 33 course rows for a stranger.
 *
 * The fix could NOT be an `is_ssi_admin()` gate on the function — that blanks
 * every scoped dashboard silently, which is the exact silent-empty failure
 * CLAUDE.md's RLS doctrine names. So the reads come here instead, and the
 * function loses `authenticated` entirely (service_role only).
 *
 * THE AUTHORIZATION, in one place:
 *   - the caller's visible scope is resolved SERVER-side (resolveVisibleScope,
 *     the same primitive class-practice-7d / daily-activity / rate-compare
 *     use). Requested learner ids must all be inside it, plus the caller's own
 *     learner id (self is always visible to self).
 *   - an out-of-scope id is a LOUD 403, never a silently dropped id and never
 *     an empty list: a dashboard that renders empty instead of erroring is
 *     worse than the leak it replaced, because nobody notices.
 *   - ADMIN PASSTHROUGH, same shape as group-summary.ts: once verifyAdmin
 *     confirms ssi_admin/god, any learner ids are allowed, and an omitted
 *     `learner_ids` means the platform-wide aggregate (the /admin/courses
 *     view). A non-admin who omits `learner_ids` gets a 400 — the
 *     platform-wide aggregate is never reachable by omission.
 *
 * Coverage (an expired school platform trial) is deliberately NOT gated here:
 * this is a reporting rollup like group-summary, and coverage is a billing
 * state, not a privacy boundary.
 *
 * Returns: { practice: [{ course_code, practice_minutes, is_estimated }] }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken, verifyAdmin } from '../_utils/auth'
import { resolveVisibleScope } from '../_utils/schoolScope'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/** Body ids arrive as JSON (POST, not a query string) so a whole region's
 *  learner set can be requested without hitting a URL length cap. */
function parseLearnerIds(body: unknown): string[] | null {
  if (!body || typeof body !== 'object') return null
  const raw = (body as { learner_ids?: unknown }).learner_ids
  if (raw === undefined || raw === null) return null
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map(v => v.trim())
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Cross-origin policy and preflight both live in `api/_utils/cors.ts`.
  if (applyCors(req, res, { methods: 'POST' })) return

  if (req.method !== 'POST') {
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

  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body
  const requested = parseLearnerIds(body)

  const svc = createClient(supabaseUrl, supabaseServiceKey)

  try {
    const scope = await resolveVisibleScope(svc, auth.userId)
    // Self is always visible to self: a learner reading their own progress
    // needs no class membership.
    const visible = new Set<string>(scope.learnerIds)
    if (scope.learnerId) visible.add(scope.learnerId)

    let learnerIds: string[] | null = requested
    if (requested !== null && requested.length === 0) {
      // An empty array is a malformed request, not "everyone" and not "nobody"
      // — say so rather than answering with a number that means neither.
      res.status(400).json({
        error: 'learner_ids must not be empty',
        message: 'learner_ids was an empty array. Name at least one learner, or omit the field entirely as an admin for the platform-wide aggregate.',
      })
      return
    }
    if (requested === null) {
      // No ids named = the platform-wide aggregate. Admin only, and refused
      // loudly to everyone else rather than answered with their own scope
      // (which would quietly turn a mis-shaped request into a wrong number).
      const adminResult = await verifyAdmin(req)
      if ('error' in adminResult) {
        res.status(403).json({
          error: 'Requires SSi admin access',
          message: 'Platform-wide practice minutes are admin-only. Name the learner_ids you want.',
        })
        return
      }
      learnerIds = null
    } else {
      const outOfScope = requested.filter(id => !visible.has(id))
      if (outOfScope.length > 0) {
        // Admin passthrough aside, this is a refusal, LOUD. Never drop the ids
        // and answer with a partial (or empty) list.
        const adminResult = await verifyAdmin(req)
        if ('error' in adminResult) {
          res.status(403).json({
            error: 'out_of_scope',
            message: `${outOfScope.length} of ${requested.length} requested learners are outside your scope. Nothing was returned.`,
          })
          return
        }
      }
    }

    const { data, error } = await svc.rpc('admin_practice_minutes_by_course', { p_learner_ids: learnerIds })
    if (error) {
      console.error('[practice-by-course] rpc failed:', error.message)
      res.status(500).json({ error: 'Failed to load practice minutes' })
      return
    }

    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ practice: data ?? [] })
  } catch (err) {
    console.error('[practice-by-course] error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s) } catch { return null }
}
