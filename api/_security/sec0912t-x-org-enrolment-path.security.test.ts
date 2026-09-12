/**
 * SEC0912T-X — the TENTH audit, coordinator finding. Handed over by Area C,
 * which found it while tracing the intel surface's tenancy walks and correctly
 * declined to assert it (org enrolment is not that area's surface).
 *
 * Full write-up: docs/security-audit-2026-09-12-tenth/README.md §1.
 *
 * Findings and tests only. No behaviour changed, no live DB read, no money
 * moved; every assertion is over repo source.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEC0912T-X-01 (MEDIUM) — THE MONEY PATH STILL DECIDES "SAME ORG" ON A
 *   NAME-DERIVED SLUG STRING. `api/org/enrol.ts` enforces the one-person,
 *   one-cohort rule with `rootOfPath(groups.path)` — the first segment of a
 *   slug computed from the org's NAME. That is the exact predicate class the
 *   ninth audit found in SQL (SEC0912-A-01, `is_govt_admin_over_group()`) and
 *   that job #300 repaired on 2026-09-12 by walking `parent_id` instead. The
 *   repaired function now carries the ruling in its own COMMENT in
 *   supabase/schema.sql: *"groups.path is a name-derived slug and is never
 *   unique, so it must not decide a row policy."* Enrolment kept the pattern.
 *
 *   THE COLLISION IS THE REPO'S OWN RECORD, not a hypothetical:
 *   `api/_utils/groupSlug.ts` exists because two unrelated orgs both called
 *   "Deborah Testing" both slugged to `deborah-testing`, and duplicates are a
 *   WARNING, not a constraint — the same request re-sent with
 *   `confirm_duplicate: true` creates the second org. There is no unique
 *   index on `groups.path`; the only index is a non-unique
 *   `text_pattern_ops` one.
 *
 *   WHAT BREAKS. A learner already enrolled at org A who redeems an invite
 *   from unrelated org B, whose root slug collides, matches `sameOrg` and is
 *   answered `alreadyEnrolled: true` — carrying org B's display name beside
 *   org A's `free_access_until`, and healing the entitlement against org A's
 *   group_id. Org B's enrolment is never written: the learner does not get
 *   the free year they were invited to, and org B's funder reporting never
 *   counts them. This is the money path, so the failure is silent and
 *   financial rather than loud.
 *
 *   CHARACTERIZATION: goes red when enrolment decides org identity on
 *   `parent_id` (or on any ancestry the org's NAME cannot change).
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { rootOfPath } from '../org/enrol'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

const enrolSrc = read('api/org/enrol.ts')
const schemaSrc = read('supabase/schema.sql')

describe('SEC0912T-X-01 — org enrolment decides "same org" on a name-derived slug', () => {
  it('two unrelated root orgs that slug the same are ONE org to rootOfPath', () => {
    // Both are roots: a root group's path is just its own slug. Different ids,
    // different tenants, same answer.
    expect(rootOfPath('deborah-testing', 'group-A')).toBe(rootOfPath('deborah-testing', 'group-B'))
    // And the collision carries down each org's subtree, because the root
    // segment is all that is compared.
    expect(rootOfPath('deborah-testing/cohort-2025', 'x')).toBe(
      rootOfPath('deborah-testing/autumn-intake', 'y'),
    )
  })

  it('the one-cohort rule is enforced with it, on the enrolment path', () => {
    expect(enrolSrc).toContain('const orgRoot = rootOfPath((thisGroup as any)?.path, invite.grants_group_id)')
    expect(enrolSrc).toContain('const sameOrg = priors.find((p) => rootById.get(p.group_id) === orgRoot)')
    // The comment states the assumption the slug cannot carry.
    expect(enrolSrc).toContain('Groups under one org share the first segment of their slug path.')
    // No parent_id walk anywhere in the handler — path is the whole predicate.
    expect(enrolSrc).not.toContain('parent_id')
  })

  it('a match short-circuits the enrolment and heals against the OTHER org', () => {
    const branch = enrolSrc.slice(enrolSrc.indexOf('if (sameOrg) {'), enrolSrc.indexOf('// ── What they hold today'))
    expect(branch).toContain('sameOrg.group_id')
    expect(branch).toContain('sameOrg.free_access_until')
    expect(branch).toContain('alreadyEnrolled: true')
    // The org NAME shown back comes from the invite's policy, so the answer
    // mixes org B's name with org A's dates.
    expect(branch).toContain('orgName: policy.org_display_name')
  })

  it('the database itself now records the opposite ruling', () => {
    expect(schemaSrc).toContain(
      'groups.path is a name-derived slug and is never unique, so it must not decide a row policy.',
    )
    // …and the repaired SQL predicate walks parent_id, as the fix intended.
    const fn = schemaSrc.slice(
      schemaSrc.indexOf('CREATE FUNCTION public.is_govt_admin_over_group('),
      schemaSrc.indexOf('$$;', schemaSrc.indexOf('CREATE FUNCTION public.is_govt_admin_over_group(')),
    )
    expect(fn).toContain('parent_id')
  })

  it('nothing stops the duplicate: the warning is confirmable and there is no unique index', () => {
    const slug = read('api/_utils/groupSlug.ts')
    expect(slug).toContain('confirm_duplicate: true')
    expect(slug).toContain('Legitimate duplicates are allowed')
    // The only index on groups.path is non-unique.
    expect(schemaSrc).toContain('CREATE INDEX idx_groups_path ON public.groups USING btree (path text_pattern_ops);')
    expect(schemaSrc).not.toMatch(/CREATE UNIQUE INDEX \w+ ON public\.groups USING btree \(path/)
  })
})
