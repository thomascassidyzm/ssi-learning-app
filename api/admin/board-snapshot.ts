/**
 * Board Snapshot API - /api/admin/board-snapshot
 *
 * Admin-only. Mints, lists, and revokes frozen board-report snapshots
 * (living-board-report-spec.md §5). Public serving lives at
 * api/board/snapshot/[code].ts — deliberately a different, unauthenticated
 * file, since a leaked share_code must never reach an admin-gated surface.
 *
 * POST { action: 'freeze', label, reportMonth, markdown } — resolves every
 *   {{metric:...}} token in `markdown` against the live board-metrics
 *   registry, hard-fails on any unresolvable token (a snapshot must be
 *   complete or not exist), and inserts one row.
 * POST { action: 'revoke', id } — sets revoked_at; the share link 404s from
 *   that point on (api/board/snapshot/[code].ts checks it).
 * GET  — lists snapshots (no payload — the list view never needs the full doc).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { resolveBoardMetric, type MetricValue } from '../_utils/boardMetrics'
import { generateShareCode } from '../_utils/codeGen'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const METRIC_TOKEN_RE = /\{\{metric:([a-zA-Z0-9_.]+)\}\}/g

function extractMetricSlugs(markdown: string): string[] {
  const slugs = new Set<string>()
  METRIC_TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = METRIC_TOKEN_RE.exec(markdown))) {
    slugs.add(match[1])
  }
  return Array.from(slugs)
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('board_snapshots')
        .select('id, created_at, label, report_month, share_code, revoked_at, created_by')
        .order('created_at', { ascending: false })
      if (error) throw error
      res.status(200).json({ snapshots: data ?? [] })
    } catch (error: any) {
      console.error('[BoardSnapshot] List error:', error)
      res.status(500).json({ error: error?.message || 'Internal server error' })
    }
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { action } = req.body || {}

  if (action === 'revoke') {
    const { id } = req.body || {}
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'id is required' })
      return
    }
    try {
      const { data, error } = await supabase
        .from('board_snapshots')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) {
        res.status(404).json({ error: 'Snapshot not found' })
        return
      }
      res.status(200).json({ success: true })
    } catch (error: any) {
      console.error('[BoardSnapshot] Revoke error:', error)
      res.status(500).json({ error: error?.message || 'Internal server error' })
    }
    return
  }

  if (action === 'freeze') {
    const { label, reportMonth, markdown } = req.body || {}
    if (!label || typeof label !== 'string' || !label.trim()) {
      res.status(400).json({ error: 'label is required' })
      return
    }
    if (!reportMonth || typeof reportMonth !== 'string') {
      res.status(400).json({ error: 'reportMonth is required' })
      return
    }
    if (!markdown || typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown is required' })
      return
    }

    try {
      const slugs = extractMetricSlugs(markdown)
      const resolved: MetricValue[] = []
      const unresolvable: string[] = []

      for (const slug of slugs) {
        const metric = await resolveBoardMetric(supabase, slug)
        if (!metric) {
          unresolvable.push(slug)
        } else {
          resolved.push(metric)
        }
      }

      // A snapshot must be complete or not exist — same principle as the
      // Cycle refactor. Any unknown token aborts the whole freeze.
      if (unresolvable.length > 0) {
        res.status(422).json({
          error: `Cannot freeze — unresolvable token(s): ${unresolvable.join(', ')}`,
          unresolvable,
        })
        return
      }

      const resolvedMetrics: Record<string, MetricValue> = {}
      for (const m of resolved) resolvedMetrics[m.slug] = m

      const frozenAt = new Date().toISOString()
      const payload = { markdown, resolvedMetrics, frozenAt }

      // Generate a unique share_code (128-bit random — collision is
      // astronomically unlikely, but check anyway rather than trust it blind).
      let shareCode: string | null = null
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateShareCode()
        const { data: existing, error: probeError } = await supabase
          .from('board_snapshots')
          .select('id')
          .eq('share_code', candidate)
          .maybeSingle()
        if (probeError) continue
        if (!existing) {
          shareCode = candidate
          break
        }
      }
      if (!shareCode) {
        res.status(500).json({ error: 'Could not generate a unique share code, please try again' })
        return
      }

      const { data: created, error: insertError } = await supabase
        .from('board_snapshots')
        .insert({
          label: label.trim(),
          report_month: reportMonth,
          payload,
          share_code: shareCode,
          created_by: admin.userId,
        })
        .select('id, created_at, label, report_month, share_code, revoked_at, created_by')
        .single()

      if (insertError || !created) {
        console.error('[BoardSnapshot] Insert failed:', insertError)
        res.status(500).json({ error: insertError?.message || 'Insert failed' })
        return
      }

      res.status(201).json(created)
    } catch (error: any) {
      console.error('[BoardSnapshot] Freeze error:', error)
      res.status(500).json({ error: error?.message || 'Internal server error' })
    }
    return
  }

  res.status(400).json({ error: "action must be 'freeze' or 'revoke'" })
}
