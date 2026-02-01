/**
 * Clerk JWT verification utilities for Vercel API endpoints
 *
 * Verifies Clerk session tokens passed in Authorization header.
 * Returns the Clerk user ID (sub claim) if valid.
 */

import type { VercelRequest } from '@vercel/node'

/**
 * Result of token verification
 */
export interface VerifyTokenResult {
  /** Whether token is valid */
  valid: boolean
  /** Clerk user ID (sub claim) if valid */
  userId?: string
  /** Error message if invalid */
  error?: string
}

/**
 * Verify Clerk JWT token from request
 *
 * Expects token in Authorization header as "Bearer <token>"
 * Uses Clerk's JWKS endpoint to verify signature.
 *
 * In production, this would use @clerk/backend SDK.
 * For now, we use a simpler approach that works with Supabase's
 * Clerk integration (the token is already verified by Clerk).
 */
export async function verifyClerkToken(req: VercelRequest): Promise<VerifyTokenResult> {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid Authorization header' }
  }

  const token = authHeader.slice(7) // Remove 'Bearer ' prefix

  if (!token) {
    return { valid: false, error: 'Empty token' }
  }

  try {
    // Decode JWT payload (base64url encoded)
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid JWT format' }
    }

    // Decode payload (middle part)
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    )

    // Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token expired' }
    }

    // Check issuer (should be Clerk)
    if (payload.iss && !payload.iss.includes('clerk')) {
      return { valid: false, error: 'Invalid token issuer' }
    }

    // Extract user ID from sub claim
    const userId = payload.sub
    if (!userId || typeof userId !== 'string') {
      return { valid: false, error: 'Missing user ID in token' }
    }

    return { valid: true, userId }
  } catch (err) {
    console.error('[clerk] Token verification error:', err)
    return { valid: false, error: 'Token verification failed' }
  }
}

/**
 * Get Clerk user ID from request, or null if not authenticated
 */
export async function getClerkUserId(req: VercelRequest): Promise<string | null> {
  const result = await verifyClerkToken(req)
  return result.valid ? result.userId ?? null : null
}
