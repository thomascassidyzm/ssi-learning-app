/**
 * Supabase Auth verification utilities for Vercel API endpoints
 *
 * Verifies Supabase Auth JWT tokens passed in Authorization header.
 * Returns the Supabase user ID if valid.
 */

import type { VercelRequest } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()

/**
 * Result of token verification
 */
export interface VerifyTokenResult {
  /** Whether token is valid */
  valid: boolean
  /** Supabase user ID if valid */
  userId?: string
  /** Error message if invalid */
  error?: string
}

/**
 * Verify Supabase Auth JWT token from request
 *
 * Creates a Supabase client with the user's token and calls getUser()
 * to verify the token server-side.
 */
export async function verifyAuthToken(req: VercelRequest): Promise<VerifyTokenResult> {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false, error: 'Missing or invalid Authorization header' }
  }

  const token = authHeader.slice(7) // Remove 'Bearer ' prefix

  if (!token) {
    return { valid: false, error: 'Empty token' }
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    return { valid: false, error: 'Server configuration error' }
  }

  try {
    // Create a Supabase client with the user's JWT
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return { valid: false, error: error?.message || 'Invalid token' }
    }

    return { valid: true, userId: user.id }
  } catch (err) {
    console.error('[auth] Token verification error:', err)
    return { valid: false, error: 'Token verification failed' }
  }
}

/**
 * Get user ID from request, or null if not authenticated
 */
export async function getAuthUserId(req: VercelRequest): Promise<string | null> {
  const result = await verifyAuthToken(req)
  return result.valid ? result.userId ?? null : null
}

/**
 * Verify the caller is an SSi admin (platform_role = 'ssi_admin' or educational_role = 'god').
 * Uses the user's own auth token to query learners (works with RLS).
 * Returns the user ID if admin, null otherwise.
 */
export async function verifyAdmin(req: VercelRequest): Promise<{ userId: string } | { error: string; status: number }> {
  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    return { error: authResult.error || 'Unauthorized', status: 401 }
  }

  const token = req.headers.authorization!.slice(7)

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })

    const { data: learner } = await supabase
      .from('learners')
      .select('platform_role, educational_role')
      .eq('user_id', authResult.userId)
      .single()

    const isAdmin = learner?.platform_role === 'ssi_admin' ||
      learner?.educational_role === 'god'

    if (!isAdmin) {
      return { error: 'Requires SSi admin access', status: 403 }
    }

    return { userId: authResult.userId }
  } catch {
    return { error: 'Admin verification failed', status: 500 }
  }
}
