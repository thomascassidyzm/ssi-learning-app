import { describe, it, expect } from 'vitest'
import {
  fuseSpans,
  spanLadder,
  partitionUnits,
  glueLeadingInterjection,
  buildFusionGroups,
  groupDepth,
  rungStepsForGroup,
  buildFusionRungPlays,
  normalizeForAudio,
  type FineUnit,
  type FusionTurnInput,
} from './fusionDrill'
import type { PodSentenceRow } from './podStageComposition'

const u = (surface: string, gloss: string, startMs: number | null = 0, endMs: number | null = 1000): FineUnit => ({
  kind: 'atom',
  target_surface: surface,
  gloss,
  target_start_ms: startMs,
  target_end_ms: endMs,
})

describe('fuseSpans / spanLadder', () => {
  it('pairwise fuses disjoint pairs L→R with an odd tail standing alone', () => {
    const spans = [0, 1, 2, 3, 4].map((i) => ({ start: i, end: i }))
    expect(fuseSpans(spans, 'pairwise')).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 4, end: 4 },
    ])
  })

  it('chained windows share an edge chunk', () => {
    const spans = [0, 1, 2].map((i) => ({ start: i, end: i }))
    expect(fuseSpans(spans, 'chained')).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ])
  })

  it('spanLadder climbs units → whole (pairwise 5 units = 4 rungs)', () => {
    const levels = spanLadder(5, 'pairwise')
    expect(levels.map((l) => l.length)).toEqual([5, 3, 2, 1])
    expect(levels[levels.length - 1]).toEqual([{ start: 0, end: 4 }])
  })

  it('a b c d e f g fuses a+b c+d e+f g on the second visit', () => {
    const levels = spanLadder(7, 'pairwise')
    expect(levels[1]).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 3 },
      { start: 4, end: 5 },
      { start: 6, end: 6 },
    ])
  })
})

describe('partitionUnits + glue', () => {
  it('splits units into sentence groups at terminal punctuation', () => {
    const units = [u('Da', 'yes'), u('naravno', 'of course'), u('Izvolite', 'here it is'), u('Riba', 'the fish')]
    const groups = partitionUnits('Da, naravno. Izvolite. Riba.', units)
    expect(groups).toEqual([[0, 1], [2], [3]])
  })

  it('handles CJK sentence enders', () => {
    const units = [u('我想说中文', 'I want to speak Chinese'), u('你呢', 'and you')]
    expect(partitionUnits('我想说中文。你呢？', units)).toEqual([[0], [1]])
  })

  it('glues ONLY a turn-initial one-unit sentence forward', () => {
    expect(glueLeadingInterjection([[0], [1, 2], [3]])).toEqual([[0, 1, 2], [3]])
    // mid-turn one-unit sentence is a real sentence — untouched
    expect(glueLeadingInterjection([[0, 1], [2], [3, 4]])).toEqual([[0, 1], [2], [3, 4]])
    expect(glueLeadingInterjection([[0]])).toEqual([[0]])
  })
})

describe('buildFusionGroups', () => {
  // Real shape: hrv SC09-S011 "Naravno. A što biste željeli za piće?" —
  // leading interjection glued forward; ONE Take G across both raw sentences.
  const gluedTurn = (): FusionTurnInput => ({
    turnTargetText: 'Naravno. A što biste željeli za piće?',
    fineMap: [
      u('Naravno', 'of course', 0, 800),
      u('A što', 'and what', 900, 1400),
      u('biste željeli', 'would you like', 1500, 2400),
      u('za piće', 'to drink', 2500, 3200),
    ],
    windowKnownMap: [
      { g: 0, start: 0, end: 1, known: 'of course and what' },
      { g: 0, start: 1, end: 2, known: 'and what would you like' },
      { g: 0, start: 2, end: 3, known: 'would you like to drink' },
    ],
    takegAudioIds: ['takeg-0'],
    rows: [
      { targetAudioId: 'sent-0', knownAudioId: 'ksent-0', targetText: 'Naravno.', knownText: 'Of course.' },
      { targetAudioId: 'sent-1', knownAudioId: 'ksent-1', targetText: 'A što biste željeli za piće?', knownText: 'And what would you like to drink?' },
    ],
  })

  it('resolves the glue case: one group spanning two rows, Take G aligned', () => {
    const groups = buildFusionGroups(gluedTurn())!
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.rowFirst).toBe(0)
    expect(g.rowLast).toBe(1)
    expect(g.takegAudioId).toBe('takeg-0')
    expect(g.sliceable).toBe(true)
    // glued group has no single natural take → whole = its full Take G
    expect(g.wholeTargetClipId).toBe('takeg-0')
    expect(g.targetText).toBe('Naravno. A što biste željeli za piće?')
    expect(g.knownText).toBe('Of course. And what would you like to drink?')
  })

  it('maps unglued multi-sentence turns 1:1 group↔row', () => {
    const input: FusionTurnInput = {
      turnTargetText: 'Hvala vam puno. Bili ste od velike pomoći.',
      fineMap: [
        u('Hvala vam', 'thank you', 0, 700),
        u('puno', 'very much', 800, 1200),
        u('Bili ste', 'you have been', 0, 700),
        u('od velike pomoći', 'a great help', 800, 1900),
      ],
      windowKnownMap: [],
      takegAudioIds: ['takeg-0', 'takeg-1'],
      rows: [
        { targetAudioId: 'sent-0', knownAudioId: 'k-0', targetText: 'Hvala vam puno.', knownText: 'Thank you very much.' },
        { targetAudioId: 'sent-1', knownAudioId: 'k-1', targetText: 'Bili ste od velike pomoći.', knownText: 'You have been a great help.' },
      ],
    }
    const groups = buildFusionGroups(input)!
    expect(groups).toHaveLength(2)
    expect(groups[0].wholeTargetClipId).toBe('sent-0')
    expect(groups[0].sliceable).toBe(true)
    expect(groups[1].wholeTargetClipId).toBe('sent-1')
    expect(groups[1].sliceable).toBe(true)
    expect(groups[1].flatStart).toBe(2)
  })

  it('bails (null) on row-count mismatch — honest fallback, never guess', () => {
    const input = gluedTurn()
    input.rows = [
      ...input.rows,
      { targetAudioId: 'x', knownAudioId: null, targetText: 'Extra.', knownText: '' },
    ]
    expect(buildFusionGroups(input)).toBeNull()
  })

  it('bails on Take G misalignment', () => {
    const input = gluedTurn()
    input.takegAudioIds = ['takeg-0', 'takeg-extra']
    expect(buildFusionGroups(input)).toBeNull()
  })

  it('accepts a single unsplit whole-turn row holding multiple groups', () => {
    const input: FusionTurnInput = {
      turnTargetText: 'Dobro jutro. Kako ste?',
      fineMap: [u('Dobro', 'good', 0, 400), u('jutro', 'morning', 500, 900), u('Kako ste', 'how are you', 0, 800)],
      windowKnownMap: [],
      takegAudioIds: ['takeg-0', null],
      rows: [{ targetAudioId: 'turn-take', knownAudioId: 'turn-known', targetText: 'Dobro jutro. Kako ste?', knownText: 'Good morning. How are you?' }],
    }
    const groups = buildFusionGroups(input)!
    expect(groups).toHaveLength(2)
    expect(groups[0].rowFirst).toBe(0)
    expect(groups[0].targetText).toBe('Dobro jutro')
  })
})

describe('rungStepsForGroup — t·k·t·t at every chunk size, capped at the sentence', () => {
  const knownClips = new Map([
    [normalizeForAudio('of course'), 'fk-of-course'],
    [normalizeForAudio('and what'), 'fk-and-what'],
    [normalizeForAudio('of course and what'), 'fk-window-1'],
    [normalizeForAudio('would you like to drink'), 'fk-window-2'],
    [normalizeForAudio('Of course. And what would you like to drink?'), 'fk-sentence'],
  ])
  const lookup = (t: string) => knownClips.get(normalizeForAudio(t)) || null

  const group = () => {
    const input: FusionTurnInput = {
      turnTargetText: 'Naravno. A što biste željeli za piće?',
      fineMap: [
        u('Naravno', 'of course', 0, 800),
        u('A što', 'and what', 900, 1400),
        u('biste željeli', 'would you like', 1500, 2400),
        u('za piće', 'to drink', 2500, 3200),
      ],
      windowKnownMap: [
        { g: 0, start: 0, end: 1, known: 'of course and what' },
        { g: 0, start: 2, end: 3, known: 'would you like to drink' },
      ],
      takegAudioIds: ['takeg-0'],
      rows: [
        { targetAudioId: 'sent-0', knownAudioId: 'ksent-0', targetText: 'Naravno.', knownText: 'Of course.' },
        { targetAudioId: 'sent-1', knownAudioId: 'ksent-1', targetText: 'A što biste željeli za piće?', knownText: 'And what would you like to drink?' },
      ],
    }
    return buildFusionGroups(input)![0]
  }

  it('rung 0 ENTERS at pairs (finest singles rung skipped) — window translations + span-union slices', () => {
    const { strips, steps } = rungStepsForGroup(group(), 0, 'pairwise', lookup)
    expect(strips).toHaveLength(2)
    expect(strips[0].target).toBe('Naravno A što')
    expect(strips[0].known).toBe('of course and what')
    const pair0 = steps.filter((s) => s.stripIndex === 0)
    expect(pair0.map((s) => s.kind)).toEqual(['chunk', 'known', 'chunk', 'chunk'])
    expect(pair0[0].clip).toEqual({ id: 'takeg-0', startMs: 0, endMs: 1400 })
    expect(pair0[1].clip).toEqual({ id: 'fk-window-1' })
    // second window's known comes from the authored window translation
    expect(strips[1].known).toBe('would you like to drink')
  })

  it('drops the known slot (t·t·t) where no real known clip exists', () => {
    // lookup without the second window's translation → its known audio drops,
    // the strip still shows the gloss-join text.
    const sparse = (t: string) =>
      normalizeForAudio(t) === normalizeForAudio('of course and what') ? 'fk-window-1' : null
    const { strips, steps } = rungStepsForGroup(group(), 0, 'pairwise', sparse)
    const pair1 = steps.filter((s) => s.stripIndex === 1)
    expect(pair1.map((s) => s.kind)).toEqual(['chunk', 'chunk', 'chunk'])
    expect(strips[1].known).toBe('would you like to drink')
  })

  it('top rung: the whole SENTENCE — and a beyond-depth rung stays there', () => {
    const depth = groupDepth(group(), 'pairwise')
    expect(depth).toBe(2) // 4 units → [2, 1] with the singles rung skipped
    const atTop = rungStepsForGroup(group(), depth - 1, 'pairwise', lookup)
    expect(atTop.strips).toHaveLength(1)
    expect(atTop.strips[0].target).toBe('Naravno. A što biste željeli za piće?')
    const beyond = rungStepsForGroup(group(), depth + 5, 'pairwise', lookup)
    expect(beyond.strips).toEqual(atTop.strips)
    // whole-sentence known prefers the fresh sentence-translation render
    const wholeSteps = atTop.steps
    expect(wholeSteps[1].kind).toBe('known')
    expect(wholeSteps[1].clip).toEqual({ id: 'fk-sentence' })
  })

  it('a two-unit sentence goes straight to its whole (nothing smaller than a pair plays)', () => {
    const twoUnit = { ...group(), units: group().units.slice(0, 2), sliceable: true }
    expect(groupDepth(twoUnit, 'pairwise')).toBe(1)
    const r0 = rungStepsForGroup(twoUnit, 0, 'pairwise', lookup)
    expect(r0.strips).toHaveLength(1)
  })

  it('non-sliceable groups clamp to their whole at every rung', () => {
    const g = { ...group(), sliceable: false }
    const r0 = rungStepsForGroup(g, 0, 'pairwise', lookup)
    expect(r0.strips).toHaveLength(1)
    expect(r0.strips[0].target).toBe(g.targetText)
  })

  describe('buildFusionRungPlays — the main-flow lap vocabulary', () => {
    const sentence: PodSentenceRow = {
      sentence_id: 'row:s1',
      global_order: 4,
      target_text: 'A što biste željeli za piće?',
      known_text: 'And what would you like to drink?',
      target_audio_id: 'sent-1',
      known_audio_id: 'ksent-1',
      explainer_audio_id: null,
      glue_to_next: true,
    }

    it('rung 0 (pairs entry) becomes ps/trans plays with Take G slices at 1×', () => {
      const plays = buildFusionRungPlays(sentence, group(), 0, 7, 'pairwise', lookup)
      // two windows: (t k t t) + (t k t t) = 8 plays
      expect(plays).toHaveLength(8)
      expect(plays.every((p) => p.sentenceIdx === 7 && p.stage === 0 && p.tier === 'fusion-r0')).toBe(true)
      expect(plays.every((p) => p.playbackSpeed === 1.0)).toBe(true)
      expect(plays[0]).toMatchObject({ playRole: 'ps', audioId: 'takeg-0', startMs: 0, endMs: 1400 })
      expect(plays[1]).toMatchObject({ playRole: 'trans', audioId: 'fk-window-1' })
      expect(plays[1].startMs).toBeUndefined() // knowns are whole clips
      // glue rides only the LAST play of the sentence's rung
      expect(plays.slice(0, -1).every((p) => !p.glueToNextChunk)).toBe(true)
      expect(plays[plays.length - 1].glueToNextChunk).toBe(true)
    })
  })
})
