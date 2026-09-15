import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlayPublisher } from './playPublisher'

export function playPackageName(): string {
  const name = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim()
  if (!name) throw new Error('GOOGLE_PLAY_PACKAGE_NAME required')
  return name
}
export async function refreshPlayGrant(db: SupabaseClient, publisher: PlayPublisher, input: {
  token: string; packageName: string; callerLearnerId?: string; eventId?: string; revoked?: boolean
}) {
  const observedAt = new Date().toISOString()
  const purchase = await publisher.get(input.packageName, input.token)
  const accountId = purchase.externalAccountIdentifiers?.obfuscatedExternalAccountId
  const { data: existing, error } = await db.from('user_entitlements').select('learner_id')
    .eq('source', 'play').eq('source_ref', input.token).maybeSingle()
  if (error) throw error
  // A restore never changes ownership. A different caller receives their own access verdict.
  let linkedOwner: string | undefined
  if (!existing && purchase.linkedPurchaseToken) {
    const { data: linked, error: linkedError } = await db.from('user_entitlements').select('learner_id')
      .eq('source', 'play').eq('source_ref', purchase.linkedPurchaseToken).maybeSingle()
    if (linkedError) throw linkedError
    linkedOwner = linked?.learner_id
  }
  const learnerId = existing?.learner_id || linkedOwner || accountId
  if (!learnerId || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(learnerId)) {
    throw new Error('Verified purchase has no canonical learner identity')
  }
  if ((input.callerLearnerId && input.callerLearnerId !== learnerId) || (accountId && accountId !== learnerId)) {
    console.warn('[play] restore identity mismatch; retained existing owner', { learnerId, callerLearnerId: input.callerLearnerId })
  }
  const products = new Set((process.env.GOOGLE_PLAY_SUBSCRIPTION_IDS || '').trim().split(',').map(s => s.trim()).filter(Boolean))
  if (!products.size) throw new Error('GOOGLE_PLAY_SUBSCRIPTION_IDS required')
  const items = purchase.lineItems?.filter(item => products.has(item.productId)) || []
  if (!items.length) throw new Error('Verified purchase has no configured SSi subscription')
  if (!existing && ['SUBSCRIPTION_STATE_PENDING', 'SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED'].includes(purchase.subscriptionState)) {
    return { learnerId, result: null }
  }
  const expiries = items.map(i => Date.parse(i.expiryTime || ''))
  if (expiries.some(n => !Number.isFinite(n))) throw new Error('Verified purchase has no valid expiry')
  const expiresAt = new Date(Math.max(...expiries)).toISOString()
  const allowed = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']
  // Hold and pause close the door even if Google retains a future billing date.
  // A delayed revoke notification cannot override a recovered, freshly verified purchase.
  const revoked = !allowed.includes(purchase.subscriptionState) ||
    (input.revoked === true && Date.parse(expiresAt) <= Date.now())
  if (!purchase.startTime || !Number.isFinite(Date.parse(purchase.startTime))) {
    throw new Error('Verified purchase has no start time')
  }
  if (!revoked && purchase.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
    await publisher.acknowledge(input.packageName, items[0].productId, input.token)
  }
  const { data: result, error: writeError } = await db.rpc('apply_play_grant', {
    p_learner_id: learnerId, p_token: input.token, p_starts_at: purchase.startTime,
    p_expires_at: expiresAt, p_revoked_at: revoked ? observedAt : null,
    p_observed_at: observedAt, p_event_id: input.eventId || null,
    p_linked_token: purchase.linkedPurchaseToken || null,
  })
  if (writeError) throw writeError
  const { data: paddle, error: overlapError } = await db.from('user_entitlements')
    .select('id, starts_at, redeemed_at, expires_at, revoked_at').eq('learner_id', learnerId).eq('source', 'paddle')
  if (overlapError) console.warn('[play] overlap lookup failed')
  else if (!revoked && Date.parse(purchase.startTime) <= Date.now() && Date.parse(expiresAt) > Date.now() && paddle?.some(row => !row.revoked_at &&
    Date.parse(row.starts_at || row.redeemed_at) <= Date.now() &&
    (!row.expires_at || Date.parse(row.expires_at) > Date.now()))) {
    console.warn('[play] learner holds active Play and Paddle grants', { learnerId })
  }
  return { learnerId, result }
}
