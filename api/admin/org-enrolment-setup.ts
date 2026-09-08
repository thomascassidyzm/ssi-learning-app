/**
 * Stand an org's enrolment up — POST /api/admin/org-enrolment-setup
 * =================================================================
 *
 * The switchover, in one call, on whatever day it turns out to be.
 *
 * Kai has NOT named a date. So nothing here is scheduled and nothing is
 * hardcoded: this endpoint creates (or finds) the org's group node, mints THE
 * ONE sign-up link if it does not have one, and writes the enrolment policy —
 * the consent wording, the free-period length, the warning lead time, the
 * dialect family map. Run it on the morning of the switchover and the org and
 * its export exist that afternoon.
 *
 * ONE LINK. This endpoint mints exactly one student code per org and returns
 * the same one on every subsequent call. The old system's second under-25 link
 * is the specific thing being designed out — age is a tick on the enrolment
 * page, not a choice of URL — so there is deliberately no parameter here that
 * would produce a second cohort link.
 *
 * Idempotent throughout: run it twice and nothing doubles. That matters
 * because the person running it on switchover morning will not be certain
 * whether it already ran.
 *
 * ssi_admin only.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { applyCors } from '../_utils/cors'
import { verifyAdmin } from '../_utils/auth'
import { generateCodeForType } from '../_utils/codeGen'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

/**
 * The Welsh dialect families, and the codes that belong to each.
 *
 * The live estate has already produced stray codes no `courses` row backs
 * (`cym_for_eng_north`, `cym_for_eng`) and carries a Northern rebuild
 * (`cym_nnew_for_eng`) that must join the Northern total rather than stand as
 * a third family. This is the DEFAULT written into the policy row; it is data
 * from that moment on, and the export names anything it has never heard of
 * rather than dropping it silently.
 */
export const WELSH_DIALECT_FAMILIES: Record<string, string> = {
  cym_s_for_eng: 'welsh_south',
  cym_n_for_eng: 'welsh_north',
  cym_nnew_for_eng: 'welsh_north',
  cym_for_eng_north: 'welsh_north',
  cym_for_eng: 'welsh_south',
}

/**
 * WHAT THE FREE YEAR ACTUALLY UNLOCKS — and it is NOT the same list as the
 * dialect map above.
 *
 * The dialect map is a REPORTING concern: it must name every code a learner's
 * minutes could have been logged against, dead and legacy ones included, or
 * the export silently under-counts. Entitlement is the opposite: it must name
 * only what we mean to give away.
 *
 * Verified against the live courses table on 2026-09-08: exactly two Welsh
 * courses are released and live in this app — `cym_n_for_eng` (North Welsh for
 * English Speakers) and `cym_s_for_eng` (South Welsh for English Speakers),
 * both premium. `cym_nnew_for_eng` is a draft rebuild and `cym_for_yor` is a
 * draft, so neither is granted; both are still in the dialect map above so
 * that if one goes live mid-year its minutes still count.
 *
 * KAI TO CONFIRM these are the two he means. Changing them is an UPDATE to the
 * policy row, not a deploy.
 */
export const WELSH_GRANTED_COURSES = ['cym_n_for_eng', 'cym_s_for_eng']

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'POST' })) return
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server configuration error' })
    return
  }
  const admin = await verifyAdmin(req)
  if ('error' in admin) {
    res.status(admin.status).json({ error: admin.error })
    return
  }

  const body = (req.body || {}) as Record<string, any>
  const orgName = String(body.orgName || '').trim()
  const consentStatement = String(body.consentStatement || '').trim()
  if (!orgName || !consentStatement) {
    res.status(400).json({ error: 'orgName and consentStatement are required' })
    return
  }

  // NO CAP, AND NO WAY TO ASK FOR ONE. The old system's sign-up link had a
  // hard maximum and it was hit when a cohort arrived together. Refusing the
  // parameter outright is louder than ignoring it: whoever tried to set one
  // finds out immediately, rather than discovering at 9am on intake day.
  if (body.maxUses !== undefined && body.maxUses !== null) {
    res.status(400).json({
      error:
        'Enrolment links are uncapped by design — the old system\'s cap was hit by a cohort arriving at once. Remove maxUses.',
    })
    return
  }

  // HOW LONG THE LINK LIVES, as data. Absent means it never expires, which is
  // "leave it up all year". A timestamp is "refresh it each year". Kai has not
  // settled which the Canolfan wants, so this endpoint supports both and
  // assumes neither.
  const linkExpiresAt = body.linkExpiresAt ? new Date(String(body.linkExpiresAt)) : null
  if (linkExpiresAt && Number.isNaN(linkExpiresAt.getTime())) {
    res.status(400).json({ error: 'linkExpiresAt must be a date' })
    return
  }
  const rotateLink = body.rotateLink === true

  const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // ── The org node ───────────────────────────────────────────────────────
    let groupId = String(body.groupId || '').trim() || null
    if (!groupId) {
      const { data: existing } = await supabase
        .from('groups')
        .select('id')
        .eq('name', orgName)
        .eq('type', 'organisation')
        .maybeSingle()
      groupId = (existing as any)?.id ?? null
    }
    if (!groupId) {
      const { data: created, error: groupErr } = await supabase
        .from('groups')
        .insert({ name: orgName, type: 'organisation', name_confirmed: true })
        .select('id')
        .single()
      if (groupErr || !created) {
        console.error('[org-enrolment-setup] group create failed:', groupErr)
        res.status(500).json({ error: 'Could not create the organisation' })
        return
      }
      groupId = (created as any).id as string
    }

    // ── THE ONE LINK ───────────────────────────────────────────────────────
    //
    // One active student code per org, ever. `rotateLink` is the year-to-year
    // refresh: it retires the current one and mints a successor, so there is
    // still exactly one live link and the old one stops working rather than
    // quietly running a second cohort alongside the new. Everyone who already
    // enrolled through the retired code keeps their enrolment — the code is a
    // door, not the membership.
    const { data: existingCode } = await supabase
      .from('invite_codes')
      .select('id, code')
      .eq('code_type', 'student')
      .eq('grants_group_id', groupId)
      .eq('is_active', true)
      .maybeSingle()

    let rotatedFrom: string | null = null
    if (rotateLink && existingCode) {
      await supabase.from('invite_codes').update({ is_active: false }).eq('id', (existingCode as any).id)
      rotatedFrom = (existingCode as any).code
    }

    let code = rotateLink ? undefined : ((existingCode as any)?.code as string | undefined)
    let codeId = rotateLink ? undefined : ((existingCode as any)?.id as string | undefined)
    if (!code) {
      const minted = generateCodeForType('student')
      const { data: inserted, error: codeErr } = await supabase
        .from('invite_codes')
        .insert({
          code: minted,
          code_type: 'student',
          grants_group_id: groupId,
          created_by: admin.userId,
          // Set explicitly rather than left to the column default: the
          // re-read above filters on it, and a lookup that depends on a
          // default is a lookup that breaks quietly if the default moves.
          is_active: true,
          // Uncapped, always. On the old system this cap existed, was reached,
          // and locked out the tail of a cohort that had all arrived together.
          max_uses: null,
          // Unexpiring unless somebody asks for an expiry — data, not a
          // constant, because "all year" and "a fresh link each year" are both
          // still on the table.
          expires_at: linkExpiresAt ? linkExpiresAt.toISOString() : null,
          metadata: { organization_name: orgName, purpose: 'org-enrolment' },
        })
        .select('id, code')
        .single()
      if (codeErr || !inserted) {
        console.error('[org-enrolment-setup] code mint failed:', codeErr)
        res.status(500).json({ error: 'Could not mint the sign-up link' })
        return
      }
      code = (inserted as any).code
      codeId = (inserted as any).id
    }

    // ── The policy ─────────────────────────────────────────────────────────
    const policy = {
      group_id: groupId,
      org_display_name: orgName,
      consent_statement: consentStatement,
      consent_version: String(body.consentVersion || 'v1'),
      ask_age_band: body.askAgeBand !== false,
      age_band_label: String(body.ageBandLabel || 'I am aged 16 to 24'),
      free_months: Number(body.freeMonths ?? 12),
      warn_days_before: Number(body.warnDaysBefore ?? 21),
      course_family_map: body.courseFamilyMap ?? WELSH_DIALECT_FAMILIES,
      // Exactly the two live Welsh courses, NOT every code in the dialect map —
      // see WELSH_GRANTED_COURSES on why those two lists are different things.
      granted_courses: body.grantedCourses ?? WELSH_GRANTED_COURSES,
      link_expires_at: linkExpiresAt ? linkExpiresAt.toISOString() : null,
      is_active: true,
      updated_at: new Date().toISOString(),
    }
    const { error: policyErr } = await supabase
      .from('org_enrolment_policies')
      .upsert(policy, { onConflict: 'group_id' })
    if (policyErr) {
      console.error('[org-enrolment-setup] policy upsert failed:', policyErr)
      res.status(500).json({ error: 'Could not write the enrolment policy' })
      return
    }

    res.status(200).json({
      success: true,
      groupId,
      orgName,
      code,
      codeId,
      rotatedFrom,
      // The link to hand out. One, and only one.
      signupUrl: `https://saysomethingin.app/enrol/${code}`,
      exportUrl: `/api/org/funder-export?groupId=${groupId}`,
      policy,
    })
  } catch (error: any) {
    console.error('[org-enrolment-setup] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}
