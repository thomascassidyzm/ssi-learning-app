/**
 * breathGroups — the Immersion tracker's grain, derived from the AUDIO.
 *
 * Tom's ruling (2026-09-12): pods are never cut below the sentence, so a long
 * sentence keeps pace Spotify-transcript style using the timings WITHIN the
 * sentence. The grain is not a text tokenisation: a run of words with no pause
 * between them is a BREATH GROUP, and a pause is a gap between one word's end
 * and the next word's start at or above BREATH_PAUSE_SEC. Nothing here goes
 * below what the ear hears.
 *
 * Threshold, from the data rather than a guess (6,036 pod target clips with
 * Azure word boundaries, 55,368 word gaps, measured 2026-09-12): gaps inside a
 * phrase sit at 0–100 ms (p95 of the no-punctuation gaps is 100 ms, and the
 * histogram is empty by 300 ms bar a tail); real pauses sit at 400 ms and up
 * (after a full stop, 700–1,250 ms). 250 ms is a CHOSEN floor between the
 * two populations, not an empty band: re-measured on the 4,798 pod sentence
 * clips with word boundaries (33,423 gaps, 2026-09-12, job #425) the band
 * 250–399 ms holds 22 gaps, against 815 at 100–249 and 3,048 at 400+.
 *
 * Two raw shapes are accepted, because two writers exist:
 *   - the #407 contract: { source, words[], starts[], ends[] } in seconds;
 *   - the Azure shape already on course_audio.word_boundaries:
 *     [{ text, offset, duration }] in milliseconds, punctuation as its own
 *     token (merged into the word before it here — a comma is not a word).
 * A THIRD shape on course_audio.word_boundaries is not word timings at all:
 * [[offset_ms, viseme_id], …] — Azure viseme frames (ids 0–21, several per
 * word, no text), written for ~375k course-phrase clips and, across the
 * 29,496 pod sentence clips, present on 5 reused course-phrase clips
 * (measured live 2026-09-12, job #425). No words, so nothing to track: it
 * normalises to null on purpose, and so does anything else, anything
 * degenerate (the 19 all-zero [[0,0],…] rows) and null — null renders
 * exactly as today.
 */

export const BREATH_PAUSE_SEC = 0.25

export interface WordTimings {
  words: string[]
  /** seconds, playback order, same length as words */
  starts: number[]
  ends: number[]
}

export interface BreathGroup {
  /** display text of the group — a slice of the sentence text when the
   *  timing words align to it, else the timing words joined */
  text: string
  start: number
  end: number
  /** timing-word index range [wordFrom, wordTo) the group covers */
  wordFrom: number
  wordTo: number
}

const PUNCT_ONLY = /^[\p{P}\p{S}\s]+$/u
const STRIP_PUNCT = /^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu
const OPENING_PUNCT = /[\p{Ps}\p{Pi}¡¿"']/u

type ContractShape = { words?: unknown; starts?: unknown; ends?: unknown }
type AzureToken = { text?: unknown; offset?: unknown; duration?: unknown }

const finiteArray = (a: unknown): a is number[] =>
  Array.isArray(a) && a.every((n) => typeof n === 'number' && Number.isFinite(n))

/** Validate a fully-shaped timing set; null unless it can drive a clock. */
function validate(words: string[], starts: number[], ends: number[]): WordTimings | null {
  if (words.length === 0 || words.length !== starts.length || words.length !== ends.length) return null
  for (let i = 0; i < words.length; i++) {
    if (ends[i] < starts[i]) return null
    if (i > 0 && starts[i] < starts[i - 1]) return null
  }
  // A clock that never moves (every stamp zero) cannot track anything.
  if (ends[ends.length - 1] <= 0) return null
  return { words, starts, ends }
}

function fromContract(raw: ContractShape): WordTimings | null {
  const { words, starts, ends } = raw
  if (!Array.isArray(words) || !finiteArray(starts) || !finiteArray(ends)) return null
  if (!words.every((w) => typeof w === 'string')) return null
  return validate(words as string[], starts, ends)
}

function fromAzure(raw: AzureToken[]): WordTimings | null {
  const words: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  for (const t of raw) {
    if (!t || typeof t !== 'object') return null
    const text = typeof t.text === 'string' ? t.text : ''
    const offset = t.offset
    const duration = t.duration
    if (typeof offset !== 'number' || typeof duration !== 'number' || !Number.isFinite(offset) || !Number.isFinite(duration)) return null
    const s = offset / 1000
    const e = (offset + Math.max(0, duration)) / 1000
    // Punctuation is not a word: it hangs off the word before it, so the
    // word's end absorbs its stamp and no gap is measured across it.
    if (!text || PUNCT_ONLY.test(text)) {
      if (words.length > 0) ends[ends.length - 1] = Math.max(ends[ends.length - 1], e)
      continue
    }
    // Azure occasionally stamps one token with a run of text (a word plus
    // the ellipsis-joined remainder of the sentence on some hrv pod clips);
    // the stamp is the FIRST word's, so that is the word kept.
    words.push(text.trim().split(/\s+/)[0])
    starts.push(s)
    ends.push(e)
  }
  return validate(words, starts, ends)
}

/** Any raw timing payload → canonical seconds-based timings, or null. */
export function normaliseWordTimings(raw: unknown): WordTimings | null {
  if (!raw || typeof raw !== 'object') return null
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null
    return fromAzure(raw as AzureToken[])
  }
  return fromContract(raw as ContractShape)
}

const msOf = (sec: number) => Math.round(sec * 1000)

/** Split timings into breath groups at every pause ≥ threshold. Group text is
 *  the timing words joined; see alignBreathGroups for the sentence-text slice. */
export function buildBreathGroups(t: WordTimings, thresholdSec: number = BREATH_PAUSE_SEC): BreathGroup[] {
  const groups: BreathGroup[] = []
  let from = 0
  for (let i = 1; i <= t.words.length; i++) {
    // Compared in whole milliseconds: 0.35 - 0.1 is 0.24999… in binary, so
    // a gap of exactly the threshold would otherwise fail to split (job #425).
    const boundary = i === t.words.length || msOf(t.starts[i]) - msOf(t.ends[i - 1]) >= msOf(thresholdSec)
    if (!boundary) continue
    groups.push({ text: t.words.slice(from, i).join(' '), start: t.starts[from], end: t.ends[i - 1], wordFrom: from, wordTo: i })
    from = i
  }
  return groups
}

const norm = (s: string) => s.normalize('NFC').toLowerCase()

/**
 * Give each group the SENTENCE's own text rather than the TTS token text.
 * The two can differ (the pod row's text vs the clip's render text — a "…"
 * pause marker, a gender agreement fixed after the render), so the words are
 * located one by one in the sentence, in order, and the group takes the slice
 * from its first located word up to the next group's first located word.
 * Punctuation between groups stays with the group it closes. Falls back to
 * the joined timing words for any group whose words cannot be located, and
 * to the whole joined form when fewer than 60% of the words align.
 */
export function alignBreathGroups(groups: BreathGroup[], t: WordTimings, sentenceText: string): BreathGroup[] {
  const text = String(sentenceText || '')
  if (!text.trim() || groups.length === 0) return groups
  const hay = norm(text)
  // Locate every word (punctuation-stripped) at or after the running cursor.
  const positions: Array<{ start: number; end: number } | null> = []
  let cursor = 0
  let located = 0
  for (const w of t.words) {
    const needle = norm(w.replace(STRIP_PUNCT, ''))
    if (!needle) { positions.push(null); continue }
    const at = hay.indexOf(needle, cursor)
    if (at < 0) { positions.push(null); continue }
    positions.push({ start: at, end: at + needle.length })
    cursor = at + needle.length
    located++
  }
  if (located < Math.ceil(t.words.length * 0.6)) return groups

  // First located word of each group, in timing-word index space.
  const groupFirst: number[] = groups.map((g) => {
    for (let k = g.wordFrom; k < g.wordTo; k++) if (positions[k]) return positions[k]!.start
    return -1
  })
  // Opening punctuation glued to a group's first word (¡ ¿ « " ( …) belongs
  // to THAT group, not to the tail of the one before it.
  const adjusted = groupFirst.map((from) => {
    if (from < 0) return from
    let f = from
    while (f > 0 && OPENING_PUNCT.test(text[f - 1])) f--
    return f
  })
  return groups.map((g, gi) => {
    const from = adjusted[gi]
    if (from < 0) return g
    let to = text.length
    for (let n = gi + 1; n < groups.length; n++) if (adjusted[n] >= 0) { to = adjusted[n]; break }
    const slice = text.slice(from, to).trim()
    return slice ? { ...g, text: slice } : g
  })
}

/** The whole derivation for one clip. Null unless the sentence has TWO OR
 *  MORE breath groups — a single group falls through to the existing card,
 *  unchanged (one component, one condition, no new mode). */
export function breathGroupsForClip(raw: unknown, sentenceText: string, thresholdSec: number = BREATH_PAUSE_SEC): BreathGroup[] | null {
  const t = normaliseWordTimings(raw)
  if (!t) return null
  const groups = buildBreathGroups(t, thresholdSec)
  if (groups.length < 2) return null
  return alignBreathGroups(groups, t, sentenceText)
}

/** Where the clock is inside the stack: the lit group's index and how far
 *  its fill has walked (0..1). Before the first group the first is lit at 0;
 *  a pause between groups holds the previous group full; past the last group
 *  the last is held full. */
export function trackPosition(groups: BreathGroup[], clockSec: number): { index: number; fill: number } {
  if (groups.length === 0) return { index: -1, fill: 0 }
  if (!(clockSec > groups[0].start)) return { index: 0, fill: 0 }
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]
    const nextStart = i + 1 < groups.length ? groups[i + 1].start : Infinity
    if (clockSec < nextStart) {
      const span = Math.max(g.end - g.start, 0.001)
      return { index: i, fill: Math.min(1, Math.max(0, (clockSec - g.start) / span)) }
    }
  }
  return { index: groups.length - 1, fill: 1 }
}

// ── Untimed clips: the same stack, lines cut from the TEXT (job #430) ─────
//
// Tom (2026-09-12): "it will help to not just have a massive block of text
// in the longer form pods … we could still split them up into single
// breaths though." The stacked layout is the win and is independent of the
// tracker, so a clip with NO word timings (Pod-1 / xAI renders, human
// recordings, viseme-only rows) renders in the same stack with its lines cut
// from the sentence itself — layout only: no lit line, no fill, no clock.
//
// Cut order: sentence enders → clause punctuation, packed up to the cap so a
// list of short clauses is one breath rather than stubs → a length cap, words
// kept whole and the overflow balanced rather than a long line plus an orphan.
// The cap comes from the audio, not a guess: across 1,455 timed pod sentence
// clips with two or more breath groups (3,942 groups, measured live
// 2026-09-12) a real breath group is 23 chars at the median, 52 at p90 and
// 66 at p95, so 60 makes a text-cut line the size of a long real breath.
// Scripts without spaces (CJK, Thai) only cut at their own punctuation.

export const TEXT_LINE_MAX_CHARS = 60

const SENTENCE_PIECES = /[^.!?…。！？]+[.!?…。！？]+["”』」)]*|[^.!?…。！？]+$/gu
const CLAUSE_PIECES = /[^,;:—–،、，；：]+[,;:—–،、，；：]+["”』」)]*|[^,;:—–،、，；：]+$/gu

const pieces = (text: string, re: RegExp): string[] =>
  (text.match(re) || []).map((s) => s.trim()).filter(Boolean)

/** Word-wrap one over-long piece into k = ceil(len / cap) lines of roughly
 *  equal length. Returns the piece unchanged when it has no spaces to cut at. */
function balancedWrap(piece: string, cap: number): string[] {
  if (piece.length <= cap) return [piece]
  const words = piece.split(/\s+/).filter(Boolean)
  if (words.length < 2) return [piece]
  const k = Math.ceil(piece.length / cap)
  const pack = (target: number): string[] => {
    const lines: string[] = []
    let cur = ''
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w
      if (cur && next.length > target) { lines.push(cur); cur = w } else cur = next
    }
    if (cur) lines.push(cur)
    return lines
  }
  // Aim at equal lines; greedy packing at that width can spill one extra
  // line, so widen the target until the piece fits its k lines (never past
  // the cap, which is where the line count was set).
  for (let target = Math.ceil(piece.length / k); target <= cap; target++) {
    const lines = pack(target)
    if (lines.length <= k) return lines
  }
  return pack(cap)
}

/** Clauses of one over-long sentence, packed in order up to the cap so a
 *  list ("en Nueva York, en Tokio, en Buenos Aires") reads as one breath
 *  rather than three stubs. A cut only counts when the clause after it fits
 *  the cap: one that overflows on its own joins what precedes it and the
 *  run is word-wrapped, so "Bueno," never stands alone above a wrapped
 *  remainder. */
function clauseLines(sentence: string, cap: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const clause of pieces(sentence, CLAUSE_PIECES)) {
    const next = cur ? `${cur} ${clause}` : clause
    if (cur && next.length > cap && clause.length <= cap) { lines.push(...balancedWrap(cur, cap)); cur = clause } else cur = next
  }
  if (cur) lines.push(...balancedWrap(cur, cap))
  return lines
}

/** The stack's lines for an untimed sentence, or null when the text yields a
 *  single line — the existing card, unchanged, exactly as one breath group
 *  does for a timed clip. Sentences are never packed together: the sentence
 *  is the unit; only clauses inside one are. */
export function textLinesForSentence(sentenceText: string, cap: number = TEXT_LINE_MAX_CHARS): string[] | null {
  const text = String(sentenceText || '').trim()
  if (!text) return null
  const lines: string[] = []
  for (const sentence of pieces(text, SENTENCE_PIECES)) {
    if (sentence.length <= cap) lines.push(sentence)
    else lines.push(...clauseLines(sentence, cap))
  }
  if (lines.length < 2) return null
  return lines
}
