/**
 * What a person reads when a code could not be sent.
 *
 * A throttled send is not an accusation. Supabase's own refusal reads "For
 * security purposes, you can only request this after 47 seconds", and it lands
 * on someone whose only crime was tapping Resend because the first code had
 * not arrived yet. This is display only — the send is still refused, exactly
 * as before; only the sentence changes.
 *
 * BUT IT MUST NOT INVENT THE WAIT. It used to say "Give it a couple of
 * minutes" over limits of every length, including our own fifteen-minute
 * rolling window — so somebody who waited the promised couple of minutes was
 * refused again and concluded sign-in was broken. Our own route now sends the
 * real wait down with the 429 and it is shown verbatim; the only refusals that
 * reach this helper are Supabase's, so the number is taken from Supabase's own
 * words when it gives one, and simply not claimed when it does not.
 */
import { classifyOtpError } from './loginCode'

/** No number anywhere in the refusal — say what is true and stop. */
export const CODE_ON_ITS_WAY =
  "We've sent a few codes to that address already, and the last one may still be on its way. Look for that one — we can't send another just yet."

/** "after 47 seconds" / "after 2 seconds" — the only quantity Supabase ever hands us. */
function waitFromSupabase(message: string): string | null {
  const m = message.match(/after (\d+) seconds?/i)
  if (!m) return null
  const seconds = Number(m[1])
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  if (seconds <= 90) return `in about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`
  const minutes = Math.ceil(seconds / 60)
  return minutes <= 1 ? 'in about a minute' : `in about ${minutes} minutes`
}

export function friendlySendCodeError(message?: string | null): string {
  if (classifyOtpError(message) === 'rate_limited') {
    const wait = waitFromSupabase(message || '')
    if (wait) {
      return `We've sent a few codes to that address already, and the last one may still be on its way. Look for that one first — we can send another ${wait}.`
    }
    return CODE_ON_ITS_WAY
  }
  return message || 'Could not send your code'
}
