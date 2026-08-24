/**
 * SEC-AUDIT-2026-08-18 · Finding 6 — "read-only while viewing as" is an
 * advisory control, not a boundary.
 *
 * This one is a CHARACTERISATION test: it PASSES, and what it pins down is the
 * limit of the control rather than a bug in it.
 *
 * rejectIfViewAs() decides whether a request is a read-only view-as request by
 * reading `X-Ssi-View-As: 1` — a header the client chooses to send. The guard's
 * own docstring is straight about this ("The client sets the X-Ssi-View-As: 1
 * header on every request made while isActingAs is true"), and for its stated
 * purpose the choice is sound: it exists to stop an admin's ssi_admin support
 * bypass firing by ACCIDENT while they browse as a persona, and an honest
 * client always sends it.
 *
 * What it cannot do is bind an admin who does not want to be bound: omit the
 * header and the support bypasses in class-teachers.ts /
 * create-class-join-code.ts / create-class-learner.ts fire normally. That
 * matters because api/admin/view-as.ts describes its audit rows as "THIS IS
 * the GDPR legitimate-interest compliance record" for view-as sessions. The
 * record says read-only; the server cannot prove read-only.
 *
 * The fix, if the compliance claim is to be load-bearing, is server-side
 * session state (a view-as session opened by api/admin/view-as.ts 'start' and
 * closed by 'end', consulted by the bypass endpoints) rather than a header —
 * then the audit row and the enforcement read from the same fact.
 *
 * Recorded as a finding so the gap is written down, not because the guard is
 * misbehaving. No production behaviour is changed by this file.
 */
import { describe, it, expect } from 'vitest'
import { isViewAsRequest, rejectIfViewAs } from './actAsGuard'

const req = (headers: Record<string, unknown>) => ({ headers } as any)

describe('SEC-AUDIT Finding 6 — view-as read-only guard is header-advisory', () => {
  it('rejects when the client declares itself to be viewing as', () => {
    expect(isViewAsRequest(req({ 'x-ssi-view-as': '1' }))).toBe(true)
    expect(rejectIfViewAs(req({ 'x-ssi-view-as': '1' }))).toEqual({
      error: 'Read-only while viewing as another user',
      status: 403,
    })
  })

  it('has nothing to reject on when the client simply omits the header', () => {
    // The whole finding, in one assertion: an identical admin session that
    // does not volunteer the header is indistinguishable from one that is not
    // impersonating at all, so the support bypasses stay open.
    expect(rejectIfViewAs(req({}))).toBeNull()
    expect(isViewAsRequest(req({}))).toBe(false)
  })

  it('is defeated by a value the client controls, not just by absence', () => {
    // Any value other than exactly '1' — including the truthy-looking ones —
    // reads as "not viewing as".
    for (const v of ['0', 'true', 1, '01', ' 1', ['1']]) {
      expect(rejectIfViewAs(req({ 'x-ssi-view-as': v }))).toBeNull()
    }
  })
})
