/**
 * Demo Schools API - /api/admin/demo-schools (backs the "Demos" admin page)
 *
 * Self-serve demo-org tool (owner: Nick, Head of Partnerships). Lets any
 * ssi_admin provision an arbitrary-depth group hierarchy for a prospect —
 * NO teachers/classes/students anywhere in this flow (2026-07-17 spec) — and
 * tear it down cleanly afterwards. Growing the tree after creation (sub-
 * groups, more joinable leaves) goes through api/admin/demo-leaf.ts and the
 * shared /api/groups endpoints, not this file.
 *
 * GET                        — list demo orgs (most recent first)
 * POST { action: 'create', prospectName, courseCode }
 *   — provisions the root organisation group + its first joinable leaf
 *     (a hidden class the UI never names); returns the org plus that leaf's
 *     student join code.
 * POST { action: 'expire', id }
 *   — clean teardown: bans every staff auth account created for this org
 *     (Supabase ban_duration, not a delete — reversible; legacy pre-2026-07-17
 *     orgs may still carry seeded staff) and marks the demo_orgs row
 *     'expired'.
 * POST { action: 'extend', id, days? }
 *   — pushes expires_at out (default +30 days).
 * POST { action: 'refresh', id }
 *   — legacy-only: tops up seeded staff/student activity on a pre-2026-07-17
 *     org. New Demos orgs have no seeded activity to refresh (a no-op).
 *     See api/_utils/demoSchoolRefresh.ts.
 * POST { action: 'purge', id }
 *   — one-way hard delete: removes every row this tool created (schools,
 *     classes, learners incl. class-entity, progress/session data, invite
 *     codes) and hard-deletes any staff auth accounts. Requires the org to
 *     already be 'expired' — expire first, purge once you're sure. See
 *     api/_utils/demoSchoolTeardown.ts.
 *
 * Admin-gated (verifyAdmin), rate-limited on create, audit-logged to
 * player_events on every create/expire (who, when, prospect name) — same
 * idiom as api/admin/create-signin-link.ts and api/admin/board-snapshot.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAdmin } from '../_utils/auth'
import { provisionDemoOrg } from '../_utils/demoSchoolGen'
import { purgeDemoOrg } from '../_utils/demoSchoolTeardown'
import { refreshDemoOrgActivity } from '../_utils/demoSchoolRefresh'
import { discoverDemoOrgGraph } from '../_utils/demoSchoolGraph'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const RATE_WINDOW_MS = 60 * 60 * 1000
const PER_ADMIN_CREATE_LIMIT = 10
const DEFAULT_EXTEND_DAYS = 30
// Long ban, not a delete — expiry is a reversible teardown, matching the
// "extendable" requirement (an admin can un-expire by re-extending later).
const BAN_DURATION = '87600h' // ~10 years

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('demo_orgs')
        .select('id, created_at, created_by, prospect_name, org_shape, course_code, group_id, school_id, expires_at, status, expired_at, metadata')
        .order('created_at', { ascending: false })
      if (error) throw error
      res.status(200).json({ orgs: data ?? [] })
    } catch (error: any) {
      console.error('[DemoSchools] List error:', error)
      res.status(500).json({ error: error?.message || 'Internal server error' })
    }
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { action } = req.body || {}

  if (action === 'create') {
    const { prospectName, courseCode } = req.body || {}

    if (!prospectName || typeof prospectName !== 'string' || !prospectName.trim()) {
      res.status(400).json({ error: 'prospectName is required' })
      return
    }
    if (!courseCode || typeof courseCode !== 'string') {
      res.status(400).json({ error: 'courseCode is required' })
      return
    }

    try {
      const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString()
      const { count: recentCount, error: rateErr } = await supabase
        .from('player_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'admin_demo_school_created')
        .gte('occurred_at', cutoff)
        .contains('payload', { actor_user_id: admin.userId })
      if (rateErr) {
        console.warn('[DemoSchools] rate-limit check failed (failing open):', rateErr.message)
      } else if ((recentCount ?? 0) >= PER_ADMIN_CREATE_LIMIT) {
        res.status(429).json({ error: 'Too many demo schools created recently. Please wait a while.' })
        return
      }

      const result = await provisionDemoOrg(supabase, {
        prospectName: prospectName.trim(),
        courseCode,
        createdBy: admin.userId,
      })

      try {
        await supabase.from('player_events').insert({
          occurred_at: new Date().toISOString(),
          event_type: 'admin_demo_school_created',
          payload: { actor_user_id: admin.userId, prospect_name: result.orgName, demo_org_id: result.demoOrgId },
        })
      } catch (auditErr) {
        console.warn('[DemoSchools] audit insert threw:', auditErr)
      }

      res.status(201).json({ org: result })
    } catch (error: any) {
      console.error('[DemoSchools] Create error:', error)
      res.status(500).json({ error: error?.message || 'Failed to create demo school' })
    }
    return
  }

  if (action === 'expire') {
    const { id } = req.body || {}
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'id is required' })
      return
    }
    try {
      const { data: org, error: fetchErr } = await supabase
        .from('demo_orgs')
        .select('id, prospect_name, status, metadata, group_id, school_id')
        .eq('id', id)
        .maybeSingle()
      if (fetchErr) throw fetchErr
      if (!org) {
        res.status(404).json({ error: 'Demo org not found' })
        return
      }

      // Union the graph discovered NOW (covers schools/classes a real member
      // created themselves after the org was seeded/adopted — containment,
      // not just the originally-seeded rows) with the static metadata.staff
      // snapshot (belt-and-braces for any staff the graph walk can't reach,
      // e.g. a school whose group_id got cleared).
      const graph = await discoverDemoOrgGraph(supabase, org)
      const metadataStaffLearnerIds: string[] = ((org.metadata as any)?.staff || []).map((s: any) => s.learnerId).filter(Boolean)
      const { data: metadataStaffLearners } = metadataStaffLearnerIds.length
        ? await supabase.from('learners').select('user_id').in('id', metadataStaffLearnerIds)
        : { data: [] as { user_id: string }[] }
      const staffAuthUids = [...new Set([
        ...graph.staffAuthUids,
        ...((metadataStaffLearners || []).map((l) => l.user_id as string).filter(Boolean)),
      ])]
      for (const uid of staffAuthUids) {
        try {
          await supabase.auth.admin.updateUserById(uid, { ban_duration: BAN_DURATION })
        } catch (banErr) {
          console.warn('[DemoSchools] ban failed for', uid, banErr)
        }
      }

      const { error: updateErr } = await supabase
        .from('demo_orgs')
        .update({ status: 'expired', expired_at: new Date().toISOString() })
        .eq('id', id)
      if (updateErr) throw updateErr

      try {
        await supabase.from('player_events').insert({
          occurred_at: new Date().toISOString(),
          event_type: 'admin_demo_school_expired',
          payload: { actor_user_id: admin.userId, prospect_name: org.prospect_name, demo_org_id: id },
        })
      } catch (auditErr) {
        console.warn('[DemoSchools] audit insert threw:', auditErr)
      }

      res.status(200).json({ success: true })
    } catch (error: any) {
      console.error('[DemoSchools] Expire error:', error)
      res.status(500).json({ error: error?.message || 'Failed to expire demo org' })
    }
    return
  }

  if (action === 'extend') {
    const { id, days } = req.body || {}
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'id is required' })
      return
    }
    try {
      const { data: org, error: fetchErr } = await supabase
        .from('demo_orgs')
        .select('id, expires_at, status, metadata, group_id, school_id')
        .eq('id', id)
        .maybeSingle()
      if (fetchErr) throw fetchErr
      if (!org) {
        res.status(404).json({ error: 'Demo org not found' })
        return
      }
      const base = Math.max(new Date(org.expires_at).getTime(), Date.now())
      const extendDays = days ? Number(days) : DEFAULT_EXTEND_DAYS
      const newExpiresAt = new Date(base + extendDays * 86400000).toISOString()

      // Reviving a previously-expired org: un-ban its staff accounts so the
      // showcase actually works again — extending the date alone would leave
      // Nick with a live-looking org nobody can sign into. Same graph union
      // as expire, so a member-created school's staff get un-banned too.
      if (org.status === 'expired') {
        const graph = await discoverDemoOrgGraph(supabase, org)
        const metadataStaffLearnerIds: string[] = ((org.metadata as any)?.staff || []).map((s: any) => s.learnerId).filter(Boolean)
        const { data: metadataStaffLearners } = metadataStaffLearnerIds.length
          ? await supabase.from('learners').select('user_id').in('id', metadataStaffLearnerIds)
          : { data: [] as { user_id: string }[] }
        const staffAuthUids = [...new Set([
          ...graph.staffAuthUids,
          ...((metadataStaffLearners || []).map((l) => l.user_id as string).filter(Boolean)),
        ])]
        for (const uid of staffAuthUids) {
          try {
            await supabase.auth.admin.updateUserById(uid, { ban_duration: 'none' })
          } catch (unbanErr) {
            console.warn('[DemoSchools] unban failed for', uid, unbanErr)
          }
        }
      }

      const { error: updateErr } = await supabase
        .from('demo_orgs')
        .update({ expires_at: newExpiresAt, status: 'active', expired_at: null })
        .eq('id', id)
      if (updateErr) throw updateErr

      res.status(200).json({ success: true, expires_at: newExpiresAt })
    } catch (error: any) {
      console.error('[DemoSchools] Extend error:', error)
      res.status(500).json({ error: error?.message || 'Failed to extend demo org' })
    }
    return
  }

  if (action === 'purge') {
    const { id } = req.body || {}
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'id is required' })
      return
    }
    try {
      const result = await purgeDemoOrg(supabase, id)

      try {
        await supabase.from('player_events').insert({
          occurred_at: new Date().toISOString(),
          event_type: 'admin_demo_school_purged',
          payload: { actor_user_id: admin.userId, prospect_name: result.prospectName, demo_org_id: id, ...result },
        })
      } catch (auditErr) {
        console.warn('[DemoSchools] audit insert threw:', auditErr)
      }

      res.status(200).json({ success: true, ...result })
    } catch (error: any) {
      console.error('[DemoSchools] Purge error:', error)
      res.status(500).json({ error: error?.message || 'Failed to purge demo org' })
    }
    return
  }

  if (action === 'refresh') {
    const { id } = req.body || {}
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'id is required' })
      return
    }
    try {
      const result = await refreshDemoOrgActivity(supabase, id, admin.userId)
      res.status(200).json({ success: true, ...result })
    } catch (error: any) {
      console.error('[DemoSchools] Refresh error:', error)
      res.status(500).json({ error: error?.message || 'Failed to refresh demo org activity' })
    }
    return
  }

  res.status(400).json({ error: "action must be 'create', 'expire', 'extend', 'refresh', or 'purge'" })
}
