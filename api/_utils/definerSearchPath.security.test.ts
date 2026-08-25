/**
 * SEC25-D-01 — SECURITY DEFINER functions without a pinned search_path.
 *
 * Area D of the 2026-08-25 audit (docs/security-audit-2026-08-25/area-d-db-and-hygiene.md).
 *
 * A SECURITY DEFINER function runs with the *owner's* privileges, and by
 * default resolves unqualified identifiers against the CALLER's search_path,
 * not the owner's. A caller who can create an object (a schema, a function,
 * a table) earlier in their own search_path can shadow a name the DEFINER
 * function references unqualified — classic Postgres privilege-escalation
 * primitive (CVE-class: "trojan-horse function"). `SET search_path` on the
 * function pins resolution and closes it.
 *
 * FIXED 2026-08-25 by supabase/migrations/20260825_sec25_d01_definer_search_path.sql,
 * which runs `ALTER FUNCTION … SET search_path TO 'public', 'pg_temp'` over all
 * 16 functions of the roster (resolution only — not one line of body logic
 * changed), with supabase/schema.sql hand-edited to match. This file was the
 * CHARACTERISATION test for the finding; it is now flipped to assert the SECURE
 * state — every `SECURITY DEFINER` function in the dump pins a search_path, and
 * a new one landing without a pin goes red here. It reads supabase/schema.sql
 * only — no DB or network contact.
 *
 * Why `pg_temp` last: omitting it entirely leaves it implicitly first on some
 * Postgres versions, which reopens the very shadowing hole the pin closes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = resolve(here, '../../supabase/schema.sql')
const schema = readFileSync(schemaPath, 'utf8')

/** Every `CREATE FUNCTION public.<name>(` header line, with its start offset. */
function allFunctionStarts(): Array<{ name: string; start: number }> {
  const out: Array<{ name: string; start: number }> = []
  const re = /^CREATE FUNCTION public\.([a-zA-Z_0-9]+)\(/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(schema))) {
    out.push({ name: m[1], start: m.index })
  }
  return out
}

/** The full source of a numbered occurrence of `name` (handles overloads). */
function functionBodyAt(start: number): string {
  const end = schema.indexOf('$$;', start)
  expect(end, `expected a terminated body starting at offset ${start}`).toBeGreaterThan(start)
  return schema.slice(start, end)
}

describe('SEC25-D-01: every SECURITY DEFINER function pins SET search_path', () => {
  // ── the finding, now closed ──

  // The roster the 2026-08-25 audit found unpinned. Kept by name as the
  // regression lock: each of these must now carry a search_path pin on every
  // SECURITY DEFINER overload. If a future schema dump drops one, this goes red
  // naming the function.
  const FIXED_ROSTER = [
    'activate_brief_version',
    'activate_prompt_version',
    'analytics_course_comparison',
    'analytics_engagement',
    'analytics_entitlement_funnel',
    'analytics_friction_map',
    'analytics_growth',
    'analytics_health',
    'analytics_overview',
    'analytics_retention_cohorts',
    'analytics_retention_days_active',
    'analytics_trial_conversion',
    'get_active_brief',
    'get_active_prompt',
    'get_my_verified_emails',
    'update_daily_contributions',
  ]

  it('SEC25-D-01 FIXED: every function of the 16-strong roster pins search_path', () => {
    for (const name of FIXED_ROSTER) {
      const occurrences = allFunctionStarts().filter((f) => f.name === name)
      expect(occurrences.length, `expected ${name}() to exist in schema.sql`).toBeGreaterThan(0)

      for (const occ of occurrences) {
        const body = functionBodyAt(occ.start)
        if (!body.includes('SECURITY DEFINER')) continue
        expect(body, `${name}() is SECURITY DEFINER and must pin SET search_path`).toMatch(
          /SET\s+search_path/i
        )
        // pg_temp must be present and LAST — omitting it leaves it implicitly
        // first on some versions, which is the hole rather than the fix.
        expect(body, `${name}() must pin 'public', 'pg_temp'`).toMatch(
          /SET\s+search_path\s+TO\s+'public',\s*'pg_temp'/i
        )
      }
    }
  })

  // ── no silent growth ──
  // A new DEFINER function landing without search_path fails THIS assertion
  // rather than sliding in unnoticed. There is no allowance list any more: the
  // roster is empty, and it stays empty.
  it('SECURE: no SECURITY DEFINER function in schema.sql is missing SET search_path', () => {
    const unpinned = new Set<string>()
    for (const { name, start } of allFunctionStarts()) {
      const body = functionBodyAt(start)
      if (body.includes('SECURITY DEFINER') && !/SET\s+search_path/i.test(body)) {
        unpinned.add(name)
      }
    }
    expect([...unpinned].sort()).toEqual([])
  })

  it('the fix ships as a migration, not only as a schema-dump edit', () => {
    // schema.sql is a dump; the migration is what actually runs against the DB.
    // Both must move together or the next dump silently reverts the fix.
    const migration = readFileSync(
      resolve(here, '../../supabase/migrations/20260825_sec25_d01_definer_search_path.sql'),
      'utf8'
    )
    for (const name of FIXED_ROSTER) {
      expect(migration, `migration must ALTER ${name}()`).toContain(`alter function public.${name}(`)
    }
    expect(migration).toContain("notify pgrst, 'reload schema';")
  })

  // ── the control that DOES hold ──
  // The pattern is understood and applied elsewhere: pick a handful of
  // DEFINER functions authored in the same era that DO pin search_path, so
  // the finding above reads as "missed", not "unknown technique".
  it('the secure pattern (SET search_path) is already in use on other DEFINER functions', () => {
    for (const name of ['claim_learner', 'is_ssi_admin', 'admin_user_course_stats', 'find_learner_by_email']) {
      const occ = allFunctionStarts().find((f) => f.name === name)
      expect(occ, `expected ${name}() to exist`).toBeTruthy()
      const body = functionBodyAt(occ!.start)
      expect(body).toContain('SECURITY DEFINER')
      expect(body).toMatch(/SET\s+search_path/i)
    }
  })
})
