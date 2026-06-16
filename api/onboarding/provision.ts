/**
 * Onboarding provisioning — POST /api/onboarding/provision
 *
 * Called right after OTP verification (so it runs on a VERIFIED session). It
 * confirms the account AND activates the free trial in one shot:
 *   - ensures a learner row
 *   - grants a TRIAL entitlement for the chosen course (1 year for a minority-
 *     language school, 1 month otherwise) — free access, no payment at signup
 *   - assigns the role: tutor → teachers row (+ a first class); school → the
 *     school_admin role + a school row + a school-level grant so students cascade
 *
 * Idempotent: safe to call more than once (re-verify / retry) — it never
 * double-grants or double-creates. Price/trial is decided SERVER-SIDE from the
 * track + the course's live status; the client choice is never trusted blindly.
 *
 * Body: { track: 'school' | 'tutor', course_code }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const TRACKS = new Set(['school', 'tutor'])
// Premium courses get a free trial then convert to paid; Free/Community are free.
const PREMIUM_TRIAL_DAYS = 30

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }

  const { track, course_code } = req.body || {}
  if (!TRACKS.has(track)) {
    res.status(400).json({ error: 'Invalid track' })
    return
  }
  if (!course_code || typeof course_code !== 'string') {
    res.status(400).json({ error: 'course_code is required' })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // 1. Validate the course is genuinely DEPLOYED (live OR beta — mirroring the
    //    in-app catalogue in App.vue) and matches the track. Never trust the
    //    client to pick a not_available/draft or wrong-track course.
    const { data: course, error: courseErr } = await supabase
      .from('courses')
      .select('course_code, pricing_tier, new_app_status')
      .eq('course_code', course_code)
      .maybeSingle()
    if (courseErr) throw new Error(`course lookup failed: ${courseErr.message}`)
    if (!course || !['live', 'beta'].includes(course.new_app_status)) {
      res.status(400).json({ error: 'That course is not available yet' })
      return
    }
    // The OFFER is the course's tier: Free/Community = free (no grant needed — free
    // courses are already accessible to everyone); Premium = a free trial then paid.
    const isFree = course.pricing_tier === 'free' || course.pricing_tier === 'community'

    // 2. Ensure a learner row.
    let { data: learner } = await supabase
      .from('learners')
      .select('id, display_name, educational_role')
      .eq('user_id', auth.userId)
      .maybeSingle()

    if (!learner) {
      const { data: authUser } = await supabase.auth.admin.getUserById(auth.userId)
      const fallbackName = authUser?.user?.email?.split('@')[0] || 'Learner'
      const { data: created, error: createErr } = await supabase
        .from('learners')
        .insert({ user_id: auth.userId, display_name: fallbackName })
        .select('id, display_name, educational_role')
        .single()
      if (createErr) {
        if (createErr.code === '23505') {
          // Raced with the client's own ensureLearnerExists (both fire on SIGNED_IN);
          // UNIQUE(user_id) means the row now exists — re-fetch instead of failing.
          const { data: again } = await supabase
            .from('learners')
            .select('id, display_name, educational_role')
            .eq('user_id', auth.userId)
            .maybeSingle()
          if (!again) throw new Error('learner create raced and re-fetch failed')
          learner = again
        } else {
          throw new Error(`learner create failed: ${createErr.message}`)
        }
      } else if (!created) {
        throw new Error('learner create returned no row')
      } else {
        learner = created
      }
    }

    // 3. Access. Free/Community courses are already accessible to everyone, so no
    //    grant is needed. Premium courses get a free trial entitlement, capped so a
    //    single OTP'd account can't farm a trial for the whole premium catalogue.
    let expiresAt: string | null = null
    if (!isFree) {
      expiresAt = new Date(Date.now() + PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const SELF_SERVICE_TRIAL_CAP = 3
      const { data: existingEnts } = await supabase
        .from('user_entitlements')
        .select('id, granted_courses, expires_at')
        .eq('learner_id', learner.id)
        .is('entitlement_code_id', null)
        .is('email_access_grant_id', null)
      const nowMs = Date.now()
      const activeTrialCourses = new Set<string>()
      for (const e of existingEnts || []) {
        const active = !e.expires_at || new Date(e.expires_at).getTime() > nowMs
        if (active && Array.isArray(e.granted_courses)) {
          for (const cc of e.granted_courses) activeTrialCourses.add(cc)
        }
      }
      const alreadyGranted = activeTrialCourses.has(course_code)
      if (!alreadyGranted && activeTrialCourses.size >= SELF_SERVICE_TRIAL_CAP) {
        res.status(409).json({
          error: 'You already have active free trials — get in touch if you need more languages.',
        })
        return
      }
      if (!alreadyGranted) {
        const { error: entErr } = await supabase.from('user_entitlements').insert({
          learner_id: learner.id,
          access_type: 'courses',
          granted_courses: [course_code],
          expires_at: expiresAt,
        })
        if (entErr) throw new Error(`trial grant failed: ${entErr.message}`)
      }
    }

    // 4. Role.
    let role: string
    if (track === 'tutor') {
      role = 'teacher'
      const { data: existingTeacher } = await supabase
        .from('teachers')
        .select('id')
        .eq('learner_id', learner.id)
        .maybeSingle()
      if (!existingTeacher) {
        const { error: tErr } = await supabase.from('teachers').insert({
          learner_id: learner.id,
          display_name: learner.display_name || 'Teacher',
          teaching_languages: [course_code],
        })
        if (tErr) throw new Error(`teacher create failed: ${tErr.message}`)
        // A first class gives them a share link straight away. Non-fatal.
        const { error: clsErr } = await supabase.from('classes').insert({
          teacher_user_id: auth.userId,
          class_name: 'My class',
          course_code,
          school_id: null,
          is_active: true,
        })
        if (clsErr) console.warn('[onboarding/provision] first class failed (non-fatal):', clsErr.message)
      }
    } else {
      role = 'school_admin'
      if (learner.educational_role !== 'school_admin') {
        const { error: roleErr } = await supabase
          .from('learners')
          .update({ educational_role: 'school_admin' })
          .eq('id', learner.id)
        if (roleErr) throw new Error(`role assignment failed: ${roleErr.message}`)
      }
      // Create a school if this admin doesn't have one yet (name set later at CONTINUE).
      const { data: existingSchool } = await supabase
        .from('schools')
        .select('id')
        .eq('admin_user_id', auth.userId)
        .maybeSingle()
      let schoolId = existingSchool?.id
      if (!schoolId) {
        const { data: school, error: sErr } = await supabase
          .from('schools')
          .insert({ admin_user_id: auth.userId, school_name: 'My school' })
          .select('id')
          .single()
        if (sErr || !school) throw new Error(`school create failed: ${sErr?.message}`)
        schoolId = school.id
      }
      // School-level trial grant so a joining student's access cascades — ONLY for
      // Premium courses (free courses are already accessible, no grant needed). Non-fatal.
      if (!isFree) {
        const { data: existingGrants } = await supabase
          .from('entitlement_grants')
          .select('id, granted_courses')
          .eq('school_id', schoolId)
          .eq('is_active', true)
        const grantCovers = (existingGrants || []).some(
          (g: any) => Array.isArray(g.granted_courses) && g.granted_courses.includes(course_code)
        )
        if (!grantCovers) {
          const { error: gErr } = await supabase.from('entitlement_grants').insert({
            school_id: schoolId,
            granted_courses: [course_code],
            granted_by: auth.userId,
            expires_at: expiresAt,
          })
          if (gErr) console.warn('[onboarding/provision] school grant failed (non-fatal):', gErr.message)
        }
      }
    }

    res.status(200).json({
      trial: isFree ? null : { course_code, expires_at: expiresAt, days: PREMIUM_TRIAL_DAYS },
      free: isFree,
      role,
      redirect: track === 'tutor' ? '/teach' : '/schools',
    })
  } catch (error: any) {
    console.error('[onboarding/provision] Error:', error)
    res.status(500).json({ error: error?.message || 'Internal server error' })
  }
}
