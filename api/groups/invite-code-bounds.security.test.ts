/**
 * SECURITY AUDIT 2026-08-11 — area `tenancy`, finding TENANCY-07 (medium).
 *
 * _utils/codeGuard.ts exists to stop privileged invite codes being unbounded
 * bearer tokens — its own words: "a privileged code can never again be
 * unlimited-use + never-expiring (the SSI-GOD-2026 class of hole)".
 *
 * Its only caller restricts it to three code types
 * (api/invite/create.ts:274-278):
 *     code_type === 'ssi_admin' || 'god' || 'tester'
 *
 * So `govt_admin` (minted as role 'leader', api/groups/[id]/invites.ts:69-74)
 * and `school_admin_join` (role 'school_leader') — both of which grant
 * tenant-level administrative authority on redemption — fall outside the guard
 * on BOTH minting paths. `invite_codes.expires_at` and `max_uses` are nullable
 * with no database default (supabase/schema.sql:7325-7326), and
 * api/groups/[id]/invites.ts:536-537 only sets them when the client supplies
 * them, so omitting `limits` mints a code that never expires and never runs out.
 *
 * Full write-up: docs/security-audit-2026-08-11/tenancy.md
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { boundPrivilegedCodeLimits } from '../_utils/codeGuard'

const REPO_API = join(__dirname, '..')

describe('CONTROL — boundPrivilegedCodeLimits itself is correct', () => {
  it('defaults an omitted expiry to 7 days and an omitted use cap to 1', () => {
    const { expires_at, max_uses } = boundPrivilegedCodeLimits(undefined, undefined)
    expect(max_uses).toBe(1)
    const days = (Date.parse(expires_at) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
  })

  it('caps an over-broad expiry at 90 days and an over-broad use count at 50', () => {
    const far = new Date(Date.now() + 3650 * 86_400_000).toISOString()
    const { expires_at, max_uses } = boundPrivilegedCodeLimits(far, 100_000)
    expect(max_uses).toBe(50)
    const days = (Date.parse(expires_at) - Date.now()) / 86_400_000
    expect(days).toBeLessThan(90.1)
  })

  it('rejects a past expiry rather than honouring it', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const { expires_at } = boundPrivilegedCodeLimits(past, 1)
    expect(Date.parse(expires_at)).toBeGreaterThan(Date.now())
  })
})

/**
 * SECURITY FINDING TENANCY-07: the guard above is never reached for the two
 * code types that grant tenant administration. These assertions read the real
 * source so they fail the day either file changes shape, and they document the
 * gap without asserting a behaviour that would need live minting to observe.
 *
 * WHAT SHOULD HAPPEN INSTEAD: extend `isPrivileged` in api/invite/create.ts to
 * include 'govt_admin' and 'school_admin_join', and apply
 * boundPrivilegedCodeLimits in api/groups/[id]/invites.ts too, so both minting
 * paths bound the same set.
 */
describe('SECURITY FINDING TENANCY-07 — leader/school-leader codes mint unbounded', () => {
  const createSrc = readFileSync(join(REPO_API, 'invite', 'create.ts'), 'utf8')
  const invitesSrc = readFileSync(join(REPO_API, 'groups', '[id]', 'invites.ts'), 'utf8')

  it('api/invite/create.ts bounds only ssi_admin / god / tester (current behaviour)', () => {
    const line = /const isPrivileged\s*=\s*(.+)/.exec(createSrc)?.[1] ?? ''
    expect(line).toContain("'ssi_admin'")
    expect(line).toContain("'god'")
    expect(line).toContain("'tester'")
    expect(line).not.toContain("'govt_admin'")        // ← the gap
    expect(line).not.toContain("'school_admin_join'") // ← the gap
  })

  it('role "leader" maps to the govt_admin code type (the one left unbounded)', () => {
    expect(invitesSrc).toMatch(/leader:\s*'govt_admin'/)
    expect(invitesSrc).toMatch(/school_leader:\s*'school_admin_join'/)
  })

  it('api/groups/[id]/invites.ts never calls the guard, and only sets limits the client sent (current behaviour)', () => {
    expect(invitesSrc).not.toContain('boundPrivilegedCodeLimits') // ← the defect
    expect(invitesSrc).toMatch(/if \(limits\?\.expires_at !== undefined\) insertData\.expires_at = limits\.expires_at/)
    expect(invitesSrc).toMatch(/if \(limits\?\.max_uses !== undefined\) insertData\.max_uses = limits\.max_uses/)
  })

  it.todo('TENANCY-07: isPrivileged must include govt_admin and school_admin_join')
  it.todo('TENANCY-07: api/groups/[id]/invites.ts must bound privileged code limits before insert')
})
