/**
 * /api/lab/verdicts — the Insights display lab's verdict door (job #26).
 *
 * Tom taps like / unsure / no against each of a dozen renderings of the same
 * rate-compare series on /admin/insights-lab, and those taps decide what the
 * teacher and leader Insights views draw next. The client writes each verdict
 * to its own browser FIRST, then offers it here, and never clears the local
 * copy until this route has answered with the id (the Zenjin taste-verdict
 * store pattern). The table is keyed on the client's uuid with duplicates
 * ignored, so a retried POST is a no-op, never a double.
 *
 *   POST  { verdicts: LabVerdict[] }  → { ok, ids: string[] }   (ids now held)
 *   GET   → { verdicts: LabVerdict[] } newest first, for the room that reads them
 *
 * ssi_admin only, both ways. Append-only: no update, no delete, anywhere.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { applyCors } from '../_utils/cors'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const VERDICTS = new Set(['like', 'unsure', 'no'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface LabVerdictIn {
  id: string
  madeAt: string
  rendering: string
  verdict: 'like' | 'unsure' | 'no'
  note?: string | null
  entityId: string
  entityLabel?: string | null
  compareTo: string
  compareLabel?: string | null
  metric: string
  window: string
  weekLabel?: string | null
  build?: string | null
  screen?: Record<string, unknown> | null
}

function str(v: unknown, max = 400): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null
}

/** One verdict as the table wants it, or null if the body is not one. */
export function toRow(v: unknown, adminUserId: string): Record<string, unknown> | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const id = str(o.id)
  const rendering = str(o.rendering, 80)
  const verdict = str(o.verdict, 10)
  const entityId = str(o.entityId, 120)
  const compareTo = str(o.compareTo, 120)
  const metric = str(o.metric, 40)
  const window = str(o.window, 40)
  if (!id || !UUID.test(id) || !rendering || !verdict || !VERDICTS.has(verdict)) return null
  if (!entityId || !compareTo || !metric || !window) return null
  const madeAt = str(o.madeAt, 40)
  const madeMs = madeAt ? Date.parse(madeAt) : NaN
  return {
    id: id.toLowerCase(),
    made_at: Number.isFinite(madeMs) ? new Date(madeMs).toISOString() : new Date().toISOString(),
    admin_user_id: adminUserId,
    rendering,
    verdict,
    note: str(o.note, 4000),
    entity_id: entityId,
    entity_label: str(o.entityLabel, 200),
    compare_to: compareTo,
    compare_label: str(o.compareLabel, 200),
    metric,
    window_id: window,
    week_label: str(o.weekLabel, 80),
    build: str(o.build, 80),
    screen: o.screen && typeof o.screen === 'object' ? o.screen : null,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET, POST' })) return

  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(503).json({ error: 'Verdict store not configured' })
    return
  }
  const svc = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    const { data, error } = await svc
      .from('insights_lab_verdicts')
      .select('*')
      .order('made_at', { ascending: false })
      .limit(2000)
    if (error) {
      res.status(500).json({ error: `Could not read verdicts (${error.message})` })
      return
    }
    res.status(200).json({ verdicts: data ?? [] })
    return
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as { verdicts?: unknown }
    const list = Array.isArray(body.verdicts) ? body.verdicts : []
    const rows = list.map((v) => toRow(v, admin.userId)).filter((r): r is Record<string, unknown> => r !== null)
    if (rows.length === 0) {
      res.status(400).json({ error: 'No well-formed verdicts in the body' })
      return
    }
    const { error } = await svc
      .from('insights_lab_verdicts')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) {
      res.status(500).json({ error: `Could not store verdicts (${error.message})` })
      return
    }
    res.status(200).json({ ok: true, ids: rows.map((r) => r.id as string) })
    return
  }

  res.status(405).json({ error: 'Method not allowed' })
}
