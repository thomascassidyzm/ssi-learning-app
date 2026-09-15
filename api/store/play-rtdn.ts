import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { createPlayPublisher, verifyPlayPush, type PlayPublisher } from '../_utils/playPublisher'
import { playPackageName, refreshPlayGrant } from '../_utils/playGrant'

export function createPlayRtdn(publisher: PlayPublisher = createPlayPublisher(), authenticate = verifyPlayPush) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
    if (!await authenticate(req.headers.authorization)) return res.status(401).json({ error: 'Invalid push identity' })
    let notification: any
    try {
      const encoded = req.body?.message?.data
      if (typeof encoded !== 'string' || encoded.length > 32768) throw new Error('Invalid envelope')
      notification = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))
    } catch { return res.status(400).json({ error: 'Invalid notification' }) }
    try {
      const packageName = playPackageName()
      if (notification.packageName !== packageName) return res.status(400).json({ error: 'Wrong package' })
      if (notification.testNotification) return res.status(200).json({ received: true })
      const sub = notification.subscriptionNotification
      const voided = notification.voidedPurchaseNotification
      if (voided && voided.productType !== 1) return res.status(200).json({ received: true })
      const token = sub?.purchaseToken || voided?.purchaseToken
      if (typeof token !== 'string' || !token || token.length > 4096 || !/^\d+$/.test(String(notification.eventTimeMillis))) {
        return res.status(400).json({ error: 'Invalid purchase notification' })
      }
      const messageId = req.body?.message?.messageId
      const eventId = typeof messageId === 'string' && messageId ? messageId : `${token}:${notification.eventTimeMillis}`
      const db = createClient((process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim(),
        (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(), { auth: { persistSession: false } })
      await refreshPlayGrant(db, publisher, {
        token, packageName, eventId,
        // Revocation and full voids come only from an authenticated Google push.
        revoked: sub?.notificationType === 12 || (voided?.productType === 1 && voided?.refundType === 1),
      })
      return res.status(200).json({ received: true })
    } catch (error) {
      console.error('[play-rtdn] processing failed', error instanceof Error ? error.message : 'database error')
      return res.status(503).json({ error: 'Notification processing unavailable' })
    }
  }
}
export default createPlayRtdn()
