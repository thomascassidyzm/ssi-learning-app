/**
 * useManagerOnboarding — the two beats an organisation manager owes us before
 * they have built anything they could lose.
 *
 * WHY THIS EXISTS (Deborah, testing the org lane, 2026-08-06): a manager
 * arrives by magic link, lands in their organisation, and simply stays signed
 * in. They never set a password — so the day that session dies (new laptop,
 * cleared storage, a phone reset) there is no way back into the organisation
 * they just built. Tom's ruling, verbatim: "Password before adding a group or
 * a learner? and then once they've done that, a context aware install as PWA,
 * on a desktop likely to be a chrome app".
 *
 * Two beats, deliberately different in kind:
 *   1. PASSWORD — a GATE. It blocks the first "add a group" / "add a learner"
 *      and has no skip. That is the whole point of it.
 *   2. INSTALL — a PROMPT. Dismissible, never blocking, never nagging. A
 *      manager who says "not now" carries straight on.
 *
 * The password predicate reads `user_metadata.has_password`, the same flag
 * SettingsScreen reads and useAuth's updatePassword writes. HONEST CAVEAT:
 * that flag is only ever set by OUR updatePassword call, so an older account
 * with a real password set some other way reads as passwordless. We treat a
 * missing flag as "no password" — the safe direction, because the worst case
 * is a manager setting a password they already had, whereas the other
 * direction locks someone out for real. There is no server-side signal for
 * "this auth user has a password" exposed to the client; Supabase does not
 * surface one on the session user, so the metadata flag is the honest best
 * available and this is a known limitation, not an oversight.
 */

import { computed, ref, type Ref } from 'vue'

/** Anything shaped like the Supabase session user we need to read. */
export interface UserLike {
  id?: string
  user_metadata?: Record<string, unknown> | null
}

/** Shared with SettingsScreen — 6 characters, matching that form exactly. */
export const MIN_PASSWORD_LENGTH = 6

/**
 * Does this account have a password we know about?
 * Missing flag → false (the safe direction — see the caveat above).
 */
export function hasPasswordFlag(user: UserLike | null | undefined): boolean {
  return user?.user_metadata?.has_password === true
}

/** Per-user so a shared device doesn't silence the nudge for the next person. */
export function installDismissKey(userId: string | null | undefined): string {
  return `ssi-org-install-dismissed:${userId || 'anon'}`
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function safeStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage) return storage
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    // Private mode / blocked storage — a nudge is not worth throwing over.
    return null
  }
}

export function isInstallDismissed(
  userId: string | null | undefined,
  storage?: StorageLike | null,
): boolean {
  const s = safeStorage(storage)
  if (!s) return false
  try {
    return !!s.getItem(installDismissKey(userId))
  } catch {
    return false
  }
}

export function dismissInstall(
  userId: string | null | undefined,
  storage?: StorageLike | null,
  stamp = String(Date.now()),
): void {
  const s = safeStorage(storage)
  if (!s) return
  try {
    s.setItem(installDismissKey(userId), stamp)
  } catch {
    // Nudge state is not worth throwing over.
  }
}

export interface InstallPromptInput {
  userId?: string | null
  /** Already running as an installed app — nothing left to ask for. */
  standalone: boolean
  /** Already said "not now" once. */
  dismissed: boolean
}

/** Never show it if it is already true, and never show it twice. */
export function shouldPromptInstall({ standalone, dismissed }: InstallPromptInput): boolean {
  return !standalone && !dismissed
}

export interface GateInput {
  /** On the member mount — a leader looking at their own subtree. */
  member: boolean
  /** Server-verified: leads a group of type 'organisation' (useOrgLeadership). */
  leadsOrg: boolean
  /** Reads has_password. */
  hasPassword: boolean
}

/**
 * The whole gate decision, in one pure function.
 *
 * `leadsOrg` is what keeps this out of the schools lane: it comes from the
 * caller's own govt_admins leader row and the TYPE of the group it points at
 * (useOrgLeadership), so a school admin — whose leader row points at a region
 * or a programme, or who has none — is never gated, even though /org/:id can
 * render a school node on the same member mount.
 */
export function needsPasswordGate({ member, leadsOrg, hasPassword }: GateInput): boolean {
  return member && leadsOrg && !hasPassword
}

/** Validation, shared with SettingsScreen's rules so the two cannot diverge. */
export function validatePassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
  }
  if (password !== confirm) return 'Passwords do not match'
  return null
}

/**
 * Reactive wrapper for the component. Takes the auth user ref so the caller
 * owns the injection and this stays trivially testable.
 */
export function useManagerOnboarding(user: Ref<UserLike | null | undefined>) {
  const hasPassword = computed(() => hasPasswordFlag(user.value))
  const userId = computed(() => user.value?.id ?? null)
  const dismissed = ref(isInstallDismissed(userId.value))

  function markInstallDismissed(): void {
    dismissInstall(userId.value)
    dismissed.value = true
  }

  return { hasPassword, userId, dismissed, markInstallDismissed }
}
