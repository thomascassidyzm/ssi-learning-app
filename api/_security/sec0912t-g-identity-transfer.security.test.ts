/**
 * SEC0912T-G — the TENTH audit, area G: identity transfer, account deletion,
 * and the unauthenticated bug-report intake.
 *
 * Full write-up: docs/security-audit-2026-09-12-tenth/area-g-identity-transfer.md
 *
 * Findings and tests only. Nothing here changes behaviour, and NO LIVE
 * DATABASE WAS READ — every assertion is over repo source (handlers,
 * supabase/schema.sql). The honest gap that bounds finding G-01 is stated in
 * the write-up: whether an orphaned `user_tags` / `govt_admins` row exists in
 * the live project today is a query this audit did not run.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEC0912T-G-01 (HIGH) — ORPHANED-IDENTITY ABSORPTION. Two sibling doors
 *   transfer another person's tenancy memberships to the caller on proof of
 *   nothing except knowing their auth uid:
 *     - `public.relink_user_tags(old_user_id text)` — SECURITY DEFINER,
 *       GRANTed to `authenticated` (and `anon`), re-points EVERY `user_tags`
 *       row held by `old_user_id` to `auth.uid()`;
 *     - `POST /api/auth/cascade-user-id` — service-role client, re-points the
 *       `govt_admins` row held by `old_user_id` to the caller.
 *   The single guard on both is "old_user_id is ORPHANED", i.e. no `learners`
 *   row still holds it. Neither asks whether the CALLER ever owned it —
 *   cascade-user-id's own header comment says so ("A future previous_user_id
 *   history column would let us prove the caller once owned old_user_id").
 *   Three facts turn that into a reachable escalation:
 *     (a) `POST /api/account/delete` is the ORPHAN FACTORY. It deletes the
 *         `learners` row and relies on `learner_id … ON DELETE CASCADE`;
 *         `user_tags.user_id` and `govt_admins.user_id` are TEXT auth-uid
 *         columns carrying NO foreign key at all, so both survive the delete
 *         and are, from that instant, orphaned by the guard's definition.
 *     (b) The auth uid of a colleague is READABLE BY A PEER: the `user_tags`
 *         SELECT policy admits any row whose `tag_value` is in
 *         `my_readable_tag_values()`, which for a class teacher is their own
 *         classes — user_id and role_in_context included, straight out of
 *         PostgREST with the anon key that ships in the bundle.
 *     (c) The transfer is UNSCOPED. `relink_user_tags` updates
 *         `WHERE user_id = old_user_id` with no tag_value bound, so the
 *         departed identity's tags at schools, classes and orgs the caller has
 *         never touched move too.
 *   Net effect: a caller acquires `role_in_context = 'admin'` rows — which the
 *   `user_tags` INSERT and UPDATE policies both go out of their way to forbid
 *   anyone granting themselves — because a SECURITY DEFINER function runs past
 *   the policy that states the rule.
 *   CHARACTERIZATION: these go red when either door requires proof of prior
 *   ownership, when the transfer is bounded to tags the caller can already
 *   manage, or when account deletion clears the two orphanable tables.
 *
 * SEC0912T-G-02 (MEDIUM) — AN IDENTITY TRANSFER LEAVES NO AUDIT ROW. Every
 *   other path that moves privilege in this repo writes `role_change_audit`
 *   through `api/_utils/auditRole.ts` — update-user-role, set-learner-flags,
 *   code redemption, entitlement grants. `RoleChangeEntry['source']` is a
 *   closed union and carries no member for either transfer door, and
 *   cascade-user-id does not import the helper. The only record of a
 *   leadership moving between people is a console line.
 *   CHARACTERIZATION: goes red when a source member for the transfer exists.
 *
 * SEC0912T-G-03 (LOW) — `screenshot_url` on the UNAUTHENTICATED bug-report
 *   intake is stored with no scheme allowlist: `str(v, 600)` trims and
 *   truncates, nothing else, so `javascript:` and `data:text/html` survive
 *   into `bug_reports`. There is no renderer for the column in this repo, so
 *   this is a stored-input finding with its sink outside the audit's reach —
 *   reported as latent, not as a live XSS. CHARACTERIZATION: goes red when the
 *   handler constrains the scheme.
 *
 * Also here, as SECURE ASSERTIONS on things this area checked and CLEARED:
 * cron authentication across all five crons, the Resend/Svix webhook's
 * fail-closed signature check, the Vercel-attested client IP behind the
 * bug-report throttle, and the absence of a body-supplied target on
 * account deletion and the offline lease.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

const CASCADE = 'api/auth/cascade-user-id.ts'
const DELETE = 'api/account/delete.ts'
const BUG = 'api/report/bug.ts'
const SCHEMA = 'supabase/schema.sql'

const cascadeSrc = read(CASCADE)
const deleteSrc = read(DELETE)
const bugSrc = read(BUG)
const schemaSrc = read(SCHEMA)

/** The body of `CREATE FUNCTION public.relink_user_tags(...) … $$;`. */
function relinkUserTagsBody(): string {
  const start = schemaSrc.indexOf('CREATE FUNCTION public.relink_user_tags(')
  expect(start, 'relink_user_tags must exist in schema.sql').toBeGreaterThan(-1)
  const end = schemaSrc.indexOf('$$;', start)
  return schemaSrc.slice(start, end)
}

/** The `CREATE TABLE public.<name> (…)` block. */
function tableBlock(name: string): string {
  const start = schemaSrc.indexOf(`CREATE TABLE public.${name} (`)
  expect(start, `${name} must exist in schema.sql`).toBeGreaterThan(-1)
  return schemaSrc.slice(start, schemaSrc.indexOf(');', start))
}

// ───────────────────────────────────────────────────────────────────────────
// SEC0912T-G-01 — orphaned-identity absorption
// ───────────────────────────────────────────────────────────────────────────

describe('SEC0912T-G-01 — the two identity-transfer doors prove orphanhood, never ownership', () => {
  it('relink_user_tags is SECURITY DEFINER and reachable by any signed-in caller', () => {
    const body = relinkUserTagsBody()
    expect(body).toContain('SECURITY DEFINER')
    // GRANTed to authenticated — so the anon key that ships in the client
    // bundle plus any learner JWT reaches it directly, no endpoint needed.
    expect(schemaSrc).toContain(
      'GRANT ALL ON FUNCTION public.relink_user_tags(old_user_id text) TO authenticated;',
    )
  })

  it('relink_user_tags gates on orphanhood alone — no clause ties old_user_id to the caller', () => {
    const body = relinkUserTagsBody()
    // The guard that IS there.
    expect(body).toContain('FROM public.learners WHERE user_id = old_user_id')
    expect(body).toContain('old identity still active')
    // The guard that is NOT there: nothing links old_user_id to the caller's
    // own history. The only auth.uid() uses are the null-check, the
    // same-as-caller short circuit, and the value written.
    const authUidUses = body.match(/auth\.uid\(\)/g) ?? []
    expect(authUidUses.length).toBe(3)
    expect(body).not.toMatch(/previous_user_id|verified_emails|learner_emails/)
  })

  it('relink_user_tags moves EVERY tag of the old identity, unbounded by tag_value', () => {
    const body = relinkUserTagsBody()
    const update = body.slice(body.indexOf('UPDATE public.user_tags'))
    expect(update).toContain('WHERE user_id = old_user_id')
    // No tag_value / tag_type bound, and no restriction to tags the caller can
    // already manage — so tags at schools and orgs the caller has never
    // touched are carried across with the rest.
    expect(update).not.toContain('tag_value')
    expect(update).not.toContain('my_manageable_tag_values')
  })

  it('the user_tags policies forbid self-granting admin/teacher — the rule the DEFINER function runs past', () => {
    const insertPolicy = schemaSrc.slice(
      schemaSrc.indexOf('CREATE POLICY user_tags_insert'),
      schemaSrc.indexOf(';', schemaSrc.indexOf('CREATE POLICY user_tags_insert')),
    )
    expect(insertPolicy).toContain("role_in_context IS DISTINCT FROM 'teacher'")
    expect(insertPolicy).toContain("role_in_context IS DISTINCT FROM 'admin'")
    // relink_user_tags writes the same table with no role_in_context clause at
    // all, so an 'admin' row transfers as readily as a 'student' one.
    expect(relinkUserTagsBody()).not.toContain('role_in_context')
  })

  it('cascade-user-id applies the same orphan-only guard to govt_admins, and says so itself', () => {
    expect(cascadeSrc).toContain('verifyAuthToken')
    expect(cascadeSrc).toContain("res.status(409).json({ error: 'old_user_id is not orphaned' })")
    // The header comment is the repo's own record of the missing check.
    expect(cascadeSrc).toContain('A future "previous_user_id" history column would')
    expect(cascadeSrc).toContain('let us prove the caller once owned old_user_id')
    // The write itself is keyed on nothing but the supplied id.
    expect(cascadeSrc).toContain(".from('govt_admins')")
    expect(cascadeSrc).toContain(".eq('user_id', oldUserId)")
  })

  it('govt_admins.user_id and user_tags.user_id are auth-uid TEXT columns carrying no foreign key', () => {
    expect(tableBlock('govt_admins')).toMatch(/user_id text NOT NULL/)
    expect(tableBlock('user_tags')).toMatch(/user_id text NOT NULL/)
    // Every FK on either table — none of them is on user_id, so nothing in the
    // database makes a learner's deletion reach these rows.
    const fks = schemaSrc
      .split('\n')
      .filter((l) => /ADD CONSTRAINT (govt_admins|user_tags)_\w+_fkey FOREIGN KEY/.test(l))
      .map((l) => l.trim())
    expect(fks.some((l) => l.includes('FOREIGN KEY (user_id)'))).toBe(false)
    // user_tags has no foreign keys whatsoever.
    expect(fks.filter((l) => l.includes('user_tags')).length).toBe(0)
  })

  it('account deletion is the orphan factory: it deletes learners and never touches the two orphanable tables', () => {
    expect(deleteSrc).toContain("from('learners').delete().eq('id', learner.id)")
    // The handler enumerates what cascades and what deliberately restricts.
    // Neither list mentions the two tables keyed on the auth uid.
    expect(deleteSrc).not.toContain('user_tags')
    expect(deleteSrc).not.toContain('govt_admins')
    // And it removes the auth identity, so the uid it leaves behind in those
    // rows can never again be reclaimed by its owner signing in.
    expect(deleteSrc).toContain('auth.admin.deleteUser')
  })

  it("a peer can read a colleague's auth uid: my_readable_tag_values admits a teacher's own classes", () => {
    const start = schemaSrc.indexOf('CREATE FUNCTION public.my_readable_tag_values()')
    const readable = schemaSrc.slice(start, schemaSrc.indexOf('$$;', start))
    expect(readable).toContain("ut.role_in_context = 'teacher'")
    expect(readable).toContain('my_manageable_tag_values()')
    const selectPolicy = schemaSrc.slice(
      schemaSrc.indexOf('CREATE POLICY user_tags_select'),
      schemaSrc.indexOf(';', schemaSrc.indexOf('CREATE POLICY user_tags_select')),
    )
    // The whole row is admitted — user_id and role_in_context with it.
    expect(selectPolicy).toContain('my_readable_tag_values')
    expect(selectPolicy).not.toContain('user_id IS NULL')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// SEC0912T-G-02 — no audit row for an identity transfer
// ───────────────────────────────────────────────────────────────────────────

describe('SEC0912T-G-02 — the privilege-transfer doors write no role_change_audit row', () => {
  it('auditRole has no source member for either transfer door', () => {
    const audit = read('api/_utils/auditRole.ts')
    const sourceLine = audit.slice(audit.indexOf('  source:'), audit.indexOf('\n', audit.indexOf('  source:')))
    expect(sourceLine).toContain("'update-user-role'")
    expect(sourceLine).toContain("'mint-learner'")
    expect(sourceLine).not.toContain('cascade')
    expect(sourceLine).not.toContain('relink')
  })

  it('cascade-user-id records the transfer to the console and nowhere durable', () => {
    expect(cascadeSrc).not.toContain('auditRole')
    expect(cascadeSrc).not.toContain('role_change_audit')
    expect(cascadeSrc).toContain("console.log('[CascadeUserId] cascaded'")
  })

  it('relink_user_tags likewise writes no audit row', () => {
    expect(relinkUserTagsBody()).not.toContain('role_change_audit')
  })

  it('the comparison holds: the sanctioned role-change paths DO audit', () => {
    for (const f of ['api/admin/update-user-role.ts', 'api/admin/set-learner-flags.ts', 'api/code/redeem.ts']) {
      expect(read(f), `${f} should audit`).toContain('auditRole')
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// SEC0912T-G-03 — unauthenticated stored input with no scheme allowlist
// ───────────────────────────────────────────────────────────────────────────

describe('SEC0912T-G-03 — bug-report screenshot_url is stored unvalidated', () => {
  it('the intake accepts a report with no bearer at all', () => {
    expect(bugSrc).toContain("const hasBearer = typeof req.headers.authorization === 'string'")
    // Auth is conditional: no bearer means a guest report, not a 401.
    expect(bugSrc).toContain('if (!authUserId) {')
  })

  it('screenshot_url passes through str() — trim and truncate, no scheme check', () => {
    expect(bugSrc).toContain('screenshot_url: str(body.screenshot_url, 600)')
    const strFn = bugSrc.slice(bugSrc.indexOf('function str('), bugSrc.indexOf('}', bugSrc.indexOf('function str(')) + 1)
    expect(strFn).toContain('.trim().slice(0, max)')
    expect(strFn).not.toMatch(/https?:|startsWith|URL\(/)
    // Nothing anywhere in the handler constrains the scheme.
    expect(bugSrc).not.toMatch(/javascript:|allowedScheme|ALLOWED_SCHEMES/)
  })

  it('no renderer for the column exists in this repo — the sink is outside the audit (honest gap)', () => {
    const vueSrc = join(repoRoot, 'packages/player-vue/src')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(vue|ts)$/.test(entry.name) && readFileSync(full, 'utf-8').includes('screenshot_url')) {
          hits.push(full.slice(repoRoot.length + 1))
        }
      }
    }
    walk(vueSrc)
    // Both hits are SENDERS (the report composer), not renderers.
    expect(hits.sort()).toEqual([
      'packages/player-vue/src/components/TesterFeedback.vue',
      'packages/player-vue/src/composables/useBugReport.ts',
    ])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// CHECKED AND CLEARED — assertions that pin properties this area found SOUND
// ───────────────────────────────────────────────────────────────────────────

describe('SEC0912T-G — checked and cleared', () => {
  it('every cron handler authenticates through the shared constant-time, fail-closed check', () => {
    const cronDir = join(repoRoot, 'api/cron')
    const handlers = readdirSync(cronDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    expect(handlers.length).toBeGreaterThanOrEqual(5)
    for (const f of handlers) {
      const src = read(`api/cron/${f}`)
      expect(src, `${f} must use checkCronAuth`).toContain('checkCronAuth')
      expect(src, `${f} must refuse on failure`).toMatch(/if \(!cronAuth\.ok\)/)
    }
    const cronAuth = read('api/_utils/cronAuth.ts')
    expect(cronAuth).toContain('timingSafeEqual')
    expect(cronAuth).toContain("return { ok: false, status: 500, error: 'CRON_SECRET not configured' }")
  })

  it('the Resend delivery webhook verifies a Svix signature over the raw body and fails closed', () => {
    const hook = read('api/auth/resend-delivery-webhook.ts')
    expect(hook).toContain('export const config = { api: { bodyParser: false } }')
    expect(hook).toContain("res.status(401).json({ error: 'Invalid signature' })")
    const svix = read('api/_utils/svixSignature.ts')
    expect(svix).toContain("if (!secret) return { ok: false, reason: 'no signing secret configured' }")
    expect(svix).toContain('timestamp outside tolerance')
    expect(svix).toContain('timingSafeEqual')
  })

  it('the bug-report throttle buckets on the peer Vercel attests, not a caller-supplied header', () => {
    expect(bugSrc).toContain('getClientIp')
    const throttle = read('api/_utils/codeAttemptThrottle.ts')
    const fn = throttle.slice(throttle.indexOf('export function getClientIp'))
    expect(fn).toContain("headers['x-vercel-forwarded-for']")
    // The spoofable header is never consulted.
    expect(fn).not.toContain("headers['x-forwarded-for']")
  })

  it('account deletion and the offline lease take no target from the caller', () => {
    expect(deleteSrc).not.toContain('req.body')
    expect(deleteSrc).toContain('There')
    const lease = read('api/entitlement/offline-lease.ts')
    // The lease reads courses from the body but resolves the LEARNER from the
    // bearer only, and never caches an entitlement answer.
    expect(lease).toContain("res.setHeader('Cache-Control', 'no-store')")
    expect(lease).toContain(".eq('user_id', userId)")
    expect(lease).not.toMatch(/body\.(learner_id|user_id|learnerId)/)
  })
})
