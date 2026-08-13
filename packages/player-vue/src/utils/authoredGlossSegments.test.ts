import { describe, it, expect } from 'vitest'
import {
  authoredGlossSegments,
  targetWordsOf,
  tilesFromGlossSegments,
} from './authoredGlossSegments'

// The two rows Tom named on 2026-08-13.
const HITZ_BAT = { target_text: 'hitz bat' }
const GOGORATZEN = { target_text: 'gogoratzen saiatzen ari naiz' }

const mk = ({ text, index, glossGroup, known }: {
  text: string; index: number; glossGroup: number; known: string
}) => ({ id: `t${index}`, targetText: text, glossGroup, knownText: known })

describe('authoredGlossSegments — reading a stored mapping', () => {
  it('accepts a segmentation that covers every target word', () => {
    expect(authoredGlossSegments({
      ...HITZ_BAT,
      known_gloss_segments: [{ span: 1, known: 'word' }, { span: 1, known: 'a' }],
    })).toEqual([{ span: 1, known: 'word' }, { span: 1, known: 'a' }])
  })

  it('accepts a chunk spanning several columns, and an empty chunk', () => {
    expect(authoredGlossSegments({
      ...GOGORATZEN,
      known_gloss_segments: [
        { span: 2, known: "I'm trying" },
        { span: 1, known: '' },
        { span: 1, known: 'to remember' },
      ],
    })).toHaveLength(3)
  })

  // The load-bearing guard: a mapping authored against an older wording would
  // put the wrong known text under the right target words.
  it('drops a segmentation that no longer covers the target text', () => {
    expect(authoredGlossSegments({
      ...GOGORATZEN,
      known_gloss_segments: [{ span: 1, known: 'word' }, { span: 1, known: 'a' }],
    })).toBeUndefined()
  })

  it('drops a malformed segmentation rather than half-rendering it', () => {
    const bad = [
      [{ span: 0, known: 'x' }, { span: 2, known: '' }],
      [{ span: 1.5, known: 'x' }, { span: 0.5, known: '' }],
      [{ span: 1, known: 'x' }, { span: 1 }],
      ['not an object', { span: 1, known: '' }],
    ]
    for (const known_gloss_segments of bad) {
      expect(authoredGlossSegments({ ...HITZ_BAT, known_gloss_segments })).toBeUndefined()
    }
  })

  it('is undefined when nobody has mapped the row — componentisation takes over', () => {
    expect(authoredGlossSegments({ ...HITZ_BAT, known_gloss_segments: null })).toBeUndefined()
    expect(authoredGlossSegments({ ...HITZ_BAT, known_gloss_segments: [] })).toBeUndefined()
    expect(authoredGlossSegments(HITZ_BAT)).toBeUndefined()
  })

  it('splits target columns on whitespace and nothing else', () => {
    expect(targetWordsOf('  hitz   bat ')).toEqual(['hitz', 'bat'])
    expect(targetWordsOf(null)).toEqual([])
  })
})

describe('tilesFromGlossSegments — the tiles the assembler renders', () => {
  it('gives every target word its own tile, in the TARGET’s order', () => {
    const tiles = tilesFromGlossSegments(
      'hitz bat', [{ span: 1, known: 'word' }, { span: 1, known: 'a' }], mk)
    // The known side reads "word a" for "a word" — wrong English, on purpose.
    expect(tiles).toEqual([
      { id: 't0', targetText: 'hitz', glossGroup: 0, knownText: 'word' },
      { id: 't1', targetText: 'bat', glossGroup: 1, knownText: 'a' },
    ])
  })

  it('shares one glossGroup across a multi-word chunk, gloss on its first tile', () => {
    const tiles = tilesFromGlossSegments(
      'gogoratzen saiatzen ari naiz',
      [{ span: 1, known: 'remembering' }, { span: 3, known: 'I am trying' }],
      mk,
    )!
    expect(tiles.map((t) => t.targetText))
      .toEqual(['gogoratzen', 'saiatzen', 'ari', 'naiz'])
    expect(tiles.map((t) => t.glossGroup)).toEqual([0, 1, 1, 1])
    // Only the run's first tile carries the gloss — LegoAssembly centres it
    // across the whole run from there.
    expect(tiles.map((t) => t.knownText)).toEqual(['remembering', 'I am trying', '', ''])
  })

  it('refuses to pair onto a tiling that is not the columns the author cut', () => {
    // e.g. a romanised tiling whose word count differs from the native one.
    expect(tilesFromGlossSegments('hitz bat', [{ span: 3, known: 'a word' }], mk)).toBeNull()
    expect(tilesFromGlossSegments('', [{ span: 1, known: 'a' }], mk)).toBeNull()
    expect(tilesFromGlossSegments('hitz bat', undefined, mk)).toBeNull()
  })
})
