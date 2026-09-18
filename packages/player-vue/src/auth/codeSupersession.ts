/**
 * codeSupersession — the one fact about emailed codes every screen must say.
 *
 * Supabase Auth keeps ONE pending code per person. Asking for another — a
 * second tap on "Send my code", a tap on Resend — cancels the code already
 * sitting in the inbox. On a school mail estate the first mail lands late,
 * the teacher taps Resend while reading it, types the older six digits, and
 * is told "Token has expired or is invalid". Job #186 read this off
 * production on 2026-09-18: one Hwb head, eight code requests, five failed
 * verifies, eight days; Chepstow, five sends in ninety seconds. Nobody was
 * typing a wrong code. They were typing a superseded one.
 *
 * Tom's ruling, 2026-09-18: a superseded code is NAMED as superseded, and
 * Resend carries a short cooldown that says the previous code stops working.
 *
 * Three pieces, written once and used by every code screen (SchoolsContainer,
 * Onboarding, SignInModal, MailboxBanner):
 *   · RESEND_COOLDOWN_MS — how long Resend stays down after any send;
 *   · supersessionNotice — the sentence beside Resend, stating the consequence;
 *   · friendlyVerifyCodeError — what a failed verify says, with supersession
 *     named first, because it is the usual truth.
 */
import { classifyOtpError } from './loginCode'

/** Long enough that a mail delayed by a gateway can land before a second
 *  request kills it; short enough that a genuinely lost code is not a wait. */
export const RESEND_COOLDOWN_MS = 60_000

/** The consequence, stated before the tap. Shown under every Resend. */
export const SUPERSESSION_NOTICE =
  'Only the newest code works. Asking for another one cancels the code already on its way — so if an email is still coming, wait for it first.'

/** What Resend reads while it is cooling down. */
export function resendCountdownLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Send a fresh code in ${secondsLeft}s` : 'Send a fresh code'
}

/**
 * The failed-verify sentence. Supabase's one generic message covers wrong,
 * expired and superseded alike, so this names the likeliest cause first and
 * gives the way on. Rate limits and network faults keep their own words.
 */
export function friendlyVerifyCodeError(message?: string | null, opts: { resends?: number } = {}): string {
  const kind = classifyOtpError(message)
  if (kind === 'rate_limited') {
    return 'Too many tries just now. Give it a minute, then use the newest code you were sent.'
  }
  if (kind === 'network') {
    return 'We could not reach the sign-in service. Check your connection and try that code again.'
  }
  if ((opts.resends ?? 0) > 0) {
    return "That code has been replaced. You asked for more than one, and only the newest works — check for the latest email and type that one. If it still fails, send a fresh code and use that."
  }
  return "That code didn't work. If you asked for a code more than once, only the newest one works — older ones stop the moment a new one is sent. Check for the latest email, or send a fresh code and use that."
}
