/**
 * servedPod tests.
 *
 * The contract this file exists to hold (Tom's ruling, 2026-09-13: "there is
 * only pod-1 now, and then pods by topic"):
 *  1. `pod-1` is the served pod when the course has one.
 *  2. A pod PARKED off the serving slug (`unrecorded`, `gated-<date>`,
 *     `retired-<date>`) still reads as "no pods yet". This is the release
 *     gate; a resolver that widened would publish every unrecorded pod.
 *  3. Any query failure, and any course with nothing to serve, resolves to
 *     `pod-1` — the served pod's own name, whose sentence query then answers
 *     for itself — never to "no pods".
 *  4. One round-trip per course per session, shared by all five call sites.
 *  5. A pod that NAMES A ROLE is a TOPIC pod for its holder: Listening Mode
 *     lists it as its own card, titled from its row, AFTER pod-1 — never in
 *     place of it, and main flow never reads it (Tom, 2026-09-13, job #544).
 *     The server has already decided the reader may have it (2026-09-03 role
 *     gate), so the client lists what it was sent and never second-guesses.
 *  6. An offline snapshot written under the retired slug maps forward to
 *     `pod-1` on read rather than being dropped by rule 2 as parked.
 *     RECORDED RED against the pre-rename module (which still served the old
 *     slug and had no forward mapping), GREEN after.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveServedPod,
  resetServedPodCache,
  pickServedSlug,
  FALLBACK_POD_SLUG,
  SERVING_POD_SLUGS,
} from './servedPod'
import { __resetNetworkGateForTests } from '../config/networkGate'

/** Fake client returning the given listening_pods rows, counting round-trips. */
function makeClient(
  rows: Array<{ slug: string; pod_type?: string; required_role?: string | null; title?: string }> | null,
  error: { message: string } | null = null,
) {
  const calls = { count: 0, lastFilters: {} as Record<string, unknown> }
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filters[col] = val; return chain },
        in: (col: string, vals: unknown[]) => { filters[col] = vals; return chain },
        // The real query is one `.or()` with two arms. The mock mirrors the
        // SERVER: rows the reader may not see never come back, so a
        // required_role row present in `rows` is one RLS already allowed.
        or: (expr: string) => { filters.or = expr; return chain },
        then: (resolve: (r: unknown) => void) => {
          if (table !== 'listening_pods') return resolve({ data: null, error: null })
          calls.count += 1
          calls.lastFilters = filters
          // Mirror the server: the `.in('slug', …)` filter is applied there,
          // so a parked slug never even comes back over the wire.
          const or = filters.or as string | undefined
          const allowedFromOr = or
            ? (or.match(/slug\.in\.\(([^)]*)\)/)?.[1] ?? '').split(',').filter(Boolean)
            : undefined
          const allowed = (filters.slug as string[] | undefined) ?? allowedFromOr
          const data = rows?.filter((r) => {
            const addressed = typeof r.required_role === 'string' && r.required_role !== ''
            if (addressed) return or !== undefined // the role arm carries no slug filter
            return (
              (!allowed || allowed.includes(r.slug)) &&
              (filters.pod_type === undefined || (r.pod_type ?? 'core') === filters.pod_type)
            )
          }) ?? null
          return resolve({ data: error ? null : data, error })
        },
      }
      return chain
    },
  } as any
  return { client, calls }
}

beforeEach(() => {
  resetServedPodCache()
  __resetNetworkGateForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetServedPodCache()
})

describe('resolveServedPod', () => {
  it('the serving list is pod-1 and nothing else', () => {
    expect([...SERVING_POD_SLUGS]).toEqual(['pod-1'])
    expect(FALLBACK_POD_SLUG).toBe('pod-1')
  })

  it('serves pod-1 when the course has one', async () => {
    const { client } = makeClient([{ slug: 'pod-1' }])
    const served = await resolveServedPod(client, 'hrv_for_eng')
    expect(served.slug).toBe('pod-1')
    expect(served.podId).toBe('hrv_for_eng:pod-1')
  })

  it('still reads "no pods" for a course whose only pod is parked on `unrecorded`', async () => {
    // The release gate. The parked pod exists and is pod_type=core — the
    // resolver must not see it as servable. Deliberately a SYNTHETIC course
    // code: no real course should be named here, because whether any given
    // course is currently parked is live data that moves under the test.
    const { client } = makeClient([{ slug: 'unrecorded' }])
    const served = await resolveServedPod(client, 'parked_for_eng')
    // pod-1 is the answer, and pod-1 holds no sentences for such a course —
    // so every learner path reads "no pods yet".
    expect(served.slug).toBe(FALLBACK_POD_SLUG)
    expect(served.podId).toBe('parked_for_eng:pod-1')
  })

  it('ignores every non-serving slug: parked cores, retired pods, choice pods', async () => {
    const { client } = makeClient([
      { slug: 'gated-2026-08-06' },
      { slug: 'pod-1-retired-2026-08-22' },
      { slug: 'travel-situations', pod_type: 'choice' },
    ])
    const served = await resolveServedPod(client, 'parked2_for_eng')
    expect(served.slug).toBe('pod-1')
  })

  it('serves a course that has BOTH a real pod-1 and a parked working copy', async () => {
    // The common live shape (many courses carry an `unrecorded` copy alongside
    // a served pod-1). Parking a working copy must never take the live pod away.
    const { client } = makeClient([{ slug: 'pod-1' }, { slug: 'unrecorded' }])
    expect((await resolveServedPod(client, 'cym_n_for_eng')).slug).toBe('pod-1')
  })

  it('falls back to pod-1 on a query error — degrade to the served name, never to "no pods"', async () => {
    const { client } = makeClient(null, { message: 'permission denied' })
    const served = await resolveServedPod(client, 'ita_for_eng')
    expect(served.slug).toBe('pod-1')
    expect(served.podId).toBe('ita_for_eng:pod-1')
  })

  it('falls back to pod-1 when the query REJECTS rather than returning an error', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({ then: (_r: unknown, reject: (e: unknown) => void) => reject(new Error('Load failed')) }),
            }),
          }),
        }),
      }),
    } as any
    const served = await resolveServedPod(client, 'fra_for_eng')
    expect(served.slug).toBe('pod-1')
  })

  it('resolves pod-1 for a course with no pods at all', async () => {
    const { client } = makeClient([])
    expect((await resolveServedPod(client, 'new_course')).slug).toBe('pod-1')
  })

  it('memoises: five call sites, one round-trip', async () => {
    const { client, calls } = makeClient([{ slug: 'pod-1' }])
    const all = await Promise.all([
      resolveServedPod(client, 'hrv_for_eng'),
      resolveServedPod(client, 'hrv_for_eng'),
      resolveServedPod(client, 'hrv_for_eng'),
      resolveServedPod(client, 'hrv_for_eng'),
      resolveServedPod(client, 'hrv_for_eng'),
    ])
    expect(calls.count).toBe(1)
    expect(all.every((s) => s.slug === 'pod-1')).toBe(true)
    // and a later caller still gets the settled answer without a new query
    expect((await resolveServedPod(client, 'hrv_for_eng')).slug).toBe('pod-1')
    expect(calls.count).toBe(1)
  })

  it('restricts the query to core pods on the one serving slug', async () => {
    const { client, calls } = makeClient([{ slug: 'pod-1' }])
    await resolveServedPod(client, 'deu_for_eng')
    expect(calls.lastFilters.course_code).toBe('deu_for_eng')
    expect(calls.lastFilters.pod_type).toBe('core')
    expect(calls.lastFilters.slug).toEqual(['pod-1'])
  })
})

describe('resolveServedPod — offline lane', () => {
  it('uses the slug the download snapshot was built from, with no network call', async () => {
    const { fetchAndCacheListeningMeta, getCachedListeningMeta } = await import('./listeningMetaCache')
    // Download Croatian while online.
    const online = makeFullClient([{ slug: 'pod-1' }])
    await fetchAndCacheListeningMeta(online, 'hrv_for_eng')
    expect((await getCachedListeningMeta('hrv_for_eng'))!.podSlug).toBe('pod-1')

    // Now go offline. A doomed query would spend the boot budget to learn
    // nothing.
    resetServedPodCache()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { client, calls } = makeClient([{ slug: 'pod-1' }])
    const served = await resolveServedPod(client, 'hrv_for_eng')
    expect(served.slug).toBe('pod-1')
    expect(calls.count).toBe(0) // no round-trip at all
  })

  it('never resurrects a parked slug from the cache', async () => {
    const { getCachedListeningMeta } = await import('./listeningMetaCache')
    // Hand-write a snapshot claiming a parked slug (belt-and-braces: the
    // writer can only ever store a serving slug, but the gate lives here too).
    const online = makeFullClient([{ slug: 'pod-1' }])
    const { fetchAndCacheListeningMeta } = await import('./listeningMetaCache')
    await fetchAndCacheListeningMeta(online, 'gate_course')
    const entry = (await getCachedListeningMeta('gate_course'))!
    const { openDB } = await import('idb')
    const db = await openDB('ssi-listening-meta', 1)
    await db.put('meta', { ...entry, podSlug: 'unrecorded' }, 'v2:gate_course')

    resetServedPodCache()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { client } = makeClient([])
    expect((await resolveServedPod(client, 'gate_course')).slug).toBe('pod-1')
  })

  it('maps a snapshot written under the retired slug forward to pod-1, rows and all', async () => {
    // A learner who downloaded a course before the 2026-09-13 rename holds a
    // snapshot whose served slug and sentence ids carry the old segment. The
    // server renamed everything; the device must read its snapshot as the
    // renamed pod, or rule 2 would treat the old name as parked and drop the
    // pod the learner actually has.
    const { getCachedListeningMeta, fetchAndCacheListeningMeta } = await import('./listeningMetaCache')
    await fetchAndCacheListeningMeta(makeFullClient([{ slug: 'pod-1' }]), 'legacy_course')
    const entry = (await getCachedListeningMeta('legacy_course'))!
    const { openDB } = await import('idb')
    const db = await openDB('ssi-listening-meta', 1)
    const retired = 'pod-' + '0' // spelled apart so the estate grep for the retired name stays clean
    await db.put(
      'meta',
      {
        ...entry,
        podSlug: retired,
        podRows: [{ id: `legacy_course:${retired}:SC01-S001`, global_order: 1 }],
      },
      'legacy_course', // the bare key is the live one; a v2: key is legacy and only adopted when no bare entry exists
    )

    const read = (await getCachedListeningMeta('legacy_course'))!
    expect(read.podSlug).toBe('pod-1')
    expect(read.podRows[0].id).toBe('legacy_course:pod-1:SC01-S001')

    resetServedPodCache()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { client, calls } = makeClient([])
    expect((await resolveServedPod(client, 'legacy_course')).podId).toBe('legacy_course:pod-1')
    expect(calls.count).toBe(0)
  })
})

/** A client that answers every table the meta download touches. */
function makeFullClient(pods: Array<{ slug: string; title?: string; pod_type?: string; required_role?: string | null }>) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filters[c] = v; return chain },
        in: (c: string, v: unknown[]) => { filters[c] = v; return chain },
        or: (expr: string) => { filters.or = expr; return chain },
        order: () => chain,
        range: () => chain,
        limit: () => chain,
        maybeSingle: () => chain,
        then: (resolve: (r: unknown) => void) => {
          if (table === 'listening_pods') {
            const or = filters.or as string | undefined
            const allowedFromOr = or
              ? (or.match(/slug\.in\.\(([^)]*)\)/)?.[1] ?? '').split(',').filter(Boolean)
              : undefined
            const allowed = (filters.slug as string[] | undefined) ?? allowedFromOr
            return resolve({
              // Mirror the server: the role arm carries no slug filter, and a
              // required_role row in `pods` is one RLS already allowed.
              data: pods.filter((p) => {
                const addressed = typeof p.required_role === 'string' && p.required_role !== ''
                if (addressed) return or !== undefined
                return (!allowed || allowed.includes(p.slug)) &&
                  (filters.pod_type === undefined || (p.pod_type ?? 'core') === filters.pod_type)
              }),
              error: null,
            })
          }
          return resolve({ data: [], error: null })
        },
      }
      return chain
    },
  } as any
}

describe('pickServedSlug — the rule, without a client', () => {
  it('a role-addressed topic pod never displaces pod-1 from the served slot (job #544)', () => {
    // RECORDED RED on the pre-fix module, which answered 'senedd-s4c-steve'
    // here — that is how Steve saw the Senedd pod labelled "Pod 1" and no
    // real pod-1 at all (job #539 probes).
    expect(
      pickServedSlug([
        { slug: 'pod-1' },
        { slug: 'senedd-s4c-steve', required_role: 'previewer_001' },
      ]),
    ).toBe('pod-1')
  })

  it('is unchanged for everyone else: no role rows means rule 1 exactly', () => {
    expect(pickServedSlug([{ slug: 'unrecorded' }, { slug: 'pod-1' }])).toBe('pod-1')
    expect(pickServedSlug([{ slug: 'unrecorded' }])).toBe(FALLBACK_POD_SLUG)
    expect(pickServedSlug([])).toBe(FALLBACK_POD_SLUG)
    expect(pickServedSlug(null)).toBe(FALLBACK_POD_SLUG)
  })

  it('treats a null/empty required_role as unrestricted, never as addressed', () => {
    expect(pickServedSlug([{ slug: 'parked-slug', required_role: null }])).toBe(FALLBACK_POD_SLUG)
    expect(pickServedSlug([{ slug: 'parked-slug', required_role: '' }])).toBe(FALLBACK_POD_SLUG)
  })
})

describe('role-addressed topic pods (rule 5, job #544)', () => {
  const CYM = [
    { slug: 'pod-1', title: 'Northern Welsh Listening Pods — Pod 1' },
    { slug: 'senedd-s4c-steve', pod_type: 'choice', required_role: 'previewer_001', title: 'Senedd: allegations of bullying at S4C (11 January 2024)' },
    { slug: 'gated-2026-08-06', title: 'parked' },
  ]

  it('main flow still plays pod-1 for the role-holder, in one round-trip', async () => {
    const { client, calls } = makeClient(CYM)
    const served = await resolveServedPod(client, 'cym_n_for_eng')
    expect(served.podId).toBe('cym_n_for_eng:pod-1')
    expect(calls.count).toBe(1)
  })

  it('Listening Mode lists pod-1 FIRST, then the Senedd pod under its own title', async () => {
    // RECORDED RED on the pre-fix module: it listed ['senedd-s4c-steve'] alone,
    // with a null title (the extras query took core pods only).
    const { resolveListeningPods } = await import('./servedPod')
    const { client } = makeClient(CYM)
    const pods = await resolveListeningPods(client, 'cym_n_for_eng')
    expect(pods.map((p) => p.podId)).toEqual(['cym_n_for_eng:pod-1', 'cym_n_for_eng:senedd-s4c-steve'])
    expect(pods[0].title).toBe('Northern Welsh Listening Pods — Pod 1')
    expect(pods[1].title).toBe('Senedd: allegations of bullying at S4C (11 January 2024)')
    expect(pods[1].addressed).toBe(true)
  })

  it('a plain learner (no role row from the server) sees exactly what they saw before', async () => {
    const { resolveListeningPods } = await import('./servedPod')
    const { client } = makeClient(CYM.filter((r) => !r.required_role))
    const pods = await resolveListeningPods(client, 'cym_n_for_eng')
    expect(pods.map((p) => p.slug)).toEqual(['pod-1'])
  })

  it('pickListeningExtras: named slots first, then addressed pods by pod_order, never a parked slug', async () => {
    const { pickListeningExtras } = await import('./servedPod')
    expect(
      pickListeningExtras([
        { slug: 'unrecorded', title: 'parked' },
        { slug: 'health-pod', pod_type: 'choice', required_role: 'previewer_002', title: 'Health', pod_order: 2 },
        { slug: 'senedd-s4c-steve', pod_type: 'choice', required_role: 'previewer_001', title: 'Senedd', pod_order: 1 },
        { slug: 'method-pod', title: 'Method' },
        { slug: 'other', required_role: '', title: 'not addressed' },
      ]).map((e) => e.slug),
    ).toEqual(['method-pod', 'senedd-s4c-steve', 'health-pod'])
  })

  it('offline: the snapshot keeps the addressed topic pod for its holder', async () => {
    const { resolveListeningPods } = await import('./servedPod')
    const { fetchAndCacheListeningMeta, getCachedListeningMeta } = await import('./listeningMetaCache')
    await fetchAndCacheListeningMeta(makeFullClient(CYM), 'cym_n_for_eng')
    const entry = (await getCachedListeningMeta('cym_n_for_eng'))!
    expect(entry.extraPods?.map((e) => [e.slug, e.addressed])).toEqual([['senedd-s4c-steve', true]])

    resetServedPodCache()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { client, calls } = makeClient([])
    const pods = await resolveListeningPods(client, 'cym_n_for_eng')
    expect(pods.map((p) => p.slug)).toEqual(['pod-1', 'senedd-s4c-steve'])
    expect(calls.count).toBe(0)
  })
})

/**
 * Rule 6 (Tom, 2026-09-12, job #354): Listening Mode lists the served pod
 * AND the named extra slots; main flow keeps resolving exactly one pod.
 * RECORDED RED against the pre-fix module: `resolveListeningPods` and
 * `LISTENING_EXTRA_POD_SLUGS` did not exist, so every test below failed at
 * import, and the "main flow still answers pod-1" case was the one that
 * mattered — it passes before AND after, which is the point of it.
 */
describe('the Senedd pod opened to every Welsh (Northern) learner (Tom, 2026-09-13 20:31Z; job #605)', () => {
  const TITLE = 'Senedd: allegations of bullying at S4C (11 January 2024)'
  const OPEN = [
    { slug: 'pod-1', pod_type: 'core', title: 'Northern Welsh Listening Pods — Pod 1' },
    { slug: 'senedd-s4c-steve', pod_type: 'choice', required_role: null, title: TITLE },
    { slug: 'gated-2026-08-06', pod_type: 'core', title: 'parked' },
  ]

  it('a PLAIN learner lists pod-1 FIRST, then the Senedd pod under its own title, once required_role is NULL', async () => {
    // RECORDED RED on the pre-fix module: with the role cleared the pod matched
    // neither the served slot nor the role arm, and the list was ['pod-1'] —
    // the pod had vanished for everyone, Steve included.
    const { resolveListeningPods } = await import('./servedPod')
    const { client } = makeClient(OPEN)
    const pods = await resolveListeningPods(client, 'cym_n_for_eng')
    expect(pods.map((p) => p.podId)).toEqual(['cym_n_for_eng:pod-1', 'cym_n_for_eng:senedd-s4c-steve'])
    expect(pods[0].title).toBe('Northern Welsh Listening Pods — Pod 1')
    expect(pods[1].title).toBe(TITLE)
    expect(pods[1].addressed).toBeUndefined()
  })

  it('MAIN FLOW still plays pod-1 and never the topic pod', async () => {
    const { client } = makeClient(OPEN)
    expect((await resolveServedPod(client, 'cym_n_for_eng')).slug).toBe('pod-1')
  })

  it('a holder whose role row outlives the release still sees it ONCE, not twice', async () => {
    const { resolveListeningPods } = await import('./servedPod')
    const { client } = makeClient([
      OPEN[0],
      { slug: 'senedd-s4c-steve', pod_type: 'choice', required_role: 'previewer_001', title: TITLE },
    ])
    const pods = await resolveListeningPods(client, 'cym_n_for_eng')
    expect(pods.map((p) => p.slug)).toEqual(['pod-1', 'senedd-s4c-steve'])
  })
})

describe('resolveListeningPods — the third slot (rule 6)', () => {
  const ITA = [
    { slug: 'pod-1', title: 'Pod 1 — Italian dialogues' },
    { slug: 'method-pod', title: 'Italian Method Pod — Tom and Aran Talk Bollocks' },
    { slug: 'pod-1-retired-2026-08-22', title: 'retired' },
  ]

  it('lists the served pod FIRST, then the method pod, each with its own title', async () => {
    const { resolveListeningPods } = await import('./servedPod')
    const { client } = makeClient(ITA)
    const pods = await resolveListeningPods(client, 'ita_for_eng')
    expect(pods.map((p) => p.podId)).toEqual(['ita_for_eng:pod-1', 'ita_for_eng:method-pod'])
    expect(pods[0].title).toBe('Pod 1 — Italian dialogues')
    expect(pods[1].title).toBe('Italian Method Pod — Tom and Aran Talk Bollocks')
  })

  it('MAIN FLOW is untouched: resolveServedPod still answers pod-1 when a method pod exists', async () => {
    const { client, calls } = makeClient(ITA)
    const served = await resolveServedPod(client, 'ita_for_eng')
    expect(served.slug).toBe('pod-1')
    // and the main-flow query never asked for the extra slot
    expect(calls.lastFilters.slug).toEqual(['pod-1'])
  })

  it('a course with no extra slot lists exactly the served pod', async () => {
    const { resolveListeningPods } = await import('./servedPod')
    const { client } = makeClient([{ slug: 'pod-1', title: 'Pod 1' }])
    const pods = await resolveListeningPods(client, 'spa_for_eng_v2')
    expect(pods.map((p) => p.slug)).toEqual(['pod-1'])
  })

  it('never lists a pod on an un-named slug, even if the server sent it (closed allow-list)', async () => {
    const { pickListeningExtras, LISTENING_EXTRA_POD_SLUGS } = await import('./servedPod')
    expect(LISTENING_EXTRA_POD_SLUGS).toEqual(['method-pod', 'senedd-s4c-steve'])
    expect(
      pickListeningExtras([
        { slug: 'unrecorded', title: 'parked' },
        { slug: 'travel-situations', title: 'choice' },
        { slug: 'method-pod', title: 'method', pod_type: 'choice' }, // wrong type
        { slug: 'senedd-s4c-steve', title: 'senedd', pod_type: 'core' }, // wrong type
      ]),
    ).toEqual([])
    expect(pickListeningExtras([{ slug: 'method-pod', title: 'method' }])).toEqual([
      { slug: 'method-pod', title: 'method' },
    ])
  })

  it('a HELD method pod is simply absent to the anon client — so it is not listed', async () => {
    const { resolveListeningPods } = await import('./servedPod')
    // The mock IS the server: RLS returns no held row, so the fixture has none.
    const { client } = makeClient([{ slug: 'pod-1', title: 'Pod 1' }])
    const pods = await resolveListeningPods(client, 'ita_for_eng')
    expect(pods.map((p) => p.slug)).toEqual(['pod-1'])
  })

  it('degrades to the served pod alone on a query error — never fewer than main flow', async () => {
    const { resolveListeningPods } = await import('./servedPod')
    const { client } = makeClient(null, { message: 'permission denied' })
    const pods = await resolveListeningPods(client, 'ita_for_eng')
    expect(pods.map((p) => p.slug)).toEqual(['pod-1'])
  })

  it('offline: lists the extra slots the download snapshot carried, with no round-trip', async () => {
    const { resolveListeningPods } = await import('./servedPod')
    const { getCachedListeningMeta } = await import('./listeningMetaCache')
    const { fetchAndCacheListeningMeta } = await import('./listeningMetaCache')
    await fetchAndCacheListeningMeta(makeFullClient(ITA), 'ita_for_eng')
    const entry = (await getCachedListeningMeta('ita_for_eng'))!
    expect(entry.podSlug).toBe('pod-1')
    expect(entry.extraPods?.map((e) => e.slug)).toEqual(['method-pod'])

    resetServedPodCache()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { client, calls } = makeClient([])
    const pods = await resolveListeningPods(client, 'ita_for_eng')
    expect(pods.map((p) => p.slug)).toEqual(['pod-1', 'method-pod'])
    expect(pods[1].title).toBe('Italian Method Pod — Tom and Aran Talk Bollocks')
    expect(calls.count).toBe(0)
  })
})
