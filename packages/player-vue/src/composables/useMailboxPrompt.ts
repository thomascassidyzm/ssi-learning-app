/**
 * useMailboxPrompt — the one place that decides whether we ask a teacher to
 * prove their mailbox reaches them, and the one place that remembers they said
 * no.
 *
 * WHY THIS EXISTS AT ALL. A school or teacher account is minted immediately
 * and proved later, on purpose: school mail gateways quarantine our codes, so
 * making a teacher wait on an email before they can do anything would lose
 * most of them at the door (api/auth/possession-redeem.ts). The cost is that
 * nothing has ever established that the address they typed can receive our
 * mail. The risk that matters is not paperwork — it is sending something about
 * their learners to a mailbox that is not theirs.
 *
 * THE SHAPE, and every part of it is deliberate:
 *   · We ask AT A MOMENT, never as a standing badge. The moment is when they
 *     have just done something they would hate to lose — created a class,
 *     copied the link they are about to send to learners. "Make sure you can
 *     always get back to this" is only true right then; every other time it is
 *     administrative noise. SettingsScreen.vue keeps its own standing row —
 *     that is a different surface for somebody already in a settings mood, and
 *     it is not this.
 *   · At most ONCE PER SESSION. Three classes created in a row is one prompt,
 *     not three.
 *   · Dismissal is DURABLE and FINAL. No timer, no counter, no "we'll ask
 *     again in a week". A nag that cannot be closed gets clicked past, and one
 *     that returns after being closed is worse than one that waits and asks
 *     better later.
 *   · The only other way it stops is the predicate going false, which happens
 *     the moment the mailbox is genuinely proved — here, in Settings, or
 *     anywhere else.
 */
import { computed, inject, ref, type ComputedRef } from 'vue'

/**
 * The unproven-mailbox predicate, lifted out of SettingsScreen.vue so it is
 * written once. `onboarded_via` is stamped by api/auth/possession-redeem.ts;
 * `email_confirmed_manually` is set by api/email/verify.ts and ONLY on a
 * completed OTP round trip for the account's own primary address —
 * verified_emails cannot stand in for it, because useAuth.ts back-fills the
 * session's own email into that list on every load.
 */
export function isMailboxUnproven(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false
  return metadata.onboarded_via === 'possession' && metadata.email_confirmed_manually !== true
}

/** Per-account, so a shared browser never inherits somebody else's answer. */
export function dismissalStorageKey(authUserId: string): string {
  return `ssi-mailbox-prompt-dismissed:${authUserId}`
}

/**
 * The whole decision, as one pure function, so the rule can be tested without
 * a browser, a session or a mounted component.
 */
export function shouldShowMailboxPrompt(state: {
  metadata: Record<string, unknown> | null | undefined
  dismissed: boolean
  shownThisSession: boolean
  momentReached: boolean
}): boolean {
  if (!state.momentReached) return false
  if (state.shownThisSession) return false
  if (state.dismissed) return false
  return isMailboxUnproven(state.metadata)
}

/**
 * Session-scoped, module-level on purpose: the cap is per browsing session and
 * must hold across every view that can raise the moment, not per component.
 */
let shownThisSession = false

/** Test seam — forget that this session has already asked. */
export function __resetMailboxPromptSession(): void {
  shownThisSession = false
}

function readDismissed(authUserId: string): boolean {
  if (!authUserId) return false
  try {
    return localStorage.getItem(dismissalStorageKey(authUserId)) === '1'
  } catch {
    // Private mode, blocked storage. Erring towards showing it once is kinder
    // than erring towards a prompt that can never be closed.
    return false
  }
}

export interface MailboxPrompt {
  /** True while the prompt should be on screen. */
  isOpen: ComputedRef<boolean>
  /** The address the account is currently reachable at, if any. */
  primaryEmail: ComputedRef<string>
  /** Call after a keep-worthy act has landed. Opens the prompt, or does nothing. */
  noteKeepWorthyMoment: () => void
  /** They closed it. Durable, per account, and final. */
  dismiss: () => void
  /** They proved a mailbox. Closes it and never asks again on this browser. */
  markProved: () => void
}

export function useMailboxPrompt(): MailboxPrompt {
  const auth = inject<any>('auth', null)
  const open = ref(false)

  const authUserId = computed<string>(() => auth?.user?.value?.id || '')
  const metadata = computed(() => auth?.user?.value?.user_metadata ?? null)
  const primaryEmail = computed<string>(() => auth?.user?.value?.email || '')

  function noteKeepWorthyMoment() {
    const show = shouldShowMailboxPrompt({
      metadata: metadata.value,
      dismissed: readDismissed(authUserId.value),
      shownThisSession,
      momentReached: true,
    })
    if (!show) return
    shownThisSession = true
    open.value = true
  }

  function remember() {
    try {
      if (authUserId.value) localStorage.setItem(dismissalStorageKey(authUserId.value), '1')
    } catch {
      /* blocked storage — the session cap still stops a second ask today */
    }
  }

  function dismiss() {
    open.value = false
    remember()
  }

  /**
   * Proving a DIFFERENT address does not flip the account's own predicate —
   * api/email/verify.ts only sets email_confirmed_manually for the primary. So
   * record it here too: they have told us a mailbox that reaches them and we
   * are holding it, and asking again would be exactly the nag we promised not
   * to be.
   */
  function markProved() {
    open.value = false
    remember()
  }

  return {
    isOpen: computed(() => open.value),
    primaryEmail,
    noteKeepWorthyMoment,
    dismiss,
    markProved,
  }
}
