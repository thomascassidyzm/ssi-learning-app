/**
 * decomposePhrase — sanity tests for both alphabetic and CJK paths.
 *
 * The alphabetic path is the steady-state happy case (Romance / Germanic
 * scripts) and is covered here as a regression guard. The CJK path was
 * added 2026-05-22 for Chinese / Japanese / Korean phrases that were
 * falling through to the single-tile fallback.
 */

import { describe, it, expect } from 'vitest'
import { decomposePhrase } from './decomposePhrase'

describe('decomposePhrase — alphabetic path', () => {
  it('marks the salient atom as its own block and labels it salient', () => {
    const textMap = new Map([
      ['L1', 'I'],
      ['L2', 'speak'],
      ['L3', 'Spanish'],
    ])
    const blocks = decomposePhrase({
      targetText: 'I speak Spanish',
      salientId: 'L3',
      textMap,
      componentsByLegoId: new Map(),
    })
    expect(blocks).not.toBeNull()
    expect(blocks!.map(b => ({ id: b.id, text: b.targetText, salient: b.isSalient }))).toEqual([
      { id: 'L1', text: 'I', salient: false },
      { id: 'L2', text: 'speak', salient: false },
      { id: 'L3', text: 'Spanish', salient: true },
    ])
  })

  it('returns null when vocab is empty', () => {
    const blocks = decomposePhrase({
      targetText: 'hello world',
      salientId: 'L1',
      textMap: new Map(),
      componentsByLegoId: new Map(),
    })
    expect(blocks).toBeNull()
  })
})

describe('decomposePhrase — CJK path', () => {
  it('decomposes Chinese into per-LEGO tiles and flags the salient', () => {
    // Vocab: 我 (I), 喜欢 (like), 中文 (Chinese)
    const textMap = new Map([
      ['L1', '我'],
      ['L2', '喜欢'],
      ['L3', '中文'],
    ])
    const blocks = decomposePhrase({
      targetText: '我喜欢中文',
      salientId: 'L3',
      textMap,
      componentsByLegoId: new Map(),
    })
    expect(blocks).not.toBeNull()
    expect(blocks!.map(b => ({ id: b.id, text: b.targetText, salient: b.isSalient }))).toEqual([
      { id: 'L1', text: '我', salient: false },
      { id: 'L2', text: '喜欢', salient: false },
      { id: 'L3', text: '中文', salient: true },
    ])
  })

  it('uses greedy max-munch — prefers longer multi-character LEGOs over single chars', () => {
    // Both 中 and 中文 are LEGOs — max-munch should grab 中文 as one block.
    const textMap = new Map([
      ['L_single', '中'],
      ['L_multi', '中文'],
      ['L_lang', '语'],
    ])
    const blocks = decomposePhrase({
      targetText: '中文语',
      salientId: 'L_lang',
      textMap,
      componentsByLegoId: new Map(),
    })
    expect(blocks).not.toBeNull()
    expect(blocks!.map(b => ({ id: b.id, text: b.targetText }))).toEqual([
      { id: 'L_multi', text: '中文' },
      { id: 'L_lang', text: '语' },
    ])
  })

  it('emits a ghost tile for unmatched CJK characters and warns', () => {
    const textMap = new Map([
      ['L1', '我'],
      ['L2', '中文'],
    ])
    const blocks = decomposePhrase({
      targetText: '我X中文',  // X has no LEGO; should become a ghost.
      salientId: 'L2',
      textMap,
      componentsByLegoId: new Map(),
    })
    expect(blocks).not.toBeNull()
    expect(blocks!.length).toBe(3)
    expect(blocks![0]).toMatchObject({ id: 'L1', isSalient: false })
    expect(blocks![1].id).toMatch(/^_gap_/)
    expect(blocks![2]).toMatchObject({ id: 'L2', isSalient: true })
  })

  it('strips Chinese sentence punctuation from tokenisation', () => {
    const textMap = new Map([
      ['L1', '我'],
      ['L2', '喜欢'],
    ])
    // Trailing 。 should be dropped, decomposition unaffected.
    const blocks = decomposePhrase({
      targetText: '我喜欢。',
      salientId: 'L2',
      textMap,
      componentsByLegoId: new Map(),
    })
    expect(blocks).not.toBeNull()
    expect(blocks!.map(b => b.id)).toEqual(['L1', 'L2'])
  })
})
