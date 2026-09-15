/**
 * support_inbox must never reference auth.users (job #680, fixing job #677).
 *
 * 20260914c_support_inbox_view.sql created the service-role view WITH
 * (security_invoker = on) and LEFT JOINed auth.users five times. Under
 * security_invoker the reading role needs SELECT on auth.users, which
 * service_role lacks and must not be granted (CLAUDE.md RLS doctrine rule 6),
 * so every PostgREST read returned 403 / 42501 "permission denied for table
 * users" — even with the service key. 20260914d recreates the view without it.
 *
 * Repo-source assertions only; no live database is read. The test finds the
 * migration that CURRENTLY defines the view (the lexically last one that
 * creates it), so it is red on 20260914c alone and green once 20260914d exists,
 * and it stays a guard against any future recreation that joins auth.users back.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '../../supabase/migrations')

const creators = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .filter((f) => /CREATE (OR REPLACE )?VIEW public\.support_inbox\b/.test(readFileSync(join(migrationsDir, f), 'utf-8')))
const latest = creators[creators.length - 1]
const sql = readFileSync(join(migrationsDir, latest), 'utf-8')
/** Everything from the CREATE VIEW to its terminating semicolon: the body PostgREST runs. */
const viewBody = sql.slice(sql.indexOf('CREATE VIEW public.support_inbox'), sql.indexOf('COMMENT ON VIEW public.support_inbox'))

const COLUMNS = [
  'door', 'source', 'id', 'created_at', 'learner_id', 'account_code', 'reporter_email',
  'platform_role', 'educational_role', 'school_role', 'school_id', 'school_name', 'school_is_test',
  'group_id', 'course_code', 'build', 'deployment_env', 'device', 'route', 'body', 'context',
  'screenshot_url', 'delivered_at',
]

describe(`support_inbox view as defined by ${latest}`, () => {
  it('names no auth.users relation anywhere in the view body', () => {
    expect(viewBody).not.toMatch(/auth\.users/)
    expect(viewBody).not.toMatch(/\bu\.email\b/)
  })

  it('keeps security_invoker on and stays service-role only', () => {
    expect(viewBody).toMatch(/WITH \(security_invoker = on\)/)
    expect(sql).toMatch(/REVOKE ALL ON public\.support_inbox FROM anon, authenticated;/)
    expect(sql).toMatch(/GRANT SELECT ON public\.support_inbox TO service_role;/)
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/)
  })

  it('keeps every column of the 20260914c shape, in order, on the first branch', () => {
    const firstBranch = viewBody.slice(0, viewBody.indexOf('UNION ALL'))
    const aliased = [...firstBranch.matchAll(/\bAS (\w+)/g)].map((m) => m[1])
    expect(aliased).toEqual(COLUMNS)
  })

  it('unions all five doors', () => {
    for (const door of ['bug_report', 'support_message', 'tester_feedback', 'content_feedback', 'handbook_question']) {
      expect(viewBody).toContain(`'${door}'`)
    }
    expect(viewBody.match(/UNION ALL/g)?.length).toBe(4)
  })

  it('takes legacy email only from columns the public rows carry', () => {
    expect(viewBody).toMatch(/COALESCE\(m\.author_name, l\.verified_emails\[1\]\)/)
    expect(viewBody).toMatch(/COALESCE\(b\.reporter_email, l\.verified_emails\[1\]\)/)
  })
})
