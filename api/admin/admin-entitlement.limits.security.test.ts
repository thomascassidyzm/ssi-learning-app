/**
 * Security audit 2026-08-11 — area 4 (admin-entitlement).
 * See docs/security-audit-2026-08-11/admin-entitlement.md
 *
 * The remaining findings, which are all about a limit that is asserted
 * somewhere but enforced nowhere (or enforced against the wrong key):
 *   ADMIN-ENT-05 — schools.teacher_seats has no server-side enforcement.
 *   ADMIN-ENT-06 — the rate limiter keys on a client-prependable header.
 *   ADMIN-ENT-09 — invite/create persists grant fields it never authorised.
 *   ADMIN-ENT-10 — max_uses is unenforceable on personal links.
 *   ADMIN-ENT-11 — offline leases are unsigned.
 *
 * Several of these are checked by reading the shipped source rather than by
 * driving the handler: the finding IS an absence, and an absence is what a
 * source scan can honestly demonstrate. Each such test says so.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(API, rel), 'utf8')

describe('ADMIN-ENT-05 — teacher_seats is never enforced', () => {
  // SECURITY FINDING ADMIN-ENT-05: schools.teacher_seats is written by the
  // Paddle webhook (paddle-webhook.ts:489) and by school/update-seats.ts:167,
  // and read for DISPLAY, but no join path compares a teacher count against it.
  // A school paying for one seat can onboard unlimited teachers via its join
  // code. SHOULD BE: gate the teacher-tagging paths on the current staff count
  // (api/_utils/schoolTeachers.ts:91 already computes it) the way
  // api/family/invite.ts:77 gates the family cap.
  //
  // Absence check: these are every server path that grants a teacher a school
  // seat. None of them mentions teacher_seats.
  const JOIN_PATHS = [
    'code/redeem.ts',
    '_utils/schoolStaff.ts',
    '_utils/schoolTeachers.ts',
    'teacher/class-teachers.ts',
    'teacher/create-class-learner.ts',
  ]

  for (const path of JOIN_PATHS) {
    it(`ADMIN-ENT-05: ${path} grants seats without consulting teacher_seats`, () => {
      expect(read(path)).not.toContain('teacher_seats')
    })
  }

  it('ADMIN-ENT-05: the teacher-tag insert in redeem.ts is unconditional', () => {
    const src = read('code/redeem.ts')
    const branch = src.slice(src.indexOf("} else if (codeType === 'teacher') {"))
    const insertAt = branch.indexOf("await supabase.from('user_tags').insert(tag)")
    expect(insertAt).toBeGreaterThan(-1)
    // Nothing between entering the branch and writing the tag looks at capacity.
    // Comments are stripped first — the prose there does say "seat", but no code
    // reads one. (The branch's only refusal is the degenerate-grant guard: a
    // code scoped to no school and no class.)
    const codeOnly = branch
      .slice(0, insertAt)
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    expect(codeOnly).not.toMatch(/teacher_seats|capacity|isFull|atCapacity/i)
  })

  it.todo(
    'ADMIN-ENT-05: teacher-join paths should refuse once the school is at teacher_seats, mirroring the family seat cap',
  )

  // CONTROL: the family plan proves the pattern exists and works.
  it('CONTROL: the family seat cap IS enforced server-side', () => {
    expect(read('family/invite.ts')).toContain('FAMILY_SEAT_CAP')
    expect(read('family/invite.ts')).toContain('Family is full')
    expect(read('family/create-child.ts')).toContain('FAMILY_SEAT_CAP')
  })
})

describe('ADMIN-ENT-06 — rate-limit IP comes from an untrusted header', () => {
  // The limiter's own helper, reproduced. UNVERIFIED whether Vercel overwrites
  // x-forwarded-for; if it appends, this is a full bypass of the only brake on
  // the 23.7-bit code keyspace (ADMIN-ENT-03).
  function getClientIp(headers: Record<string, string | undefined>): string {
    return (
      (headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (headers['x-real-ip'] as string) ||
      'unknown'
    )
  }

  it('CONTROL: the helper in api/code/validate.ts is exactly this shape', () => {
    const src = read('code/validate.ts')
    expect(src).toContain("(req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()")
  })

  // SECURITY FINDING ADMIN-ENT-06: split(',')[0] is the LEFT-most entry, which
  // by XFF convention is the value the client supplied. A prepended value wins
  // over the real client address, so each request can present a fresh "IP" and
  // the per-IP throttle never accumulates.
  // SHOULD BE: key on x-vercel-forwarded-for (platform-set, unspoofable) or the
  // right-most XFF entry. Nothing in api/ reads x-vercel-forwarded-for today.
  it('ADMIN-ENT-06: a prepended XFF entry wins over the real client address', () => {
    const spoofed = getClientIp({ 'x-forwarded-for': '10.0.0.1, 203.0.113.9' })
    expect(spoofed).toBe('10.0.0.1') // attacker value, not the real 203.0.113.9
    // ...and a different prepended value yields a different throttle bucket.
    expect(getClientIp({ 'x-forwarded-for': '10.0.0.2, 203.0.113.9' })).toBe('10.0.0.2')
  })

  it('ADMIN-ENT-06: no endpoint uses the platform-set x-vercel-forwarded-for', () => {
    for (const path of ['code/validate.ts', 'auth/possession-redeem.ts', 'try-link/validate.ts']) {
      expect(read(path)).not.toContain('x-vercel-forwarded-for')
    }
  })

  it.todo(
    'ADMIN-ENT-06: rate limiters should key on x-vercel-forwarded-for (or the right-most XFF entry), not the client-supplied left-most one',
  )

  // CONTROL: the throttle itself exists and hashes IPs rather than storing them.
  it('CONTROL: the code-validation throttle exists and stores only hashed IPs', () => {
    const src = read('code/validate.ts')
    expect(src).toContain('const PER_IP_LIMIT = 10')
    expect(src).toContain('const RATE_WINDOW_MS = 15 * 60 * 1000')
    expect(src).toContain("createHash('sha256')")
    // The limit must be checked BEFORE any code lookup, or it is an oracle.
    expect(src.indexOf('PER_IP_LIMIT')).toBeLessThan(src.indexOf('invite_code_validation'))
  })
})

describe('ADMIN-ENT-09 — invite/create persists unauthorised grant fields', () => {
  const src = read('invite/create.ts')

  // CONTROL: the fields that MATTER are server-derived, and the file says so.
  it('CONTROL: a govt_admin caller cannot choose the group a school_admin code grants', () => {
    expect(src).toContain('derivedGrantsGroupId = (govtAdmin as any).group_id ?? null')
    expect(src).toContain('insertData.grants_group_id = derivedGrantsGroupId ?? null')
  })

  it("CONTROL: a class-scoped teacher code's school is read off the class, not the payload", () => {
    expect(src).toContain('derivedGrantsSchoolId = classRow.school_id ?? null')
    expect(src).toContain('insertData.grants_school_id = derivedGrantsSchoolId')
  })

  it('CONTROL: a teacher code with no class must name a school the caller administers', () => {
    expect(src).toContain("res.status(403).json({ error: 'Only the school admin can create teacher codes for this school' })")
    expect(src).toContain(".eq('admin_user_id', userId)")
  })

  // SECURITY FINDING ADMIN-ENT-09: these three assignments run for EVERY
  // code_type, including ones whose authorization branch never validated them.
  // Inert today — redemption only honours a group grant when neither school nor
  // class is set (api/code/redeem.ts:612), and a school_admin code creates a new
  // school rather than attaching to a named one (:486) — so a smuggled value can
  // never be the one that fires. It is a stored assertion of an unauthorised
  // grant, live the moment any reader drops that precondition.
  // SHOULD BE: assemble the grant columns inside each code_type branch.
  it('ADMIN-ENT-09: grants_region / grants_class_id are copied from the body for any code_type', () => {
    expect(src).toContain('if (grants_region !== undefined) insertData.grants_region = grants_region')
    expect(src).toContain('if (grants_class_id !== undefined) insertData.grants_class_id = grants_class_id')
  })

  it('ADMIN-ENT-09: the containment that makes it inert is the redemption precondition', () => {
    const redeem = read('code/redeem.ts')
    // If this precondition is ever relaxed, ADMIN-ENT-09 becomes live.
    expect(redeem).toContain(
      'if (inviteRow.grants_group_id && !inviteRow.grants_school_id && !inviteRow.grants_class_id) {',
    )
  })

  it.todo(
    'ADMIN-ENT-09: invite/create should persist only the grant columns the caller was actually authorised for',
  )
})

describe('ADMIN-ENT-10 — max_uses is unenforceable on personal links', () => {
  const src = read('_utils/personalLinkUses.ts')

  // SECURITY FINDING ADMIN-ENT-10: a personal link never reaches the one place
  // that increments use_count, so max_uses (which is enforced against
  // use_count) can never bind. The module documents this as deliberate, and the
  // reasoning is sound — incrementing would lock the bound recipient out of
  // their own account on a second click. The residual problem is that max_uses
  // is still REPORTED for these rows, so an operator can believe they set a cap
  // that does not exist.
  // SHOULD BE: suppress `max` for kind:'signin', or enforce a real bound using
  // the possession_mint_attempts tally this module already computes.
  it("ADMIN-ENT-10: a personal link reports a max it cannot enforce", async () => {
    const { usesForLink } = await import('../_utils/personalLinkUses')
    const row = { id: 'code-1', use_count: 0, max_uses: 1 }
    const payload = usesForLink(row, true, new Map([['code-1', { count: 7, lastAt: '2026-08-10T00:00:00Z' }]]))

    expect(payload.kind).toBe('signin')
    // Seven sign-ins against a max of one — the cap is advisory only.
    expect(payload.count).toBe(7)
    expect(payload.max).toBe(1)
  })

  it('ADMIN-ENT-10: the design decision is recorded in the source, not accidental', () => {
    expect(src).toContain('WHAT WE DELIBERATELY DO NOT DO')
    expect(src).toContain('repeatable-until-revoked by design')
  })

  it.todo(
    "ADMIN-ENT-10: a personal link should not report a max_uses it cannot enforce (or should enforce one from the possession_mint_attempts tally)",
  )

  it('CONTROL: a shareable link still reports its real, enforced use_count', async () => {
    const { usesForLink } = await import('../_utils/personalLinkUses')
    const payload = usesForLink({ id: 'c2', use_count: 3, max_uses: 10 }, false, new Map())
    expect(payload).toEqual({ count: 3, max: 10, kind: 'redemption', lastAt: null })
  })
})

describe('ADMIN-ENT-11 — offline leases are unsigned', () => {
  const src = read('entitlement/offline-lease.ts')

  // SECURITY FINDING ADMIN-ENT-11: the lease response is plain JSON with no
  // signature or MAC, so the client's persisted copy is whatever the device
  // says it is. Inherent to an offline model and low blast radius — it only
  // extends playback of already-downloaded audio, and every new entitlement
  // decision still goes through the server. Recorded so nobody assumes the
  // stored lease is tamper-evident.
  // SHOULD BE (only if it ever needs to be): HMAC over
  // (learner_id, course_code, expiresAt), verified before honouring a stored lease.
  it('ADMIN-ENT-11: the response carries no signature field', () => {
    expect(src).not.toMatch(/\b(signature|hmac|createHmac|sign)\b/i)
    expect(src).toContain('leaseExpiresAt')
  })

  it.todo(
    'ADMIN-ENT-11: per-course leases could be HMAC-signed so a locally edited expiry is detectable',
  )

  // CONTROL: the server side is genuinely strict — these must not regress.
  it('CONTROL: the lease upsert fails CLOSED so a trial cannot be re-minted', () => {
    expect(src).toContain('if (upErr) throw upErr')
    expect(src).toContain('a device can re-mint a fresh 30-day trial every call')
  })

  it('CONTROL: revocation wins over everything else', () => {
    const branch = src.slice(src.indexOf('if (prior?.revoked)'))
    expect(branch.slice(0, 300)).toContain('Kill-switch wins')
  })

  it('CONTROL: the entitlement answer is never cacheable', () => {
    expect(src).toContain("res.setHeader('Cache-Control', 'no-store')")
  })
})
