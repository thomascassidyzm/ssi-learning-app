/**
 * THE NAME A CYCLE ID CARRIES.
 *
 * A cycle id has to say WHICH PHRASE played, because that is what the class
 * brain reads back off the diary to draw the Course journey card. The name is
 * the phrase row's own id, minus the course: `cym_n_for_eng:S0042L03U05`
 * becomes `S0042L03_use_05`, which the id then carries ahead of what the cycle
 * is doing with the phrase — `S0042L03_use_05_review_7`.
 *
 * Counting rows to reconstruct that index is NOT a substitute: phrase ids have
 * gaps where rows were deleted (549 of deu_for_eng's 1,816 build/use rows sit
 * past one), and a reconstructed index then names a phrase the class never
 * heard. A row with no readable id gets no name, and the brain resolves the
 * cycle to nothing rather than to a wrong sentence.
 *
 * Twin of `phraseCycleId` in the player's walk, and the parser that reads it
 * back is `phraseIdFromCycleId` in `_utils/classBrain.ts`.
 */
export function phraseCycleName(phraseRowId: string | null | undefined): string | null {
  const m = /(S\d{4}L\d{2})(B|U)(\d{2})$/.exec(phraseRowId || '')
  return m ? `${m[1]}_${m[2] === 'U' ? 'use' : 'build'}_${m[3]}` : null
}
