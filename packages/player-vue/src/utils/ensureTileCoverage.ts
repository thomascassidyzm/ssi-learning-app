import type { LegoBlock } from '../components/LegoAssembly.vue'

const TAG = '[TileCoverage]'

/** Same punctuation-strip regex as generateLearningScript.ts */
const PUNCT_RE = /[.,!?;:¡¿'"\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g

/** CJK detection — same regex as generateLearningScript.ts */
const CJK_RE = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(PUNCT_RE, '')
}

/** Tokenize: split on whitespace for alphabetic, per-character for CJK */
function tokenize(text: string): string[] {
  if (!text) return []
  if (CJK_RE.test(text)) {
    // Each CJK character is its own token; strip punctuation first
    return normalize(text).split('').filter(ch => ch.trim() !== '')
  }
  return normalize(text).split(/\s+/).filter(Boolean)
}

/**
 * Ensure every word in `fullPhraseText` is covered by a tile.
 * Fills gaps with neutral gap-filler blocks.
 * Returns [] on alignment failure (caller falls back to empty tiles).
 */
export function ensureTileCoverage(blocks: LegoBlock[], fullPhraseText: string): LegoBlock[] {
  if (!fullPhraseText || blocks.length === 0) return blocks

  const isCJK = CJK_RE.test(fullPhraseText)

  // Normalized tokens for matching
  const phraseTokens = tokenize(fullPhraseText)
  if (phraseTokens.length === 0) return blocks

  // Original-cased tokens for display (parallel array)
  const originalTokens = isCJK
    ? fullPhraseText.replace(PUNCT_RE, '').split('').filter(ch => ch.trim() !== '')
    : fullPhraseText.trim().replace(PUNCT_RE, '').split(/\s+/).filter(Boolean)

  const result: LegoBlock[] = []
  let phraseIdx = 0
  let gapCount = 0

  for (const block of blocks) {
    const blockTokens = tokenize(block.targetText)
    if (blockTokens.length === 0) {
      // Block has empty text after normalization — skip it
      continue
    }

    // Find where this block's tokens start in the remaining phrase
    let matchStart = -1
    for (let i = phraseIdx; i <= phraseTokens.length - blockTokens.length; i++) {
      let match = true
      for (let j = 0; j < blockTokens.length; j++) {
        if (phraseTokens[i + j] !== blockTokens[j]) {
          match = false
          break
        }
      }
      if (match) {
        matchStart = i
        break
      }
    }

    if (matchStart === -1) {
      // Block not found in remaining phrase — alignment failure
      console.warn(`${TAG} Alignment failure: block "${block.targetText}" not found in remaining phrase "${phraseTokens.slice(phraseIdx).join(isCJK ? '' : ' ')}"`)
      return []
    }

    // Fill gap between phraseIdx and matchStart
    for (let i = phraseIdx; i < matchStart; i++) {
      gapCount++
      result.push({
        id: `_gap_${gapCount}`,
        targetText: originalTokens[i],
        isSalient: false,
      })
    }

    result.push(block)
    phraseIdx = matchStart + blockTokens.length
  }

  // Trailing tokens after last block
  for (let i = phraseIdx; i < phraseTokens.length; i++) {
    gapCount++
    result.push({
      id: `_gap_${gapCount}`,
      targetText: originalTokens[i],
      isSalient: false,
    })
  }

  if (gapCount > 0) {
    console.warn(`${TAG} Filled ${gapCount} gap(s) in "${fullPhraseText}"`)
  }

  return result
}
