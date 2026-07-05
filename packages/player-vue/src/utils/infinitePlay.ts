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
