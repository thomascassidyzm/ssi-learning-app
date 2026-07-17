/**
 * Tests for actAsGuard — the read-only write-rejection shared by every
 * ssi_admin support-bypass endpoint (class-teachers.ts,
 * create-class-join-code.ts, create-class-learner.ts). Guard is role-blind
 * by design (see actAsGuard.ts's docstring): the header alone is enough to
 * reject, regardless of which persona (teacher / school_admin / govt_admin
 * / student) the admin is currently viewing as — so one set of tests here
 * covers "write-while-impersonating rejected" for every entity level added
 * in this change, without re-deriving each endpoint's full auth mock.
 */
import { describe, it, expect } from 'vitest'
import type { VercelRequest } from '@vercel/node'
import { isViewAsRequest, rejectIfViewAs } from './actAsGuard'

function makeReq(headers: Record<string, string>): VercelRequest {
  return { headers } as any
}

describe('actAsGuard', () => {
  it('is false for a plain request with no view-as header', () => {
    expect(isViewAsRequest(makeReq({}))).toBe(false)
    expect(rejectIfViewAs(makeReq({}))).toBeNull()
  })

  it('rejects any write while the header is present, regardless of persona role', () => {
    for (const header of ['1']) {
      const req = makeReq({ 'x-ssi-view-as': header })
      expect(isViewAsRequest(req)).toBe(true)
      const rejection = rejectIfViewAs(req)
      expect(rejection).toEqual({ error: 'Read-only while viewing as another user', status: 403 })
    }
  })

  it('ignores any other value for the header (only the literal "1" counts)', () => {
    const req = makeReq({ 'x-ssi-view-as': 'true' })
    expect(isViewAsRequest(req)).toBe(false)
    expect(rejectIfViewAs(req)).toBeNull()
  })
})
