/**
 * Shared Wise API client + webhook signature verification helper.
 *
 * Wise is a first-party Wise Business account (no Platform agreement). The
 * API is free; we authenticate with a personal API token tied to a profile.
 *
 * Env:
 *   WISE_API_TOKEN          — personal API token
 *   WISE_PROFILE_ID         — business profile ID (used in /v3/profiles/:id/* paths)
 *   WISE_WEBHOOK_PUBLIC_KEY — RSA public key (PEM) used to verify webhook signatures
 *   WISE_API_BASE           — optional override; defaults to https://api.wise.com
 *                             (use https://api.sandbox.transferwise.tech for sandbox)
 *
 * Webhook signature: Wise signs the raw request body with their private key and
 * sends the Base64 signature in the `X-Signature-SHA256` header. We verify with
 * RSA + SHA256 using their published public key.
 *
 * https://docs.wise.com/api-docs/features/webhooks-notifications
 */

import { createVerify } from 'node:crypto'

export const WISE_API_BASE = (process.env.WISE_API_BASE || 'https://api.wise.com').trim()
export const WISE_API_TOKEN = (process.env.WISE_API_TOKEN || '').trim()
export const WISE_PROFILE_ID = (process.env.WISE_PROFILE_ID || '').trim()
export const WISE_WEBHOOK_PUBLIC_KEY = (process.env.WISE_WEBHOOK_PUBLIC_KEY || '').trim()

export interface WiseFetchOptions extends Omit<RequestInit, 'headers'> {
  /** Extra headers; Authorization + Content-Type are set automatically */
  headers?: Record<string, string>
  /** Body to JSON-stringify (overrides options.body if provided) */
  json?: unknown
}

/**
 * Authenticated fetch wrapper for the Wise REST API.
 *
 * Throws on non-2xx with the response body included in the error message —
 * caller is responsible for handling failures (Wise errors are descriptive).
 *
 * @param path - path beginning with `/`, e.g. `/v1/accounts` or `/v3/profiles/123/transfers`
 * @param options - standard fetch options, plus `json` shortcut for JSON bodies
 */
export async function wiseApi<T = unknown>(
  path: string,
  options: WiseFetchOptions = {}
): Promise<T> {
  if (!WISE_API_TOKEN) {
    throw new Error('WISE_API_TOKEN is not configured')
  }

  const { json, headers: extraHeaders, ...rest } = options

  const headers: Record<string, string> = {
    Authorization: `Bearer ${WISE_API_TOKEN}`,
    Accept: 'application/json',
    ...extraHeaders,
  }

  let body = rest.body
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  }

  const url = path.startsWith('http') ? path : `${WISE_API_BASE}${path}`
  const res = await fetch(url, { ...rest, headers, body })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(
      `[wise] ${rest.method || 'GET'} ${path} failed ${res.status}: ${text.slice(0, 500)}`
    )
  }

  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

/**
 * Verify a Wise webhook signature.
 *
 * Wise signs the raw request body with their RSA private key (SHA256). The
 * signature arrives Base64-encoded in the `X-Signature-SHA256` header. We
 * verify against the published public key (env var, PEM-encoded).
 *
 * Returns true on valid signature, false on mismatch / missing config.
 *
 * @param rawBody - the exact request body bytes/string Wise signed
 * @param signature - value of the `X-Signature-SHA256` header (Base64)
 */
export function verifyWiseWebhook(
  rawBody: string | Buffer,
  signature: string | undefined
): boolean {
  if (!signature) {
    console.warn('[wise] verifyWiseWebhook: missing signature header')
    return false
  }
  if (!WISE_WEBHOOK_PUBLIC_KEY) {
    console.warn('[wise] verifyWiseWebhook: WISE_WEBHOOK_PUBLIC_KEY not configured')
    return false
  }

  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody)
    verifier.end()
    return verifier.verify(WISE_WEBHOOK_PUBLIC_KEY, signature, 'base64')
  } catch (err) {
    console.error('[wise] verifyWiseWebhook error:', err)
    return false
  }
}

/**
 * Helper to require WISE_PROFILE_ID at call time (so module import doesn't
 * crash if env vars are missing during build).
 */
export function requireProfileId(): string {
  if (!WISE_PROFILE_ID) {
    throw new Error('WISE_PROFILE_ID is not configured')
  }
  return WISE_PROFILE_ID
}
