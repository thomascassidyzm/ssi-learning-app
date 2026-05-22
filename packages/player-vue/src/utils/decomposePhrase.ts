/**
 * decomposePhrase — client-side fallback for when the backend doesn't ship
 * a `decomposition` array on a cycle (notably INFPLAY USE phrases today).
 *
 * Walks the phrase token-by-token and binds each token (or token-group)
 * to a previously-introduced LEGO from the learner's known-vocab map.
 * Returns the same LegoBlock[] shape the rich-path renderer in
 * LearningPlayer already consumes — so downstream tile rendering,
 * inserter styling, and ensureTileCoverage gap-fill are reused without
 * branching.
 *
 * Salient handling: if the salient LEGO is an M-LEGO with declared atoms,
 * locate every atom's token position first (character-exact, out-of-order
 * allowed, claimed-token tracking — same logic LegoAssembly uses
 * internally), then emit ONE salient block whose targetText spans from
 * first atom to last atom (including any tokens between atoms — those
 * render as inserters via the existing alignComponentsToFullText path).
 *
 * Other tokens: greedy max-munch against the reverse-text map (longest
 * matching key at each position wins). Salient atoms are claimed first
 * so they can't be re-matched as their own A-LEGOs.
 *
 * Unmatched tokens: per the SSi methodology invariant, every word in a
 * phrase is a previously-introduced LEGO. An unmatched token therefore
 * indicates a content authoring bug; we surface it with a console.warn
 * AND emit a ghost-tile so the golden rule still holds (every audible
 * word has a visual tile).
 *
 * CJK: handled natively via per-character tokenisation. Chinese / Japanese
 * kanji / Korean phrases tokenise one character per Tok; LEGO atom texts
 * are similarly split per-char in atomTokens. Reverse-map keys for CJK
 * LEGOs concatenate with no separator (joinKey honours the script). The
 * salient LEGO test runs the same way for both scripts.
 *
 * Returns null when decomposition can't be attempted (empty input or
 * vocab maps not yet loaded). Caller falls back to its existing chain.
 */

import type { LegoBlock } from '../components/LegoAssembly.vue'

const CJK_RE = /[　-鿿가-힯＀-￯]/
// Strip sentence punctuation but PRESERVE in-word apostrophes and hyphens —
// French "d'un" / "j'aime", English "don't", compound nouns etc. keep
// their lexical identity. Smart-quote variants normalise to straight ASCII
// first so "l'italiano" and "l'italiano" match the same key.
const PUNCT_RE = /[.,!?;:¡¿"„""«»。、！？；：]+/g
const SMART_APOS_RE = /[‘’ʼ]/g  // ’ ‘ ʼ → '
const MAX_WINDOW = 8  // longest M-LEGO token-count we'd reasonably look up

type Atom = { known: string; target: string }
type Tok = { lower: string; start: number; end: number }

function isCjk(text: string): boolean {
  return CJK_RE.test(text)
}

/** Tokenise the phrase for matching. Alphabetic scripts split on whitespace;
 *  CJK has no spaces, so each character becomes its own token. Punctuation
 *  and whitespace are dropped from both modes. Each Tok carries its
 *  original-text char offset so the salient-span path can slice the original
 *  string back out (preserving punctuation, casing, and spacing). */
function tokenisePhrase(targetText: string): Tok[] {
  const tokens: Tok[] = []
  if (isCjk(targetText)) {
    for (let i = 0; i < targetText.length; i++) {
      const raw = targetText[i]
      if (/\s/.test(raw)) continue
      const cleaned = raw.toLowerCase().replace(SMART_APOS_RE, "'").replace(PUNCT_RE, '')
      if (cleaned.length === 0) continue
      tokens.push({ lower: cleaned, start: i, end: i + 1 })
    }
    return tokens
  }
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(targetText)) !== null) {
    const raw = m[0]
    const cleaned = raw.toLowerCase().replace(SMART_APOS_RE, "'").replace(PUNCT_RE, '')
    if (cleaned.length === 0) continue
    tokens.push({ lower: cleaned, start: m.index, end: m.index + raw.length })
  }
  return tokens
}

function normaliseLegoText(text: string): string {
  return text.toLowerCase().replace(SMART_APOS_RE, "'").replace(PUNCT_RE, '').trim()
}

/** Split a LEGO's target into tokens parallel to tokenisePhrase. For
 *  alphabetic scripts that's whitespace-split; for CJK it's per-character. */
function atomTokens(atomTarget: string): string[] {
  const normalised = normaliseLegoText(atomTarget)
  if (isCjk(atomTarget)) {
    return normalised.split('').filter(ch => ch.trim() !== '')
  }
  return normalised.split(/\s+/).filter(Boolean)
}

/** Join a sequence of token-lowers back into a reverse-map key. CJK keys
 *  have no separator; alphabetic keys are space-joined. Mirrors the way
 *  buildTextToLegoIdMap normalises LEGO texts. */
function joinKey(slice: Tok[], cjk: boolean): string {
  return slice.map(t => t.lower).join(cjk ? '' : ' ')
}

/** Build a reverse `Map<lowercase_normalised_text, legoId>` from the
 *  learner's known-LEGO text map. Both A-LEGOs and M-LEGOs are included —
 *  whatever's been loaded into the text map is matchable. */
function buildTextToLegoIdMap(textMap: Map<string, string>): Map<string, string> {
  const m = new Map<string, string>()
  for (const [id, text] of textMap.entries()) {
    if (!text) continue
    const key = normaliseLegoText(text)
    if (key.length === 0) continue
    // First-wins on collision (LEGOs shouldn't duplicate text, but defensive)
    if (!m.has(key)) m.set(key, id)
  }
  return m
}

/** Locate every declared atom of an M-LEGO in the phrase tokens. Returns
 *  the span (first-atom token start, last-atom token end-exclusive) and
 *  the set of token indices claimed by the salient, or null if any atom
 *  can't be found character-exact. */
function findSalientSpan(
  tokens: Tok[],
  atoms: Atom[],
): { startTok: number; endTokExcl: number; claimed: Set<number> } | null {
  if (atoms.length === 0) return null
  const claimed = new Set<number>()
  const atomStarts: number[] = []
  const atomEnds: number[] = []
  for (const atom of atoms) {
    const aToks = atomTokens(atom.target)
    if (aToks.length === 0) continue
    let foundAt = -1
    outer: for (let i = 0; i <= tokens.length - aToks.length; i++) {
      for (let k = 0; k < aToks.length; k++) {
        if (claimed.has(i + k)) continue outer
        if (tokens[i + k].lower !== aToks[k]) continue outer
      }
      foundAt = i
      break
    }
    if (foundAt === -1) return null
    for (let k = 0; k < aToks.length; k++) claimed.add(foundAt + k)
    atomStarts.push(foundAt)
    atomEnds.push(foundAt + aToks.length)
  }
  if (atomStarts.length === 0) return null
  const startTok = Math.min(...atomStarts)
  const endTokExcl = Math.max(...atomEnds)
  // Claim every token inside the span (including inserters) so the
  // greedy walk doesn't re-bind them to their own A-LEGOs.
  const fullClaim = new Set<number>()
  for (let i = startTok; i < endTokExcl; i++) fullClaim.add(i)
  return { startTok, endTokExcl, claimed: fullClaim }
}

export interface DecomposePhraseArgs {
  targetText: string
  salientId: string
  /** legoTargetTextMap (or its useNative variant) — id → text */
  textMap: Map<string, string>
  /** _componentsByLegoId (or its useNative variant) — M-LEGO id → atoms */
  componentsByLegoId: Map<string, Atom[]>
}

/** Find a contiguous token span matching the salient's canonical text.
 *  Returns the token range or null. Character-exact, case-insensitive
 *  (via the normaliser). Used to claim the salient's tokens BEFORE the
 *  greedy max-munch walk runs — otherwise a longer overlapping M-LEGO
 *  match could swallow the salient and leave nothing flagged isSalient. */
function findSalientTextSpan(
  tokens: Tok[],
  salientText: string,
): { startTok: number; endTokExcl: number } | null {
  const salientToks = isCjk(salientText)
    ? normaliseLegoText(salientText).split('').filter(ch => ch.trim() !== '')
    : normaliseLegoText(salientText).split(/\s+/).filter(Boolean)
  if (salientToks.length === 0) return null
  for (let i = 0; i <= tokens.length - salientToks.length; i++) {
    let match = true
    for (let k = 0; k < salientToks.length; k++) {
      if (tokens[i + k].lower !== salientToks[k]) { match = false; break }
    }
    if (match) return { startTok: i, endTokExcl: i + salientToks.length }
  }
  return null
}

export function decomposePhrase({
  targetText,
  salientId,
  textMap,
  componentsByLegoId,
}: DecomposePhraseArgs): LegoBlock[] | null {
  if (!targetText) return null
  if (textMap.size === 0) return null  // vocab not yet loaded

  const cjk = isCjk(targetText)
  const tokens = tokenisePhrase(targetText)
  if (tokens.length === 0) return null

  const reverseMap = buildTextToLegoIdMap(textMap)
  if (reverseMap.size === 0) return null

  // Step 1: locate the salient's token span. Try in order:
  //   1a. M-LEGO atoms (non-contiguous allowed — handles separable verbs
  //       and word-order rearrangement).
  //   1b. Canonical salient text as a contiguous token sequence (handles
  //       A-LEGO salients AND M-LEGOs whose canonical text appears
  //       verbatim in the phrase).
  // Either path claims the span's tokens so the greedy walk can't
  // swallow them into a longer overlapping M-LEGO and leave the salient
  // unflagged.
  const salientAtoms = salientId ? componentsByLegoId.get(salientId) ?? null : null
  let salientSpan = salientAtoms ? findSalientSpan(tokens, salientAtoms) : null
  if (!salientSpan && salientId) {
    const salientText = textMap.get(salientId)
    if (salientText) {
      const textSpan = findSalientTextSpan(tokens, salientText)
      if (textSpan) {
        const fullClaim = new Set<number>()
        for (let i = textSpan.startTok; i < textSpan.endTokExcl; i++) fullClaim.add(i)
        salientSpan = { startTok: textSpan.startTok, endTokExcl: textSpan.endTokExcl, claimed: fullClaim }
      }
    }
  }

  // Step 2: walk tokens, emitting blocks. Salient span is one block;
  // other tokens use greedy max-munch.
  const blocks: LegoBlock[] = []
  let pos = 0
  let unmatchedCount = 0

  while (pos < tokens.length) {
    // Salient span emits as one block. If the span came from the M-LEGO
    // atom path (salientAtoms non-null), carry components so the inserter
    // rendering engages for inside-span non-atom tokens. If it came from
    // the text-substring path (A-LEGO or contiguous M-LEGO), no
    // components — single tile.
    if (salientSpan && pos === salientSpan.startTok) {
      const spanText = targetText.slice(
        tokens[salientSpan.startTok].start,
        tokens[salientSpan.endTokExcl - 1].end,
      )
      const block: LegoBlock = {
        id: salientId,
        targetText: spanText,
        isSalient: true,
      }
      if (salientAtoms) {
        block.components = salientAtoms.map(a => ({ known: '', target: a.target }))
      }
      blocks.push(block)
      pos = salientSpan.endTokExcl
      continue
    }

    // Greedy max-munch from reverseMap. Don't let a window overlap into
    // the salient span (would corrupt the salient's identity).
    let matched = false
    const maxW = Math.min(MAX_WINDOW, tokens.length - pos)
    for (let w = maxW; w >= 1; w--) {
      if (salientSpan && pos < salientSpan.startTok && pos + w > salientSpan.startTok) continue
      const slice = tokens.slice(pos, pos + w)
      const key = joinKey(slice, cjk)
      const legoId = reverseMap.get(key)
      if (legoId) {
        const originalText = targetText.slice(slice[0].start, slice[w - 1].end)
        const atoms = componentsByLegoId.get(legoId)
        const comps = atoms ? atoms.map(a => ({ known: '', target: a.target })) : undefined
        blocks.push({
          id: legoId,
          targetText: originalText,
          // Salient flag from the greedy walk — covers A-LEGO salients
          // (no atoms to anchor on, so the salientSpan branch above
          // never fires) and any other position where the salient
          // happens to be found by greedy max-munch rather than via
          // its M-LEGO atom decomposition.
          isSalient: legoId === salientId,
          ...(comps ? { components: comps } : {}),
        })
        pos += w
        matched = true
        break
      }
    }

    if (!matched) {
      unmatchedCount++
      console.warn(
        `[decomposePhrase] Unmatched token "${targetText.slice(tokens[pos].start, tokens[pos].end)}" in phrase "${targetText}" — methodology says every word should be a previously-introduced LEGO. Likely content gap.`,
      )
      blocks.push({
        id: `_gap_cs_${pos}`,
        targetText: targetText.slice(tokens[pos].start, tokens[pos].end),
        isSalient: false,
      })
      pos += 1
    }
  }

  // If we couldn't match anything at all, the vocab is too sparse to
  // produce a useful decomposition — let the caller fall back.
  if (blocks.length === 0) return null
  if (unmatchedCount === tokens.length) return null

  return blocks
}
