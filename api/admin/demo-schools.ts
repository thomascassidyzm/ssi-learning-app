/**
 * Demo Schools API - /api/admin/demo-schools
 *
 * Self-serve "Create demo school" tool (owner: Nick, Head of Partnerships).
 * Lets any ssi_admin provision a full showcase org for a prospect — real
 * accounts, real classes, realistic seeded activity (api/_utils/demoSchoolGen.ts)
 * — without engineering help, and tear it down cleanly afterwards.
 *
 * GET                        — list demo orgs (most recent first)
 * POST { action: 'create', prospectName, orgShape, courseCode, numSchools?,
 *        teachersPerSchool?, classesPerSchool?, learnersPerSchool? }
 *   — provisions the org; returns the full result including staff
 *     credentials (email + one-time password — shown once, never persisted).
 * POST { action: 'expire', id }
 *   — clean teardown: bans every staff auth account created for this org
 *     (Supabase ban_duration, not a delete — reversible) and marks the
 *     demo_orgs row 'expired'. Learner rows are synthetic (never signed in)
 *     and need no teardown.
 * POST { action: 'extend', id, days? }
 *   — pushes expires_at out (default +30 days).
 * POST { action: 'purge', id }
 *   — one-way hard delete: removes every row this tool created (schools,
 *     classes, learners incl. class-entity, progress/session data, invite
 *     codes) and hard-deletes staff auth accounts. Requires the org to
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
import { provisionDemoOrg, type OrgShape } from '../_utils/demoSchoolGen'
import { purgeDemoOrg } from '../_utils/demoSchoolTeardown'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const RATE_WINDOW_MS = 60 * 60 * 1000
const PER_ADMIN_CREATE_LIMIT = 10
const ORG_SHAPES: OrgShape[] = ['single_school', 'group', 'government_region']
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
    const { prospectName, orgShape, courseCode, numSchools, teachersPerSchool, classesPerSchool, learnersPerSchool } = req.body || {}

    if (!prospectName || typeof prospectName !== 'string' || !prospectName.trim()) {
      res.status(400).json({ error: 'prospectName is required' })
      return
    }
    if (!ORG_SHAPES.includes(orgShape)) {
      res.status(400).json({ error: `orgShape must be one of ${ORG_SHAPES.join(', ')}` })
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
        orgShape,
        courseCode,
        numSchools: numSchools ? Number(numSchools) : undefined,
        teachersPerSchool: teachersPerSchool ? Number(teachersPerSchool) : undefined,
        classesPerSchool: classesPerSchool ? Number(classesPerSchool) : undefined,
        learnersPerSchool: learnersPerSchool ? Number(learnersPerSchool) : undefined,
        createdBy: admin.userId,
      })

      try {
        await supabase.from('player_events').insert({
          occurred_at: new Date().toISOString(),
          event_type: 'admin_demo_school_created',
          payload: { actor_user_id: admin.userId, prospect_name: result.orgName, demo_org_id: result.demoOrgId, org_shape: result.orgShape },
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
        .select('id, prospect_name, status, metadata')
        .eq('id', id)
        .maybeSingle()
      if (fetchErr) throw fetchErr
      if (!org) {
        res.status(404).json({ error: 'Demo org not found' })
        return
      }

      const staffLearnerIds: string[] = ((org.metadata as any)?.staff || []).map((s: any) => s.learnerId).filter(Boolean)
      if (staffLearnerIds.length) {
        const { data: learners } = await supabase.from('learners').select('user_id').in('id', staffLearnerIds)
        for (const l of learners || []) {
          try {
            await supabase.auth.admin.updateUserById(l.user_id as string, { ban_duration: BAN_DURATION })
          } catch (banErr) {
            console.warn('[DemoSchools] ban failed for', l.user_id, banErr)
          }
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
        .select('id, expires_at, status, metadata')
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
      // Nick with a live-looking org nobody can sign into.
      if (org.status === 'expired') {
        const staffLearnerIds: string[] = ((org.metadata as any)?.staff || []).map((s: any) => s.learnerId).filter(Boolean)
        if (staffLearnerIds.length) {
          const { data: learners } = await supabase.from('learners').select('user_id').in('id', staffLearnerIds)
          for (const l of learners || []) {
            try {
              await supabase.auth.admin.updateUserById(l.user_id as string, { ban_duration: 'none' })
            } catch (unbanErr) {
              console.warn('[DemoSchools] unban failed for', l.user_id, unbanErr)
            }
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

  res.status(400).json({ error: "action must be 'create', 'expire', 'extend', or 'purge'" })
}
