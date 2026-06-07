<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface LegoBlock {
  id: string
  targetText: string
  /** Romanised form of this tile (e.g. pinyin), shown as a ruby annotation
   *  above the native-script text when romanisation display is enabled. The
   *  tile boundaries are identical across scripts — only this line toggles. */
  romanText?: string
  knownText?: string
  /** Intro/debut gloss grouping: consecutive blocks sharing a glossGroup id
   *  form one run whose known gloss (on the run's first block) renders
   *  centred under the WHOLE run. Tiles themselves are identical to the
   *  regular-phrase rendering — only the gloss row is added. */
  glossGroup?: number
  isSalient?: boolean
  /** This A-LEGO was extracted from an M-LEGO and now appears solo */
  isSoloComponent?: boolean
  /** M-LEGO component breakdown */
  components?: { known: string; target: string; absorbed?: boolean; isInserter?: boolean }[]
}

type AssemblyPhase = 'hidden' | 'scattered' | 'assembling' | 'assembled' | 'dissolving'

export interface ComponentBreakdown {
  known: string
  target: string
  /** Token sits inside an M-LEGO span but is not one of the LEGO's declared
   *  atoms — a previously-introduced LEGO inserted into the M-LEGO. Rendered
   *  with reduced opacity so the salient LEGO atoms still pop. */
  isInserter?: boolean
}

const props = defineProps<{
  blocks: LegoBlock[]
  phase: string // UI phase: 'prompt' | 'speak' | 'voice1' | 'voice2'
  components?: ComponentBreakdown[]
  targetLang?: string // ISO 639-3 language code (e.g., 'jpn', 'zho', 'spa')
  /** Cycle type — drives the known-text visibility rule (intro/debut only).
   *  Tile typography is uniform across cycle types (Tom 2026-06-07). */
  cycleType?: string
  /** Show the romanised ruby line (block.romanText) above each tile. Driven by
   *  the learner's script toggle — native-script glyphs are always primary; this
   *  only adds/removes the pronunciation annotation. */
  showRomanization?: boolean
}>()

// Known-text (the English subtitle under each tile) only renders during
// intro and debut cycles — the first time a learner meets the LEGO. Once
// the salient appears alongside other LEGOs (BLD / USE phrases), the
// target tiles must stand alone. Tom 2026-05-21.
const isIntroOrDebut = computed(() => {
  const t = (props.cycleType || '').toLowerCase()
  return t === 'intro' || t === 'debut'
})

// Detect M-LEGO: multiple components on the salient block or in props
// Falls back to word-aligned synthesis when known/target have matching word counts
// GOLDEN RULE: result must cover ALL words in targetText — gaps get absorbed
const mLegoComponents = computed(() => {
  let rawComps: ComponentBreakdown[] | null = null
  if (props.components && props.components.length > 1) rawComps = props.components
  // Check if any block has components
  if (!rawComps) {
    for (const b of props.blocks) {
      if (b.components && b.components.length > 1) { rawComps = b.components; break }
    }
  }
  // Single-tile intro/debut: synthesize word-aligned components
  if (!rawComps && props.blocks.length === 1) {
    const block = props.blocks[0]
    const known = block.knownText
      || (props.components?.length === 1 ? props.components[0].known : '')
    const target = block.targetText
    if (known && target) {
      const targetTokens = originalTokens(target)
      const knownTokens = originalTokens(known)
      if (targetTokens.length > 1 && knownTokens.length === targetTokens.length) {
        rawComps = targetTokens.map((t, i) => ({ known: knownTokens[i], target: t }))
      }
    }
  }
  if (!rawComps) return null

  // Align components to the block's full targetText, absorbing gap words.
  // If alignment fails, fall back to NO components (single span with full text)
  // rather than showing partial text that violates the golden rule.
  const fullText = props.blocks[0]?.targetText || ''
  if (!fullText) return rawComps
  const aligned = alignComponentsToFullText(rawComps, fullText)
  // Verify aligned text covers full text (golden rule check). For CJK
  // content, strip ALL whitespace from both sides — Chinese/Japanese
  // doesn't use spaces, but the dashboard sometimes stores fullText with
  // analyst-inserted spaces ("也 想") while the components join into
  // un-spaced form ("也想"). Same logical content; the warning was just
  // whitespace noise.
  const isCJK = CJK_RE.test(fullText)
  const alignedText = aligned.map(c => c.target).join(isCJK ? '' : ' ')
  const normFull = normaliseForCompare(fullText, isCJK)
  const normAligned = normaliseForCompare(alignedText, isCJK)
  if (normAligned !== normFull) {
    // Alignment produced incomplete text — drop component stubs entirely
    console.warn(`[LegoAssembly] Component alignment mismatch: "${alignedText}" vs "${fullText}" — showing full text`)
    return null  // null = no components, single span shows blocks[0].targetText
  }
  return aligned
})

function normaliseForCompare(text: string, isCJK: boolean): string {
  let s = text.toLowerCase().trim().replace(SMART_APOS_RE, "'").replace(PUNCT_RE, '')
  if (isCJK) s = s.replace(/\s+/g, '')
  return s
}

// CJK detection — matches ensureTileCoverage.ts
const CJK_RE = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/
// Sentence punctuation only — in-word apostrophes/hyphens preserved so
// "j'apprends", "d'un", "well-meaning" retain lexical identity. Smart-
// quote variants normalised to ASCII via SMART_APOS_RE upstream.
// ASCII apostrophe deliberately NOT in this class.
const PUNCT_RE = /[.,!?;:¡¿"“”„«»\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g
const SMART_APOS_RE = /[‘’ʼ]/g  // typographic single quotes → straight

/** Tokenize text: per-character for CJK, per-word for alphabetic. Strips punctuation. */
function tokenize(text: string): string[] {
  if (!text) return []
  const cleaned = text.toLowerCase().trim().replace(SMART_APOS_RE, "'").replace(PUNCT_RE, '')
  if (CJK_RE.test(text)) {
    return cleaned.split('').filter(ch => ch.trim() !== '')
  }
  return cleaned.split(/\s+/).filter(Boolean)
}

/** Get original-cased tokens (parallel to tokenize, for display).
 *  Preserves apostrophes and other in-word punctuation — "j'apprends",
 *  "l'italiano", "don't" all stay intact. Standalone punctuation tokens
 *  (e.g. a bare "." between words) are dropped so the token count
 *  matches tokenize() and the index-based alignment in ensureTileCoverage
 *  stays consistent. */
function originalTokens(text: string): string[] {
  if (!text) return []
  if (CJK_RE.test(text)) {
    return text.trim().split('').filter(ch => ch.trim() !== '' && ch.replace(PUNCT_RE, '').length > 0)
  }
  return text.trim().split(/\s+/).filter(t => t && t.replace(PUNCT_RE, '').length > 0)
}

/** Join tokens back — no separator for CJK, space for alphabetic. */
function joinTokens(tokens: string[], text: string): string {
  return CJK_RE.test(text) ? tokens.join('') : tokens.join(' ')
}

/**
 * Align declared components to the full LEGO targetText.
 *
 * Gap-handling rules:
 *  - Tokens **before** the first declared atom → absorbed as prefix into
 *    the first comp (preserves leading articles, punctuation, etc.).
 *  - Tokens **between** declared atoms → emitted as their own inserter
 *    components (isInserter: true). These are previously-introduced
 *    LEGOs slotted inside the M-LEGO's span — e.g. "dich morgen" inside
 *    "rufe…an". Renderer dims them so the salient atoms still pop.
 *  - Tokens **after** the last declared atom → absorbed as suffix onto
 *    the last comp.
 *
 * This ensures the tile displays ALL words the audio says, and surfaces
 * inside-span gaps as visually-distinct inserters per the SSi methodology
 * invariant (every inside-span token is a previously-introduced LEGO).
 * CJK-aware: uses per-character tokenization for Chinese/Japanese/Korean.
 */
function alignComponentsToFullText(
  comps: ComponentBreakdown[],
  fullText: string
): ComponentBreakdown[] {
  const fullTokens = tokenize(fullText)
  const fullOriginal = originalTokens(fullText)
  if (fullTokens.length === 0) return comps

  // Build alignment: for each component, find its earliest unclaimed match
  // in fullTokens. Order-independent — atoms may appear in any order in the
  // phrase (German V2 fronting, separable-verb fronting, etc.); we still
  // recognise them as the same M-LEGO's components and emit them in the
  // order they actually appear in the phrase.
  type Span = { compIdx: number; start: number; end: number }
  const spans: Span[] = []
  const claimed = new Set<number>()

  for (let ci = 0; ci < comps.length; ci++) {
    const compTokens = tokenize(comps[ci].target)
    if (compTokens.length === 0) continue
    let matchStart = -1
    outer: for (let i = 0; i <= fullTokens.length - compTokens.length; i++) {
      for (let j = 0; j < compTokens.length; j++) {
        if (claimed.has(i + j)) continue outer
        if (fullTokens[i + j] !== compTokens[j]) continue outer
      }
      matchStart = i
      break
    }
    if (matchStart === -1) {
      // Component not found — alignment failed, return raw components
      return comps
    }
    for (let k = 0; k < compTokens.length; k++) claimed.add(matchStart + k)
    spans.push({ compIdx: ci, start: matchStart, end: matchStart + compTokens.length })
  }

  if (spans.length === 0) return comps

  // Sort by phrase position so emitted components follow phrase order, not
  // canonical M-LEGO order.
  spans.sort((a, b) => a.start - b.start)

  // Check if components already cover all tokens
  const totalCovered = spans.reduce((s, sp) => s + (sp.end - sp.start), 0)
  if (totalCovered === fullTokens.length) {
    // Re-emit in phrase order so the tile reads left-to-right correctly
    // even when the declared canonical order differs from phrase order.
    return spans.map(sp => ({
      known: comps[sp.compIdx].known,
      target: joinTokens(fullOriginal.slice(sp.start, sp.end), fullText),
    }))
  }

  const isCJK = CJK_RE.test(fullText)
  const result: ComponentBreakdown[] = []
  const firstSpan = spans[0]
  const lastSpan = spans[spans.length - 1]

  // First comp: prefix tokens (before first atom) absorbed in. Preserves
  // leading articles / punctuation that aren't true inserters between atoms.
  const prefixTokens = fullOriginal.slice(0, firstSpan.start)
  const firstSpanTokens = fullOriginal.slice(firstSpan.start, firstSpan.end)
  result.push({
    known: comps[firstSpan.compIdx].known,
    target: joinTokens([...prefixTokens, ...firstSpanTokens], fullText),
  })

  // Walk the remaining spans. Gap tokens between this span and the previous
  // are TRUE inserters — emit as their own components with isInserter=true.
  for (let si = 1; si < spans.length; si++) {
    const prevEnd = spans[si - 1].end
    const span = spans[si]
    const gapTokens = fullOriginal.slice(prevEnd, span.start)
    for (const tok of gapTokens) {
      result.push({ known: '', target: tok, isInserter: true })
    }
    const spanTokens = fullOriginal.slice(span.start, span.end)
    result.push({
      known: comps[span.compIdx].known,
      target: joinTokens(spanTokens, fullText),
    })
  }

  // Trailing tokens after last span → suffix onto last comp
  if (lastSpan.end < fullTokens.length) {
    const trailing = fullOriginal.slice(lastSpan.end)
    const last = result[result.length - 1]
    result[result.length - 1] = {
      ...last,
      target: last.target + (isCJK ? '' : ' ') + joinTokens(trailing, fullText),
    }
  }

  return result
}

// VOICE_1 is ears-only — no target text. Tiles reveal at VOICE_2 with a
// short, sharp animation so the phrase stays on screen long enough to
// read on a ~2s voice. Constants decoupled from audio duration so a
// laggy VOICE_1 audio start can never push text ahead of sound.
// Tom 2026-05-25.
const ASSEMBLE_DURATION_MS = 250
const STAGGER_PER_BLOCK_MS = 150

const assemblyPhase = ref<AssemblyPhase>('hidden')
const instantHide = ref(false)
let revealTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.phase, (phase) => {
  if (revealTimer) { clearTimeout(revealTimer); revealTimer = null }

  if (props.blocks.length === 0) {
    instantHide.value = true
    assemblyPhase.value = 'hidden'
    return
  }

  switch (phase) {
    case 'prompt':
    case 'speak':
    case 'voice1':
    case 'voice_1':
      assemblyPhase.value = 'hidden'
      break
    case 'voice2':
    case 'voice_2': {
      instantHide.value = false
      assemblyPhase.value = 'assembling'
      const totalMs = ASSEMBLE_DURATION_MS + STAGGER_PER_BLOCK_MS * Math.max(0, props.blocks.length - 1)
      revealTimer = setTimeout(() => {
        assemblyPhase.value = 'assembled'
      }, totalMs)
      break
    }
    default:
      instantHide.value = true
      assemblyPhase.value = 'hidden'
  }
}, { immediate: true })

const assembleDuration = `${ASSEMBLE_DURATION_MS / 1000}s`

const staggerDelay = (index: number): string => `${(STAGGER_PER_BLOCK_MS * index) / 1000}s`

// For intro/single-lego: compute known text from components or props
const knownText = computed(() => {
  if (props.components && props.components.length === 1) {
    return props.components[0].known
  }
  if (props.blocks.length === 1 && props.blocks[0].knownText) {
    return props.blocks[0].knownText
  }
  return ''
})


// Carriage mode: long M-LEGOs split into wagon groups so the tile
// doesn't wrap text internally. Two triggers:
//  - atomCount > 3 (existing): balanced groups of up to 3 atoms each
//  - targetText > CARRIAGE_CHAR_THRESHOLD (Tom 2026-05-21): few atoms
//    but long total text. Each component (atom or inserter) becomes
//    its own group so the tile splits cleanly at component boundaries.
//
// Without the char trigger, an intro/debut of a long-but-few-atom
// M-LEGO falls into the single-tile branch and wraps its text
// internally — looks like a runaway tile bleeding off-screen.
const carriageGroups = computed(() => {
  const CARRIAGE_CHAR_THRESHOLD = 24
  if (props.blocks.length !== 1) return null
  if (!mLegoComponents.value) return null
  const comps = mLegoComponents.value
  // Atom-count threshold (inserters don't push us into carriage mode).
  const atomCount = comps.filter(c => !c.isInserter).length
  const fullText = props.blocks[0]?.targetText || ''
  if (atomCount <= 3 && fullText.length <= CARRIAGE_CHAR_THRESHOLD) return null
  if (atomCount > 3) {
    // Balanced groups of up to 3 atoms each.
    const groups: ComponentBreakdown[][] = []
    for (let i = 0; i < comps.length; i += 3) {
      groups.push(comps.slice(i, i + 3))
    }
    return groups
  }
  // Few atoms but text overflows — every component is its own group.
  return comps.map(c => [c])
})

// RTL detection — Arabic, Hebrew, and related scripts
const RTL_RE = /[\u0600-\u06FF\u0590-\u05FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/
const isRTL = computed(() => {
  const text = props.blocks[0]?.targetText || ''
  return RTL_RE.test(text)
})

// CJK presence per-text \u2014 Roman-tuned tile sizing reads cramped for
// character-based scripts. Drives an `is-cjk` class on .lego-block /
// .tile-target that bumps font-size and adds letter-spacing, without
// inserting actual whitespace between glyphs.
function hasCjk(text: string | undefined | null): boolean {
  return !!text && CJK_RE.test(text)
}

// Soft-hyphenate long text so tiles can wrap instead of shrinking.
// Inserts \u00AD at word boundaries, and mid-word if a single word > maxChars.
const SHY = '\u00AD'

// Max characters per visual line before soft-hyphenation, by target language.
// CJK characters are larger and denser — fewer per line keeps them readable.
// Compound-noun and agglutinative languages get a lower limit too: their
// single-word lengths regularly blow past 14-16 chars (Krankenversicherung,
// gezondheidszorg, kindergeborenes…) and the same DEFAULT_HYPHEN_LIMIT that
// works for Spanish / French / Italian leaves them stranded — words >limit
// are the only ones softHyphenate splits.
const HYPHEN_LIMITS: Record<string, number> = {
  jpn: 10,  // Japanese
  zho: 10,  // Chinese (Mandarin)
  cmn: 10,  // Chinese (Mandarin, alternate code)
  yue: 10,  // Cantonese
  kor: 10,  // Korean
  tha: 12,  // Thai (no spaces, medium-density script)
  ara: 16,  // Arabic (connected script, slightly shorter)
  heb: 16,  // Hebrew
  deu: 14,  // German (long compound nouns)
  nld: 14,  // Dutch (same family of compounds)
  swe: 14,  // Swedish
  nor: 14,  // Norwegian
  dan: 14,  // Danish
  fin: 14,  // Finnish (agglutinative)
  hun: 14,  // Hungarian (agglutinative)
  isl: 14,  // Icelandic (compound nouns)
}
const DEFAULT_HYPHEN_LIMIT = 20 // Roman alphabet languages

const maxLineChars = computed(() => {
  const lang = props.targetLang?.toLowerCase() || ''
  return HYPHEN_LIMITS[lang] || DEFAULT_HYPHEN_LIMIT
})

function softHyphenate(text: string): string {
  const limit = maxLineChars.value
  // Only split SINGLE LONG WORDS mid-word \u2014 German compound nouns,
  // agglutinative Finnish/Hungarian forms, etc. Anything below the
  // per-language limit is returned verbatim. Multi-word phrases wrap
  // at spaces naturally; the tile outline stays continuous because
  // each LEGO is one tile regardless of word count.
  return text.split(' ').map(word => {
    if (word.length <= limit) return word
    const parts: string[] = []
    for (let i = 0; i < word.length; i += limit) {
      parts.push(word.slice(i, i + limit))
    }
    return parts.join(SHY)
  }).join(' ')
}


/**
 * Wagonise a long block into adjacent tiles instead of letting it wrap
 * its text internally. Three paths:
 *
 *  1. M-LEGO with >3 declared atoms — split at component boundaries
 *     in groups of up to 3. Internal stubs render between atoms within
 *     each wagon (real M-LEGO composition).
 *  2. M-LEGO with ≤3 atoms but text > WAGON_CHAR_THRESHOLD — one
 *     component per wagon. No internal stubs (wagon.length = 1), but
 *     the wagon edge-stubs still mark "this LEGO continues".
 *  3. Block with no declared components but text > WAGON_CHAR_THRESHOLD
 *     — synthesise word-wagons (~3 words each), packing each wagon's
 *     words as ONE component so the template doesn't render misleading
 *     M-LEGO atom-divider stubs INSIDE the wagon.
 *
 * Single-word blocks always return null — nothing to split on.
 */
function practiceCarriageWagons(block: LegoBlock): ComponentBreakdown[][] | null {
  // Char threshold above which the tile would visibly wrap on mobile
  // widths — chosen empirically against the 1.45-1.7rem mono font at
  // ~390px viewport.
  const WAGON_CHAR_THRESHOLD = 24

  const aligned = alignedBlockComponents(block)

  if (aligned) {
    // Threshold counts declared atoms only — inserters live inside the
    // span and shouldn't push a 2-atom M-LEGO with 2 inserters into wagon
    // mode (which would split atoms across wagons).
    const atomCount = aligned.filter(c => !c.isInserter).length
    if (atomCount > 3) {
      const wagonCount = Math.ceil(aligned.length / 3)
      const wagonSize = Math.ceil(aligned.length / wagonCount)
      const wagons: ComponentBreakdown[][] = []
      for (let i = 0; i < aligned.length; i += wagonSize) {
        wagons.push(aligned.slice(i, i + wagonSize))
      }
      return wagons
    }
    if (block.targetText.length > WAGON_CHAR_THRESHOLD) {
      // Few atoms, long text — each component (atom or inserter) gets
      // its own wagon. Single-component wagons skip the internal stubs.
      return aligned.map(c => [c])
    }
    return null
  }

  // No declared components but text too long for one tile — synthesise
  // word-wagons. Reached by A-LEGOs whose canonical text is multi-word
  // (rare) and by the single-tile fallback in LearningPlayer when
  // decomposition fails and the whole phrase rides in one block.
  if (block.targetText.length > WAGON_CHAR_THRESHOLD) {
    const words = block.targetText.split(/\s+/).filter(Boolean)
    if (words.length < 2) return null
    const wagonCount = Math.ceil(words.length / 3)
    const wagonSize = Math.ceil(words.length / wagonCount)
    const wagons: ComponentBreakdown[][] = []
    for (let i = 0; i < words.length; i += wagonSize) {
      const slice = words.slice(i, i + wagonSize)
      // Pack as ONE component per wagon — template auto-sets
      // `has-components` on wagon.length > 1, which would render
      // misleading M-LEGO atom-divider stubs INSIDE each wagon.
      wagons.push([{ known: '', target: slice.join(' ') }])
    }
    return wagons
  }

  return null
}

/**
 * Align a practice block's components to its targetText.
 * Returns aligned components if successful, null if alignment fails
 * (caller should fall back to showing block.targetText as a single span).
 */
function alignedBlockComponents(block: LegoBlock): ComponentBreakdown[] | null {
  if (!block.components || block.components.length <= 1) return null
  const aligned = alignComponentsToFullText(block.components, block.targetText)
  // Golden rule check: verify aligned text covers full block text. CJK
  // content tolerates whitespace differences (see normaliseForCompare).
  const isCJK = CJK_RE.test(block.targetText)
  const alignedText = aligned.map(c => c.target).join(isCJK ? '' : ' ')
  const normFull = normaliseForCompare(block.targetText, isCJK)
  const normAligned = normaliseForCompare(alignedText, isCJK)
  if (normAligned !== normFull) {
    console.warn(`[LegoAssembly] Block component mismatch: "${alignedText}" vs "${block.targetText}"`)
    return null
  }
  return aligned
}

// Intro/debut gloss groups (Tom 2026-06-07): when blocks carry glossGroup
// ids, render them as runs — the word tiles EXACTLY as a regular phrase
// shows them (per-tile ruby, same boxes), plus one known gloss centred
// under each run. Groups are built from consecutive blocks sharing an id;
// the run's gloss is the first block's knownText.
const introGlossGroups = computed<Array<{ blocks: LegoBlock[]; known: string }> | null>(() => {
  if (!props.blocks.some((b) => b.glossGroup !== undefined)) return null
  const groups: Array<{ blocks: LegoBlock[]; known: string }> = []
  let lastId: number | undefined
  for (const b of props.blocks) {
    const id = b.glossGroup
    const last = groups[groups.length - 1]
    if (last && id !== undefined && id === lastId) {
      last.blocks.push(b)
    } else {
      groups.push({ blocks: [b], known: b.knownText || '' })
    }
    lastId = id
  }
  return groups
})

// Uniform sentence-level scaling: all tiles in a phrase scale together.
// Floor 0.85 so the target font stays at least as big as the known-text
// panel above — long phrases wrap onto more rows rather than shrinking
// the type below a legible size.
// Applies to single-block phrases too (Tom 2026-05-21): when decomposition
// falls back to a single tile holding the whole phrase, that one tile
// should still respect total-char shrinkage. Otherwise the salient bump
// reads as huge relative to multi-block phrases that *do* shrink.
const sentenceScale = computed(() => {
  const totalChars = props.blocks.reduce((sum, b) => sum + b.targetText.length, 0)
  if (totalChars <= 20) return 1
  return Math.max(0.85, 1 - (totalChars - 20) * 0.005)
})
</script>

<template>
  <div class="lego-assembly" :class="[assemblyPhase, { 'instant-hide': instantHide }]" :style="{ '--sentence-scale': sentenceScale, direction: isRTL ? 'rtl' : 'ltr' }">

    <!-- ═══════════════════════════════════════════
         INTRO GLOSS GROUPS — intro/debut word tiles, identical to the
         regular-phrase rendering (per-tile ruby, same boxes), with the
         known-language gloss centred under each component's tile run.
         ═══════════════════════════════════════════ -->
    <template v-if="introGlossGroups">
      <div
        v-for="(group, gi) in introGlossGroups"
        :key="'gg' + gi"
        class="lego-block-wrapper gloss-group"
        :class="[assemblyPhase]"
        :style="{ '--stagger-delay': staggerDelay(gi) }"
      >
        <div class="gloss-group-row">
          <div v-for="block in group.blocks" :key="block.id" class="gloss-group-tile">
            <div v-if="showRomanization && block.romanText" class="tile-ruby">{{ block.romanText }}</div>
            <div
              class="lego-block"
              :class="{ salient: block.isSalient, 'is-cjk': hasCjk(block.targetText) }"
              :style="{ '--char-count': block.targetText.length }"
            >
              <span class="block-text">{{ softHyphenate(block.targetText) }}</span>
            </div>
          </div>
        </div>
        <span v-if="group.known" class="block-known">{{ group.known }}</span>
      </div>
    </template>

    <!-- ═══════════════════════════════════════════
         CARRIAGE MODE — long M-LEGO as groups of up to 3 components
         Each group is a mini tile with internal stubs, groups linked externally
         ═══════════════════════════════════════════ -->
    <div
      v-else-if="carriageGroups"
      class="lego-tile"
      :class="[assemblyPhase, { salient: blocks[0]?.isSalient }]"
      :style="{ '--assemble-duration': assembleDuration, '--stagger-delay': '0s' }"
    >
      <div v-if="showRomanization && blocks[0]?.romanText" class="tile-ruby">{{ blocks[0]?.romanText }}</div>
      <div class="carriage-track">
        <div
          v-for="(group, gi) in carriageGroups"
          :key="gi"
          class="carriage-wagon"
        >
          <div
            class="carriage-cell"
            :class="{ 'has-components': group.length > 1 }"
            :style="{ '--char-count': group.reduce((s, c) => s + c.target.length, 0) }"
          >
            <span v-for="(comp, ci) in group" :key="ci" class="comp">{{ softHyphenate(comp.target) }}</span>
          </div>
          <div v-if="isIntroOrDebut && group.some(c => c.known)" class="carriage-known-row">
            <span
              v-for="(comp, ci) in group"
              :key="ci"
              class="carriage-known-comp"
            >{{ comp.known || '' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════
         SINGLE TILE MODE — M-LEGO (with stubs) or A-LEGO
         Used for intro/debut: shows known text underneath
         ═══════════════════════════════════════════ -->
    <div
      v-else-if="blocks.length === 1 && (components || blocks[0]?.components)"
      class="lego-tile"
      :class="[assemblyPhase, { salient: blocks[0]?.isSalient }]"
      :style="{
        '--assemble-duration': assembleDuration,
        '--stagger-delay': '0s',
        '--char-count': blocks[0]?.targetText.length || 8,
      }"
    >
      <div v-if="showRomanization && blocks[0]?.romanText" class="tile-ruby">{{ blocks[0]?.romanText }}</div>
      <!-- Target row: single tile, components are spans with stubs between.
           Three modes:
             1. M-LEGO with components → component-aligned sub-tiles
             2. Multi-word A-LEGO → word-aligned sub-tiles (same divider
                styling). Wraps across lines at sub-tile boundaries rather
                than wrapping text inside one big tile.
             3. Single-word A-LEGO → one sub-tile, no dividers. -->
      <!-- One LEGO = one tile (Tom 2026-05-20). M-LEGOs with REAL
           components (composed of known A-LEGO atoms) render those
           components as sub-tiles with stub dividers — that's the
           pedagogical "M-LEGO is made of these A-LEGOs" signal. An
           A-LEGO (no components) renders as a single .comp containing
           its full text, even if multi-word. Text wraps naturally at
           word boundaries inside the tile when needed; the tile
           outline stays continuous because it IS one chunk. -->
      <!-- M-LEGO with components: target tiles (row 1, in the box) and the
           known gloss (row 2) live in ONE grid, sharing column tracks, so each
           gloss centres under its tile. The gloss cells are zero-width
           (justify-self:center, overflow visible) so the COLUMNS are sized by
           the tiles — tiles keep natural widths, glosses centre under them.
           (They used to be two separate flex rows — natural-width tiles vs
           equal-third glosses — which could only line up by coincidence.) -->
      <div
        v-if="mLegoComponents"
        class="tile-grid"
        :class="{ 'is-cjk': hasCjk(blocks[0]?.targetText), 'show-known': isIntroOrDebut && mLegoComponents.some(c => c.known) }"
        :style="{ '--cols': mLegoComponents.length }"
      >
        <span
          v-for="(comp, i) in mLegoComponents"
          :key="'t' + i"
          class="comp"
          :class="{ 'is-inserter': comp.isInserter }"
          :style="{ gridColumn: i + 1, gridRow: 1 }"
        >{{ softHyphenate(comp.target) }}</span>
        <template v-if="isIntroOrDebut && mLegoComponents.some(c => c.known)">
          <span
            v-for="(comp, i) in mLegoComponents"
            :key="'k' + i"
            class="tile-known-comp"
            :style="{ gridColumn: i + 1, gridRow: 2 }"
          >{{ comp.known || '' }}</span>
        </template>
      </div>

      <!-- Single A-LEGO (no components): the simple box + gloss underneath. -->
      <template v-else>
        <div class="tile-target" :class="{ 'is-cjk': hasCjk(blocks[0]?.targetText) }">
          <span class="comp">{{ softHyphenate(blocks[0]?.targetText || '') }}</span>
        </div>
        <div v-if="isIntroOrDebut && knownText" class="tile-known">{{ knownText }}</div>
      </template>
    </div>

    <!-- ═══════════════════════════════════════════
         PRACTICE PHRASE BLOCKS — multiple LEGOs in a phrase
         Each block is a tile; M-LEGOs render with stubs internally.
         Long M-LEGOs (>3 components) hyphenate into adjacent wagon tiles
         with stub-style edge markings between them.
         ═══════════════════════════════════════════ -->
    <template v-else>
      <TransitionGroup :name="instantHide ? '' : 'lego-block'">
        <div
          v-for="(block, index) in blocks"
          :key="block.id"
          class="lego-block-wrapper"
          :class="[assemblyPhase, { 'is-hyphenated': !!practiceCarriageWagons(block) }]"
          :style="{
            '--stagger-delay': staggerDelay(index),
            '--char-count': block.targetText.length,
          }"
        >
          <!-- Romanised ruby line (e.g. pinyin) above the native tile. Toggled
               by the learner; tile boundaries are identical across scripts. -->
          <div v-if="showRomanization && block.romanText" class="tile-ruby">{{ block.romanText }}</div>
          <!-- Hyphenated mode: long M-LEGO split into wagon tiles -->
          <template v-if="practiceCarriageWagons(block)">
            <div class="hyphenated-track">
              <div
                v-for="(wagon, wi) in practiceCarriageWagons(block)!"
                :key="wi"
                class="lego-block wagon"
                :class="{
                  'has-components': wagon.length > 1,
                  'wagon-start': wi === 0,
                  'wagon-end': wi === practiceCarriageWagons(block)!.length - 1,
                  'salient': block.isSalient,
                  'is-cjk': hasCjk(block.targetText),
                }"
                :style="{ '--char-count': wagon.reduce((s, c) => s + c.target.length, 0) }"
              >
                <span
                  v-for="(comp, ci) in wagon"
                  :key="ci"
                  class="comp block-text"
                  :class="{ 'is-inserter': comp.isInserter }"
                >{{ softHyphenate(comp.target) }}</span>
              </div>
            </div>
            <div v-if="isIntroOrDebut && practiceCarriageWagons(block)!.some(w => w.some(c => c.known))" class="hyphenated-known-track">
              <div
                v-for="(wagon, wi) in practiceCarriageWagons(block)!"
                :key="wi"
                class="block-known-row wagon-known"
              >
                <span
                  v-for="(comp, ci) in wagon"
                  :key="ci"
                  class="block-known-comp"
                >{{ comp.known || '' }}</span>
              </div>
            </div>
          </template>
          <!-- Standard mode: single tile (A-LEGO or short M-LEGO).
               Ghost tiles (id starts with _gap_ or _SYN) are words not
               declared as a LEGO on this seed but grokable from earlier
               M-LEGO context — render with softer styling so the learner
               sees "encountered word" without inferring a false LEGO unit. -->
          <template v-else>
            <div
              class="lego-block"
              :class="{
                'has-components': !!alignedBlockComponents(block),
                'solo-component': block.isSoloComponent,
                'ghost': block.id.startsWith('_gap_') || block.id.startsWith('_SYN'),
                'salient': block.isSalient,
                'is-cjk': hasCjk(block.targetText),
              }"
            >
              <template v-if="alignedBlockComponents(block)">
                <span
                  v-for="(comp, ci) in alignedBlockComponents(block)!"
                  :key="ci"
                  class="comp block-text"
                  :class="{ 'is-inserter': comp.isInserter }"
                >{{ softHyphenate(comp.target) }}</span>
              </template>
              <span v-else class="block-text">{{ softHyphenate(block.targetText) }}</span>
            </div>
            <template v-if="isIntroOrDebut">
              <div v-if="alignedBlockComponents(block)?.some(c => c.known)" class="block-known-row">
                <span
                  v-for="(comp, ci) in alignedBlockComponents(block)!"
                  :key="ci"
                  class="block-known-comp"
                >{{ comp.known || '' }}</span>
              </div>
              <span v-else-if="block.knownText" class="block-known">{{ block.knownText }}</span>
            </template>
          </template>
        </div>
      </TransitionGroup>
    </template>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════════
   LAYOUT CONTAINER
   ═══════════════════════════════════════════════════════════════ */
.lego-assembly {
  position: absolute;
  inset: 0;
  display: flex;
  flex-wrap: wrap;
  /* Bottom-align so every tile BOX sits on the same baseline within a row; the
     romanisation ruby floats above the tiles that have one, instead of pushing
     ruby-less tiles up into a ragged line. */
  align-items: flex-end;
  align-content: center;
  justify-content: center;
  gap: 0;
  padding: calc(var(--hero-pane-bottom, 250px) + 16px) 0.75rem calc(var(--nav-total, 100px) + 10px);
  pointer-events: none;
  z-index: 3;
  transition: opacity 0.4s ease;
}

.lego-assembly.hidden {
  opacity: 0;
}

/* Instant hide: no fade, no transition — tiles vanish with audio */
.lego-assembly.instant-hide {
  transition: none !important;
}
.lego-assembly.instant-hide .lego-block-wrapper,
.lego-assembly.instant-hide .lego-tile {
  transition: none !important;
  animation: none !important;
}

/* ═══════════════════════════════════════════════════════════════
   SINGLE TILE — intro/debut (A-LEGO or M-LEGO with stubs)
   ═══════════════════════════════════════════════════════════════ */
.lego-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: calc(100vw - 2rem);
  transition-property: transform, opacity;
  transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, opacity;
}

.lego-tile.hidden {
  opacity: 0;
  transform: scale(0.85);
}

.lego-tile.assembling {
  opacity: 1;
  transform: scale(1);
  transition-duration: var(--assemble-duration, 1.5s);
  animation: tile-arrive var(--assemble-duration, 1.5s) both;
}

.lego-tile.assembled {
  opacity: 1;
  transform: scale(1);
  transition-duration: 0.6s;
}

/* Target row: the actual tile */
.tile-target {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  padding: 0.6em 1.2em;
  border-radius: 0;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.20);
  overflow: hidden;
  position: relative;
  max-width: 100%;
}

.tile-target .comp {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 1.9rem;
  hyphens: manual;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  overflow-wrap: break-word;
  letter-spacing: 0.02em;
  position: relative;
  padding: 0 0.35em;
}

/* Stubs-bright: short solid lines from top & bottom edges, open middle.
   M-LEGO compositions where each .comp is a known A-LEGO atom — the
   visible stubs signal "real composition of known pieces". */
.tile-target.has-components .comp + .comp::before,
.tile-target.has-components .comp + .comp::after {
  content: '';
  position: absolute;
  left: 0;
  width: 1.5px;
  height: 27%;
  background: rgba(255, 255, 255, 0.4);
  z-index: 2;
  pointer-events: none;
}
.tile-target.has-components .comp + .comp::before {
  top: 0;
}
.tile-target.has-components .comp + .comp::after {
  bottom: 0;
}

/* Known text underneath (single A-LEGO) */
.tile-known {
  font-family: var(--font-body, system-ui);
  font-size: 1.2rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
}

/* Known text row: per-component aligned with target (M-LEGO) */
.tile-known-row {
  display: flex;
  align-items: baseline;
  align-self: stretch;
  /* Match tile-target horizontal padding so component widths align */
  padding: 0 1.2em;
}
.tile-known-comp {
  font-family: var(--font-body, system-ui);
  font-size: 1.2rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  text-align: center;
  flex: 1;
  padding: 0 0.35em;
}

/* ── M-LEGO shared grid: tiles (row 1) + gloss (row 2) in one grid so each
   gloss centres under its tile (replaces the two separate flex rows). ── */
.tile-grid {
  display: inline-grid;
  grid-template-columns: repeat(var(--cols), auto); /* columns sized by the TILES */
  align-items: center;
  justify-items: center;
  row-gap: 0.4em;        /* tile row → gloss row */
  position: relative;
  max-width: 100%;
}
/* The bordered box sits behind the tile row only (row 1, all columns). */
.tile-grid::before {
  content: '';
  grid-row: 1;
  grid-column: 1 / -1;
  align-self: stretch;
  justify-self: stretch;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.20);
  z-index: 0;
}
.tile-grid .comp {
  z-index: 1;
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 1.9rem;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: 0.02em;
  padding: 0.55em 0.7em;   /* vertical → box height; horizontal → tile breathing */
  position: relative;
  hyphens: manual;
}
/* Divider stubs between adjacent tiles (short top + bottom lines). */
.tile-grid .comp + .comp::before,
.tile-grid .comp + .comp::after {
  content: '';
  position: absolute;
  left: 0;
  width: 1.5px;
  height: 27%;
  background: rgba(255, 255, 255, 0.4);
  z-index: 2;
  pointer-events: none;
}
.tile-grid .comp + .comp::before { top: 0; }
.tile-grid .comp + .comp::after { bottom: 0; }
/* Gloss cells contribute ZERO width so the columns stay sized by the tiles;
   the text overflows centred on the column (= under the tile centre). */
.tile-grid .tile-known-comp {
  width: 0;
  min-width: 0;
  justify-self: center;
  overflow: visible;
  white-space: nowrap;
  padding: 0;
}
/* Salient (intro/debut) box emphasis — mirrors .tile-target.salient. */
.lego-tile.salient .tile-grid::before {
  border-color: rgba(255, 255, 255, 0.3);
  border-width: 2px;
}

/* Salient (intro/debut) — neutral glow, consistent across phases */
.lego-tile.salient .tile-target {
  border-color: rgba(255, 255, 255, 0.3);
  border-width: 2px;
  background: rgba(255, 255, 255, 0.15);
  box-shadow:
    0 0 20px 5px rgba(255, 255, 255, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
}

/* ═══════════════════════════════════════════════════════════════
   CARRIAGE MODE — long M-LEGO as groups of ≤3, linked externally
   ═══════════════════════════════════════════════════════════════ */
.carriage-track {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  column-gap: 0;
  row-gap: 0;
}

.carriage-wagon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  position: relative;
}

/* Flush: no connector between wagon groups */

/* Each group is a mini M-LEGO tile (reuses stub styling via .has-components .comp) */
.carriage-cell {
  display: inline-flex;
  align-items: center;
  padding: 0.5em 0.9em;
  border-radius: 0;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.20);
  position: relative;
}

.carriage-cell .comp {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: 1.7rem;
  hyphens: manual;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: 0.02em;
  position: relative;
  padding: 0 0.3em;
  white-space: nowrap;
}

/* Internal stubs within each carriage group (same pattern as tile-target) */
.carriage-cell.has-components .comp + .comp::before,
.carriage-cell.has-components .comp + .comp::after {
  content: '';
  position: absolute;
  left: 0;
  width: 1.5px;
  height: 27%;
  background: rgba(255, 255, 255, 0.4);
  z-index: 2;
  pointer-events: none;
}
.carriage-cell.has-components .comp + .comp::before {
  top: 0;
}
.carriage-cell.has-components .comp + .comp::after {
  bottom: 0;
}

/* Known text row per group, aligned per component */
.carriage-known-row {
  display: flex;
  align-items: baseline;
  align-self: stretch;
  padding: 0 0.9em;
}
.carriage-known-comp {
  font-family: var(--font-body, system-ui);
  font-size: 1.1rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  text-align: center;
  flex: 1;
  padding: 0 0.3em;
}

/* Salient carriage styling — consistent across phases */
.lego-tile.salient .carriage-cell {
  border-color: rgba(255, 255, 255, 0.3);
  border-width: 2px;
  background: rgba(255, 255, 255, 0.15);
  box-shadow:
    0 0 12px 2px rgba(255, 255, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
/* Flush: no connector to style */

/* ═══════════════════════════════════════════════════════════════
   PRACTICE BLOCKS — multiple LEGOs in a phrase (horizontal flow)
   ═══════════════════════════════════════════════════════════════ */

/* Wrapper: handles animation/positioning, contains tile + known text.
   flex-shrink: 0 ensures tiles never compress — they wrap to the next line whole. */
.lego-block-wrapper {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
  gap: 3px;
  transition-property: transform, opacity;
  transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1.0);
  will-change: transform, opacity;
}

/* ═══════════════════════════════════════════════════════════════
   INTRO GLOSS GROUPS — tile runs with the known gloss centred under
   each run. The tiles inside reuse .lego-block / .tile-ruby exactly,
   so the intro/debut tiling reads identical to a regular phrase.
   ═══════════════════════════════════════════════════════════════ */
.gloss-group-row {
  display: flex;
  align-items: flex-end; /* tile boxes share a baseline; ruby floats above */
  gap: 0;                /* flush, matching the assembly's tile spacing */
}
.gloss-group-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;              /* ruby → tile spacing, matches .lego-block-wrapper */
}

/* Romanised ruby line (pinyin / romaji / transliteration) above a tile.
   Deliberately quiet — a pronunciation crutch the learner drops over time,
   never competing with the native-script glyph it annotates. */
.tile-ruby {
  align-self: center;
  text-align: center;
  /* One pinyin syllable ≈ one hanzi wide (a syllable is 3-5 roman chars, a
     hanzi ~one em), so the ruby tracks the tile width and never spills past it.
     Sized to sit comfortably under the eye without competing with the glyph. */
  font-size: calc(1.25rem * var(--sentence-scale, 1));
  line-height: 1.15;
  letter-spacing: 0.01em;
  font-weight: 500;
  color: var(--text-secondary, rgba(60, 55, 48, 0.62));
  opacity: 0.9;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
  /* The romanisation is always Latin — keep it LTR even above RTL (Arabic)
     tiles, and isolate it from the surrounding bidi context. */
  direction: ltr;
  unicode-bidi: isolate;
}

/* The visual tile */
.lego-block {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  padding: calc(0.6em * var(--sentence-scale, 1)) calc(1.1em * var(--sentence-scale, 1));
  border-radius: 0;
  background: rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.28);
  box-shadow:
    0 0 12px 2px rgba(255, 255, 255, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  max-width: calc(100vw - 3rem);
  /* overflow: hidden was clipping single-line tiles whose text was
   * longer than the tile padding suggested. With nowrap text the
   * tile grows to fit; we don't need to hide overflow. */
  position: relative;
}

/* Known text under each practice block (A-LEGO) */
.block-known {
  font-family: var(--font-body, system-ui);
  font-size: 1.1rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  text-align: center;
  max-width: calc(100vw - 3rem);
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Known text row: per-component aligned with target (practice M-LEGO) */
.block-known-row {
  display: flex;
  align-items: baseline;
  align-self: stretch;
  /* Match lego-block horizontal padding so comp widths align */
  padding: 0 1.1em;
}
.block-known-comp {
  font-family: var(--font-body, system-ui);
  font-size: 1.1rem;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.9);
  white-space: nowrap;
  text-align: center;
  flex: 1;
  padding: 0 0.35em;
}

/* Uniform tile typography (Tom 2026-06-07): with the romanisation ruby and
   authored per-word tiles, the old salient-vs-context weight/size split read
   as noise — every tile now carries the same bold text. The salient class
   stays on blocks (semantics/telemetry) but no longer changes the type. */
.lego-block .block-text {
  font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
  font-size: calc(1.7rem * var(--sentence-scale, 1));
  /* Wraps: word-boundary by default (clean space breaks), plus any SHY
   * positions softHyphenate inserted mid-word for long compound nouns.
   * `hyphens: manual` means a wrap AT a SHY shows a visible hyphen
   * (signalling "this word is broken"); plain word-break wraps show
   * nothing extra. */
  hyphens: manual;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.02em;
  user-select: none;
  position: relative;
  padding: 0 0.35em;
}

/* Stubs-bright on practice M-LEGOs — M-LEGO components rendered as
   adjacent sub-tiles get the same partial vertical bars as
   .tile-target.has-components above. */
.lego-block.has-components .comp + .comp::before,
.lego-block.has-components .comp + .comp::after {
  content: '';
  position: absolute;
  left: 0;
  width: 1.5px;
  height: 27%;
  background: rgba(255, 255, 255, 0.4);
  z-index: 2;
  pointer-events: none;
}
.lego-block.has-components .comp + .comp::before {
  top: 0;
}
.lego-block.has-components .comp + .comp::after {
  bottom: 0;
}

/* ═══════════════════════════════════════════════════════════════
   HYPHENATED M-LEGO — split into adjacent wagon tiles for long phrases
   Outer edges of wagons get stub-style markings (top + bottom partial
   vertical bars, open middle) to communicate that the tiles are one
   LEGO continuing across the boundary.
   ═══════════════════════════════════════════════════════════════ */
.hyphenated-track {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  justify-content: center;
  gap: 6px;
  max-width: calc(100vw - 2rem);
}

.hyphenated-known-track {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  gap: 6px;
  max-width: calc(100vw - 2rem);
  margin-top: 3px;
}

.hyphenated-known-track .wagon-known {
  /* The known-row inside the track stretches to match its wagon above */
  flex: 0 0 auto;
}

/* Outer edge of every wagon except the last: stub-style (no full right border) */
.lego-block.wagon:not(.wagon-end) {
  border-right-color: transparent;
}
.lego-block.wagon:not(.wagon-end)::after {
  content: '';
  position: absolute;
  top: -1px;
  right: -1px;
  width: 1.5px;
  height: calc(100% + 2px);
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.4) 0% 27%,
    transparent 27% 73%,
    rgba(255, 255, 255, 0.4) 73% 100%
  );
  z-index: 2;
  pointer-events: none;
}

/* Outer edge of every wagon except the first: stub-style (no full left border) */
.lego-block.wagon:not(.wagon-start) {
  border-left-color: transparent;
}
.lego-block.wagon:not(.wagon-start)::before {
  content: '';
  position: absolute;
  top: -1px;
  left: -1px;
  width: 1.5px;
  height: calc(100% + 2px);
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.4) 0% 27%,
    transparent 27% 73%,
    rgba(255, 255, 255, 0.4) 73% 100%
  );
  z-index: 2;
  pointer-events: none;
}

/* --- ASSEMBLING (sequential reveal in reading order) --- */
.lego-block-wrapper.assembling {
  animation: block-reveal 0.25s cubic-bezier(0.25, 0.1, 0.25, 1.0) var(--stagger-delay, 0s) both;
}

/* --- ASSEMBLED (static, no style change from base) --- */
.lego-block-wrapper.assembled {
  opacity: 1;
  transform: translateY(0);
}

/* --- SALIENT LEGO (newly introduced) ---
   No visual change at all since the uniform-typography pass (Tom
   2026-06-07) — the class is kept on blocks for semantics only. */

/* ═══════════════════════════════════════════════════════════════
   CJK SIZING — Chinese/Japanese/Korean characters are denser than
   Roman letters and read cramped at Roman-tuned sizes. Bump font-
   size and add letter-spacing so glyphs breathe without inserting
   actual whitespace between characters. One size for every tile —
   salient and context read identically.
   ═══════════════════════════════════════════════════════════════ */
.lego-block.is-cjk .block-text {
  font-size: calc(2rem * var(--sentence-scale, 1));
  letter-spacing: 0.08em;
}
.tile-target.is-cjk .comp {
  font-size: 2.2rem;
  letter-spacing: 0.08em;
}

/* --- HIDDEN --- */
.lego-block-wrapper.hidden {
  opacity: 0;
  transform: translateY(6px);
  transition-duration: 0.3s;
  transition-timing-function: ease-in;
}

/* --- Transition group enter/leave --- */
.lego-block-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.lego-block-leave-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.lego-block-enter-from {
  opacity: 0;
  transform: scale(0.7);
}
.lego-block-leave-to {
  opacity: 0;
  transform: scale(0.85) translateY(10px);
}

/* ═══════════════════════════════════════════════════════════════
   KEYFRAMES
   ═══════════════════════════════════════════════════════════════ */
@keyframes block-reveal {
  0% { opacity: 0; transform: translateY(6px); }
  100% { opacity: 1; transform: translateY(0); }
}

@keyframes tile-arrive {
  0% { transform: scale(0.85); opacity: 0; }
  70% { transform: scale(1.03); opacity: 1; }
  85% { transform: scale(0.98); }
  100% { transform: scale(1); }
}

/* ═══════════════════════════════════════════════════════════════
   MOBILE
   ═══════════════════════════════════════════════════════════════ */
@media (max-width: 600px) {
  .lego-block .block-text {
    font-size: calc(1.55rem * var(--sentence-scale, 1));
  }
  .lego-block {
    padding: calc(0.5em * var(--sentence-scale, 1)) calc(0.9em * var(--sentence-scale, 1));
  }

  /* CJK mobile — keep the density bump proportional to the mobile baseline. */
  .lego-block.is-cjk .block-text {
    font-size: calc(1.8rem * var(--sentence-scale, 1));
  }

  .tile-target .comp {
    font-size: 1.6rem;
  }
  .tile-target.is-cjk .comp {
    font-size: 1.9rem;
  }

  .carriage-cell {
    padding: 0.45em 0.7em;
  }
  .carriage-cell .comp {
    font-size: 1.4rem;
  }
}
</style>

<!-- Mist theme overrides -->
<style>
:root[data-theme="mist"] .lego-block {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 6px rgba(44, 38, 34, 0.14),
              0 8px 24px rgba(44, 38, 34, 0.10);
  backdrop-filter: none;
}

:root[data-theme="mist"] .lego-block .block-text {
  color: var(--text-primary);
}


/* Salient in mist: same chrome as a normal tile. The default mist
   .lego-block rule above (white bg, neutral border, dark shadow)
   handles it. No mist-specific salient rule needed — text gets the
   default text-primary colour and the subtle weight+size bump from
   the unscoped .lego-block.salient .block-text rule. */

/* M-LEGO stubs for mist theme */
:root[data-theme="mist"] .tile-target.has-components .comp + .comp::before,
:root[data-theme="mist"] .tile-target.has-components .comp + .comp::after,
:root[data-theme="mist"] .lego-block.has-components .comp + .comp::before,
:root[data-theme="mist"] .lego-block.has-components .comp + .comp::after {
  background: rgba(44, 38, 34, 0.2);
}

/* Mist: uniform tiles (Tom 2026-06-07). The old "second colour" treatment
   (smaller, muted non-salient text + softer non-salient chrome) is gone —
   every tile renders the same bold dark text in the same white box. */

/* Hyphenated wagon edge stubs for mist theme */
:root[data-theme="mist"] .lego-block.wagon:not(.wagon-end)::after,
:root[data-theme="mist"] .lego-block.wagon:not(.wagon-start)::before {
  background: linear-gradient(
    to bottom,
    rgba(44, 38, 34, 0.25) 0% 27%,
    transparent 27% 73%,
    rgba(44, 38, 34, 0.25) 73% 100%
  );
}

/* Single tile mist overrides */
:root[data-theme="mist"] .tile-target {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10),
              0 8px 20px rgba(44, 38, 34, 0.06);
  backdrop-filter: none;
}
:root[data-theme="mist"] .tile-target .comp {
  color: var(--text-primary);
}
:root[data-theme="mist"] .tile-known,
:root[data-theme="mist"] .tile-known-comp,
:root[data-theme="mist"] .block-known,
:root[data-theme="mist"] .block-known-comp {
  color: var(--text-secondary);
}
:root[data-theme="mist"] .lego-tile.salient .tile-target {
  border-color: rgba(0, 0, 0, 0.35);
  background: #ffffff;
}

/* M-LEGO shared-grid mist overrides — mirror .tile-target so the new grid
   renders white-box/dark-text like the rest (mist is the only live theme). */
:root[data-theme="mist"] .tile-grid::before {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10),
              0 8px 20px rgba(44, 38, 34, 0.06);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
:root[data-theme="mist"] .tile-grid .comp {
  color: var(--text-primary);
}
:root[data-theme="mist"] .tile-grid .comp + .comp::before,
:root[data-theme="mist"] .tile-grid .comp + .comp::after {
  background: rgba(44, 38, 34, 0.2);
}
:root[data-theme="mist"] .lego-tile.salient .tile-grid::before {
  border-color: rgba(0, 0, 0, 0.35);
}
:root[data-theme="mist"] .tile-grid.is-cjk .comp {
  font-size: 2.2rem;
}
@media (max-width: 600px) {
  :root[data-theme="mist"] .tile-grid.is-cjk .comp {
    font-size: 1.9rem;
  }
}

/* Carriage mist overrides */
:root[data-theme="mist"] .carriage-cell {
  background: #ffffff;
  border: 1.5px solid rgba(0, 0, 0, 0.35);
  box-shadow: 0 2px 4px rgba(44, 38, 34, 0.10);
  backdrop-filter: none;
}
:root[data-theme="mist"] .carriage-cell .comp {
  color: var(--text-primary);
}
:root[data-theme="mist"] .carriage-cell.has-components .comp + .comp::before,
:root[data-theme="mist"] .carriage-cell.has-components .comp + .comp::after {
  background: rgba(44, 38, 34, 0.2);
}
:root[data-theme="mist"] .carriage-known-comp {
  color: var(--text-secondary);
}
:root[data-theme="mist"] .lego-tile.salient .carriage-cell {
  border-color: rgba(0, 0, 0, 0.35);
  background: #ffffff;
}

/* No mist-scoped sizing rules needed any more — the uniform unscoped
   .block-text / .is-cjk rules apply in mist too, now that the mist
   non-salient overrides (which used to win on specificity) are gone. */
</style>
