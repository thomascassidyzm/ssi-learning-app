import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * True iff no is_new LEGO remains beyond the given cursor LEGO id — i.e.
 * the learner belongs in infinite-play.
 *
 * Cursor-only model (2026-07-04): infinite-play is DERIVED from the
 * cursor's position among the course's is_new LEGOs, not read from a
 * separate ratcheted ceiling column or a stored current_mode flag.
 * Infplay entry (explicit ∞ tap or auto-entry) always stamps the cursor
 * to the course's final LEGO, so this predicate agrees with belt-skipped
 * entries too, not just natural progression through every belt.
 * Lexicographic comparison works because lego_id is the zero-padded
 * SNNNNLNN format.
 */
export async function hasReachedInfinitePlay(
  cursorLegoId: string | null,
  courseCode: string,
  supabaseClient: SupabaseClient | null | undefined,
): Promise<boolean> {
  if (!cursorLegoId || !supabaseClient || !courseCode) return false
  try {
    const { data, error } = await supabaseClient
      .from('course_legos')
      .select('lego_id')
      .eq('course_code', courseCode)
      .eq('is_new', true)
      .gt('lego_id', cursorLegoId)
      .limit(1)
    if (error) {
      console.warn('[hasReachedInfinitePlay] query failed:', error)
      return false
    }
    return (data?.length ?? 0) === 0
  } catch (err) {
    console.warn('[hasReachedInfinitePlay] threw:', err)
    return false
  }
}

/**
 * The complete auto-entry gate: may this round move the learner into INF PLAY?
 *
 * Auto-entry is not cosmetic — it stamps the cursor to the course's FINAL LEGO,
 * so a wrong "yes" silently relocates the learner to the end of their course and
 * survives every future boot. Three things must ALL hold, and they are ordered
 * cheapest-first so the expensive one only runs when it can matter:
 *
 * 1. SHAPE PROPOSES. The round carries no intro/debut/build cycle. Necessary,
 *    never sufficient — a mid-round resume, a mode that selects the builds out,
 *    or a partial /cycles payload all produce the same shape.
 * 2. THE SESSION IS NOT DEGRADED. When content fetching is failing, the only
 *    rounds we can build come from the cache, and the cache holds only material
 *    already covered. Review-only shape then means "we could not reach anything",
 *    which is CONSOLIDATING — its own state — and says nothing whatever about
 *    whether new content exists. Tom, 2026-08-31.
 * 3. THE COURSE'S CONTENT AGREES. No is_new LEGO remains beyond the cursor.
 *    A failed or unanswerable check returns false and we stay in main, which is
 *    the safe direction: a genuine INF PLAY learner simply re-enters on their
 *    next completed round.
 */
export function roundShapeSuggestsInfinitePlay(
  round: { cycles?: Array<{ type?: string }> } | null | undefined,
): boolean {
  const cycles = round?.cycles
  if (!cycles?.length) return false
  return !cycles.some((c) => c?.type === 'intro' || c?.type === 'debut' || c?.type === 'build')
}

export async function shouldAutoEnterInfinitePlay(args: {
  round: { cycles?: Array<{ type?: string }> } | null | undefined
  contentFetchingDegraded: boolean
  cursorLegoId: string | null
  courseCode: string
  supabaseClient: SupabaseClient | null | undefined
}): Promise<boolean> {
  if (!roundShapeSuggestsInfinitePlay(args.round)) return false
  if (args.contentFetchingDegraded) return false
  return hasReachedInfinitePlay(args.cursorLegoId, args.courseCode, args.supabaseClient)
}
