/**
 * The device-storage scope for a play-as-class session.
 *
 * The player keeps three device caches keyed by course alone — the resume
 * position (`ssi_learning_position_<course>`), the belt cursor
 * (`ssi_belt_progress_<course>`) and the Easy/Fast mode (`ssi-learning-mode`).
 * A class is its own learner (owner ruling 2026-07-16), but on the SAME course
 * as the teacher those keys were shared, so a class session's belt skip, mode
 * toggle and position were read back as the teacher's own the moment they
 * played as themselves — and then written into the teacher's enrollment row
 * and learner preferences from that poisoned cache (staging, 2026-09-14
 * 21:35Z, job #742). Every class-mode device key carries this suffix; a
 * self-practice key carries none, so no existing learner's cache moves.
 *
 * Scoped by the CLASS id, not the class learner id: the id exists from the
 * moment the class does, whereas the class learner is minted lazily.
 */
export function classStorageScope(classContext: { id?: string | null } | null | undefined): string {
  return classContext?.id ? `:class:${classContext.id}` : ''
}

/**
 * The device-storage scope for ANY play session — the account-level extension
 * of `classStorageScope`.
 *
 * The class suffix above fixed teacher-vs-their-own-class on one course. It
 * did NOT fix the more general case, which was live in production on
 * 2026-09-15: the keys still carried no ACCOUNT, so every account sharing a
 * school browser shared one resume position and one belt. Class 9AWI, whose
 * own cursor was `S0001L01`, booted at seed 8 and stamped a YELLOW belt on
 * its cold_start; six minutes later its teacher's own account booted to the
 * identical round 13 on the same device. 54 production cold starts in three
 * days contradicted themselves about the belt.
 *
 * Two rules, both load-bearing:
 * - the scope carries the LEARNER the session plays as (the class learner in
 *   class mode, the account's own learner id otherwise), so one device's
 *   caches can never be read by a different account;
 * - it is NULL while that identity is unknown — `staffLearnerId` falls back to
 *   the literal `'demo-learner'` before auth resolves, and a class learner is
 *   minted lazily. A null scope means DO NOT TOUCH the device cache at all:
 *   the account's own server cursor is the source of truth, and caching under
 *   a placeholder every account shares is exactly the bug.
 */
export function deviceStorageScope(
  classContext: { id?: string | null; class_learner_id?: string | null } | null | undefined,
  learnerId: string | null | undefined,
): string | null {
  if (classContext?.id) {
    // Play-as-class caches belong to the CLASS, whichever teacher is driving.
    // Before its learner is minted there is no identity to key on — and
    // borrowing the driving teacher's is the leak this closes.
    const classLearnerId = classContext.class_learner_id
    if (!classLearnerId) return null
    return `${classStorageScope(classContext)}:u:${classLearnerId}`
  }
  if (!learnerId || learnerId === 'demo-learner') return null
  return `:u:${learnerId}`
}
