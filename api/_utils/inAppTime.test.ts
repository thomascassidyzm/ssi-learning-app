/**
 * IN-APP TIME PIN — the rule behind every time figure on the school surfaces
 * and on Intelligence (api/_utils/inAppTime.ts): a minute is play to stop,
 * tagged by mode; an unclosed span ends at the last audio-ended point, never
 * at a timeout; and no span can ever be a 128-hour sitting.
 *
 * Tom's ruling of 2026-09-13 supersedes the 2026-09-10 any-event idle-cutoff
 * rule. The first test below is the proof of the change: it was red on the
 * pre-change module (which counted to the last event of any type) and is
 * green on this one.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  sessioniseSeconds,
  sessioniseDiary,
  spansFromDiary,
  spanSecondsByDay,
  activeDays,
  toDiaryPlayRow,
  unpackDiaryPlayRows,
  inAppTimeByLearner,
  IDLE_CUTOFF_SECONDS,
  BLOCK_CAP_SECONDS,
  type DiaryPlayRow,
} from './inAppTime'

const m = (min: number) => min * 60 * 1000
const s = (sec: number) => sec * 1000

const T0 = Date.UTC(2026, 8, 13, 20, 0, 0)
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

/** A fake service-role client that serves `rows` for player_events and nothing for course_audio. */
function fakeSvc(rows: Record<string, unknown>[], audio: Record<string, number> = {}) {
  const builder = (table: string) => {
    let data: any[] = table === 'player_events' ? [...rows] : []
    const b: any = {
      select: () => b,
      in: (col: string, vals: unknown[]) => { if (table === 'player_events') data = data.filter((r) => vals.includes(r[col])); if (table === 'course_audio') data = vals.filter((id) => id in audio).map((id) => ({ id, duration_ms: audio[id as string] })); return b },
      gte: () => b,
      order: () => b,
      range: () => b,
      then: (resolve: any) => Promise.resolve({ data, error: null }).then(resolve),
    }
    return b
  }
  return { from: vi.fn(builder), rpc: vi.fn() } as any
}

describe('THE CHANGE — play to stop, closed at the last audio-ended point', () => {
  it('a play tap, five clips, no stop, then a non-play event two minutes later: counts to the last clip END, tags the mode, ignores the stray event', async () => {
    const rows = [
      { learner_id: 'L', event_type: 'tap_play', occurred_at: iso(0) },
      ...[10, 20, 30, 40, 50].map((sec) => ({ learner_id: 'L', event_type: 'audio_play', occurred_at: iso(s(sec)), ct: 'build', duration: '3000', speed: '1' })),
      { learner_id: 'L', event_type: 'cold_start', occurred_at: iso(m(2)) },
    ]
    const out = await inAppTimeByLearner(fakeSvc(rows), ['L'], iso(-m(60)))
    const t = out.get('L')!
    // Pre-change rule: 0 → 2 min = 120 s (every event counted, idle cutoff). Now: 0 → 53 s.
    expect(t.seconds).toBe(53)
    expect(t.mainSeconds).toBe(53)
    expect(t.listeningSeconds).toBe(0)
    expect(t.spans).toHaveLength(1)
    expect(t.spans[0]).toMatchObject({ mode: 'main', openedBy: 'tap_play', closedBy: 'end_of_diary', closeClipEnd: 'durationMs', seconds: 53 })
  })
})

describe('spansFromDiary — the rule', () => {
  const clip = (t: number, extra: Partial<DiaryPlayRow> = {}): DiaryPlayRow => ({ t, kind: 'clip', durationMs: 3000, playbackSpeed: 1, ...extra })

  it('play tap → clips → stop tap: the span is tap to tap, the gaps between clips inside it', () => {
    const spans = spansFromDiary([{ t: 0, kind: 'tap_play' }, clip(s(5)), clip(s(40)), clip(s(90)), { t: s(100), kind: 'tap_pause' }])
    expect(spans).toEqual([expect.objectContaining({ startMs: 0, endMs: s(100), seconds: 100, mode: 'main', openedBy: 'tap_play', closedBy: 'tap_pause', closeClipEnd: 'tap', clips: 3 })])
  })

  it('a stop tapped mid-clip closes at the tap, not at the clip end', () => {
    const spans = spansFromDiary([{ t: 0, kind: 'tap_play' }, clip(s(10)), { t: s(11), kind: 'tap_pause' }])
    expect(spans[0].seconds).toBe(11)
  })

  it('a stop tapped an hour after the audio went quiet closes at the last clip end — a stop is never an hour of play', () => {
    const spans = spansFromDiary([{ t: 0, kind: 'tap_play' }, clip(s(10)), { t: m(60), kind: 'tap_pause' }])
    expect(spans[0]).toMatchObject({ seconds: 13, closedBy: 'silence', closeClipEnd: 'durationMs' })
  })

  it('a stop with nothing playing is nothing; a clip with no span open opens one (lock-screen resume emits no tap)', () => {
    expect(spansFromDiary([{ t: 0, kind: 'tap_pause' }])).toEqual([])
    const spans = spansFromDiary([clip(s(10)), clip(s(20)), { t: s(30), kind: 'tap_pause' }])
    expect(spans[0]).toMatchObject({ startMs: s(10), seconds: 20, openedBy: 'clip', closedBy: 'tap_pause' })
  })

  it('a silence longer than the guard between clips is two spans, and the silence is not counted', () => {
    const spans = spansFromDiary([{ t: 0, kind: 'tap_play' }, clip(s(10)), clip(m(30)), { t: m(31), kind: 'tap_pause' }])
    expect(spans.map((x) => [x.seconds, x.closedBy])).toEqual([[13, 'silence'], [60, 'tap_pause']])
    // a gap of exactly the guard is still one span
    expect(spansFromDiary([clip(0), clip(s(IDLE_CUTOFF_SECONDS) + 3000)])).toHaveLength(1)
  })

  it('a second play tap while a span is open closes the first at its last audio-ended point', () => {
    const spans = spansFromDiary([{ t: 0, kind: 'tap_play' }, clip(s(10)), { t: s(60), kind: 'tap_play' }, clip(s(61)), { t: s(70), kind: 'tap_pause' }])
    expect(spans.map((x) => [x.startMs, x.seconds, x.closedBy])).toEqual([[0, 13, 'tap_play'], [s(60), 10, 'tap_pause']])
  })

  it('end-logged clips (pods, Listening Mode) start at occurred_at − elapsedMs and end at occurred_at', () => {
    const spans = spansFromDiary([{ t: s(10), kind: 'clip', elapsedMs: 4000 }, { t: s(20), kind: 'clip', elapsedMs: 5000 }])
    expect(spans[0]).toMatchObject({ startMs: s(6), endMs: s(20), seconds: 14, closeClipEnd: 'elapsedMs' })
  })

  it('a start-logged clip with no length resolves through course_audio when the caller supplies it, else closes at its own start and names the clip', () => {
    const rows: DiaryPlayRow[] = [{ t: 0, kind: 'tap_play' }, { t: s(10), kind: 'clip', audioId: 'A' }]
    const bare = spansFromDiary(rows)
    expect(bare[0]).toMatchObject({ seconds: 10, closeClipEnd: 'unknown', closerAudioId: 'A' })
    const resolved = spansFromDiary(rows, { durations: new Map([['A', 2500]]) })
    expect(resolved[0]).toMatchObject({ seconds: 13, closeClipEnd: 'course_audio', closerAudioId: null })
    // a clip at 0.5x plays for twice its length
    expect(spansFromDiary([{ t: 0, kind: 'clip', durationMs: 4000, playbackSpeed: 0.5 }])[0].seconds).toBe(8)
  })

  it('Listening Mode is its own span, opened by a clip or a tick, and a mode switch closes the other mode at its last audio-ended point', () => {
    const spans = spansFromDiary([
      { t: 0, kind: 'tap_play' }, clip(s(10)),
      { t: s(30), kind: 'clip', listening: true, elapsedMs: 2000 }, { t: s(60), kind: 'tick', listening: true }, { t: s(90), kind: 'clip', listening: true, elapsedMs: 1000 },
      clip(s(120)), { t: s(125), kind: 'tap_pause' },
    ])
    expect(spans.map((x) => [x.mode, x.startMs, x.endMs, x.closedBy])).toEqual([
      ['main', 0, s(13), 'mode_switch'],
      ['listening', s(28), s(90), 'mode_switch'],
      ['main', s(120), s(125), 'tap_pause'],
    ])
    expect(spansFromDiary([{ t: 0, kind: 'tick', listening: true }, { t: s(30), kind: 'tick', listening: true }])[0]).toMatchObject({ mode: 'listening', openedBy: 'tick', seconds: 30, closeClipEnd: 'tick' })
  })

  it('caps a pathological span — the 128-hour sitting can never come back', () => {
    const rows: DiaryPlayRow[] = [{ t: 0, kind: 'tap_play' }]
    for (let t = 0; t <= 128 * 60; t += 2) rows.push(clip(m(t)))
    expect(spansFromDiary(rows)[0].seconds).toBe(BLOCK_CAP_SECONDS)
  })

  it('names the span course by majority of its clips', () => {
    const spans = spansFromDiary([clip(0, { course: 'a' }), clip(s(5), { course: 'b' }), clip(s(10), { course: 'b' })])
    expect(spans[0].course).toBe('b')
  })
})

describe('sessioniseDiary and the by-day split', () => {
  it('sums seconds by mode and lists the unresolved closing clips', () => {
    const r = sessioniseDiary([
      { t: 0, kind: 'tap_play' }, { t: s(10), kind: 'clip', audioId: 'X' },
      { t: m(20), kind: 'clip', listening: true, elapsedMs: 5000 }, { t: m(20) + s(30), kind: 'tick', listening: true },
    ])
    expect(r).toMatchObject({ seconds: 45, mainSeconds: 10, listeningSeconds: 35, unresolvedAudioIds: ['X'] })
  })

  it('splits a span that crosses midnight between its two UTC days', () => {
    const start = Date.UTC(2026, 8, 13, 23, 59, 0)
    const byDay = spanSecondsByDay(spansFromDiary([{ t: start, kind: 'tap_play' }, { t: start + m(3), kind: 'tap_pause' }]))
    expect(byDay).toEqual({ '2026-09-13': 60, '2026-09-14': 120 })
  })
})

describe('sessioniseSeconds — the legacy bare-timestamp adapter', () => {
  it('counts the gaps between stamps inside a lesson, ends at the guard, never counts the silence', () => {
    expect(sessioniseSeconds([0, m(3), m(7), m(10)])).toBe(600)
    expect(sessioniseSeconds([0, m(5), m(10), m(40), m(45)])).toBe(900)
    expect(sessioniseSeconds([m(10), 0, m(7), m(3)])).toBe(600)
    expect(sessioniseSeconds([m(1)])).toBe(0)
    expect(sessioniseSeconds([])).toBe(0)
  })
  it('the dials move the answer', () => {
    const ts = [0, m(3), m(10), m(11)]
    expect(sessioniseSeconds(ts, { idleCutoffSeconds: 120 })).toBe(60)
    expect(sessioniseSeconds(ts, { idleCutoffSeconds: 600 })).toBe(660)
  })
})

describe('row adapters', () => {
  it('reads a PostgREST row in the DIARY_PLAY_SELECT shape, and a fixture that carries a payload object', () => {
    expect(toDiaryPlayRow({ occurred_at: iso(0), event_type: 'audio_play', ct: 'listening_mode', elapsed: '860', url: '/api/audio/30514028-0094-40c6-b836-10530e808cfa?courseId=x', course_code: 'c' }))
      .toEqual({ t: T0, kind: 'clip', listening: true, elapsedMs: 860, durationMs: null, playbackSpeed: null, audioId: null, course: 'c' })
    expect(toDiaryPlayRow({ occurred_at: iso(0), event_type: 'audio_play', course_code: null, payload: { cycleType: 'use', url: '/api/audio/b55e3296-b9d6-47ab-9584-21c97da893d1', playbackSpeed: 0.9 } }))
      .toMatchObject({ kind: 'clip', listening: false, audioId: 'b55e3296-b9d6-47ab-9584-21c97da893d1', playbackSpeed: 0.9 })
    expect(toDiaryPlayRow({ occurred_at: iso(0), event_type: 'round_complete' })).toBeNull()
    expect(toDiaryPlayRow({ occurred_at: iso(0), event_type: 'listening_tick' })).toMatchObject({ kind: 'tick', listening: true })
  })

  it('unpacks the diary_play_rows shape', () => {
    const rows = unpackDiaryPlayRows({ L: [[T0, 'p', 0, null, null, null, null, 'c'], [T0 + 1000, 'a', 1, 860, null, 1, null, 'c'], [T0 + 2000, 'a', 0, null, null, 0.9, 'abc', 'c'], [T0 + 3000, 't', 0, null, null, null, null, null], [T0 + 4000, 's', 0, null, null, null, null, 'c']] })
    expect(rows.get('L')).toEqual([
      { t: T0, kind: 'tap_play', course: 'c' },
      { t: T0 + 1000, kind: 'clip', listening: true, elapsedMs: 860, durationMs: null, playbackSpeed: 1, audioId: null, course: 'c' },
      { t: T0 + 2000, kind: 'clip', listening: false, elapsedMs: null, durationMs: null, playbackSpeed: 0.9, audioId: 'abc', course: 'c' },
      { t: T0 + 3000, kind: 'tick', listening: true, course: null },
      { t: T0 + 4000, kind: 'tap_pause', course: 'c' },
    ])
    expect(unpackDiaryPlayRows(null).size).toBe(0)
  })

  it('inAppTimeByLearner resolves a closing clip through course_audio in one lookup', async () => {
    const rows = [
      { learner_id: 'L', event_type: 'tap_play', occurred_at: iso(0) },
      { learner_id: 'L', event_type: 'audio_play', occurred_at: iso(s(10)), ct: 'use', url: '/api/audio/aaaaaaaa-0000-4000-8000-000000000001' },
    ]
    const svc = fakeSvc(rows, { 'aaaaaaaa-0000-4000-8000-000000000001': 2000 })
    const t = (await inAppTimeByLearner(svc, ['L'], iso(-m(1)))).get('L')!
    expect(t.seconds).toBe(12)
    expect(t.spans[0].closeClipEnd).toBe('course_audio')
    expect(svc.from.mock.calls.filter((c: any[]) => c[0] === 'course_audio')).toHaveLength(1)
  })
})

describe('activeDays', () => {
  it('counts the distinct UTC days a learner had any event on — one clip on a day is a day practised', () => {
    const d = (x: string) => new Date(x).getTime()
    expect(activeDays([
      d('2026-09-08T07:50:00Z'), d('2026-09-08T08:03:00Z'),
      d('2026-09-09T10:52:00Z'),
      d('2026-09-11T23:59:59Z'), d('2026-09-11T00:00:01Z'),
    ])).toEqual(['2026-09-08', '2026-09-09', '2026-09-11'])
  })
  it('is empty for no events and ignores garbage stamps', () => {
    expect(activeDays([])).toEqual([])
    expect(activeDays([NaN])).toEqual([])
  })
})
