/**
 * useListeningPods — the jump-in marker rides the pod line read to the turn
 * the overlay plays (job #470; Popty writes `jump_in` on the line row, job
 * #471). Pins the chain: listening_pod_sentences.jump_in → PodSentence.jumpIn
 * → PodTurn.sentences[0].jumpIn, online and in the offline snapshot's column
 * list, and that a split row jumps in on its FIRST sentence only.
 *
 * Fails on the pre-#470 code: the live select never asked for the column, so
 * the row carried nothing, and the turn copied an explicit field list without
 * it — exactly how wordTimings went missing on its first staging build.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it, afterEach } from 'vitest'
import { createApp, ref, type Ref } from 'vue'
import { openDB } from 'idb'
import { useListeningPods, type UseListeningPodsReturn } from './useListeningPods'
import { POD_ROW_COLUMNS } from './listeningMetaCache'

type RouteResult = { data: any; error: { message: string } | null }
const selects: Array<{ table: string; columns: string }> = []
class FakeQuery {
  filters: Record<string, any> = {}
  inFilter: { column: string; values: any[] } | null = null
  constructor(private table: string, private routes: Record<string, (q: FakeQuery) => RouteResult>) {}
  select(columns?: string) { selects.push({ table: this.table, columns: String(columns ?? '') }); return this }
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

const base = {
  known_audio_id: null, explainer_audio_id: null, glue_to_next: false, atom_map: null,
  sentence_known_audio_ids: null, atom_map_fine: null, window_known_map: null, takeg_audio_ids: null,
  variant_key: null, attach_sentence_number: null,
}
const POD_ROWS = [
  // A genuine turn: no marker at all (the column is nullable, and rows
  // written before it carry nothing).
  { ...base, id: 'p1', scene_number: 1, sentence_number: 1, global_order: 1, speaker: 'Tom',
    target_text: 'Allora, cosa facciamo oggi?', known_text: 'So, what are we doing today?',
    target_audio_id: 'pod-t1', sentence_audio_ids: null },
  // A jump-in, split into two sentences: the FIRST interrupts, the second is
  // Aran carrying on.
  { ...base, id: 'p2', scene_number: 1, sentence_number: 2, global_order: 2, speaker: 'Aran',
    target_text: 'Sì sì! Lo so già.', known_text: 'Yes yes! I already know.',
    target_audio_id: 'pod-t2', sentence_audio_ids: ['split-2a', 'split-2b'], jump_in: true },
  // Explicitly a turn.
  { ...base, id: 'p3', scene_number: 1, sentence_number: 3, global_order: 3, speaker: 'Tom',
    target_text: 'Davvero?', known_text: 'Really?',
    target_audio_id: 'pod-t3', sentence_audio_ids: null, jump_in: false },
]
const CLIPS: Record<string, { text: string; word_boundaries: unknown }> = {
  'split-2a': { text: 'Sì sì!', word_boundaries: null },
  'split-2b': { text: 'Lo so già.', word_boundaries: null },
  'pod-t1': { text: 'Allora, cosa facciamo oggi?', word_boundaries: null },
  'pod-t2': { text: 'Sì sì! Lo so già.', word_boundaries: null },
  'pod-t3': { text: 'Davvero?', word_boundaries: null },
}
const client = makeFakeClient({
  courses: () => ({ data: { content_stamp: 's1', audio_stamp: 'a1' }, error: null }),
  listening_pods: () => ({ data: [{ id: 'ita_for_eng:method-pod', slug: 'method-pod', title: 'Method', pod_type: 'core', pod_order: 1 }], error: null }),
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

describe('useListeningPods — the jump-in marker reaches the turn the overlay plays', () => {
  it('jump_in true → jumpIn on the first sentence only; false or absent → a turn', async () => {
    const { pods, flush } = mountPods('ita_for_eng')
    await flush()
    expect(pods.error.value).toBeNull()
    const scene = pods.scenes.value[0]
    expect(scene).toBeTruthy()
    const units = scene.turns.flatMap((t) => t.sentences)
    const byClip = new Map(units.map((u) => [u.targetAudioId, u.jumpIn]))
    expect(byClip.get('pod-t1')).toBe(false)     // absent → turn
    expect(byClip.get('split-2a')).toBe(true)    // the interruption
    expect(byClip.get('split-2b')).toBe(false)   // same speaker carrying on
    expect(byClip.get('pod-t3')).toBe(false)     // explicit false → turn
    // The turn-level copy is a typed boolean on every sentence, never undefined.
    for (const u of units) expect(typeof u.jumpIn).toBe('boolean')
  })

  it('the live read asks the line row for jump_in, and so does the offline snapshot', async () => {
    selects.length = 0
    const { pods, flush } = mountPods('ita_for_eng')
    await flush()
    expect(pods.error.value).toBeNull()
    const live = selects.find((s) => s.table === 'listening_pod_sentences')
    expect(live?.columns.split(/,\s*/)).toContain('jump_in')
    expect(POD_ROW_COLUMNS.split(/,\s*/)).toContain('jump_in')
  })
})
