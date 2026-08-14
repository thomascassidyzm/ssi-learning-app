/**
 * The offline bundle must ship ONLY learner-facing pods.
 *
 * The player reads the exact pod id `${course}:pod-0`, so a pod parked on any
 * other `pod-0-*` slug is staging or archive and is invisible to it. The bundle
 * query used to filter on `course_code` alone, which meant a downloading learner
 * received `pod-0-unrecorded` — the working copy that carries ~110 untranslated,
 * unrecorded sentences while a canon rewrite is in flight — and superseded
 * `pod-0-gated-<date>` / `pod-0-retired-<date>` rows, interleaved in arbitrary
 * order because `pod_order` is NULL on every pod row and is coerced to 0.
 *
 * This is also the switchover contract: `pod-0` is live, `pod-0-*` is not. If the
 * filter is ever dropped, promoting a staged canon stops being safe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

/** Every filter applied to the `listening_pods` query, in order. */
let podFilters: Array<{ op: string; args: unknown[] }> = []
/** The pod rows the `listening_pods` query actually resolved to, after the
 *  handler's own filters were applied the way PostgREST would apply them. */
let resolvedPodIds: string[] = []

const POD_ROWS = [
  { id: 'fra_for_eng:pod-0', slug: 'pod-0', pod_order: null, title: 'French Listening Pods — Pod 0' },
  { id: 'fra_for_eng:pod-0-unrecorded', slug: 'pod-0-unrecorded', pod_order: null, title: 'UNRECORDED working copy, not learner-facing' },
  { id: 'fra_for_eng:pod-0-retired-2026-08-14', slug: 'pod-0-retired-2026-08-14', pod_order: null, title: '[RETIRED]' },
  { id: 'fra_for_eng:music', slug: 'music', pod_order: null, title: 'Choice Pod — Music' },
]

/** Minimal thenable query builder that records what was asked of it. */
function makeBuilder(table: string) {
  const applied: Array<{ op: string; args: unknown[] }> = []
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') {
          // Resolve with the rows this table should return, after applying the
          // recorded filters the way PostgREST would.
          let data: any[] = []
          if (table === 'listening_pods') {
            podFilters = applied
            data = POD_ROWS.filter((r) =>
              applied.every((f) =>
                f.op === 'not' && f.args[0] === 'slug' && f.args[1] === 'like'
                  ? !new RegExp('^' + String(f.args[2]).replace(/%/g, '.*') + '$').test(r.slug)
                  : true,
              ),
            )
            resolvedPodIds = data.map((r) => r.id)
          }
          return (resolve: (v: unknown) => void) => resolve({ data, error: null })
        }
        return (...args: unknown[]) => {
          applied.push({ op: prop, args })
          return builder
        }
      },
    },
  )
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeBuilder(table) }),
}))

const res = () => {
  const r: any = { statusCode: 200, body: undefined }
  r.status = (c: number) => { r.statusCode = c; return r }
  r.json = (b: unknown) => { r.body = b; return r }
  r.setHeader = () => r
  r.end = () => r
  return r as VercelResponse & { body: any }
}

describe('bundle pod selection', () => {
  beforeEach(() => { podFilters = []; resolvedPodIds = []; vi.resetModules() })

  it('excludes every pod-0-* slug and keeps pod-0 and choice pods', async () => {
    const handler = (await import('./bundle')).default
    await handler({ method: 'GET', query: { code: 'fra_for_eng' }, headers: {} } as unknown as VercelRequest, res())

    const notFilter = podFilters.find((f) => f.op === 'not')
    expect(notFilter, 'listening_pods query must exclude staged/archived slugs').toBeTruthy()
    expect(notFilter!.args).toEqual(['slug', 'like', 'pod-0-%'])

    // The staged working copy and the archive must never reach the downloader.
    expect(resolvedPodIds).not.toContain('fra_for_eng:pod-0-unrecorded')
    expect(resolvedPodIds).not.toContain('fra_for_eng:pod-0-retired-2026-08-14')
    // The live pod and the choice pod must still ship.
    expect(resolvedPodIds).toContain('fra_for_eng:pod-0')
    expect(resolvedPodIds).toContain('fra_for_eng:music')
  })
})
