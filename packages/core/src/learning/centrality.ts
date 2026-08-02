/**
 * Distinction-network criticality — forward-reuse centrality per LEGO
 * (adaptation workstream C, supersedes the intro-order criticality proxy).
 *
 * FOUNDER RULING (Tom, 2026-07-31, verbatim — journaled in docs/DECISIONS.md):
 * "A hub LEGO is a LEGO that is connected to many other subsequent LEGOs, or
 * is used in many subsequent phrases… The question is whether this LEGO is
 * going to block people from getting to other phrases. And maybe we do some
 * simple maths: Which words are showing the most variation in the phrase →
 * Find the number of other phrases that contain these words → Use this number
 * as a measure of centrality."
 *
 * So criticality = "does this LEGO block the path forward?", measured as
 * FORWARD REUSE: for each LEGO, the number of SUBSEQUENT practice phrases
 * (belonging to later-introduced LEGOs) plus later M-LEGO compositions whose
 * target text contains this LEGO's target. Subsequent-only is the point — a
 * hub is something the learner cannot route around on the way forward; reuse
 * *behind* the learner blocks nothing.
 *
 * This subsumes the previous ruling (criticality = introduction order,
 * `adaptation-budget.md` §3): early LEGOs naturally score high on forward
 * reuse because the whole course is ahead of them, so intro-order falls out
 * as the degenerate case — and stays as the fallback when no centrality map
 * is supplied (see `ratePolicy.ts`).
 *
 * Matching rule: contiguous TOKEN-subsequence containment over normalized
 * (lowercased, letter/digit-tokenized) target text. Token-level, not raw
 * substring, so "en" never matches inside "bien"; tokenizing on non-letters
 * means elision ("qu'il") still contains "il" — the same class of false
 * positive/negative the 2026-07-04 component-membership rescope hit.
 *
 * Pure, offline-computable from course content the player already fetched
 * (the script walk) — no new capture, no new tables, no runtime tax beyond
 * one indexed pass per course load.
 */

// ---------------------------------------------------------------------------
// Input — the course walk, in introduction order
// ---------------------------------------------------------------------------

export interface CentralityLego {
  /** LEGO id (`S%04dL%02d`). */
  legoId: string;
  /** 1-based introduction ordinal in the course walk. */
  ordinal: number;
  /** Target-language text of the LEGO itself. */
  target: string;
}

export interface CentralityPhrase {
  /** Introduction ordinal of the LEGO this phrase practises (its owner). */
  ownerOrdinal: number;
  /** Target-language text of the phrase. */
  target: string;
}

export interface LegoCentrality {
  legoId: string;
  ordinal: number;
  /** Raw forward-reuse count: subsequent phrases + subsequent M-LEGO compositions containing this LEGO. */
  forwardReuse: number;
  /**
   * Rank percentile of `forwardReuse` across the course, 0..1 (1 = biggest
   * hub). Ties share the same percentile. This is what the rate policy's
   * criticality guard consumes (`unitCentralityPercentile`).
   */
  percentile: number;
}

// ---------------------------------------------------------------------------
// Tokenization & containment
// ---------------------------------------------------------------------------

/** Lowercase and split into letter/digit runs (unicode-aware). */
export function tokenizeTarget(text: string): string[] {
  return (text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

/** Is `needle` a contiguous subsequence of `haystack`? Empty needle never matches. */
function containsTokenSeq(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------

/**
 * Compute forward-reuse centrality for every LEGO in the course walk.
 *
 * A candidate document (phrase or later LEGO's own target) counts toward LEGO
 * L iff its owner ordinal is STRICTLY GREATER than L's ordinal (subsequent
 * only) and its token sequence contains L's token sequence contiguously.
 *
 * Cost: one inverted index over documents (token → doc ids), then per LEGO a
 * candidate scan of the rarest token's posting list — comfortably sub-100ms
 * for a full course (~700 LEGOs × ~17k phrases) in one pass at script-build
 * time.
 */
export function computeLegoCentrality(
  legos: CentralityLego[],
  phrases: CentralityPhrase[]
): Map<string, LegoCentrality> {
  interface Doc {
    ownerOrdinal: number;
    tokens: string[];
  }
  const docs: Doc[] = [];
  for (const p of phrases) {
    docs.push({ ownerOrdinal: p.ownerOrdinal, tokens: tokenizeTarget(p.target) });
  }
  // Later LEGOs' own targets are the "M-LEGO composition" candidates: a later
  // molecular LEGO that tiles this one shows up as containment in its target.
  for (const l of legos) {
    docs.push({ ownerOrdinal: l.ordinal, tokens: tokenizeTarget(l.target) });
  }

  // Inverted index: token → doc indices that contain it.
  const postings = new Map<string, number[]>();
  for (let d = 0; d < docs.length; d++) {
    const seen = new Set<string>();
    for (const t of docs[d].tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      let list = postings.get(t);
      if (!list) {
        list = [];
        postings.set(t, list);
      }
      list.push(d);
    }
  }

  const results: LegoCentrality[] = legos.map((lego) => {
    const needle = tokenizeTarget(lego.target);
    let forwardReuse = 0;
    if (needle.length > 0) {
      // Scan the rarest token's posting list; verify the full sequence there.
      let candidates: number[] | undefined;
      for (const t of needle) {
        const list = postings.get(t);
        if (!list) {
          candidates = [];
          break;
        }
        if (!candidates || list.length < candidates.length) candidates = list;
      }
      for (const d of candidates ?? []) {
        const doc = docs[d];
        if (doc.ownerOrdinal <= lego.ordinal) continue; // subsequent only
        // A later LEGO's own-target doc for THIS lego id can't occur (owner
        // ordinal equals lego ordinal → excluded above), so no self-count.
        if (needle.length === 1 || containsTokenSeq(doc.tokens, needle)) forwardReuse++;
      }
    }
    return { legoId: lego.legoId, ordinal: lego.ordinal, forwardReuse, percentile: 0 };
  });

  // Rank percentile, ties sharing (fraction of legos strictly below).
  const sorted = [...results].sort((a, b) => a.forwardReuse - b.forwardReuse);
  const n = sorted.length;
  const percentileByCount = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const c = sorted[i].forwardReuse;
    if (!percentileByCount.has(c)) {
      percentileByCount.set(c, n > 1 ? i / (n - 1) : 1);
    }
  }
  for (const r of results) {
    r.percentile = percentileByCount.get(r.forwardReuse) ?? 0;
  }

  return new Map(results.map((r) => [r.legoId, r]));
}
