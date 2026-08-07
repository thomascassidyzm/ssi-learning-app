/**
 * A-86 — per-lane proof that a REVISED clip comes out of each Supabase walk
 * carrying its `.v<N>` suffix.
 *
 * Why this file exists separately from `revisedAudioRefs.test.ts`: that one
 * tests the helper in isolation. These tests drive the LANES — the code paths
 * that walk Supabase for themselves rather than going through
 * `generateLearningScript` — because the bug being closed is not "the helper is
 * wrong", it is "the helper was never called here". Each test therefore feeds a
 * fake revised clip through the real `initialize()` / loader of a lane and
 * asserts the stamped ref is what reaches the thing that builds a URL or an
 * IndexedDB key.
 *
 * A bare uuid for a revised clip is a permanent stale-audio bug on that device:
 * both caches key on the ref string.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createApp, ref } from 'vue'
import { usePodStage0 } from '../composables/usePodStage0'
import { fetchAndCacheListeningMeta } from '../composables/listeningMetaCache'
import { clearRevisedAudioRefs, getRevisedAudioRefs, stampRowAudioRefs } from './revisedAudioRefs'
import { usePodLapScheduler } from '../composables/usePodLapScheduler'
import { useLayer1Scheduler } from '../composables/useLayer1Scheduler'
import { CourseDataProvider } from './CourseDataProvider'

const COURSE = 'fra_for_eng'

/** Clips the fake DB reports as revised, with the revision each sits at. */
const REVISED: Record<string, number> = {
  'clip-known': 2,
  'clip-t1': 3,
  'clip-t2': 2,
  'clip-intro': 4,
  'clip-sentence-a': 2,
  'clip-welcome': 5,
  'clip-presentation': 2,
  'clip-explainer': 2,
}

/**
 * Minimal Supabase double. Every chained filter returns the chain; the table
 * name plus the presence of the `audio_revision` filter decides the payload,
 * which is exactly how the real lanes distinguish their content walk from the
 * revised-ref lookup.
 */
function makeSupabase(tables: Record<string, any[]>) {
  const calls: string[] = []
  const from = (table: string) => {
    let isRevisionLookup = false
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      like: () => chain,
      lt: () => chain,
      lte: () => chain,
      gte: () => chain,
      not: () => chain,
      or: () => chain,
      range: () => chain,
      order: () => chain,
      limit: () => chain,
      gt: (col: string) => {
        if (col === 'audio_revision') isRevisionLookup = true
        return chain
      },
      maybeSingle: () => {
        single = true
        return chain
      },
      single: () => {
        single = true
        return chain
      },
      then: (cb: any) => resolve().then(cb),
    }
    let single = false
    const resolve = () => {
      calls.push(`${table}${isRevisionLookup ? ':revisions' : ''}`)
      if (isRevisionLookup) {
        return Promise.resolve({
          data: Object.entries(REVISED).map(([id, audio_revision]) => ({ id, audio_revision })),
          error: null,
        })
      }
      const rows = tables[table] ?? []
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null })
    }
    return chain
  }
  return { client: { from } as any, calls }
}

beforeEach(() => clearRevisedAudioRefs())

// ---------------------------------------------------------------------------
// Shared map — one query per course across every lane
// ---------------------------------------------------------------------------
describe('getRevisedAudioRefs — the shared map', () => {
  it('queries once per course however many lanes ask', async () => {
    const { client, calls } = makeSupabase({})
    const [a, b, c] = await Promise.all([
      getRevisedAudioRefs(client, COURSE),
      getRevisedAudioRefs(client, COURSE),
      getRevisedAudioRefs(client, COURSE),
    ])
    expect(a.get('clip-t1')).toBe('clip-t1.v3')
    expect(b).toBe(a)
    expect(c).toBe(a)
    expect(calls.filter((c) => c.endsWith(':revisions'))).toHaveLength(1)
  })

  it('does NOT memoise an empty result, so one transient failure cannot strand a session on bare refs', async () => {
    const failing = {
      from: () => {
        throw new Error('network')
      },
    } as any
    const first = await getRevisedAudioRefs(failing, COURSE)
    expect(first.size).toBe(0)

    // Same course, now healthy — must re-query rather than serve the empty map.
    const { client } = makeSupabase({})
    const second = await getRevisedAudioRefs(client, COURSE)
    expect(second.get('clip-known')).toBe('clip-known.v2')
  })
})

// ---------------------------------------------------------------------------
// Array columns — the pod silence-split clips
// ---------------------------------------------------------------------------
describe('stampRowAudioRefs — array id columns', () => {
  it('stamps sentence_audio_ids, which become per-sentence clips downstream', () => {
    const refs = new Map([['clip-sentence-a', 'clip-sentence-a.v2']])
    const [row] = stampRowAudioRefs(refs, [
      { id: 'turn-1', sentence_audio_ids: ['clip-sentence-a', 'clip-plain'], sentence_known_audio_ids: null },
    ])
    expect(row.sentence_audio_ids).toEqual(['clip-sentence-a.v2', 'clip-plain'])
  })

  it('leaves a row with no revised array id untouched, object identity included', () => {
    const refs = new Map([['clip-sentence-a', 'clip-sentence-a.v2']])
    const input = [{ id: 'turn-2', sentence_audio_ids: ['clip-plain'] }]
    expect(stampRowAudioRefs(refs, input)[0]).toBe(input[0])
  })
})

// ---------------------------------------------------------------------------
// LANE 1 — listening pod laps (usePodLapScheduler)
// ---------------------------------------------------------------------------
describe('lane: usePodLapScheduler', () => {
  it('stamps pod sentence clips and listening bookends at the walk', async () => {
    const { client } = makeSupabase({
      listening_pod_sentences: [
        {
          id: `${COURSE}:pod-0:1`,
          global_order: 1,
          scene_number: 1,
          speaker: 'A',
          target_text: 'bonjour',
          known_text: 'hello',
          target_audio_id: 'clip-t1',
          known_audio_id: 'clip-known',
          explainer_audio_id: 'clip-explainer',
          glue_to_next: false,
          atom_map: null,
          sentence_audio_ids: null,
          sentence_known_audio_ids: null,
        },
      ],
      course_audio: [
        { role: 'bookend_listen_intro', text: 'intro', id: 'clip-intro', duration_ms: 1000 },
        { role: 'bookend_listen_outro', text: 'outro', id: 'clip-plain', duration_ms: 1000 },
      ],
    })

    const scheduler = usePodLapScheduler({
      supabase: { value: client } as any,
      courseCode: COURSE,
      learnerId: 'guest-1',
    } as any)
    await scheduler.initialize()

    const sentence = scheduler.podSentences.value[0] as any
    expect(sentence.target_audio_id).toBe('clip-t1.v3')
    expect(sentence.known_audio_id).toBe('clip-known.v2')
    expect(sentence.explainer_audio_id).toBe('clip-explainer.v2')

    // Bookends feed the same `/api/audio/${id}` builder.
    expect(scheduler.introAudio.value?.id).toBe('clip-intro.v4')
    // Unrevised clips keep their bare uuid — their cached bytes stay valid.
    expect(scheduler.outroAudio.value?.id).toBe('clip-plain')
  })
})

// ---------------------------------------------------------------------------
// LANE 2 — Layer-1 listening (useLayer1Scheduler)
// ---------------------------------------------------------------------------
describe('lane: useLayer1Scheduler', () => {
  it('stamps seed clips and bookends at the walk', async () => {
    const { client } = makeSupabase({
      course_seeds: [
        {
          seed_number: 1,
          known_text: 'hello',
          target_text: 'bonjour',
          target_text_roman: null,
          known_audio_id: 'clip-known',
          target1_audio_id: 'clip-t1',
          target2_audio_id: 'clip-t2',
        },
      ],
      course_legos: [{ seed_number: 1, lego_index: 1 }],
      course_audio: [
        { role: 'bookend_listen_intro', text: 'intro', id: 'clip-intro', duration_ms: 1000 },
      ],
    })

    const scheduler = useLayer1Scheduler({ supabase: { value: client }, courseCode: COURSE } as any)
    await scheduler.initialize()

    const seed = scheduler.seeds.value.get(1)!
    expect(seed.known_audio_id).toBe('clip-known.v2')
    expect(seed.target1_audio_id).toBe('clip-t1.v3')
    expect(seed.target2_audio_id).toBe('clip-t2.v2')
    expect(scheduler.introAudio.value?.id).toBe('clip-intro.v4')
  })
})

// ---------------------------------------------------------------------------
// LANE 3 — the OFFLINE listening snapshot (listeningMetaCache)
//
// The load-bearing one: offline, the revised-ref lookup cannot run, so the
// schedulers' own stamping degrades to a no-op. If the snapshot was written
// bare, an offline learner plays the pre-repair clip for the snapshot's life.
// ---------------------------------------------------------------------------
describe('lane: listeningMetaCache offline snapshot', () => {
  it('persists versioned refs, and still resolves clip texts by the bare uuid', async () => {
    const { client } = makeSupabase({
      listening_pod_sentences: [
        {
          id: `${COURSE}:pod-0:1`,
          global_order: 1,
          speaker: 'A',
          target_text: 'bonjour',
          known_text: 'hello',
          target_audio_id: 'clip-t1',
          known_audio_id: 'clip-known',
          explainer_audio_id: null,
          glue_to_next: false,
          atom_map: null,
          sentence_audio_ids: ['clip-sentence-a'],
          sentence_known_audio_ids: null,
        },
      ],
      course_audio: [
        // Serves three roles in this fake DB: bookends, the split-clip text
        // lookup (queried by BARE id), and the fine-known page.
        { role: 'bookend_listen_intro', text: 'intro', id: 'clip-intro', duration_ms: 900 },
        { id: 'clip-sentence-a', text: 'bonjour', text_normalized: 'bonjour' },
      ],
      course_seeds: [
        {
          seed_number: 1,
          known_text: 'hello',
          target_text: 'bonjour',
          target_text_roman: null,
          known_audio_id: 'clip-known',
          target1_audio_id: 'clip-t1',
          target2_audio_id: 'clip-t2',
        },
      ],
      course_legos: [{ seed_number: 1, lego_index: 1 }],
      courses: [{ content_stamp: 'stamp-1' }],
    })

    // The IndexedDB write logs a failure under happy-dom (no indexedDB) and is
    // swallowed by design; the returned snapshot is the thing under test here.
    const meta = (await fetchAndCacheListeningMeta(client, COURSE))!
    expect(meta).toBeTruthy()

    expect(meta.podRows[0].target_audio_id).toBe('clip-t1.v3')
    expect(meta.podRows[0].sentence_audio_ids).toEqual(['clip-sentence-a.v2'])
    expect(meta.coreSeeds[0].target1_audio_id).toBe('clip-t1.v3')
    expect(meta.bookends.some((b: any) => b.id === 'clip-intro.v4')).toBe(true)

    // The text lookup had to go to the DB with the bare uuid, but comes back
    // keyed by the stamped ref — which is what the overlay will ask for.
    expect(meta.clipTexts['clip-sentence-a.v2']).toBe('bonjour')
    expect(meta.clipTexts['clip-sentence-a']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// LANE 4 — pod stage auditioner (usePodStage0, drives PodStageAuditioner.vue)
// ---------------------------------------------------------------------------
describe('lane: usePodStage0', () => {
  it('stamps the clips the auditioner plays', async () => {
    const { client } = makeSupabase({
      listening_pod_sentences: [
        {
          id: `${COURSE}:pod-0:1`,
          global_order: 1,
          speaker: 'A',
          target_text: 'bonjour',
          known_text: 'hello',
          target_audio_id: 'clip-t1',
          known_audio_id: 'clip-known',
          explainer_audio_id: 'clip-explainer',
          glue_to_next: false,
          atom_map: null,
        },
      ],
      pod_legos: [],
      course_audio: [],
    })

    // usePodStage0 reads its client via inject(), so it needs an app context.
    const app = createApp({})
    app.provide('supabase', { value: client })
    const stage = app.runWithContext(() => usePodStage0(ref(COURSE)))
    await stage.load()

    const main = stage.mainAudioFor(`${COURSE}:pod-0:1`)!
    expect(main.targetAudioId).toBe('clip-t1.v3')
    expect(main.knownAudioId).toBe('clip-known.v2')
    expect(main.explainerAudioId).toBe('clip-explainer.v2')
  })
})

// ---------------------------------------------------------------------------
// LANE 5 — CourseDataProvider (welcome / presentation / cycle audio)
// ---------------------------------------------------------------------------
describe('lane: CourseDataProvider', () => {
  const provider = (tables: Record<string, any[]>) =>
    new CourseDataProvider({
      supabaseClient: makeSupabase(tables).client,
      courseId: COURSE,
      audioBaseUrl: '',
    })

  it('puts the versioned ref in the welcome audio URL', async () => {
    const p = provider({
      course_audio: [{ id: 'clip-welcome', s3_key: 'x.mp3', duration_ms: 900, text: 'welcome' }],
    })
    const welcome = await p.getWelcomeAudio()
    expect(welcome?.id).toBe('clip-welcome.v5')
    expect(welcome?.url).toContain('/api/audio/clip-welcome.v5?')
  })

  it('puts the versioned ref in the presentation audio URL', async () => {
    const p = provider({
      course_audio: [{ id: 'clip-presentation', s3_key: 'x.mp3', duration_ms: 900, origin: 'tts' }],
    })
    const intro = await p.getIntroductionAudio('S0001L01')
    expect(intro?.id).toBe('clip-presentation.v2')
    expect(intro?.url).toContain('/api/audio/clip-presentation.v2?')
  })

  it('puts versioned refs in every audio URL of a loaded cycle', async () => {
    const p = provider({
      course_legos: [
        {
          seed_number: 1,
          lego_index: 1,
          lego_type: 'A',
          known_text: 'hello',
          target_text: 'bonjour',
          known_audio_id: 'clip-known',
          target1_audio_id: 'clip-t1',
          target2_audio_id: 'clip-t2',
        },
      ],
      course_practice_phrases: [],
    })
    const items = await p.loadSessionItems(1, 1)
    expect(items).toHaveLength(1)
    const refs = items[0].lego.audioRefs
    expect(refs.known.url).toContain('/api/audio/clip-known.v2?')
    expect(refs.target.voice1.url).toContain('/api/audio/clip-t1.v3?')
    expect(refs.target.voice2.url).toContain('/api/audio/clip-t2.v2?')
  })
})
