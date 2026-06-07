/**
 * alignRomanToNative — verifies pinyin→hanzi syllable alignment, including the
 * erhua edge cases that broke the naive 1-token-1-char approach. Phrase fixtures
 * are drawn from the live zho_for_eng course.
 */

import { describe, it, expect } from 'vitest'
import { pinyinSyllableCount, sliceNativeByRoman, applyDualScript, buildWordTiles, buildWordPairTiles, nativeFromRomanTiles, buildSegmentedTiles, alignJapaneseRomaji } from './alignRomanToNative'

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

describe('buildWordPairTiles — space-separated scripts', () => {
  it('zips native and romanised words one-for-one (Russian)', () => {
    const tiles = buildWordPairTiles('ona mogla pomoch', 'Она могла помочь')!
    expect(tiles.map(t => t.targetText)).toEqual(['Она', 'могла', 'помочь'])
    expect(tiles.map(t => t.romanText)).toEqual(['ona', 'mogla', 'pomoch'])
  })

  it('tiles finer than a multi-word salient LEGO and bolds its words (Arabic)', () => {
    // salient LEGO spans the first three words; tiling is still per-word
    const tiles = buildWordPairTiles(
      'atatalaa\'u ila an kathiiran',
      'أتطلع إلى أن كثيرا',
      { salientNativeTexts: ['أتطلع إلى أن'] },
    )!
    expect(tiles.length).toBe(4)
    expect(tiles.map(t => t.isSalient)).toEqual([true, true, true, false])
  })

  it('returns null when word counts disagree (joined romanisation)', () => {
    expect(buildWordPairTiles('thelo na milísoume giaaftó', 'θέλω να μιλήσουμε για αυτό')).toBeNull()
  })
})

describe('nativeFromRomanTiles — spaceless scripts (Japanese/Thai)', () => {
  it('swaps native in by legoId and keeps romanisation as ruby', () => {
    const romanTiles = [
      { id: 'S1L1', targetText: 'jikan doori', isSalient: true },
      { id: 'S1L2', targetText: 'shinpai', isSalient: false },
    ]
    const nativeById = new Map([['S1L1', '時間通り'], ['S1L2', '心配']])
    const out = nativeFromRomanTiles(romanTiles, nativeById)
    expect(out.map(t => t.targetText)).toEqual(['時間通り', '心配'])
    expect(out.map(t => t.romanText)).toEqual(['jikan doori', 'shinpai'])
    expect(out[0].isSalient).toBe(true)
  })

  it('leaves unmatched (ghost) tiles romanised with no ruby', () => {
    const romanTiles = [{ id: '_gap_1', targetText: 'ga', isSalient: false }]
    const out = nativeFromRomanTiles(romanTiles, new Map())
    expect(out[0].targetText).toBe('ga')
    expect(out[0].romanText).toBeUndefined()
  })
})

describe('buildSegmentedTiles — device word segmentation (Japanese/Thai)', () => {
  it('segments native into words on-device and pairs romaji positionally', () => {
    const tiles = buildSegmentedTiles('友だちに時間をあげる', 'tomodachi ni jikan o ageru', 'ja')!
    expect(tiles).not.toBeNull()
    expect(tiles.map(t => t.targetText)).toEqual(['友だち', 'に', '時間', 'を', 'あげる'])
    expect(tiles.map(t => t.romanText)).toEqual(['tomodachi', 'ni', 'jikan', 'o', 'ageru'])
  })

  it('segments Thai into words', () => {
    const tiles = buildSegmentedTiles('ผมอยากพูดภาษาไทย', 'phom yak phut phasa thai', 'th')!
    expect(tiles.map(t => t.targetText)).toEqual(['ผม', 'อยาก', 'พูด', 'ภาษา', 'ไทย'])
    expect(tiles.map(t => t.romanText)).toEqual(['phom', 'yak', 'phut', 'phasa', 'thai'])
  })

  it('falls back to the native→romaji dictionary when counts disagree', () => {
    // romaji over-splits อาทิตย์ into "a thit" → counts differ → dict lookup
    const dict = new Map([['ผม', 'phom'], ['อาทิตย์', 'a thit']])
    const tiles = buildSegmentedTiles('ผมอาทิตย์', 'phom a thit', 'th', { nativeRomajiDict: dict })!
    const aathit = tiles.find(t => t.targetText === 'อาทิตย์')
    expect(aathit?.romanText).toBe('a thit')
  })

  it('forced-aligns Japanese romaji to every segmented tile (kanji included)', () => {
    // The exact dev cases where tiles were showing blank.
    expect(alignJapaneseRomaji(['止め', 'たい', 'と', '思う'], 'yametai to omou.'))
      .toEqual(['yame', 'tai', 'to', 'omou'])
    expect(alignJapaneseRomaji(['す', 'ごく', 'する', 'の', 'が', '好き'], 'sugoku suru no ga suki'))
      .toEqual(['su', 'goku', 'suru', 'no', 'ga', 'suki'])
    expect(alignJapaneseRomaji(
      ['学び', '始め', 'た', 'ことに', 'は', '満足', 'し', 'てる'],
      'manabi hajimeta koto ni wa manzoku shiteru',
    )).toEqual(['manabi', 'hajime', 'ta', 'kotoni', 'wa', 'manzoku', 'shi', 'teru'])
  })

  it('uses the forced aligner inside buildSegmentedTiles (no blank ruby)', () => {
    const tiles = buildSegmentedTiles('すごくするのが好き', 'sugoku suru no ga suki', 'ja')!
    expect(tiles.map(t => t.romanText)).toEqual(['su', 'goku', 'suru', 'no', 'ga', 'suki'])
    expect(tiles.every(t => !!t.romanText)).toBe(true)
  })

  it('marks salient words from the salient LEGO text', () => {
    const tiles = buildSegmentedTiles('友だちに時間をあげる', 'tomodachi ni jikan o ageru', 'ja', {
      salientNativeTexts: ['時間'],
    })!
    const jikan = tiles.find(t => t.targetText === '時間')
    expect(jikan?.isSalient).toBe(true)
    expect(tiles.find(t => t.targetText === '友だち')?.isSalient).toBe(false)
  })
})
