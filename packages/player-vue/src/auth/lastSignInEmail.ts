/**
 * lastSignInEmail — the address this device last signed in with.
 *
 * Tom, 2026-09-09: "Most of the time we have support issues with people who
 * cannot remember which email they signed up with." Sign-in is a code to an
 * address and there are no passwords, so an empty box is the whole problem in
 * one control. The device already knows the answer; it just never says.
 *
 * ONLY the address. No token, no code, no session material of any kind — this
 * is the same string the person typed into the box themselves, on their own
 * device, kept so they do not have to type it again.
 *
 * NOT CLEARED ON SIGN-OUT, deliberately. Signing out is the moment a person is
 * most likely to need to be told which address they use, and a shared phone is
 * already served: the offered address is dismissed in one tap and a different
 * one typed straight over it. Clearing it would throw the answer away at
 * exactly the question. Anyone who wants it gone taps "Use a different
 * address", which forgets it here and now.
 */

const STORAGE_KEY = 'ssi-last-signin-email'

/** Remember the address a sign-in actually used on this device. */
export function rememberSignInEmail(email: string | null | undefined): void {
  const value = (email || '').trim().toLowerCase()
  // A link-auth placeholder is not an address anyone can be told to use.
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* storage blocked — the box is simply empty, which is today's behaviour */
  }
}

/** The address to offer on the sign-in screen, or null if there is none. */
export function readLastSignInEmail(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value && value.includes('@') ? value : null
  } catch {
    return null
  }
}

/** Forget it — the "use a different address" tap, and nothing else. */
export function forgetLastSignInEmail(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* nothing to forget */
  }
}
