/**
 * listeningMetaCache tests — vitest, fake-indexeddb.
 *
 * The offline round-3 contract (Tom's airplane-mode test 2026-07-09):
 *  1. fetchAndCacheListeningMeta persists pods + Core seeds + bookends +
 *     fine-knowns + LEGO catalogue as ONE all-or-nothing entry.
 *  2. A failed fetch caches NOTHING (entry-present must always mean
 *     fully-usable).
 *  3. collectListeningMetaAudioIds derives every clip the metadata can
 *     reference (incl. split sentences, Take-G slices, fine-knowns), so
 *     cached metadata can never point at un-downloaded audio.
 *  4. useListeningPods falls back to the cache when offline / the live
 *     fetch fails — content when downloaded, the explicit not-downloaded
 *     message when not. Never a raw TypeError, never a stuck spinner.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createApp, ref, type Ref } from 'vue'
import {
  fetchAndCacheListeningMeta,
  getCachedListeningMeta,
  collectListeningMetaAudioIds,
} from './listeningMetaCache'
import { useListeningPods, type UseListeningPodsReturn } from './useListeningPods'

// ── Fake supabase: a thenable query builder routed per table ──────────────

type RouteResult = { data: any[] | null; error: { message: string } | null }

function makeFakeClient(routes: Record<string, (q: FakeQuery) => RouteResult>) {
  return {
    from(table: string) {
      return new FakeQuery(table, routes)
    },
  } as any
}

class FakeQuery {
  filters: Record<string, any> = {}
  inFilter: { column: string; values: any[] } | null = null
  constructor(
    private table: string,
    private routes: Record<string, (q: FakeQuery) => RouteResult>,
  ) {}
  select() { return this }
  eq(column: string, value: any) { this.filters[column] = value; return this }
  in(column: string, values: any[]) { this.inFilter = { column, values }; return this }
  order() { return this }
  range() { return this }
  limit() { return this }
  then(resolve: (r: RouteResult) => void, reject?: (e: unknown) => void) {
    try {
      const route = this.routes[this.table]
      const result = route
        ? route(this)
        : { data: null, error: { message: `no route for ${this.table}` } }
      resolve(result)
    } catch (e) {
      reject?.(e)
    }
  }
}

const failAll = makeFakeClient(new Proxy({}, {
  get: () => () => ({ data: null, error: { message: 'TypeError: Load failed' } }),
}) as any)

// ── Fixture: a small course with every id-bearing shape ───────────────────

const POD_ROWS = [
  {
    id: 'p1', scene_number: 1, sentence_number: 1, global_order: 1,
    speaker: 'Anna (08:00)', target_text: 'Ciao. Come stai?', known_text: 'Hi. How are you?',
    target_audio_id: 'pod-t1', known_audio_id: 'pod-k1', explainer_audio_id: 'pod-e1',
    glue_to_next: false, atom_map: null,
    sentence_audio_ids: ['split-t1', 'split-t2'],
    sentence_known_audio_ids: ['split-k1', 'split-k2'],
    atom_map_fine: null, window_known_map: null,
    takeg_audio_ids: ['takeg-1', null],
  },
  {
    id: 'p2', scene_number: 1, sentence_number: 2, global_order: 2,
    speaker: 'Marco', target_text: 'Bene, grazie.', known_text: 'Well, thanks.',
    target_audio_id: 'pod-t2', known_audio_id: 'pod-k2', explainer_audio_id: null,
    glue_to_next: false, atom_map: null,
    sentence_audio_ids: null, sentence_known_audio_ids: null,
    atom_map_fine: null, window_known_map: null, takeg_audio_ids: null,
  },
]

const SEED_ROWS = [
  {
    seed_number: 1, known_text: 'I want to speak', target_text: 'voglio parlare',
    target_text_roman: null, known_audio_id: 'seed-k1',
    target1_audio_id: 'seed-t1a', target2_audio_id: 'seed-t1b',
  },
  {
    seed_number: 2, known_text: 'now', target_text: 'adesso',
    target_text_roman: null, known_audio_id: null,
    target1_audio_id: 'seed-t2a', target2_audio_id: null,
  },
]

const happyClient = makeFakeClient({
  listening_pod_sentences: () => ({ data: POD_ROWS, error: null }),
  course_audio: (q) => {
    if (q.inFilter?.column === 'id') {
      // split-clip display texts
      return {
        data: q.inFilter.values.map((id: string) => ({ id, text: `text of ${id}` })),
        error: null,
      }
    }
    if (q.filters.role === 'pod_fine_known') {
      return { data: [{ id: 'fine-1', text_normalized: 'come stai' }], error: null }
    }
    // bookends (.in on role)
    return {
      data: [
        { role: 'bookend_listen_intro', text: 'time to listen', id: 'bk-in', duration_ms: 1200 },
        { role: 'bookend_listen_outro', text: 'back to speaking', id: 'bk-out', duration_ms: 1100 },
      ],
      error: null,
    }
  },
  course_seeds: () => ({ data: SEED_ROWS, error: null }),
  course_legos: () => ({
    data: [
      { seed_number: 1, lego_index: 1 },
      { seed_number: 1, lego_index: 2 },
      { seed_number: 2, lego_index: 1 },
    ],
    error: null,
  }),
})

// bookends use .in('role', ...) too — disambiguate from split texts by column.
// (Handled above: id-in → texts; role filter eq → fine-knowns; else bookends.)

afterEach(async () => {
  vi.restoreAllMocks()
})

describe('fetchAndCacheListeningMeta', () => {
  it('persists a full entry and round-trips it', async () => {
    const meta = await fetchAndCacheListeningMeta(happyClient, 'ita_for_eng')
    expect(meta).not.toBeNull()
    const cached = await getCachedListeningMeta('ita_for_eng')
    expect(cached).not.toBeNull()
    expect(cached!.podRows).toHaveLength(2)
    expect(cached!.coreSeeds).toHaveLength(2)
    expect(cached!.bookends.map((b) => b.role).sort()).toEqual([
      'bookend_listen_intro', 'bookend_listen_outro',
    ])
    expect(cached!.fineKnowns['come stai']).toBe('fine-1')
    expect(cached!.legoCatalogue).toHaveLength(3)
    // Split-clip texts recorded for BOTH target and known split ids.
    expect(Object.keys(cached!.clipTexts).sort()).toEqual(
      ['split-k1', 'split-k2', 'split-t1', 'split-t2'],
    )
  })

  it('caches nothing when any query fails (all-or-nothing)', async () => {
    const meta = await fetchAndCacheListeningMeta(failAll, 'fra_for_eng')
    expect(meta).toBeNull()
    expect(await getCachedListeningMeta('fra_for_eng')).toBeNull()
  })
})

describe('collectListeningMetaAudioIds', () => {
  it('derives every id class: seeds, pod turns, splits, Take-G, fine-knowns, bookends', async () => {
    const meta = await fetchAndCacheListeningMeta(happyClient, 'ita_for_eng')
    const ids = new Set(collectListeningMetaAudioIds(meta!))
    for (const expected of [
      'seed-k1', 'seed-t1a', 'seed-t1b', 'seed-t2a',       // Core seeds (nulls skipped)
      'pod-t1', 'pod-k1', 'pod-e1', 'pod-t2', 'pod-k2',    // pod turns
      'split-t1', 'split-t2', 'split-k1', 'split-k2',      // per-sentence splits
      'takeg-1',                                            // Take-G fusion slices
      'fine-1',                                             // fine-known glosses
      'bk-in', 'bk-out',                                    // bookends
    ]) {
      expect(ids.has(expected), `missing ${expected}`).toBe(true)
    }
    expect(ids.has('null')).toBe(false)
  })
})

// ── The overlay path: useListeningPods offline behaviour ──────────────────

function mountPods(client: any, course: string): { pods: UseListeningPodsReturn; flush: () => Promise<void> } {
  let pods!: UseListeningPodsReturn
  const courseCode: Ref<string | null> = ref(course)
  const app = createApp({
    setup() {
      pods = useListeningPods(courseCode)
      return () => null
    },
  })
  app.provide('supabase', { value: client })
  app.mount(document.createElement('div'))
  // fetchData chains several awaits (IDB reads + fake queries) — drain a
  // generous run of macrotasks so it fully settles.
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)) }
  return { pods, flush }
}

describe('useListeningPods offline fallback', () => {
  it('serves scenes from the cached metadata when the live fetch fails', async () => {
    await fetchAndCacheListeningMeta(happyClient, 'ita_for_eng') // downloaded earlier, online
    const { pods, flush } = mountPods(failAll, 'ita_for_eng')
    await flush()
    expect(pods.isLoading.value).toBe(false)      // never a stuck spinner
    expect(pods.error.value).toBeNull()
    expect(pods.scenes.value).toHaveLength(1)     // scene 1 built from cache
    expect(pods.scenes.value[0].sentenceCount).toBeGreaterThan(0)
  })

  it('shows the explicit not-downloaded message offline with no cache — never the raw TypeError', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { pods, flush } = mountPods(failAll, 'never_downloaded')
    await flush()
    expect(pods.isLoading.value).toBe(false)      // never a stuck spinner
    expect(pods.scenes.value).toHaveLength(0)
    expect(pods.error.value).toMatch(/aren't downloaded yet/)
    expect(pods.error.value).not.toMatch(/TypeError/)
  })
})
