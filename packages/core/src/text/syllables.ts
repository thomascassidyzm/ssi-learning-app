/**
 * syllables.ts — per-target-language syllable counting registry.
 *
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ KNOWN, NAMED DUPLICATION — this file has a TWIN in the other repo:    │
 * │   ssi-dashboard-v7-clean/tools/lib/syllable-counters.cjs              │
 * │ The algorithm here is a VERBATIM port of that file: same registry,    │
 * │ same per-language options, same throw-on-unregistered contract, and   │
 * │ its fixtures are ported alongside (syllables.test.ts) so equivalence  │
 * │ is provable rather than assumed.                                      │
 * │                                                                       │
 * │ This is DEBT, not a resolved design. Two repos, two copies, no build- │
 * │ time link between them: a rule changed on one side and not the other  │
 * │ silently diverges the player's phrase-skip from Popty's content       │
 * │ tooling. It is deliberate for now because @ssi/core cannot be         │
 * │ imported from the dashboard's CommonJS tool scripts and the dashboard │
 * │ is not a publishable dependency of the player. THE FIX, when someone  │
 * │ pays for it, is to make ONE of them the package the other consumes.   │
 * │ Until then: any change to either file MUST be mirrored to the other,  │
 * │ fixtures included.                                                    │
 * └───────────────────────────────────────────────────────────────────────┘
 *
 * hrv is the ORIGINAL Croatian counter (kept byte-identical to the version
 * insert-ellipsis-seams.cjs shipped with before this registry existed — same
 * vowel + syllabic-r rule, same output for the same input). Every other
 * counter is a vowel-group heuristic: count maximal runs of vowel letters per
 * word as syllable nuclei, with a couple of per-language adjustments (French
 * silent final -e, Dutch "ij" digraph, Spanish/Italian/Portuguese accented
 * hiatus vowels, Welsh w/y as vowels). These are approximations, not a
 * phonetic parser.
 *
 * registerCounter() lets a caller add more languages without editing this
 * file's core; countSyllables() FAILS LOUDLY (throws) for an unregistered
 * language code — no silent fallback to the wrong language's rules. Callers
 * that must not throw ask hasSyllableCounter() first; that is exactly how the
 * Easy-mode syllable cap stays INERT (and says so) on the 54 courses whose
 * target language has no counter, instead of silently counting them wrong.
 */

export type SyllableCounter = (text: string) => number

// --- Croatian (unchanged from the original insert-ellipsis-seams.cjs) ---
export function countSyllablesHrv(text: string): number {
  const words = (text || '').toLowerCase()
    .replace(/[.,!?;:„"“”'’()\-–—…]/g, ' ')
    .split(/\s+/).filter(Boolean)
  let total = 0
  for (const w of words) {
    const vowels = (w.match(/[aeiou]/g) || []).length
    let syllabicR = 0
    for (let i = 0; i < w.length; i++) {
      if (w[i] !== 'r') continue
      const prev = w[i - 1], next = w[i + 1]
      const prevVowel = prev && 'aeiou'.includes(prev)
      const nextVowel = next && 'aeiou'.includes(next)
      if (!prevVowel && !nextVowel) syllabicR++
    }
    let count = vowels + syllabicR
    if (count === 0) count = 1
    total += count
  }
  return total
}

// --- English (vowel groups + orthographic silent-ending rules) ---
// English spelling is the least phonetic of the set, so this counter carries
// more ending rules than the generic vowel-group heuristic: silent final -e
// ("make") except consonant+le ("table"); silent -es after a non-sibilant
// ("likes" vs "houses"), kept for the consonant+le plural ("tables" vs
// "miles"); silent -ed except after t/d ("walked" vs "wanted"); y as a vowel
// except word-initially ("very" vs "yes"); and n't adding a nucleus only
// after a consonant ("didn't" vs "can't").
export function countSyllablesEng(text: string): number {
  const words = (text || '').toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z'\s]/g, ' ')
    .split(/\s+/).filter(Boolean)
  let total = 0
  for (let w of words) {
    let extra = 0
    if (w.endsWith("n't")) {
      const base = w.slice(0, -3)
      if (base && !'aeiou'.includes(base[base.length - 1])) extra = 1
      w = base + 'nt'
    }
    w = w.replace(/'(s|ll|d|re|ve|m|em)$/, '').replace(/'/g, '')
    let count = 0, inRun = false
    for (let i = 0; i < w.length; i++) {
      const isVowel = 'aeiou'.includes(w[i]) || (w[i] === 'y' && i > 0)
      if (isVowel) { if (!inRun) count++; inRun = true } else inRun = false
    }
    if (count > 1) {
      if (/[^aeiouy]e$/.test(w) && !/[^aeiouy]le$/.test(w)) count--
      else if (/es$/.test(w) && !/[sxzcgh]es$/.test(w) && !/[^aeiouy]les$/.test(w)) count--
      else if (/ed$/.test(w) && !/[td]ed$/.test(w)) count--
    }
    total += Math.max(count, 1) + extra
  }
  return total
}

// --- Generic vowel-group counter, shared by the Latin/Germanic counters ---
// Splits each word into maximal runs of "vowel" characters (per the supplied
// set). Any multi-char `digraphs` (e.g. Dutch "ij") are first collapsed to a
// single placeholder vowel slot, so a digraph made of one vowel letter + one
// consonant letter (like "j") still contributes exactly ONE nucleus instead
// of vanishing or breaking the run around it. `hiatusVowels` (e.g. Spanish
// accented í/ú) each force their OWN nucleus even mid-run — an accent on a
// normally-weak vowel is the orthographic marker of hiatus, not a diphthong
// ("días" = dí-as, 2 syllables, not the "ia" diphthong "dias" would give).
// One run = one syllable nucleus; a word with none still counts as 1.
const DIGRAPH_SLOT = '' // private-use placeholder, never occurs in real text

function vowelGroupWordCount(
  word: string,
  vowelSet: Set<string>,
  digraphs: readonly string[],
  hiatusSet: Set<string>,
): number {
  if (!word) return 0
  let marked = word
  for (const d of [...digraphs].sort((a, b) => b.length - a.length)) {
    marked = marked.split(d).join(DIGRAPH_SLOT)
  }
  let count = 0, inRun = false, prevHiatus = false
  for (const ch of marked) {
    const isVowel = ch === DIGRAPH_SLOT || vowelSet.has(ch)
    const isHiatus = hiatusSet.has(ch)
    if (isVowel) {
      if (!inRun || isHiatus || prevHiatus) count++
      inRun = true
      prevHiatus = isHiatus
    } else {
      inRun = false
      prevHiatus = false
    }
  }
  return count || 1
}

function wordsOf(text: string): string[] {
  return (text || '').toLowerCase()
    .replace(/[.,!?;:„"“”'’()\-–—…¿¡]/g, ' ')
    .split(/\s+/).filter(Boolean)
}

export interface VowelGroupOptions {
  digraphs?: readonly string[]
  hiatusVowels?: string
  frenchSilentE?: boolean
}

export function makeVowelGroupCounter(
  vowels: string,
  { digraphs = [], hiatusVowels = '', frenchSilentE = false }: VowelGroupOptions = {},
): SyllableCounter {
  const vowelSet = new Set(vowels)
  const hiatusSet = new Set(hiatusVowels)
  return (text: string): number => {
    let total = 0
    for (const w of wordsOf(text)) {
      let n = vowelGroupWordCount(w, vowelSet, digraphs, hiatusSet)
      // French: a word-final unaccented "e" is normally silent in speech —
      // don't count it as its own nucleus if the word has another one.
      if (frenchSilentE && n > 1 && /(?:^|[^aeiouyâàéèêëîïôùûüœæ])e$/.test(w)) n--
      total += n
    }
    return total
  }
}

/** The registered languages. Mirrors the twin file's REGISTRY exactly. */
export const SYLLABLE_REGISTRY: Record<string, SyllableCounter> = {
  hrv: countSyllablesHrv,
  eng: countSyllablesEng,
  spa: makeVowelGroupCounter('aeiouáéíóúü', { hiatusVowels: 'íú' }),
  ita: makeVowelGroupCounter('aeiouàèéìíîòóù', { hiatusVowels: 'ìù' }),
  por: makeVowelGroupCounter('aeiouáàâãéêíóôõúü', { hiatusVowels: 'íú' }),
  deu: makeVowelGroupCounter('aeiouyäöü'),
  fra: makeVowelGroupCounter('aeiouyâàéèêëîïôùûüœæ', { frenchSilentE: true }),
  nld: makeVowelGroupCounter('aeiouy', { digraphs: ['ij'] }),
  cym: makeVowelGroupCounter('aeiouwy'),
}

export function registerCounter(langCode: string, fn: SyllableCounter): void {
  SYLLABLE_REGISTRY[langCode] = fn
}

/**
 * Is there a counter for this language? The non-throwing companion to
 * countSyllables — callers that must degrade rather than fail (the Easy-mode
 * phrase cap) ask this first.
 */
export function hasSyllableCounter(langCode: string): boolean {
  return Boolean(SYLLABLE_REGISTRY[langCode])
}

/**
 * Count the syllables of `text` in `langCode`.
 * THROWS for an unregistered language — deliberately. There is no silent
 * fallback to another language's rules, because a wrong-language count is
 * worse than no count: it produces a plausible number nobody checks.
 */
export function countSyllables(text: string, langCode: string): number {
  const fn = SYLLABLE_REGISTRY[langCode]
  if (!fn) {
    throw new Error(`no syllable counter registered for language '${langCode}' — add one to packages/core/src/text/syllables.ts (SYLLABLE_REGISTRY), and mirror it into its twin ssi-dashboard-v7-clean/tools/lib/syllable-counters.cjs, before running this course`)
  }
  return fn(text)
}

/**
 * A course's `target_lang` (values like 'spa', 'por_br', 'fra_ca') reduced to
 * the registry key: the part before the first '-' or '_', lowercased. A
 * regional variant shares its parent language's syllable rules.
 */
export function syllableLangOf(targetLang: string | null | undefined): string {
  return String(targetLang || '').split(/[-_]/)[0].toLowerCase()
}
