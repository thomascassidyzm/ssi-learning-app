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
 * This is a CHARACTERISATION test: it PASSES today because it is recording
 * the current (incomplete) state, not asserting the secure one. It reads
 * supabase/schema.sql only — no DB or network contact.
 *
 * Exploitability is graded per function, not asserted uniformly here — most
 * of the list below only ever touches `sessions`/`course_*`/`learners` by
 * schema-qualified table access inside their own bodies (which the identifier
 * search_path trick does NOT protect against object-creation shadowing of
 * unqualified *function* calls, e.g. an unqualified `now()`-shaped helper).
 * The severity call and per-function detail live in the area-d report; this
 * file's job is to keep the inventory honest so the count cannot drift
 * without the test being touched.
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

describe('SEC25-D-01: SECURITY DEFINER functions without SET search_path', () => {
  // ── the finding, pinned ──

  // The known-bad-shape roster as of the 2026-08-25 audit. Pinned by name so
  // that ADDING a new unpinned DEFINER function is caught by the "no growth"
  // assertion below, and FIXING one (adding SET search_path) is caught by
  // this list going stale — update it only when the report is updated too.
  const KNOWN_UNPINNED = [
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

  it('SECURITY FINDING SEC25-D-01: the pinned list of DEFINER functions has no SET search_path in its body', () => {
    for (const name of KNOWN_UNPINNED) {
      const occurrences = allFunctionStarts().filter((f) => f.name === name)
      expect(occurrences.length, `expected ${name}() to exist in schema.sql`).toBeGreaterThan(0)

      // At least one overload of this name must be SECURITY DEFINER with no
      // search_path — that is the shape this finding is about.
      const vulnerable = occurrences.some((occ) => {
        const body = functionBodyAt(occ.start)
        return body.includes('SECURITY DEFINER') && !/SET\s+search_path/i.test(body)
      })
      expect(vulnerable, `expected ${name}() to be SECURITY DEFINER without SET search_path`).toBe(true)
    }
  })

  it.todo('SECURE: every SECURITY DEFINER function in schema.sql carries SET search_path')

  // ── no silent growth ──
  // A new DEFINER function landing without search_path should fail THIS
  // assertion, not slide in unnoticed. If it's a deliberate new instance of
  // the same shape, add it to KNOWN_UNPINNED here (which also means adding it
  // to the area-d report) rather than loosening this bound.
  it('no NEW unpinned SECURITY DEFINER functions beyond the pinned roster', () => {
    const unpinned = new Set<string>()
    for (const { name, start } of allFunctionStarts()) {
      const body = functionBodyAt(start)
      if (body.includes('SECURITY DEFINER') && !/SET\s+search_path/i.test(body)) {
        unpinned.add(name)
      }
    }
    expect([...unpinned].sort()).toEqual([...KNOWN_UNPINNED].sort())
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
