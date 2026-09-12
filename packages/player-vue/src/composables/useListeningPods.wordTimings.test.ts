/**
 * useListeningPods — word timings ride the pod clip read to the overlay's
 * turn (job #408). Pins the whole chain: course_audio.word_boundaries →
 * timingsById → PodSentence.wordTimings → PodTurn.sentences[0].wordTimings
 * (the object openScene hands the tracker), online and in the offline
 * snapshot. The turn-level copy is where the first staging build lost it:
 * mergeTurns copies an explicit field list, and wordTimings was not on it.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it, afterEach } from 'vitest'
import { createApp, ref, type Ref } from 'vue'
import { openDB } from 'idb'
import { useListeningPods, type UseListeningPodsReturn } from './useListeningPods'
import { fetchAndCacheListeningMeta } from './listeningMetaCache'

type RouteResult = { data: any; error: { message: string } | null }
class FakeQuery {
  filters: Record<string, any> = {}
  inFilter: { column: string; values: any[] } | null = null
  constructor(private table: string, private routes: Record<string, (q: FakeQuery) => RouteResult>) {}
  select() { return this }
  eq(column: string, value: any) { this.filters[column] = value; return this }
  in(column: string, values: any[]) { this.inFilter = { column, values }; return this }
  order() { return this }
  range() { return this }
  limit() { return this }
  maybeSingle() { return this }
  then(resolve: (r: RouteResult) => void) {
    const route = this.routes[this.table]
    resolve(route ? route(this) : { data: null, error: { message: `no route for ${this.table}` } })
  }
}
const makeFakeClient = (routes: Record<string, (q: FakeQuery) => RouteResult>) =>
  ({ from: (table: string) => new FakeQuery(table, routes) }) as any

const AZURE = [{ text: 'Mogu', offset: 50, duration: 250 }, { text: 'li', offset: 313, duration: 100 }]
const POD_ROWS = [
  {
    id: 'p1', scene_number: 1, sentence_number: 1, global_order: 1, speaker: 'Ana',
    target_text: 'Ciao. Come stai?', known_text: 'Hi. How are you?',
    target_audio_id: 'pod-t1', known_audio_id: null, explainer_audio_id: null, glue_to_next: false,
    atom_map: null, sentence_audio_ids: ['split-t1', 'split-t2'], sentence_known_audio_ids: null,
    atom_map_fine: null, window_known_map: null, takeg_audio_ids: null, variant_key: null, attach_sentence_number: null,
  },
  {
    id: 'p2', scene_number: 1, sentence_number: 2, global_order: 2, speaker: 'Ben',
    target_text: 'Mogu li dobiti… kavu?', known_text: 'Can I get… a coffee?',
    target_audio_id: 'pod-t2', known_audio_id: null, explainer_audio_id: null, glue_to_next: false,
    atom_map: null, sentence_audio_ids: null, sentence_known_audio_ids: null,
    atom_map_fine: null, window_known_map: null, takeg_audio_ids: null, variant_key: null, attach_sentence_number: null,
  },
]
const CLIPS: Record<string, { text: string; word_boundaries: unknown }> = {
  'split-t1': { text: 'Ciao.', word_boundaries: AZURE },
  'split-t2': { text: 'Come stai?', word_boundaries: null },
  'pod-t1': { text: 'Ciao. Come stai?', word_boundaries: null },
  'pod-t2': { text: 'Mogu li dobiti… kavu?', word_boundaries: AZURE },
}
const client = makeFakeClient({
  courses: () => ({ data: { content_stamp: 's1', audio_stamp: 'a1' }, error: null }),
  listening_pods: () => ({ data: [{ id: 'hrv_for_eng:pod-1', slug: 'pod-1', title: 'Pod 1', pod_type: 'core', pod_order: 1 }], error: null }),
  listening_pod_sentences: () => ({ data: POD_ROWS, error: null }),
  course_seeds: () => ({ data: [], error: null }),
  course_legos: () => ({ data: [], error: null }),
  course_practice_phrases: () => ({ data: [], error: null }),
  audio_revisions: () => ({ data: [], error: null }),
  course_audio: (q) => {
    if (q.inFilter?.column === 'id') {
      return { data: q.inFilter.values.filter((id: string) => CLIPS[id]).map((id: string) => ({ id, ...CLIPS[id] })), error: null }
    }
    return { data: [], error: null }
  },
})

function mountPods(course: string): { pods: UseListeningPodsReturn; flush: () => Promise<void> } {
  let pods!: UseListeningPodsReturn
  const courseCode: Ref<string | null> = ref(course)
  const app = createApp({ setup() { pods = useListeningPods(courseCode); return () => null } })
  app.provide('supabase', { value: client })
  app.mount(document.createElement('div'))
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 100)) }
  return { pods, flush }
}

afterEach(async () => {
  const db = await openDB('ssi-listening-meta', undefined)
  for (const store of Array.from(db.objectStoreNames)) await db.clear(store)
  db.close()
})

describe('useListeningPods — word timings reach the turn the overlay renders', () => {
  it('carries word_boundaries onto each sentence of each turn: split clip, whole-turn clip, null where absent', async () => {
    const { pods, flush } = mountPods('hrv_for_eng')
    await flush()
    expect(pods.error.value).toBeNull()
    const scene = pods.scenes.value[0]
    expect(scene).toBeTruthy()
    const units = scene.turns.flatMap((t) => t.sentences)
    const byClip = new Map(units.map((u) => [u.targetAudioId, u.wordTimings]))
    expect(byClip.get('split-t1')).toEqual(AZURE)
    expect(byClip.get('split-t2')).toBeNull()
    expect(byClip.get('pod-t2')).toEqual(AZURE)
  })

  it('the offline snapshot carries the same timings for the whole-turn clip and the split clip', async () => {
    const meta = await fetchAndCacheListeningMeta(client, 'hrv_for_eng')
    expect(meta).toBeTruthy()
    expect(meta!.clipTimings?.['pod-t2']).toEqual(AZURE)
    expect(meta!.clipTimings?.['split-t1']).toEqual(AZURE)
    expect(meta!.clipTimings?.['split-t2']).toBeUndefined()
  })
})
