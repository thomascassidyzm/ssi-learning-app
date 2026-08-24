/**
 * classDetailPanels — what each panel on the class-detail page is allowed to
 * SAY, given what actually happened to its own fetch.
 *
 * The class page draws from several independent sources (the class row, the
 * roster view, the class_teachers view). Before 2026-08-07 one failure blanked
 * the lot and the page then asserted things nobody had observed: "no teachers
 * are linked to this class" about a class with two teachers, and an invite link
 * with no code in it. These functions keep the three states apart — pending,
 * failed, observed-empty — so a panel can never claim the third when it is in
 * the first two.
 */

import { redeemLink, displayableCode } from '@/composables/schools/inviteLink'

export type PanelState = 'loading' | 'error' | 'empty' | 'ready'

/**
 * The TEACHERS panel. `empty` — the only state that renders "no teachers are
 * linked to this class yet" — requires a resolved, error-free read.
 */
export function teacherPanelState(input: {
  count: number
  loaded: boolean
  error: string | null
}): PanelState {
  if (input.count > 0) return 'ready'
  if (input.error) return 'error'
  if (!input.loaded) return 'loading'
  return 'empty'
}

/**
 * The INVITE STUDENTS panel. A link is offered only when the code is genuinely
 * present; otherwise the panel says why it is holding back and offers nothing
 * copyable.
 */
export function joinPanelState(input: {
  joinCode: string | null | undefined
  loading: boolean
  error: string | null
  origin?: string
}): { state: PanelState; url: string | null; code: string | null } {
  const code = displayableCode(input.joinCode)
  const url = input.origin === undefined ? redeemLink(code) : redeemLink(code, input.origin)
  if (code && url) return { state: 'ready', url, code }
  if (input.error) return { state: 'error', url: null, code: null }
  if (input.loading) return { state: 'loading', url: null, code: null }
  // Resolved, no error, still no code: the class genuinely has no join code.
  return { state: 'empty', url: null, code: null }
}
