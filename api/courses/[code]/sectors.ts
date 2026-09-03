/**
 * Sector registry for a base course — GET /api/courses/:code/sectors
 *
 * Public (no auth), same shape of route as api/courses/available.ts. `code` is
 * the BASE course code (e.g. spa_for_eng); the answer is the sector segments
 * registered against it in `course_sectors`.
 *
 * WHY THIS ENDPOINT EXISTS AT ALL: `course_sectors` is service-role-only (RLS
 * on, no policies, anon/authenticated revoked), so the browser can never read
 * it directly. Every read goes through here, holding the service key.
 *
 * THE HELIX IS ABOUT IMMEDIACY: a sector segment runs ALONGSIDE the core
 * course, so the picker has to be able to say WHEN it opens in the learner's
 * own words. That is what `anchor` is for — the segment's declared core anchor
 * lego, resolved from the BASE course's own rows into its known/target text so
 * the UI can render "opens after —" as CONTENT in both languages. No numbers,
 * never the words "seed" or "lego" (position is the highest LEGO played,
 * displayed as its own content). An anchor that will not resolve comes back
 * `null` — never a guess.
 *
 * Only status='live' segments are offered; `?include=draft` also returns
 * drafts, for QA only. A draft segment has no content yet and must never be
 * offered to a learner.
 *
 * AN EMPTY LIST IS THE CORRECT ANSWER for an unknown course code or a course
 * with no registry rows — 200 with `{ sectors: [] }`, not a 404, not an error.
 * The modal's walk list is expected to be empty until segments are registered.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors } from '../../_utils/cors'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

export interface SectorAnchor {
  legoId: string
  known: string
  target: string
}

export interface SectorOption {
  slug: string
  sectorCourseCode: string
  roles: string[]
  status: 'draft' | 'live'
  anchor: SectorAnchor | null
}

/**
 * `roles` comes from the row's jsonb, with 'general' first if present —
 * general is the default role and the strict subset every other role extends.
 * Anything that isn't a list of strings degrades to ['general'] rather than
 * shipping a malformed picker.
 */
export function normaliseRoles(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string' && r.length > 0) : []
  const unique = Array.from(new Set(list))
  if (unique.length === 0) return ['general']
  const rest = unique.filter((r) => r !== 'general')
  return unique.includes('general') ? ['general', ...rest] : rest
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Cross-origin (native shell) policy + preflight. No-op same-origin.
  if (applyCors(req, res, { methods: 'GET' })) return

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const raw = req.query.code
  const baseCourseCode = (Array.isArray(raw) ? raw[0] : raw || '').trim()
  if (!baseCourseCode) {
    res.status(400).json({ error: 'Missing course code' })
    return
  }

  const includeParam = req.query.include
  const include = Array.isArray(includeParam) ? includeParam[0] : includeParam
  const includeDraft = include === 'draft'

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    let query = supabase
      .from('course_sectors')
      .select('sector_slug, sector_course_code, roles, core_anchor_lego_id, status')
      .eq('base_course_code', baseCourseCode)
      .order('sector_slug')

    if (!includeDraft) query = query.eq('status', 'live')

    const { data, error } = await query

    if (error) {
      console.error('[courses/sectors] Registry query failed:', error)
      res.status(500).json({ error: error.message })
      return
    }

    const rows = data ?? []
    if (rows.length === 0) {
      // The correct answer for an unknown course, or one with nothing
      // registered yet. The shell ships before the registrations do.
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
      res.status(200).json({ sectors: [] })
      return
    }

    // Resolve every declared anchor from the BASE course's own legos in one
    // query — lego_id is unique only WITHIN a course, so the lookup is scoped
    // by base_course_code.
    const anchorIds = Array.from(
      new Set(rows.map((r: any) => r.core_anchor_lego_id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))
    )
    const anchorsById = new Map<string, SectorAnchor>()
    if (anchorIds.length > 0) {
      const { data: legos, error: legoError } = await supabase
        .from('course_legos')
        .select('lego_id, known_text, target_text')
        .eq('course_code', baseCourseCode)
        .in('lego_id', anchorIds)
      if (legoError) {
        // An unresolvable anchor is `null`, never a guess and never a 500 —
        // the picker still lists the walk, it just can't say when it opens.
        console.error('[courses/sectors] Anchor lookup failed:', legoError)
      }
      for (const lego of legos ?? []) {
        const l: any = lego
        if (typeof l.known_text === 'string' && typeof l.target_text === 'string') {
          anchorsById.set(l.lego_id, { legoId: l.lego_id, known: l.known_text, target: l.target_text })
        }
      }
    }

    const sectors: SectorOption[] = rows.map((r: any) => ({
      slug: r.sector_slug,
      sectorCourseCode: r.sector_course_code,
      roles: normaliseRoles(r.roles),
      status: r.status === 'live' ? 'live' : 'draft',
      anchor: anchorsById.get(r.core_anchor_lego_id) ?? null,
    }))

    // Short cache like api/courses/available.ts — the registry changes rarely.
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300')
    res.status(200).json({ sectors })
  } catch (error: any) {
    console.error('[courses/sectors] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
