/**
 * SEC0912-B — the in-app support channel (api/support/*, migrations
 * 20260911_support_channel.sql + 20260911b_support_loop.sql), new since the
 * 2026-09-05 audit and never security-reviewed.
 *
 * Full write-up: docs/security-audit-2026-09-12/README.md
 *
 * Findings and tests only: nothing here changes behaviour, and NO LIVE
 * DATABASE WAS READ. Every assertion is over repo source. That matters
 * especially for B-01, because the migration that carries the defect is
 * marked UNAPPLIED in supabase/schema.sql — so this is a finding caught
 * BEFORE it reaches the live project, which is the cheap moment.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEC0912-B-01 (MEDIUM) — COLUMN-BLIND GRANT. The handlers project a narrow
 *   column list (`MESSAGE_VIEW_COLUMNS`) and say in prose that "the envelope
 *   stays server-side". The migration then does `GRANT SELECT ON
 *   public.support_messages TO authenticated` with an own-school RLS policy —
 *   a TABLE-level grant, which is column-blind. A school admin holding the
 *   anon key (it ships in the bundle) and their own JWT reads every column
 *   through PostgREST directly: `envelope`, `draft_reply`,
 *   `escalation_test`, `escalation_evidence`, `author_user_id`, and — added
 *   by 20260911b under the SAME blanket grant — `move_reason`, `model_tier`,
 *   `model_ladder`. The server-side narrowing is cosmetic.
 *   CHARACTERIZATION: goes red when the grant becomes column-scoped or the
 *   read moves behind a view.
 *
 * SEC0912-B-02 (LOW) — RAW DATABASE ERROR TEXT reaches the caller from the new
 *   support and copy-teacher-play surfaces (`error.message`, `err.message` in
 *   a 500 body). Same class as the finding already pinned by
 *   api/groups/groupsErrorLeakage.security.test.ts, recurring in new code
 *   because nothing gates it. CHARACTERIZATION.
 *
 * Also here, as SECURE ASSERTIONS on things this audit checked and cleared:
 * the population endpoint's integers-only shape, the client envelope's
 * allowlist, the admin-only gate on all three routes, and the absence of any
 * HTML sink for a message body.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { populationShape } from '../support/population'
import { pickClientEnvelope, MESSAGE_VIEW_COLUMNS } from '../support/_shared'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')

const CHANNEL_MIGRATION = 'supabase/migrations/20260911_support_channel.sql'
const LOOP_MIGRATION = 'supabase/migrations/20260911b_support_loop.sql'
const FIX_MIGRATION = 'supabase/migrations/20260912a_support_messages_column_grant.sql'

/** Columns the server DELIBERATELY withholds from the thread view. */
const WITHHELD_COLUMNS = [
  'envelope',
  'draft_reply',
  'escalation_test',
  'escalation_evidence',
  'author_user_id',
  'author_via',
  'signal_key',
  'doorbell_sent_at',
]

/** Internal operational columns 20260911b bolts on afterwards. */
const LATER_INTERNAL_COLUMNS = ['move', 'move_reason', 'model_tier', 'model_ladder']

describe('SEC0912-B-01 — support_messages publishes only MESSAGE_VIEW_COLUMNS to `authenticated` (fixed job #300)', () => {
  it('the server view deliberately withholds eight columns', () => {
    const projected = MESSAGE_VIEW_COLUMNS.split(',').map((c) => c.trim())
    for (const col of WITHHELD_COLUMNS) {
      expect(projected, `${col} must not be in the server's projection`).not.toContain(col)
    }
    // And the prose says why.
    expect(read('api/support/_shared.ts')).toContain('the envelope stays server-side')
  })

  it('FIXED (job #300, 20260912a): the browser grant is COLUMN-level and equals MESSAGE_VIEW_COLUMNS + thread_id', () => {
    const fix = read(FIX_MIGRATION)
    // The blanket grant 20260911 made is revoked in the same file that
    // replaces it (RLS doctrine rule 2: a REVOKE carries its GRANTs).
    expect(fix).toMatch(/REVOKE SELECT ON public\.support_messages\s+FROM authenticated/)
    const m = fix.match(/GRANT SELECT\s*\(([^)]*)\)\s*ON public\.support_messages TO authenticated/)
    expect(m, 'a column-scoped GRANT SELECT (…) must exist').not.toBeNull()
    const granted = m![1].split(',').map((s) => s.trim()).filter(Boolean).sort()
    // Pinned to the server's own projection: a column added to one list and
    // not the other goes red here, before it goes live.
    const projected = MESSAGE_VIEW_COLUMNS.split(',').map((s) => s.trim())
    expect(granted).toEqual(['thread_id', ...projected].sort())
    for (const col of [...WITHHELD_COLUMNS, ...LATER_INTERNAL_COLUMNS]) {
      expect(granted, `${col} must not be granted`).not.toContain(col)
    }
    expect(fix).toMatch(/NOTIFY pgrst, 'reload schema'/)
    // The row policy is untouched — rows are still "my school's thread".
    expect(read(CHANNEL_MIGRATION)).toContain('CREATE POLICY support_messages_own_read ON public.support_messages')
  })

  it('FIXED: the committed schema snapshot carries only column grants on support_messages for authenticated', () => {
    const schema = read('supabase/schema.sql')
    expect(schema).not.toMatch(/GRANT SELECT ON TABLE public\.support_messages TO authenticated/)
    const cols = [...schema.matchAll(/GRANT SELECT\((\w+)\) ON TABLE public\.support_messages TO authenticated;/g)].map((x) => x[1]).sort()
    const projected = MESSAGE_VIEW_COLUMNS.split(',').map((s) => s.trim())
    expect(cols).toEqual(['thread_id', ...projected].sort())
  })

  it('a later migration adds four more internal columns — and under a column grant they are UNREADABLE by default', () => {
    const loop = read(LOOP_MIGRATION)
    expect(loop).toContain('ALTER TABLE public.support_messages')
    for (const col of LATER_INTERNAL_COLUMNS) {
      expect(loop).toContain(`ADD COLUMN IF NOT EXISTS ${col}`)
    }
    // It adds no grant — which, after 20260912a, is the safe default rather
    // than the drift mechanism: a column-level grant publishes nothing new.
    expect(loop).not.toMatch(/GRANT SELECT[^;]*support_messages/)
    expect(loop).toContain('Answers "why did this cost a Fable call?"')
  })

  it('there IS a browser path to PostgREST for a school admin — the read is reachable, not theoretical', () => {
    // The anon key is a build-time client value shipped in the bundle…
    expect(read('packages/player-vue/src/config/env.ts')).toContain('VITE_SUPABASE_ANON_KEY')
    // …and the schools surfaces already query PostgREST straight from the
    // browser under the signed-in JWT, which is the exact door B-01 walks
    // through. Nothing about support_messages is special to PostgREST.
    expect(read('packages/player-vue/src/composables/schools/useSchoolContext.ts')).toContain(".from('schools')")
    expect(read('packages/player-vue/src/composables/schools/classTeacherScope.ts')).toContain(".from('classes')")
  })

  it('SECURE ASSERTION: support_signals — which carries asker auth uids — is service-role only', () => {
    const mig = read(CHANNEL_MIGRATION)
    expect(mig).toMatch(/REVOKE ALL ON public\.support_signals\s+FROM anon, authenticated/)
    expect(mig).not.toMatch(/GRANT [A-Z]+ ON public\.support_signals\s+TO (anon|authenticated)/)
    expect(mig).toContain('ALTER TABLE public.support_signals  ENABLE ROW LEVEL SECURITY')
    // The uid list lands on it in the later migration; the posture must hold.
    expect(read(LOOP_MIGRATION)).toContain('ADD COLUMN IF NOT EXISTS askers')
  })

  it('SECURE ASSERTION: the two tables 20260911b creates are service-role only, with no policies', () => {
    const loop = read(LOOP_MIGRATION)
    for (const t of ['support_handbook_precedents', 'support_settings']) {
      expect(loop).toContain(`ALTER TABLE public.${t}`)
      expect(loop).toMatch(new RegExp(`REVOKE ALL ON public\\.${t}\\s+FROM anon, authenticated`))
      expect(loop).not.toMatch(new RegExp(`CREATE POLICY [a-z_]+ ON public\\.${t}`))
    }
  })
})

describe('SEC0912-B-02 — raw database error text in 500 bodies (new surfaces)', () => {
  const OFFENDERS: Array<[string, RegExp]> = [
    ['api/support/messages.ts', /error: error\?\.message \|\|/],
    ['api/support/messages.ts', /error: err instanceof Error \? err\.message/],
    ['api/support/thread.ts', /error: err instanceof Error \? err\.message/],
    ['api/support/population.ts', /error: err instanceof Error \? err\.message/],
    ['api/school/copy-teacher-play/_shared.ts', /error: tlErr\.message/],
    ['api/school/copy-teacher-play/apply.ts', /error: err instanceof Error \? err\.message/],
  ]
  for (const [file, pattern] of OFFENDERS) {
    it(`CHARACTERIZATION: ${file} returns the underlying error string to the caller`, () => {
      expect(read(file)).toMatch(pattern)
    })
  }

  it('the repo already treats this as a finding class elsewhere', () => {
    // api/groups/groupsErrorLeakage.security.test.ts exists precisely for it;
    // nothing gates the pattern, so new endpoints reintroduce it freely.
    expect(read('api/groups/groupsErrorLeakage.security.test.ts')).toMatch(/leak/i)
  })
})

describe('SEC0912-B — checked and clear (secure assertions)', () => {
  it('all three support routes gate on the caller\'s OWN resolved scope, never on the body', () => {
    const shared = read('api/support/_shared.ts')
    expect(shared).toContain('resolveVisibleScope')
    expect(shared).toContain("scope.role === 'school_admin'")
    expect(shared).toContain("scope.role === 'govt_admin'")
    for (const route of ['api/support/thread.ts', 'api/support/messages.ts', 'api/support/population.ts']) {
      const src = read(route)
      expect(src).toContain('resolveSupportScope')
      expect(src).toMatch(/status\(403\)/)
      expect(src).toContain('verifyAuthToken')
    }
  })

  it('the population answer can carry a count and a date and nothing else', () => {
    const body = populationShape(['a', 'b', 'own', 'b'], 'own', new Date('2026-09-01T00:00:00.000Z'))
    expect(Object.keys(body).sort()).toEqual(['schools', 'since'])
    expect(body.schools).toBe(2) // own school excluded, duplicates collapsed
    expect(JSON.stringify(body)).not.toContain('own')
  })

  it('the client envelope is an allowlist, every field bounded, nothing about identity', () => {
    const out = pickClientEnvelope({
      route: '/schools',
      author_user_id: 'somebody-else',
      school_id: 'another-school',
      displayed_value: 'x'.repeat(5000),
      device_info: { userAgent: 'y'.repeat(5000), evil: 'z' },
    }) as Record<string, unknown>
    expect(Object.keys(out).sort()).toEqual(['device_info', 'displayed_value', 'route'])
    expect(String(out.displayed_value)).toHaveLength(300)
    expect((out.device_info as Record<string, unknown>).evil).toBeUndefined()
    expect(String((out.device_info as Record<string, string>).userAgent)).toHaveLength(400)
  })

  it('a message body is never rendered through an HTML sink', () => {
    const view = read('packages/player-vue/src/views/schools/SupportView.vue')
    expect(view).toContain('{{ m.body }}')
    expect(view).not.toContain('v-html')
    expect(read('packages/player-vue/src/components/schools/support/SupportSheet.vue')).not.toContain('v-html')
  })

  it('every cron job in the directory fails closed on a deployed environment', () => {
    // Three of the five crons are new this window (support-doorbell,
    // org-free-year-warnings, org-entitlement-reconcile). All five share the
    // one constant-time guard.
    for (const job of [
      'support-doorbell', 'org-free-year-warnings', 'org-entitlement-reconcile',
      'expire-demo-schools', 'teacher-payouts',
    ]) {
      const src = read(`api/cron/${job}.ts`)
      expect(src, `${job} must use checkCronAuth`).toContain('checkCronAuth')
      expect(src).toMatch(/cronAuth\.ok/)
    }
    expect(read('api/_utils/cronAuth.ts')).toContain('timingSafeEqual')
  })
})
