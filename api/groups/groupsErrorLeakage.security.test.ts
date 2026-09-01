/**
 * SEC0901-C-07 (low/info) — `detail: String(error)` on the 500 path of the
 * three group-tree read surfaces.
 *
 * `api/groups/table.ts`, `api/groups/tree.ts` and `api/groups/[id]/home.ts`
 * are all correctly authenticated and scope-checked (resolveGroupTreeCaller +
 * callerCanSeeGroup / caller.ownGroupId — see area-c-tenant-endpoints.md).
 * That authz is not in question here. What this file characterizes is a
 * SEPARATE, narrower issue on their error path: on an unexpected exception
 * all three stringify the raw error into the JSON response body
 * (`detail: String(error)`), which can carry a Postgres/PostgREST message —
 * column names, constraint names, internal table shape — out to any caller
 * who can reach a 500, including a govt_admin / school_admin leader who is
 * authenticated but not platform staff.
 *
 * This is source-only (no live DB) because it is a static property of the
 * error branch, not a data-dependent one: the CONVENTION is what's being
 * pinned, so any of these three files (or a new file copying the pattern)
 * regressing back to a raw message is what should go red.
 *
 * CHARACTERIZATION, not a fix — no production code changed. This goes red on
 * purpose if the leak is closed (e.g. dropping `detail` or replacing it with
 * a fixed string); red here means the finding is CLOSED.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = (rel: string) => readFileSync(resolve(here, rel), 'utf8')

describe('SEC0901-C-07 — raw error text on the group-tree read surfaces\' 500 path', () => {
  it('groups/table.ts still echoes String(error) in its catch-all 500', () => {
    expect(src('table.ts')).toMatch(/res\.status\(500\)\.json\(\{ error: 'Internal server error', detail: String\(error\) \}\)/)
  })

  it('groups/tree.ts still echoes String(error) in its catch-all 500', () => {
    expect(src('tree.ts')).toMatch(/res\.status\(500\)\.json\(\{ error: 'Internal server error', detail: String\(error\) \}\)/)
  })

  it('groups/[id]/home.ts still echoes String(error) in its catch-all 500', () => {
    expect(src('[id]/home.ts')).toMatch(/res\.status\(500\)\.json\(\{ error: 'Internal server error', detail: String\(error\) \}\)/)
  })

  it('contrast: school/rename-class.ts (also mine, also service-role) does NOT echo the raw error', () => {
    const renameClassSrc = readFileSync(resolve(here, '../school/rename-class.ts'), 'utf8')
    expect(renameClassSrc).not.toMatch(/detail: String\(error\)/)
  })
})
