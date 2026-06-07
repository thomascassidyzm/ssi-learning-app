/**
 * alignRomanToNative — verifies pinyin→hanzi syllable alignment, including the
 * erhua edge cases that broke the naive 1-token-1-char approach. Phrase fixtures
 * are drawn from the live zho_for_eng course.
 */

import { describe, it, expect } from 'vitest'
import { pinyinSyllableCount, sliceNativeByRoman, applyDualScript, buildWordTiles, attachRuby } from './alignRomanToNative'

describe('pinyinSyllableCount', () => {
  it('counts vowel nuclei per pinyin word', () => {
    expect(pinyinSyllableCount('wǒ')).toBe(1) // 我
    expect(pinyinSyllableCount('xīwàng')).toBe(2) // 希望
    expect(pinyinSyllableCount('bànfǎ')).toBe(2) // 办法
    expect(pinyinSyllableCount('xúncháng')).toBe(2) // 寻常
    expect(pinyinSyllableCount('shìshi')).toBe(2) // 试试 (neutral 2nd tone, no mark)
    expect(pinyinSyllableCount('nàge')).toBe(2) // 那个
  })

  it('does not over-count the standalone er-syllable', () => {
    expect(pinyinSyllableCount('èr')).toBe(1) // 二
    expect(pinyinSyllableCount('ér')).toBe(1) // 而
  })

  it('counts erhua (merged 儿) as an extra character', () => {
    expect(pinyinSyllableCount('yíhuìr')).toBe(3) // 一会儿
    expect(pinyinSyllableCount('nàr')).toBe(2) // 那儿
    expect(pinyinSyllableCount('wánr')).toBe(2) // 玩儿
  })

  it('treats syllable-initial r correctly (not erhua)', () => {
    expect(pinyinSyllableCount('rén')).toBe(1) // 人
    expect(pinyinSyllableCount('ròu')).toBe(1) // 肉
  })

  it('honours the apostrophe syllable boundary', () => {
    expect(pinyinSyllableCount("dá'àn")).toBe(2) // 答案
    expect(pinyinSyllableCount("nǚ'ér")).toBe(2) // 女儿
  })

  it('counts diphthongs/triphthongs as one syllable', () => {
    expect(pinyinSyllableCount('xiǎng')).toBe(1) // 想
    expect(pinyinSyllableCount('jiào')).toBe(1) // 叫
    expect(pinyinSyllableCount('duō')).toBe(1) // 多
  })
})

describe('sliceNativeByRoman', () => {
  it('slices a phrase into per-tile hanzi runs', () => {
    const roman = ['wǒ', 'xīwàng', 'yǒu', 'bànfǎ']
    const native = '我希望有办法'
    expect(sliceNativeByRoman(roman, native)).toEqual(['我', '希望', '有', '办法'])
  })

  it('attaches trailing punctuation to the last tile', () => {
    const roman = ['tā', 'yě', 'xiǎng', 'duō', 'xué']
    const native = '他也想多学。'
    expect(sliceNativeByRoman(roman, native)).toEqual(['他', '也', '想', '多', '学。'])
  })

  it('aligns erhua phrases (the case the naive approach failed)', () => {
    // "nǐ néng shuō yīhuìr ma" → 你能说一会儿吗
    const roman = ['nǐ', 'néng', 'shuō', 'yīhuìr', 'ma']
    const native = '你能说一会儿吗'
    expect(sliceNativeByRoman(roman, native)).toEqual(['你', '能', '说', '一会儿', '吗'])
  })

  it('returns null when syllable and hanzi counts disagree', () => {
    // Native has more characters than the romanisation accounts for.
    expect(sliceNativeByRoman(['wǒ'], '我们')).toBeNull()
  })

  it('returns null for non-hanzi native (e.g. missing romanisation upstream)', () => {
    expect(sliceNativeByRoman(['hello'], '')).toBeNull()
  })
})

describe('applyDualScript', () => {
  it('promotes romanised tiles to native-primary with a roman ruby', () => {
    const roman = [
      { id: 'L1', targetText: 'wǒ', isSalient: false },
      { id: 'L2', targetText: 'xīwàng', isSalient: true },
      { id: 'L3', targetText: 'yǒu', isSalient: false },
      { id: 'L4', targetText: 'bànfǎ', isSalient: false },
    ]
    const out = applyDualScript(roman, '我希望有办法')
    expect(out.map(b => b.targetText)).toEqual(['我', '希望', '有', '办法'])
    expect(out.map(b => b.romanText)).toEqual(['wǒ', 'xīwàng', 'yǒu', 'bànfǎ'])
    // boundaries + flags preserved
    expect(out[1].isSalient).toBe(true)
    expect(out.map(b => b.id)).toEqual(['L1', 'L2', 'L3', 'L4'])
  })

  it('aligns M-LEGO components to native too', () => {
    const roman = [
      {
        id: 'M1', targetText: 'xiǎng yào', isSalient: true,
        components: [{ known: 'want', target: 'xiǎng' }, { known: 'to', target: 'yào' }],
      },
    ]
    const out = applyDualScript(roman, '想要')
    expect(out[0].targetText).toBe('想要')
    expect(out[0].components!.map(c => c.target)).toEqual(['想', '要'])
    expect(out[0].components!.map(c => c.known)).toEqual(['want', 'to'])
  })

  it('falls back to the romanised tiling unchanged when alignment fails', () => {
    const roman = [{ id: 'L1', targetText: 'wǒ', isSalient: true }]
    // native has more characters than the romanisation accounts for
    const out = applyDualScript(roman, '我们')
    expect(out).toBe(roman)
    expect(out[0].romanText).toBeUndefined()
  })
})

describe('buildWordTiles', () => {
  // The exact phrase from the dev report: an 8-char clause is ONE LEGO, but
  // pinyin word-spacing chunks it into parseable tiles.
  const roman = 'nǐ xiǎng shénme shíhou kāishǐ liànxí?'
  const native = '你想什么时候开始练习？'

  it('tiles by pinyin word, not by LEGO', () => {
    const tiles = buildWordTiles(roman, native)!
    expect(tiles.map(t => t.targetText)).toEqual(['你', '想', '什么', '时候', '开始', '练习？'])
    expect(tiles.map(t => t.romanText)).toEqual(['nǐ', 'xiǎng', 'shénme', 'shíhou', 'kāishǐ', 'liànxí?'])
  })

  it('bolds only the word tiles inside the salient LEGO span', () => {
    const tiles = buildWordTiles(roman, native, { salientNativeTexts: ['你想什么时候开始'] })!
    expect(tiles.map(t => t.isSalient)).toEqual([true, true, true, true, true, false])
  })

  it('emphasises every tile when no salient info is supplied', () => {
    const tiles = buildWordTiles(roman, native)!
    expect(tiles.every(t => t.isSalient)).toBe(true)
  })

  it('returns null when the native phrase cannot be aligned', () => {
    expect(buildWordTiles('wǒ', '我们')).toBeNull()
  })
})

describe('attachRuby — word-zip (space-separated scripts)', () => {
  it('zips transliteration word-for-word (Russian)', () => {
    const blocks = [
      { id: 'L1', targetText: 'Она', isSalient: false },
      { id: 'L2', targetText: 'могла', isSalient: true },
      { id: 'L3', targetText: 'помочь', isSalient: false },
    ]
    const out = attachRuby(blocks, 'ona mogla pomoch')
    expect(out.map(b => b.romanText)).toEqual(['ona', 'mogla', 'pomoch'])
  })

  it('gives a multi-word LEGO its multi-word transliteration (Greek)', () => {
    const blocks = [
      { id: 'L1', targetText: 'σαν', isSalient: false },
      { id: 'L2', targetText: 'στον πατέρα', isSalient: true },
    ]
    const out = attachRuby(blocks, 'san ston patera')
    expect(out[0].romanText).toBe('san')
    expect(out[1].romanText).toBe('ston patera')
  })

  it('skips pure-punctuation tiles without consuming a roman word', () => {
    const blocks = [
      { id: 'L1', targetText: 'λέξη', isSalient: true },
      { id: 'g', targetText: '.', isSalient: false },
    ]
    const out = attachRuby(blocks, 'lexi')
    expect(out[0].romanText).toBe('lexi')
    expect(out[1].romanText).toBeUndefined()
  })
})

describe('attachRuby — per-LEGO lookup (Japanese)', () => {
  it('uses per-LEGO transliteration for spaceless scripts', () => {
    // 来るか / 気になる — no spaces, romaji has more "words" than native tiles
    const blocks = [
      { id: 'S1L1', targetText: '来るか', isSalient: false },
      { id: 'S1L2', targetText: '気になる。', isSalient: true },
    ]
    const legoRoman = new Map([['S1L1', 'kuru ka'], ['S1L2', 'ki ni naru']])
    const out = attachRuby(blocks, 'kuru ka ki ni naru.', { nativeSpaced: false, legoRomanById: legoRoman })
    expect(out.map(b => b.romanText)).toEqual(['kuru ka', 'ki ni naru'])
  })

  it('does NOT word-zip a spaceless script even if word counts coincide', () => {
    // Two native tiles, two romaji words — but they must NOT be zipped 1:1
    // (the romaji words don't correspond to the kanji tiles). Per-LEGO wins.
    const blocks = [
      { id: 'A', targetText: '時間', isSalient: false },
      { id: 'B', targetText: '今', isSalient: true },
    ]
    const legoRoman = new Map([['A', 'jikan'], ['B', 'ima']])
    const out = attachRuby(blocks, 'foo bar', { nativeSpaced: false, legoRomanById: legoRoman })
    expect(out.map(b => b.romanText)).toEqual(['jikan', 'ima']) // from lookup, not 'foo'/'bar'
  })

  it('leaves tiles unruby-d when no source resolves', () => {
    const blocks = [{ id: 'x', targetText: '来る', isSalient: true }]
    const out = attachRuby(blocks, 'kuru ka ki', { nativeSpaced: false })
    expect(out[0].romanText).toBeUndefined()
  })
})
