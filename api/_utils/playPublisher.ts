import { createSign, createPublicKey, verify } from 'node:crypto'

export interface PlayPurchase {
  startTime?: string
  subscriptionState: string
  acknowledgementState?: string
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string }
  linkedPurchaseToken?: string
  lineItems?: { productId: string; expiryTime?: string }[]
}
export interface PlayPublisher {
  get(packageName: string, token: string): Promise<PlayPurchase>
  acknowledge(packageName: string, productId: string, token: string): Promise<void>
}
const base = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'
async function jsonFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Google request failed: ${response.status}`)
  return (response.status === 204 ? {} : await response.json()) as T
}

/** No SDK dependency: service-account JWT exchanged for a short-lived OAuth token. */
export function createPlayPublisher(): PlayPublisher {
  let cached: { token: string; until: number } | undefined
  async function accessToken() {
    if (cached && cached.until > Date.now()) return cached.token
    const account = JSON.parse((process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '').trim())
    if (!account.client_email || !account.private_key) throw new Error('Play service account missing')
    const now = Math.floor(Date.now() / 1000)
    const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: account.client_email.trim(), scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    })}`
    const signature = createSign('RSA-SHA256').update(input).sign(account.private_key.trim(), 'base64url')
    const result = await jsonFetch<{ access_token: string }>('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${signature}` }),
    })
    if (!result.access_token) throw new Error('Google returned no access token')
    cached = { token: result.access_token, until: Date.now() + 3000000 }
    return cached.token
  }
  return {
    async get(packageName, token) {
      return jsonFetch<PlayPurchase>(`${base}${encodeURIComponent(packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`,
        { headers: { Authorization: `Bearer ${await accessToken()}` } })
    },
    async acknowledge(packageName, productId, token) {
      const response = await fetch(`${base}${encodeURIComponent(packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, {
        method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw new Error(`Google acknowledgement failed: ${response.status}`)
    },
  }
}

/** Verify authenticated Pub/Sub push; a receipt re-fetch alone cannot authenticate a refund notice. */
export async function verifyPlayPush(authorization: string | undefined): Promise<boolean> {
  const audience = process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE?.trim()
  const email = process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL?.trim()
  if (!audience || !email || !authorization?.startsWith('Bearer ')) return false
  try {
    const parts = authorization.slice(7).split('.')
    if (parts.length !== 3) return false
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    if (header.alg !== 'RS256' || !header.kid || claims.aud !== audience || claims.email !== email ||
        claims.email_verified !== true || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
        typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) return false
    const certs = await jsonFetch<Record<string, string>>('https://www.googleapis.com/oauth2/v1/certs')
    if (!certs[header.kid]) return false
    return verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey(certs[header.kid]), Buffer.from(parts[2], 'base64url'))
  } catch { return false }
}
