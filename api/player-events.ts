/**
 * Player Events Endpoint — batch-insert diagnostic events from the
 * learning player into the player_events table.
 *
 * Frontend buffers events and POSTs in batches (every few seconds).
 * Auth is by the same `ssi-user-id` cookie that audio_plays uses; the
 * server doesn't strictly verify (anyone can spoof) but for diagnostic
 * use that's fine — nobody benefits from injecting fake logs into
 * their own row.
 *
 * Endpoint: POST /api/player-events
 * Body: { events: [{ event_type, payload?, course_code?, session_id?, occurred_at?, client_version? }] }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

interface IncomingEvent {
  event_type: string
  payload?: unknown
  course_code?: string | null
  session_id?: string | null
  occurred_at?: string | null
  client_version?: string | null
}

function getDeviceType(userAgent: string): 'mobile' | 'tablet' | 'desktop' {
  const ua = userAgent.toLowerCase()
  if (/ipad|android(?!.*mobile)|tablet/i.test(ua)) return 'tablet'
  if (/iphone|ipod|android.*mobile|webos|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile'
  return 'desktop'
}

const MAX_BATCH = 50

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'Service role key not configured' })
  }

  const body = req.body as { events?: unknown } | undefined
  const events = Array.isArray(body?.events) ? (body!.events as IncomingEvent[]) : null
  if (!events || events.length === 0) {
    return res.status(400).json({ error: 'events array required' })
  }
  if (events.length > MAX_BATCH) {
    return res.status(400).json({ error: `batch too large (max ${MAX_BATCH})` })
  }

  const userId = (req.cookies?.['ssi-user-id'] as string | undefined) || null
  const deviceType = getDeviceType(req.headers['user-agent'] || '')
  const ipCountry = (req.headers['x-vercel-ip-country'] as string) || null

  const rows = events
    .filter((e) => e && typeof e.event_type === 'string' && e.event_type.length > 0)
    .map((e) => ({
      occurred_at: e.occurred_at || new Date().toISOString(),
      user_id: userId,
      course_code: e.course_code || null,
      session_id: e.session_id || null,
      event_type: e.event_type.slice(0, 64),
      payload: e.payload ?? null,
      client_version: e.client_version || null,
      device_type: deviceType,
      ip_country: ipCountry,
    }))

  if (rows.length === 0) {
    return res.status(400).json({ error: 'no valid events' })
  }

  try {
    const supabase = createClient(supabaseUrl!, supabaseServiceKey)
    const { error } = await supabase.from('player_events').insert(rows)
    if (error) {
      console.warn('[player-events] insert failed:', error.message, error.code)
      return res.status(500).json({ error: error.message })
    }
    return res.status(200).json({ inserted: rows.length })
  } catch (err: any) {
    console.error('[player-events] threw:', err)
    return res.status(500).json({ error: err?.message || 'Internal error' })
  }
}
