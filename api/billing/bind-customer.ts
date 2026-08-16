/**
 * Bind a Paddle customer to the caller's own billing node BEFORE any money
 * moves — POST /api/billing/bind-customer
 *
 * WHY THIS EXISTS (A-123, security audit 2026-08-15 finding SEC15-01).
 *
 * The 2026-08-11 fix stopped the Paddle webhook taking the target tenant from
 * `customData.school_id` (browser-composed). It replaced that with "the payer's
 * own node", resolved from the email on the Paddle customer record — but that
 * email is typed into the checkout by the buyer, so the hijack survived with
 * one substitution: know the victim admin's EMAIL instead of their school UUID,
 * pay £15, and the victim's billing pointers are overwritten. Cancel, and the
 * victim's school goes dark.
 *
 * An email is not an identity. A verified SESSION is. So the binding is made
 * here, server-side, before the checkout opens:
 *
 *   1. the caller proves who they are with their Supabase session (never a body
 *      field, never a typed email);
 *   2. the node is resolved FROM that session — schools.admin_user_id or an
 *      ADMIN school tag, govt_admins.group_id for an org — exactly the rule
 *      api/school/update-seats.ts uses, so a plain teacher tag cannot address
 *      the school's billing;
 *   3. the caller's email is read from auth.users with the service key, never
 *      from the request;
 *   4. the Paddle customer for that email is found or created, and its id is
 *      written onto the node as `provider_customer_id`.
 *
 * The webhook then resolves ONLY through a binding it can trust (the row
 * already bound to this subscription id, or the row bound to this customer id)
 * and refuses anything else for manual remediation.
 *
 * ACCESS PRESERVATION (Tom's binding condition on A-123 — no-one's access may
 * be removed by this change):
 *   - A node that currently holds a LIVE platform entitlement and is already
 *     bound to a customer is NEVER re-bound. Its existing customer id is
 *     returned unchanged. A live subscription's addressing cannot be moved by
 *     anyone calling this endpoint, including its own admin.
 *   - Nothing here writes platform_status, expiry or seats. This endpoint can
 *     only ever ADD a pointer; it can never downgrade anybody.
 *   - The client FAILS CLOSED on an error here (it does not open the checkout),
 *     so a failure costs a retry, never a payment that cannot be attributed.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'
import { paddle } from '../_utils/paddle'
import { leaderGroupId } from '../_utils/orgPlatform'
import { holdsLivePlatformEntitlement } from '../_utils/billingBinding'
import { mintBillingIntent } from '../_utils/billingIntent'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

type Scope = 'school' | 'org'

/** Find the Paddle customer for this email, or create one. Never takes an
 *  email from the request — the caller passes the address auth.users holds. */
async function findOrCreatePaddleCustomer(email: string): Promise<string> {
  const existing = await paddle.customers.list({ email: [email] }).next()
  const hit = (existing || []).find((c: any) => c?.id)
  if (hit?.id) return hit.id as string

  try {
    const created = await paddle.customers.create({ email })
    return created.id
  } catch (err: any) {
    // Paddle 409s when the address already exists but the list above missed it
    // (e.g. an archived customer). Re-read rather than surfacing a hard error.
    const retry = await paddle.customers.list({ email: [email] }).next()
    const found = (retry || []).find((c: any) => c?.id)
    if (found?.id) return found.id as string
    throw err
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const auth = await verifyAuthToken(req)
  if (!auth.valid || !auth.userId) {
    res.status(401).json({ error: auth.error || 'Unauthorized' })
    return
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[billing/bind-customer] Missing Supabase configuration')
    res.status(500).json({ error: 'Server configuration error' })
    return
  }

  const scope = String((req.body || {}).scope || '') as Scope
  if (scope !== 'school' && scope !== 'org') {
    res.status(400).json({ error: "scope must be 'school' or 'org'" })
    return
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  try {
    // --- The node, resolved from the SESSION. Never from the body. ---
    let table: 'schools' | 'groups'
    let nodeId: string | null = null

    if (scope === 'school') {
      table = 'schools'
      const { data: ownSchool } = await supabase
        .from('schools')
        .select('id')
        .eq('admin_user_id', auth.userId)
        .maybeSingle()
      nodeId = ownSchool?.id ?? null
      if (!nodeId) {
        // Admin-only, exactly as api/school/update-seats.ts: a bare school tag
        // would also catch plain teachers, who must not be able to address
        // their school's billing.
        const { data: tag } = await supabase
          .from('user_tags')
          .select('tag_value')
          .eq('user_id', auth.userId)
          .eq('tag_type', 'school')
          .eq('role_in_context', 'admin')
          .is('removed_at', null)
          .limit(1)
          .maybeSingle()
        if (tag?.tag_value) nodeId = String(tag.tag_value).replace('SCHOOL:', '')
      }
    } else {
      table = 'groups'
      nodeId = await leaderGroupId(supabase as any, auth.userId)
    }

    if (!nodeId) {
      res.status(403).json({
        error:
          scope === 'school'
            ? 'Only a school admin can start a school subscription'
            : 'Only an organisation leader can start an organisation subscription',
      })
      return
    }

    // --- Read the node's current billing state. ---
    const { data: node, error: nodeErr } = await supabase
      .from(table)
      .select('id, provider_customer_id, provider_subscription_id, platform_status, platform_expires_at')
      .eq('id', nodeId)
      .maybeSingle()
    if (nodeErr || !node) {
      res.status(404).json({ error: 'Billing node not found' })
      return
    }

    // ACCESS PRESERVATION: a node that is currently entitled AND already bound
    // keeps the binding it has. Re-pointing a live subscription's addressing is
    // a manual-remediation case, never a side effect of opening a checkout.
    // The signed statement of intent the webhook will actually trust as the
    // address. Minted from the SESSION-resolved node, so the browser never gets
    // to name the node it is paying for.
    const intent = mintBillingIntent({ scope, nodeId, authUid: auth.userId })
    if (!intent) {
      console.error('[billing/bind-customer] No signing material for the billing intent')
      res.status(500).json({ error: 'Could not prepare checkout' })
      return
    }

    const alreadyBound = (node.provider_customer_id as string | null) || null
    if (
      alreadyBound &&
      holdsLivePlatformEntitlement(node.platform_status, node.platform_expires_at)
    ) {
      res.status(200).json({ customerId: alreadyBound, intent, nodeId, reused: true })
      return
    }

    // --- The caller's email, from auth.users. Never from the request body. ---
    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(auth.userId)
    const email = (userData?.user?.email || '').trim().toLowerCase()
    if (userErr || !email) {
      console.error('[billing/bind-customer] No email on the authenticated user:', auth.userId, userErr?.message)
      res.status(400).json({ error: 'Your account has no email address to bill' })
      return
    }

    const customerId = await findOrCreatePaddleCustomer(email)

    // Bind. This ADDS a pointer — it writes no status, no expiry, no seats, so
    // it cannot downgrade anyone under any failure mode.
    const { error: bindErr } = await supabase
      .from(table)
      .update({ provider_customer_id: customerId })
      .eq('id', nodeId)
    if (bindErr) {
      console.error('[billing/bind-customer] Failed to write the binding:', bindErr.message)
      res.status(500).json({ error: 'Could not prepare checkout' })
      return
    }

    console.log(
      `[billing/bind-customer] bound ${table} ${nodeId} → paddle customer ${customerId} (session ${auth.userId})`
    )
    res.status(200).json({ customerId, intent, nodeId, reused: false })
  } catch (err: any) {
    console.error('[billing/bind-customer] Handler error:', err?.message || err)
    res.status(500).json({ error: 'Could not prepare checkout' })
  }
}
