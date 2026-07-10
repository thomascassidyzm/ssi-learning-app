/**
 * fusionDrill — the pairwise gradual-fusion ladder for Listening Mode
 * Dialogues > Drill (Aran's model, Tom 2026-07-05).
 *
 * A turn's `atom_map_fine` gives the natural chunks (agent-authored seams —
 * MOLECULAR breath-groups per Tom's 2026-07-05 method, not atomic words;
 * overlaps allowed where authored). Drill climbs one rung per VISIT:
 *
 *   rung 0:  a · b · c                the molecular chunks, each a strip
 *   rung 1:  a+b · c                  pairwise fusion, odd tail stands alone
 *   top:     the whole SENTENCE       — and it stays there.
 *
 * Every chunk at every rung plays t·k·t·t (target · known · target · target).
 * The ladder is CAPPED at the sentence: a turn is 3–4 sentences from one
 * speaker — far too much to hold — so sentences never conjoin into the turn
 * here (the turn-whole belongs to Immersion flow, not Drill).
 *
 * Chunk audio = contiguous ms slices of the sentence's Take G render (the
 * gapped take, seams preserved), so fused chunks keep their internal pauses
 * until the sentence tops out on the natural take. Chunk knowns = the
 * agent-authored unit glosses / window translations rendered as
 * `pod_fine_known` clips (text-keyed). No real audio for a piece → the
 * ladder self-clamps to the sentence whole rather than play approximations.
 *
 * Pure functions only — the player and the dashboard Pod Lab must compose
 * from ONE engine (no second drifting copy).
 */

import type { PodPlay, PodSentenceRow } from './podStageComposition'

/**
 * Kill switch for sub-sentence ms-slice playback (2026-07-10 seam diagnosis:
 * ~35% of ita groups have misplaced seams — the ffmpeg silence-detect fallback
 * picks wrong gaps, and a BAD split is WORSE than NO split). While false, every
 * group degrades to text chunk strips + whole-sentence audio; text chunking and
 * glosses stay fully intact. Flip to true when per-chunk rendered clips land.
 */
const DRILL_SLICE_PLAYBACK_ENABLED = false

export type FusionMode = 'pairwise' | 'chained'

/** One authored fine unit from `listening_pod_sentences.atom_map_fine`. */
export interface FineUnit {
  kind?: string
  gloss?: string
  lego_key?: string
  target_surface: string
  /** ms span within this unit's GROUP's Take G clip (per-group timebase). */
  target_start_ms?: number | null
  target_end_ms?: number | null
}

export interface WindowKnown {
  g: number
  start: number
  end: number
  known: string
}

/** Per-sentence-row data as the player presents it (the June per-sentence
 *  split): one row per sentence clip, or a single whole-turn row. */
export interface FusionRowInput {
  targetAudioId: string | null
  knownAudioId: string | null
  targetText: string
  knownText: string
}

export interface FusionTurnInput {
  turnTargetText: string
  fineMap: FineUnit[]
  windowKnownMap: WindowKnown[] | null
  /** Aligned to GLUED sentence groups; null element = single-unit group. */
  takegAudioIds: Array<string | null> | null
  rows: FusionRowInput[]
}

/** One glued sentence group, resolved and ready to drill. */
export interface FusionGroup {
  groupIndex: number
  units: FineUnit[]
  /** Authored window translations for this group's spans, keyed by FLAT
   *  `start-end` unit indices (window_known_map's indexing). */
  windowKnowns: Record<string, string>
  /** Flat index (within the whole turn's unit list) of units[0]. */
  flatStart: number
  /** Take G render for this group (null = single-unit group / not rendered). */
  takegAudioId: string | null
  /** The real whole-sentence target take (sentence clip; the group's full
   *  Take G for glued groups — gaps and all, still the real render). */
  wholeTargetClipId: string | null
  /** June-split per-sentence known take (fallback below fresh renders). */
  wholeKnownClipId: string | null
  targetText: string
  knownText: string
  /** Rows of the turn this group covers (glue can span two). */
  rowFirst: number
  rowLast: number
  /** True when the group's units carry usable ms spans inside a Take G —
   *  the precondition for sub-sentence rungs. False → whole-sentence only. */
  sliceable: boolean
}

export interface DrillClipRef {
  id: string
  startMs?: number
  endMs?: number
}

/** One visual strip at the current rung (target chunk + its known line). */
export interface DrillStrip {
  target: string
  known: string
}

export interface DrillQueueStep {
  kind: 'chunk' | 'known'
  /** Which strip this step belongs to — drives the strip highlight. */
  stripIndex: number
  text: string
  /** null → no real clip for this slot; skip the audio, keep the text. */
  clip: DrillClipRef | null
}

/** Mirror of services/shared/text-normalize.cjs normalizeForAudio — every
 *  lookup against course_audio.text_normalized must use exactly this. */
export const normalizeForAudio = (t: string | null | undefined): string =>
  (t || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!。！]+$/, '')

export const SENTENCE_PUNCT = /[.!?…。！？؟]/ // ؟ = Arabic/Farsi question mark — ~9 turns per RTL pod-0 have one mid-turn

/**
 * One fusion step over spans of unit indices.
 *   pairwise: disjoint pairs L→R, an odd tail stands alone until the next rung
 *   chained:  adjacent windows share an edge chunk ("ma non posso" /
 *             "non posso parlare") — gentler climb, one more rung per size
 */
export function fuseSpans(
  spans: Array<{ start: number; end: number }>,
  mode: FusionMode,
): Array<{ start: number; end: number }> {
  if (spans.length <= 1) return spans
  const out: Array<{ start: number; end: number }> = []
  if (mode === 'chained') {
    for (let i = 0; i < spans.length - 1; i++) out.push({ start: spans[i].start, end: spans[i + 1].end })
  } else {
    for (let i = 0; i < spans.length; i += 2)
      out.push({ start: spans[i].start, end: spans[Math.min(i + 1, spans.length - 1)].end })
  }
  return out
}

/** Every fusion level for an n-unit sentence: units → … → the whole. */
export function spanLadder(n: number, mode: FusionMode): Array<Array<{ start: number; end: number }>> {
  let spans = Array.from({ length: n }, (_, i) => ({ start: i, end: i }))
  const levels = [spans]
  while (spans.length > 1) {
    spans = fuseSpans(spans, mode)
    levels.push(spans)
  }
  return levels
}

/**
 * Partition the turn's fine units into sentence groups by walking the turn
 * text between consecutive unit surfaces looking for sentence-terminal
 * punctuation — sound-wave grouping, no grammar. Returns arrays of unit
 * INDICES into `units`.
 */
export function partitionUnits(turnText: string, units: FineUnit[]): number[][] {
  const text = turnText || ''
  const lower = text.toLowerCase()
  const groups: number[][] = [[]]
  let cursor = 0
  for (let i = 0; i < units.length; i++) {
    const surface = (units[i].target_surface || '').toLowerCase()
    const idx = surface ? lower.indexOf(surface, cursor) : -1
    if (i > 0 && idx !== -1 && SENTENCE_PUNCT.test(text.slice(cursor, idx))) groups.push([])
    groups[groups.length - 1].push(i)
    if (idx !== -1) cursor = idx + surface.length
  }
  return groups.filter((g) => g.length > 0)
}

/**
 * Glue rule (narrowed 2026-07-04): ONLY a turn-initial one-unit sentence — a
 * leading "Ciao!" interjection — glues onto the sentence that follows. A
 * mid-turn one-unit sentence is a real sentence with its own takes.
 */
export function glueLeadingInterjection(groups: number[][]): number[][] {
  if (groups.length >= 2 && groups[0].length === 1) {
    return [[...groups[0], ...groups[1]], ...groups.slice(2)]
  }
  return groups
}

export interface BuildFusionGroupsOpts {
  /** Emit GLUED turns as per-row groups instead of one spanning group. The
   *  interjection row keeps its own take (depth 1 — nothing to fuse); the
   *  continuation row slices its chunks from the SHARED Take G (unit ms
   *  spans are in that clip's timebase either way). The main-flow lap
   *  scheduler needs this — its items are rows, so a spanning group would
   *  double-play material; Drill keeps the spanning group (it anchors the
   *  glue and skips the continuation row). */
  splitGlued?: boolean
}

/**
 * Resolve a turn's fine map into drill-ready sentence groups. Returns null
 * when the authored data doesn't line up with this turn (no fine map, group/
 * row mismatch, Take G misalignment) — the caller falls back to the plain
 * per-sentence t·k·t·t drill. Honest data or nothing; never guess a cut.
 */
export function buildFusionGroups(
  input: FusionTurnInput,
  opts?: BuildFusionGroupsOpts,
): FusionGroup[] | null {
  const units = (input.fineMap || []).filter(
    (u) => u && (u.kind === undefined || u.kind === 'atom' || u.kind === 'passthrough') && u.target_surface,
  )
  if (units.length === 0) return null

  const raw = partitionUnits(input.turnTargetText, units)
  const glued = glueLeadingInterjection(raw)

  // Row alignment: the June split gives one row per raw sentence. A single
  // unsplit row legitimately holds every group. Anything else → bail.
  const rows = input.rows || []
  const singleRow = rows.length === 1
  if (!singleRow && raw.length !== rows.length) return null

  // Take G alignment is per GLUED group when present.
  const takeg = input.takegAudioIds
  if (takeg && takeg.length !== glued.length) return null

  // Rows covered per glued group: glue only ever merges raw row 0 into 1.
  const gluedOffset = glued.length === raw.length ? 0 : 1

  // splitGlued: compose from the RAW partition (1:1 with rows) and point the
  // glue-affected raw groups at the shared glued Take G.
  const splitGlued = !!opts?.splitGlued && gluedOffset === 1
  const groupsSrc = splitGlued ? raw : glued
  const takegIndexFor = (gi: number) => (splitGlued ? Math.max(0, gi - 1) : gi)

  // Flat offsets per group (window_known_map uses flat unit indices; the flat
  // order is identical for raw and glued — gluing only merges neighbours).
  const flatStarts: number[] = []
  {
    let off = 0
    for (const g of groupsSrc) {
      flatStarts.push(off)
      off += g.length
    }
  }

  const windowIndex: Record<string, string> = {}
  for (const w of input.windowKnownMap || []) windowIndex[`${w.start}-${w.end}`] = w.known

  return groupsSrc.map((unitIdxs, gi) => {
    const groupUnits = unitIdxs.map((i) => units[i])
    const rowFirst = singleRow ? 0 : splitGlued ? gi : gi === 0 ? 0 : gi + gluedOffset
    const rowLast = singleRow ? 0 : splitGlued ? gi : gi === 0 ? gluedOffset : gi + gluedOffset
    const rowsOfGroup = rows.slice(rowFirst, rowLast + 1)
    // A per-sentence row maps 1:1 onto this group (the common case).
    const perSentenceRow = !singleRow && rowsOfGroup.length === 1 ? rowsOfGroup[0] : null
    const wholeTurnGroup = singleRow && groupsSrc.length === 1 ? rows[0] : null

    const takegId = takeg ? takeg[takegIndexFor(gi)] || null : null
    const sliceable =
      DRILL_SLICE_PLAYBACK_ENABLED &&
      !!takegId &&
      groupUnits.length > 1 &&
      groupUnits.every((u) => u.target_start_ms != null && u.target_end_ms != null)

    return {
      groupIndex: gi,
      units: groupUnits,
      windowKnowns: windowIndex,
      flatStart: flatStarts[gi],
      takegAudioId: takegId,
      wholeTargetClipId:
        perSentenceRow?.targetAudioId || wholeTurnGroup?.targetAudioId || takegId || null,
      wholeKnownClipId: perSentenceRow?.knownAudioId || wholeTurnGroup?.knownAudioId || null,
      targetText:
        perSentenceRow?.targetText ||
        wholeTurnGroup?.targetText ||
        (rowsOfGroup.length > 1
          ? rowsOfGroup.map((r) => r.targetText).filter(Boolean).join(' ')
          : groupUnits.map((u) => u.target_surface).join(' ')),
      knownText:
        perSentenceRow?.knownText ||
        wholeTurnGroup?.knownText ||
        (rowsOfGroup.length > 1
          ? rowsOfGroup.map((r) => r.knownText).filter(Boolean).join(' ')
          : groupUnits.map((u) => u.gloss || '').filter(Boolean).join(' ')),
      rowFirst,
      rowLast,
      sliceable,
    }
  })
}

/**
 * Skip the finest-units rung. TRUE was the stopgap for the ATOMIC-era maps
 * (Tom 2026-07-05: single atomic units too 'bitty'). The real fix was
 * re-authoring the maps at MOLECULAR granularity (breath-group chunks,
 * Tom's method, same day) — the finest level IS now the level he specified
 * ("3 separate strips that go in turn"), so the ladder enters there again.
 * Flip to true only for courses still carrying atomic-era maps.
 */
export const SKIP_FINEST_RUNG = false

/** The ladder a group actually climbs: span levels (finest rung skipped per
 *  SKIP_FINEST_RUNG), or just the whole for non-sliceable groups. */
function ladderFor(group: FusionGroup, mode: FusionMode): Array<Array<{ start: number; end: number }>> {
  if (!group.sliceable) return [[{ start: 0, end: group.units.length - 1 }]]
  let levels = spanLadder(group.units.length, mode)
  if (SKIP_FINEST_RUNG && levels.length > 1) levels = levels.slice(1)
  return levels
}

/** The number of rungs this group's own ladder has under a fusion mode. A
 *  group with no sliceable audio clamps straight to its whole (depth 1). */
export function groupDepth(group: FusionGroup, mode: FusionMode): number {
  return ladderFor(group, mode).length
}

/** Progression-badge tier label for a fusion rung ("fusion-r0", "fusion-r1"…). */
export const FUSION_TIER_PREFIX = 'fusion-r'

/**
 * MAIN-FLOW unified ladder (Tom 2026-07-03 lock, sentence-capped per the
 * 2026-07-05 ruling): a sentence's ladder = its fusion rungs, then the
 * config speed cascade. This composes ONE fusion rung as PodPlays for the
 * pod-lap scheduler — the same steps Drill plays (chunk t·k·t·t at 1×,
 * Take G ms-slices, fine-known translations), expressed in the lap's play
 * vocabulary so gaps/telemetry/Progression all work unchanged. The rung
 * BELOW the whole belongs here; the whole-sentence t·k·t·t ≡ engine
 * Stage 1, where the existing stage playlists take over (the splice is
 * seamless — same shape, same speed).
 */
export function buildFusionRungPlays(
  sentence: PodSentenceRow,
  group: FusionGroup,
  rung: number,
  sentenceIdx: number,
  mode: FusionMode,
  lookupKnownClip: (text: string) => string | null,
): PodPlay[] {
  const { steps } = rungStepsForGroup(group, rung, mode, lookupKnownClip)
  const plays: PodPlay[] = []
  for (const st of steps) {
    if (!st.clip) continue // no real clip for this slot — the text-only known drops
    plays.push({
      sentenceIdx,
      stage: 0,
      tier: `${FUSION_TIER_PREFIX}${rung}`,
      playRole: st.kind === 'known' ? 'trans' : 'ps',
      audioId: st.clip.id,
      text: st.text,
      playbackSpeed: 1.0,
      glueToNextChunk: false,
      ...(st.clip.startMs != null && st.clip.endMs != null
        ? { startMs: st.clip.startMs, endMs: st.clip.endMs }
        : {}),
    })
  }
  if (plays.length > 0 && sentence.glue_to_next) plays[plays.length - 1].glueToNextChunk = true
  return plays
}

/**
 * Compose one group's strips + play steps at a rung. Every chunk plays
 * t·k·t·t; the known slot drops (t·t) when there is no real known clip —
 * the strip still SHOWS the gloss text. A scene-wide rung clamps to the
 * group's own depth: topped-out sentences repeat their whole while longer
 * siblings climb. `lookupKnownClip` resolves a known text to its
 * `pod_fine_known` clip id (normalizeForAudio-keyed).
 */
export function rungStepsForGroup(
  group: FusionGroup,
  rung: number,
  mode: FusionMode,
  lookupKnownClip: (text: string) => string | null,
  stripOffset = 0,
): { strips: DrillStrip[]; steps: DrillQueueStep[] } {
  const ladder = ladderFor(group, mode)
  const level = ladder[Math.min(rung, ladder.length - 1)]

  const strips: DrillStrip[] = []
  const steps: DrillQueueStep[] = []

  const pushTktt = (
    stripIndex: number,
    chunkText: string,
    chunkClip: DrillClipRef | null,
    knownText: string,
    knownClip: DrillClipRef | null,
  ) => {
    steps.push({ kind: 'chunk', stripIndex, text: chunkText, clip: chunkClip })
    if (knownClip) steps.push({ kind: 'known', stripIndex, text: knownText, clip: knownClip })
    steps.push({ kind: 'chunk', stripIndex, text: chunkText, clip: chunkClip })
    steps.push({ kind: 'chunk', stripIndex, text: chunkText, clip: chunkClip })
  }

  // Sentence whole — the top of the ladder, where every sentence ends up.
  // Known preference: fresh render of the real sentence translation (audio
  // provably matches text) → June-split take slice → fresh gloss-join render.
  if (level.length === 1) {
    const sentText = group.knownText
    const glossJoin = group.units.map((u) => u.gloss || '').filter(Boolean).join(' ')
    const knownText = sentText || glossJoin
    const clipId =
      (sentText ? lookupKnownClip(sentText) : null) ||
      group.wholeKnownClipId ||
      (glossJoin ? lookupKnownClip(glossJoin) : null)
    const knownClip = clipId ? { id: clipId } : null
    strips.push({ target: group.targetText, known: knownText })
    pushTktt(
      stripOffset,
      group.targetText,
      group.wholeTargetClipId ? { id: group.wholeTargetClipId } : null,
      knownText,
      knownClip,
    )
    return { strips, steps }
  }

  // Sub-sentence rung — ms slices of the group's Take G.
  level.forEach((span, si) => {
    const us = group.units.slice(span.start, span.end + 1)
    const chunkText = us.map((u) => u.target_surface).join(' ')
    const chunkClip: DrillClipRef = {
      id: group.takegAudioId as string,
      startMs: us[0].target_start_ms as number,
      endMs: us[us.length - 1].target_end_ms as number,
    }
    const knownText =
      us.length === 1
        ? us[0].gloss || ''
        : group.windowKnowns[`${group.flatStart + span.start}-${group.flatStart + span.end}`] ||
          us.map((u) => u.gloss || '').filter(Boolean).join(' ')
    const knownId = knownText ? lookupKnownClip(knownText) : null
    strips.push({ target: chunkText, known: knownText })
    pushTktt(stripOffset + si, chunkText, chunkClip, knownText, knownId ? { id: knownId } : null)
  })
  return { strips, steps }
}
