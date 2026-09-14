/**
 * ownPlayBanner — "You are now playing as yourself. If you want to play as
 * class please go here." (Tom, 2026-09-14 13:07Z, job #662.)
 *
 * A TEACHER account on the standalone learner player is playing on her own
 * learner account, and the lesson will not count for a class. The dashboard
 * navigation is not present on that player, by design (owner ruling
 * 2026-08-06: self-practice lands on the navless player), so the warning
 * sits across the top of the player itself — the one place the mistake
 * happens — in Tom's words, linking to her classes. Persistent while she is
 * there; never under a class context (that IS play as class), never inside
 * the schools shell's embedded player, never for anyone but a teacher.
 */
export interface OwnPlayBannerInput {
  /** The EFFECTIVE educational role from the role cache (the persona's under View-as). */
  role: string | null | undefined
  /** A play-as-class context is active. */
  hasClassContext: boolean
  /** The player is embedded in a management shell that carries its own nav. */
  embedded: boolean
}

export const OWN_PLAY_BANNER_LINK = '/schools'

export function showOwnPlayBanner(input: OwnPlayBannerInput): boolean {
  return input.role === 'teacher' && !input.hasClassContext && !input.embedded
}
