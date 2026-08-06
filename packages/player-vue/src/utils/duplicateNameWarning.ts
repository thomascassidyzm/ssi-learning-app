/**
 * duplicateNameWarning — the client half of the duplicate-name warning at org
 * creation.
 *
 * The API answers a colliding create with 409 and a machine-readable body
 * carrying `code: 'duplicate_name'` and the colliding orgs. That is NOT an
 * error to surface raw: it's information the creator has to act on, so the
 * caller shows a warning with two ways out — change the name, or go ahead
 * anyway, which re-sends the same request with `confirm_duplicate: true`.
 *
 * The `code` is what distinguishes this 409 from the OTHER 409 the same
 * endpoint can return, "You already lead a group — one organisation per leader
 * for now", which is a genuine dead end and keeps behaving exactly as it does.
 *
 * Deborah made two orgs both called "Deborah Testing" and nothing told her.
 * Legitimate duplicates are still allowed — a human just has to say so once.
 */

export interface DuplicateInfo {
  name?: string
  created_at?: string | null
}

/** "5 August 2026" — British, no ordinal suffix, empty string when unknown. */
export function formatCreatedOn(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * The warning sentence. Reads as information, not an accusation, and names
 * the thing the creator needs in order to decide: which org already exists and
 * when it was made.
 */
export function duplicateWarningMessage(
  duplicates: DuplicateInfo[] | undefined,
  noun = 'organisation',
): string {
  const first = duplicates?.[0]
  const name = first?.name || ''
  const on = formatCreatedOn(first?.created_at)
  const when = on ? `, created on ${on}` : ''
  const article = noun === 'organisation' ? 'an' : 'a'
  return `There's already ${article} ${noun} called "${name}"${when}. Creating this one will give you two with the same name.`
}

/**
 * Reads a fetch response body and says whether it is the duplicate-name
 * warning. Returns null for every other outcome, including the one-org-per-
 * leader 409, so callers keep their existing error handling untouched.
 */
export function readDuplicateWarning(
  status: number,
  body: unknown,
  noun = 'organisation',
): { message: string; duplicates: DuplicateInfo[] } | null {
  if (status !== 409) return null
  const data = body as { code?: string; duplicates?: DuplicateInfo[] } | null
  if (!data || data.code !== 'duplicate_name') return null
  const duplicates = Array.isArray(data.duplicates) ? data.duplicates : []
  return { message: duplicateWarningMessage(duplicates, noun), duplicates }
}
