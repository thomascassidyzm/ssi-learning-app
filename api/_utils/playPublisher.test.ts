import { afterEach, expect, it, vi } from 'vitest'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { createPlayPublisher, verifyPlayPush } from './playPublisher'
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
it('exchanges a signed JWT from trimmed service-account JSON and uses the receipt endpoint', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  vi.stubEnv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', ' \n' + JSON.stringify({ client_email: 'play@example.test',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) + '\n')
  const request = vi.fn(async (url: string, options: any) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      const jwt = options.body.get('assertion').split('.')
      expect(verify('RSA-SHA256', Buffer.from(jwt.slice(0, 2).join('.')), publicKey, Buffer.from(jwt[2], 'base64url'))).toBe(true)
      const claims = JSON.parse(Buffer.from(jwt[1], 'base64url').toString())
      expect(claims.iss).toBe('play@example.test')
      expect(claims.scope).toBe('https://www.googleapis.com/auth/androidpublisher')
      return { ok: true, status: 200, json: async () => ({ access_token: 'oauth' }) }
    }
    expect(options.headers.Authorization).toBe('Bearer oauth')
    return { ok: true, status: 200, json: async () => ({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE' }) }
  })
  vi.stubGlobal('fetch', request)
  const publisher = createPlayPublisher()
  await publisher.get('com.ssi', 'token/encoded')
  expect(request.mock.calls[1][0]).toContain('/purchases/subscriptionsv2/tokens/token%2Fencoded')
  await publisher.acknowledge('com.ssi', 'monthly', 'token/encoded')
  expect(request.mock.calls[2][0]).toContain('/purchases/subscriptions/monthly/tokens/token%2Fencoded:acknowledge')
  expect(request).toHaveBeenCalledTimes(3)
})
it('requires a Google signature, the configured audience and the configured push account', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  vi.stubEnv('GOOGLE_PLAY_PUBSUB_AUDIENCE', 'https://staging.example/play')
  vi.stubEnv('GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL', 'push@example.test')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
    json: async () => ({ kid: publicKey.export({ type: 'spki', format: 'pem' }) }) })))
  const jwt = (aud: string) => {
    const encode = (x: unknown) => Buffer.from(JSON.stringify(x)).toString('base64url')
    const input = `${encode({ alg: 'RS256', kid: 'kid' })}.${encode({ aud, iss: 'https://accounts.google.com',
      email: 'push@example.test', email_verified: true, exp: Date.now() / 1000 + 300 })}`
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`
  }
  expect(await verifyPlayPush(`Bearer ${jwt('https://staging.example/play')}`)).toBe(true)
  expect(await verifyPlayPush(`Bearer ${jwt('wrong audience')}`)).toBe(false)
  expect(await verifyPlayPush(`Bearer ${jwt('https://staging.example/play').slice(0, -10)}tampered`)).toBe(false)
})
