/**
 * alignRomanToNative — map a romanised (pinyin) tiling onto native-script
 * (hanzi) text so a SINGLE decomposition can be shown in either script.
 *
 * Why this exists
 * ───────────────
 * Pinyin is whitespace-segmented into words and chunks cleanly into the
 * 2-3-unit tiles the player wants. Hanzi has no spaces, so re-segmenting the
 * native text on its own collapses whole phrases into one giant tile. But
 * Mandarin has a property we can exploit: **one hanzi character = one
 * spoken syllable**. So if we know how many syllables each pinyin tile holds,
 * we can slice exactly that many hanzi characters off the native phrase and
 * hand each tile its matching characters — no native segmentation needed.
 *
 * Measured against the live zho_for_eng course this aligns 399/400 phrases;
 * the one residual is a row with no romanisation at all (a content gap), which
 * the caller falls back on. The previously-failing cases were all erhua
 * (一会儿 "yíhuìr"), handled below.
 *
 * Scope: Mandarin-specific (syllable counting is pinyin-shaped). Japanese
 * romaji↔kanji is NOT 1-mora-1-char, so this must not be used for Japanese —
 * the caller relies on lego-level pairing there instead.
 */

import type { LegoBlock } from '../components/LegoAssembly.vue'

/** Hanzi (CJK unified ideographs incl. Ext-A) — the "one char = one syllable"
 *  units we slice. Kana/Hangul deliberately excluded: this is Mandarin-only. */
const HANZI_RE = /[㐀-鿿]/
/** Pinyin vowel nuclei, including every tone-marked variant. Each maximal run
 *  of these is one syllable nucleus. */
const VOWEL_RE = /[aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i

/** Strip tone marks / lowercase and unify apostrophes so we can recognise the
 *  standalone "er" syllable (二/而/儿) and the pinyin syllable-boundary
 *  apostrophe. ü/v fold to u (a vowel either way for nucleus counting). */
function deaccent(word: string): string {
  return word
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining tone marks
    .replace(/ü/g, 'u')
    .replace(/v/g, 'u')
    .replace(/[‘’ʼ`´]/g, "'") // unify apostrophe variants
}

/**
 * Count Mandarin syllables (= hanzi characters) in ONE pinyin word token.
 *
 * Base count = number of maximal vowel runs (one vowel nucleus per syllable).
 * Plus erhua: a word-final 'r' that is NOT itself the "er" syllable adds one
 * character (the merged 儿 / 兒). The standalone "er" token (二/而/儿) is
 * guarded so its coda 'r' is not double-counted.
 */
export function pinyinSyllableCount(word: string): number {
  const norm = deaccent(word)
  const bare = norm.replace(/[^a-z]/g, '')
  if (!bare) return 0

  // Count maximal vowel runs. An apostrophe is pinyin's explicit syllable
  // boundary (dá'àn 答案, nǚ'ér 女儿) — it forces a run break so the two
  // syllables either side are counted separately rather than merged as one
  // vowel cluster. Consonants break runs the same way.
  let nuclei = 0
  let inRun = false
  for (const ch of norm) {
    if (/[a-z]/.test(ch) && VOWEL_RE.test(ch)) {
      if (!inRun) { nuclei++; inRun = true }
    } else {
      inRun = false
    }
  }
  if (nuclei === 0) return 0

  // Erhua (merged 儿 / 兒): a word-final 'r' that isn't a syllable-initial is
  // either the standalone "er" syllable or an erhua suffix. In pinyin the only
  // base final ending in 'r' is "er" itself, so any trailing 'r' is one of:
  //   • the whole word is "er"            (二/而)            — already counted
  //   • C + er  e.g. "gēr" (歌儿)          — 'e' run counts 歌, 'r' adds 儿
  //   • V + er  e.g. "nǚér" (女儿)         — "er" is its own counted syllable
  //   • <coda> + r e.g. "wánr"/"nàr"       — 'r' is erhua, adds one character
  if (bare !== 'er' && bare.endsWith('r')) {
    const beforeR = bare[bare.length - 2]
    if (beforeR === 'e') {
      // Distinguish a counted "er" syllable from a C+er erhua. The "er"
      // syllable has no initial — 'e' sits at word start or after another
      // vowel (a syllable boundary). 'e' after a consonant means C+er erhua.
      const beforeE = bare[bare.length - 3]
      if (beforeE !== undefined && !VOWEL_RE.test(beforeE)) nuclei += 1
    } else if (beforeR !== undefined) {
      nuclei += 1
    }
  }
  return nuclei
}

/** Whitespace-split a roman phrase/tile into pinyin word tokens. */
function pinyinWords(roman: string): string[] {
  return roman.trim().split(/\s+/).filter(Boolean)
}

/** Total syllables (= expected hanzi count) across a roman string. */
function syllablesIn(roman: string): number {
  return pinyinWords(roman).reduce((sum, w) => sum + pinyinSyllableCount(w), 0)
}

/** Count hanzi characters in a native string. */
function hanziCount(native: string): number {
  let n = 0
  for (const ch of native) if (HANZI_RE.test(ch)) n++
  return n
}

/**
 * Slice a native (hanzi) phrase into per-tile substrings parallel to an
 * ordered list of romanised tile texts.
 *
 * Each tile consumes `pinyinSyllableCount`-many hanzi characters from a running
 * cursor over `nativePhrase`; any non-hanzi characters (punctuation, the rare
 * latin token) that immediately follow are attached to that same tile, and any
 * leading non-hanzi is attached to the first tile.
 *
 * Returns `null` when the alignment can't be trusted — total syllables across
 * the tiles don't equal the hanzi count, or the phrase has no hanzi at all.
 * The caller then keeps the romanised tiling unchanged rather than risk a
 * mis-sliced native render.
 */
export function sliceNativeByRoman(
  romanTexts: string[],
  nativePhrase: string,
): string[] | null {
  if (!nativePhrase) return null
  const totalHan = hanziCount(nativePhrase)
  if (totalHan === 0) return null

  const wantPerTile = romanTexts.map(syllablesIn)
  const totalWant = wantPerTile.reduce((a, b) => a + b, 0)
  // Erhua + standalone-er handling should make these equal. If they diverge
  // the data is anomalous (e.g. a null/partial romanisation) — bail so the
  // caller falls back instead of producing a silently-shifted alignment.
  if (totalWant !== totalHan) return null

  const chars = [...nativePhrase]
  const out: string[] = []
  let cursor = 0

  // Leading non-hanzi (rare) rides on the first tile.
  let lead = ''
  while (cursor < chars.length && !HANZI_RE.test(chars[cursor])) {
    lead += chars[cursor]
    cursor++
  }

  for (let t = 0; t < romanTexts.length; t++) {
    let take = wantPerTile[t]
    let piece = ''
    while (cursor < chars.length && (take > 0 || !HANZI_RE.test(chars[cursor]))) {
      const ch = chars[cursor]
      const isHan = HANZI_RE.test(ch)
      // Stop before a hanzi that belongs to the next tile.
      if (isHan && take === 0) break
      piece += ch
      if (isHan) take--
      cursor++
    }
    out.push(piece)
  }

  // Any trailing characters (shouldn't happen once counts match) join the last
  // tile so no native text is ever dropped.
  if (cursor < chars.length) {
    out[out.length - 1] = (out[out.length - 1] || '') + chars.slice(cursor).join('')
  }
  if (lead) out[0] = lead + (out[0] || '')

  return out
}

/**
 * Promote a romanised-script tiling to dual-script tiles.
 *
 * The tiling is computed once on the romanised script (which segments cleanly);
 * this turns each tile into native-primary form — `targetText` becomes the
 * native-script slice, and the romanised text rides along as `romanText` for the
 * optional ruby annotation. M-LEGO components are aligned to native too so a
 * tile's internal breakdown stays in the same script as the tile.
 *
 * The tile BOUNDARIES are preserved exactly — only the script of the text
 * changes. If the native phrase can't be aligned to the tiles (rare data
 * anomalies: a missing apostrophe, a pinyin/hanzi content mismatch), the
 * romanised tiling is returned unchanged so the learner still sees correct
 * chunking rather than a mis-sliced native render.
 */
export function applyDualScript(blocks: LegoBlock[], nativePhrase: string): LegoBlock[] {
  if (blocks.length === 0) return blocks
  const nativeSlices = sliceNativeByRoman(blocks.map(b => b.targetText), nativePhrase)
  if (!nativeSlices) return blocks

  return blocks.map((b, i) => {
    const nativeText = nativeSlices[i] || b.targetText
    const out: LegoBlock = { ...b, targetText: nativeText, romanText: b.targetText }
    if (b.components && b.components.length > 0) {
      const compNatives = sliceNativeByRoman(b.components.map(c => c.target), nativeText)
      out.components = compNatives
        ? b.components.map((c, ci) => ({ ...c, target: compNatives[ci] || c.target }))
        : undefined // alignment failed → render as a single native span
    }
    return out
  })
}
