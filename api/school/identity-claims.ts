/**
 * Who a school's invite links vouch for — GET/POST/DELETE /api/school/identity-claims
 *
 * The admin-facing half of school identity on the domain (job #371). A
 * school's multi-use teacher and admin links let an arrival straight in when
 * the typed address is one the school vouches for (api/_utils/schoolDomain.ts).
 * This endpoint is where the admin sees and edits that set:
 *
 *   kind='domain'  — an email domain the school lives on. The founding admin's
 *                    own domain is claimed at signup; a school on several
 *                    domains (a merger, a trust) adds the others here. A public
 *                    mail domain is refused, with the reason.
 *   kind='address' — ONE named address let in by hand: the supply teacher for a
 *                    fortnight, the colleague who only has a personal address.
 *                    This is the legitimate non-domain route that is not
 *                    "email support" — the admin who already vouches for that
 *                    person in the staffroom vouches for them here, in one line.
 *
 * Caller-scoped, like api/school/update-profile.ts: the school is resolved
 * from the caller's OWN admin standing (api/_utils/schoolStaff.ts's
 * isSchoolAdminOf, both spellings), never from a body school_id. A teacher is
 * refused with 403; a leader edits through their own org surface, not here.
 * The table is service-role-only, so this route is the only door to it.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { applyCors } from '../_utils/cors'
import { verifyAuthToken } from '../_utils/auth'
import { schoolMembershipsOf } from '../_utils/schoolStaff'
import { isValidEmailFormat, isDisposableEmailDomain } from '../_utils/emailValidation'
import { canonicalEmail } from '../_utils/identity/emailCanon'
import { normaliseDomain, whyDomainNotClaimable } from '../_utils/schoolDomain'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

const REFUSAL_COPY: Record<string, string> = {
  not_a_domain: 'That does not look like an email domain. Try something like example.sch.uk.',
  public_mail: 'That is a public email provider, so it cannot identify your school. Add individual addresses instead.',
  disposable: 'That is a throwaway email provider and cannot be a school domain.',
  placeholder: 'That domain is internal to SaySomethingin and cannot be claimed.',
  relay: 'That is a private relay domain and cannot identify a school.',
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, { methods: 'GET, POST, DELETE' })) return
  if (!['GET', 'POST', 'DELETE'].includes(req.method || '')) {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // The caller's school, as its ADMIN. A school_id in the query narrows the
    // choice for a person who administers more than one; it never widens it.
    const memberships = await schoolMembershipsOf(supabase, auth.userId)
    const adminOf = memberships.filter((m) => m.role === 'admin').map((m) => m.schoolId)
    const requested = typeof req.query?.school_id === 'string' ? req.query.school_id : (req.body?.school_id as string | undefined)
    const schoolId = requested ? (adminOf.includes(requested) ? requested : null) : adminOf[0] ?? null
    if (!schoolId) {
      res.status(403).json({ error: 'Only a school admin can manage who the school\'s links let in.' })
      return
    }

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('school_identity_claims')
        .select('id, kind, value, source, created_at')
        .eq('school_id', schoolId)
        .order('kind')
        .order('created_at')
      if (error) throw new Error(error.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(200).json({ school_id: schoolId, claims: data || [] })
      return
    }

    if (req.method === 'DELETE') {
      const id = typeof req.body?.id === 'string' ? req.body.id : ''
      if (!id) {
        res.status(400).json({ error: 'id is required' })
        return
      }
      // Scoped to the caller's school in the same statement, so an id from
      // another school deletes nothing and says so.
      const { data, error } = await supabase
        .from('school_identity_claims')
        .delete()
        .eq('id', id)
        .eq('school_id', schoolId)
        .select('id')
      if (error) throw new Error(error.message)
      if (!data?.length) {
        res.status(404).json({ error: 'Not found' })
        return
      }
      res.status(200).json({ ok: true })
      return
    }

    // POST — add a domain or an address.
    const kind = req.body?.kind
    const raw = typeof req.body?.value === 'string' ? req.body.value : ''
    let value = ''
    if (kind === 'domain') {
      value = normaliseDomain(raw)
      const reason = whyDomainNotClaimable(value)
      if (reason) {
        res.status(400).json({ error: REFUSAL_COPY[reason], reason })
        return
      }
    } else if (kind === 'address') {
      if (!isValidEmailFormat(raw)) {
        res.status(400).json({ error: 'Please enter a valid email address.' })
        return
      }
      value = canonicalEmail(raw)
      if (isDisposableEmailDomain(value)) {
        res.status(400).json({ error: 'Throwaway addresses cannot be let in.' })
        return
      }
    } else {
      res.status(400).json({ error: 'kind must be domain or address' })
      return
    }

    const { data, error } = await supabase
      .from('school_identity_claims')
      .insert({ school_id: schoolId, kind, value, source: 'admin_added', added_by: auth.userId })
      .select('id, kind, value, source, created_at')
      .single()
    if (error) {
      if (error.code === '23505') {
        res.status(200).json({ ok: true, existing: true })
        return
      }
      throw new Error(error.message)
    }
    res.status(200).json({ ok: true, claim: data })
  } catch (err: any) {
    console.error('[school/identity-claims]', err?.message || err)
    res.status(500).json({ error: 'Could not update who your links let in.' })
  }
}
