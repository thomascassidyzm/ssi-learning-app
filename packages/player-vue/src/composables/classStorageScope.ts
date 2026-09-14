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
