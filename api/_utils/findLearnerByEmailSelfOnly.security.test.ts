/**
 * find_learner_by_email was an email oracle. This test is the lock.
 *
 * THE DEFECT (live until 2026-09-07, found by the job #301 branch census):
 * public.find_learner_by_email(text) is SECURITY DEFINER, owned by postgres and
 * GRANTed EXECUTE to `authenticated`. It matched a CLIENT-SUPPLIED email against
 * learners.verified_emails and returned that learner's row — id, auth user_id,
 * display_name, platform_role, educational_role, preferences, timestamps —
 * bypassing RLS, because SECURITY DEFINER runs as the owner. Any signed-in
 * learner who knew or guessed an address could resolve the person behind it.
 *
 * THE FIX (supabase/migrations/20260907_find_learner_by_email_self_only.sql):
 * the identity acted on now comes from the caller's token, and the parameter is
 * only ever allowed to be the caller's own verified email — the same gate
 * claim_learner already carried, which is the call the one real caller makes
 * next (packages/player-vue/src/composables/useAuth.ts).
 *
 * Proved against the live database on 2026-09-07 with two throwaway learner
 * rows in a rolled-back transaction: as learner A, a lookup of learner B's
 * address returned B's whole row before the fix and zero rows after it, while
 * A's own lookup kept returning A. This file is the STATIC half of that proof —
 * it reads supabase/schema.sql and the migration only, no DB or network — so a
 * future dump that reverts the body goes red here rather than quietly.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const schema = readFileSync(resolve(here, '../../supabase/schema.sql'), 'utf8')
const migration = readFileSync(
  resolve(here, '../../supabase/migrations/20260907_find_learner_by_email_self_only.sql'),
  'utf8'
)

/** The full body of find_learner_by_email as the dump carries it. */
function bodyFromSchema(): string {
  const start = schema.indexOf('CREATE FUNCTION public.find_learner_by_email(')
  expect(start, 'find_learner_by_email() must exist in the dump').toBeGreaterThan(-1)
  const end = schema.indexOf('$$;', start)
  expect(end).toBeGreaterThan(start)
  return schema.slice(start, end)
}

describe('find_learner_by_email is a self-lookup, not an email oracle', () => {
  it('derives the caller identity from the token, in the dump', () => {
    const body = bodyFromSchema()
    expect(body).toContain('SECURITY DEFINER')
    // an identity that comes from the token, not from the wire
    expect(body).toMatch(/auth\.uid\(\)\s+IS NOT NULL/)
    expect(body).toContain("auth.jwt() ->> 'email'")
  })

  it('constrains the parameter to the caller’s own email, in the dump', () => {
    const body = bodyFromSchema()
    // the defect was this line standing alone as the only predicate
    expect(body).toMatch(/lower\(trim\(lookup_email\)\)\s*=\s*lower\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)/)
    // and the old, unguarded predicate must be gone
    expect(body).not.toMatch(/WHERE\s+lookup_email = ANY\(l\.verified_emails\)/)
  })

  it('ships as a migration, not only as a schema-dump edit', () => {
    // schema.sql is a dump; the migration is what actually runs against the DB.
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.find_learner_by_email\(lookup_email text\)/)
    expect(migration).toContain("auth.jwt() ->> 'email'")
    expect(migration).toContain("NOTIFY pgrst, 'reload schema';")
  })

  it('keeps the signature so deployed clients are not broken', () => {
    // The one real caller passes its own supabaseUser.email. Preserving the
    // two-argument RPC means cached PWA clients keep linking their own account.
    const caller = readFileSync(
      resolve(here, '../../packages/player-vue/src/composables/useAuth.ts'),
      'utf8'
    )
    expect(caller).toContain("rpc('find_learner_by_email', { lookup_email: email })")
    expect(bodyFromSchema()).toContain('find_learner_by_email(lookup_email text)')
  })
})
