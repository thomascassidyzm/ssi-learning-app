/**
 * What a person reads when a code could not be sent.
 *
 * A throttled send is not an accusation. Supabase's own refusal reads "For
 * security purposes, you can only request this after 47 seconds", and it lands
 * on someone whose only crime was tapping Resend because the first code had
 * not arrived yet. This is display only — the send is still refused, exactly
 * as before; only the sentence changes.
 */
import { classifyOtpError } from './loginCode'

export const CODE_ON_ITS_WAY =
  "We've sent a few codes to that address already, and the last one may still be on its way. Give it a couple of minutes, then try again."

export function friendlySendCodeError(message?: string | null): string {
  if (classifyOtpError(message) === 'rate_limited') return CODE_ON_ITS_WAY
  return message || 'Could not send your code'
}
