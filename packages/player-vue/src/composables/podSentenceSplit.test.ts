import { describe, it, expect } from 'vitest'
import { splitRowUnits } from './podSentenceSplit'
import { partitionAtomMap, flattenPodRows } from './usePodLapScheduler'
import type { AtomMapEntry } from '@ssi/core/pods'

const atom = (target_surface: string, gloss = ''): AtomMapEntry => ({
  lego_key: target_surface.toLowerCase(),
  kind: 'atom',
  gloss,
  target_surface,
})

describe('splitRowUnits', () => {
  it('returns a single whole-turn unit when not split (no sentence clips)', () => {
    const units = splitRowUnits({
      target_text: 'Buongiorno. Come stai?',
      known_text: 'Good morning. How are you?',
      target_audio_id: 'T',
      known_audio_id: 'K',
    })
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ isSplit: false, targetAudioId: 'T', knownAudioId: 'K' })
    expect(units[0].targetText).toBe('Buongiorno. Come stai?')
  })

  it('splits a 2-sentence turn into 2 sentence units paired by index', () => {
    const units = splitRowUnits({
      target_text: 'Buongiorno. Come stai?',
      known_text: 'Good morning. How are you?',
      target_audio_id: 'TURN_T',
      known_audio_id: 'TURN_K',
      sentence_audio_ids: ['t0', 't1'],
      sentence_known_audio_ids: ['k0', 'k1'],
    })
    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({ index: 0, isSplit: true, targetText: 'Buongiorno.', targetAudioId: 't0', knownText: 'Good morning.', knownAudioId: 'k0' })
    expect(units[1]).toMatchObject({ index: 1, isSplit: true, targetText: 'Come stai?', targetAudioId: 't1', knownText: 'How are you?', knownAudioId: 'k1' })
  })

  it('uses each clip\'s own stored text for CJK (the Latin regex cannot split 。/no-spaces)', () => {
    // The exact bug Tom caught: a Japanese turn whose target_text the boundary
    // regex leaves whole — without textById both cards showed the whole turn.
    const textById = new Map([
      ['t0', 'マンチェスター出身ですが、今はロンドンに住んでいます。'],
      ['t1', 'あなたは？'],
      ['k0', "I'm from Manchester, but now I live in London."],
      ['k1', 'And you?'],
    ])
    const row = {
      target_text: 'マンチェスター出身ですが、今はロンドンに住んでいます。あなたは？',
      known_text: "I'm from Manchester, but now I live in London. And you?",
      sentence_audio_ids: ['t0', 't1'],
      sentence_known_audio_ids: ['k0', 'k1'],
    }
    // Without the map: the regex can't split Japanese → both cards show the whole turn.
    expect(splitRowUnits(row)[1].targetText).toBe(row.target_text)
    // With the map: each card shows its own sentence.
    const units = splitRowUnits(row, textById)
    expect(units[0]).toMatchObject({ targetText: 'マンチェスター出身ですが、今はロンドンに住んでいます。', knownText: "I'm from Manchester, but now I live in London." })
    expect(units[1]).toMatchObject({ targetText: 'あなたは？', knownText: 'And you?' })
  })

  it('drops the known clip (null) when the known side count mismatches the target side', () => {
    const units = splitRowUnits({
      target_text: 'Sì, è libero. Prego, si accomodi.',
      known_text: "Yes, it's free. Please, go ahead.",
      sentence_audio_ids: ['t0', 't1'],
      sentence_known_audio_ids: ['k0'], // only one — mismatch
    })
    expect(units).toHaveLength(2)
    expect(units.every((u) => u.knownAudioId === null)).toBe(true)
  })

  it('falls back to the whole turn when a split clip is stale (not in textById)', () => {
    // French/Portuguese pods: main-course audio was re-rendered and the old
    // June split slices deleted, but the pod row still lists them. The clip
    // ids don't resolve, so the split must fall back to the whole-turn render.
    const row = {
      target_text: 'Buongiorno. Come stai?',
      known_text: 'Good morning. How are you?',
      target_audio_id: 'WHOLE_T',
      known_audio_id: 'WHOLE_K',
      sentence_audio_ids: ['t0', 't1'],       // t1 was deleted
      sentence_known_audio_ids: ['k0', 'k1'],
    }
    const textById = new Map([
      ['t0', 'Buongiorno.'],
      // t1 missing → stale slice
      ['k0', 'Good morning.'],
      ['k1', 'How are you?'],
    ])
    const units = splitRowUnits(row, textById)
    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ isSplit: false, targetAudioId: 'WHOLE_T', knownAudioId: 'WHOLE_K' })
  })

  it('still splits when every clip resolves in textById', () => {
    const row = {
      target_text: 'Buongiorno. Come stai?',
      known_text: 'Good morning. How are you?',
      sentence_audio_ids: ['t0', 't1'],
      sentence_known_audio_ids: ['k0', 'k1'],
    }
    const textById = new Map([
      ['t0', 'Buongiorno.'], ['t1', 'Come stai?'],
      ['k0', 'Good morning.'], ['k1', 'How are you?'],
    ])
    expect(splitRowUnits(row, textById)).toHaveLength(2)
  })
})

describe('partitionAtomMap', () => {
  it('partitions a flat atom_map across sentences by sequential surface coverage', () => {
    // ita_for_eng SC01-S004 shape: 4 atoms tile 3 sentences.
    const atoms = [atom('Sì'), atom('ho una giornata molto impegnata oggi'), atom('Spero che tu abbia una buona giornata'), atom('A dopo')]
    const groups = partitionAtomMap(atoms, [
      'Sì, ho una giornata molto impegnata oggi.',
      'Spero che tu abbia una buona giornata.',
      'A dopo.',
    ])
    expect(groups).not.toBeNull()
    expect(groups!.map((g) => g.map((a) => a.target_surface))).toEqual([
      ['Sì', 'ho una giornata molto impegnata oggi'],
      ['Spero che tu abbia una buona giornata'],
      ['A dopo'],
    ])
  })

  it('handles multiple atoms folding into one sentence', () => {
    // SC01-S003: ["Sto molto bene","grazie","Vai a lavorare"] over 2 sentences.
    const groups = partitionAtomMap(
      [atom('Sto molto bene'), atom('grazie'), atom('Vai a lavorare')],
      ['Sto molto bene, grazie.', 'Vai a lavorare?'],
    )
    expect(groups!.map((g) => g.length)).toEqual([2, 1])
  })

  it('returns null when atoms do not cleanly align (safe fallback → no Stage-0)', () => {
    const groups = partitionAtomMap(
      [atom('Buongiorno'), atom('amico')], // "amico" isn't in the second sentence
      ['Buongiorno.', 'Come stai?'],
    )
    expect(groups).toBeNull()
  })

  it('returns null for a single sentence or empty atom_map', () => {
    expect(partitionAtomMap([atom('Ciao')], ['Ciao.'])).toBeNull()
    expect(partitionAtomMap(null, ['a', 'b'])).toBeNull()
    expect(partitionAtomMap([], ['a', 'b'])).toBeNull()
  })
})

describe('flattenPodRows', () => {
  const row = (over: Partial<Parameters<typeof flattenPodRows>[0][number]>) => ({
    id: 'x', global_order: 0, speaker: null, target_text: '', known_text: '',
    target_audio_id: null, known_audio_id: null, explainer_audio_id: null,
    glue_to_next: false, atom_map: null, sentence_audio_ids: null, sentence_known_audio_ids: null,
    ...over,
  })

  it('passes a non-split turn through unchanged', () => {
    const out = flattenPodRows([row({ id: 'r1', target_text: 'Ciao.', target_audio_id: 'T', known_audio_id: 'K', explainer_audio_id: 'E', atom_map: [atom('Ciao')] })])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ target_audio_id: 'T', known_audio_id: 'K', explainer_audio_id: 'E' })
    expect(out[0].atom_map).toHaveLength(1)
  })

  it('expands a split turn into per-sentence rows with partitioned atoms and no explainer', () => {
    const out = flattenPodRows([row({
      id: 'r1', speaker: 'Sarah',
      target_text: 'Buongiorno. Come stai?', known_text: 'Good morning. How are you?',
      explainer_audio_id: 'TURN_EXPLAINER',
      sentence_audio_ids: ['t0', 't1'], sentence_known_audio_ids: ['k0', 'k1'],
      atom_map: [atom('Buongiorno'), atom('Come stai')],
    })])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ target_audio_id: 't0', known_audio_id: 'k0', explainer_audio_id: null })
    expect(out[0].atom_map!.map((a) => a.target_surface)).toEqual(['Buongiorno'])
    expect(out[1].atom_map!.map((a) => a.target_surface)).toEqual(['Come stai'])
    expect(out[1].global_order).toBeCloseTo(0.001)
  })

  it('glues sentences of one speaker tight and breathes on a speaker change', () => {
    const out = flattenPodRows([
      row({ id: 'r1', global_order: 0, speaker: 'Sarah', target_text: 'Buongiorno. Come stai?', sentence_audio_ids: ['t0', 't1'], sentence_known_audio_ids: ['k0', 'k1'], atom_map: [atom('Buongiorno'), atom('Come stai')] }),
      row({ id: 'r2', global_order: 1, speaker: 'Neighbour', target_text: 'Bene.', target_audio_id: 'T2' }),
    ])
    // u0 Sarah → u1 Sarah (sibling, same turn) = glue; u1 Sarah → u2 Neighbour (speaker change) = breath; u2 last = false
    expect(out.map((r) => r.glue_to_next)).toEqual([true, false, false])
  })

  it('glues consecutive same-speaker turns and falls back to DB glue when speakerless', () => {
    const sameSpeaker = flattenPodRows([
      row({ id: 'r1', global_order: 0, speaker: 'Sarah', target_text: 'Ciao.', target_audio_id: 'T1' }),
      row({ id: 'r2', global_order: 1, speaker: 'Sarah', target_text: 'Bene.', target_audio_id: 'T2' }),
    ])
    expect(sameSpeaker[0].glue_to_next).toBe(true) // same speaker across turns → glued

    const speakerless = flattenPodRows([
      row({ id: 'r1', global_order: 0, speaker: null, glue_to_next: true, target_text: 'Ciao.', target_audio_id: 'T1' }),
      row({ id: 'r2', global_order: 1, speaker: null, target_text: 'Bene.', target_audio_id: 'T2' }),
    ])
    expect(speakerless[0].glue_to_next).toBe(true) // falls back to the row's own glue_to_next
  })
})
