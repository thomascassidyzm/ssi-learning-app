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
    const { data: existingCode } = await supabase
      .from('invite_codes')
      .select('id, code')
      .eq('code_type', 'student')
      .eq('grants_group_id', groupId)
      .eq('is_active', true)
      .maybeSingle()

    let code = (existingCode as any)?.code as string | undefined
    let codeId = (existingCode as any)?.id as string | undefined
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
          // Uncapped and unexpiring by default: a cohort of thousands arrives
          // over weeks, and a link that runs out mid-intake is the failure
          // this whole build exists to avoid.
          max_uses: null,
          expires_at: null,
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
      granted_courses: body.grantedCourses ?? Object.keys(WELSH_DIALECT_FAMILIES),
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
