/**
 * SEC0912T-D — Family accounts, try-links, invites and welcome. Tenth audit,
 * Area D, 2026-09-12. None of this surface had been security-reviewed before.
 *
 * Full write-up: docs/security-audit-2026-09-12-tenth/area-d-family-and-links.md
 *
 * Findings and tests only. Nothing here changes behaviour, NO LIVE DATABASE
 * WAS READ, no email was sent, no network was touched. Every assertion is over
 * repo source (readFileSync) or over pure helpers imported from the handlers.
 * The one behavioural test (D-06) drives api/invite/create.ts against an
 * in-memory stub client.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SEC0912T-D-01 (MEDIUM) — UNBOUNDED, PLAN-GATE-FREE IDENTITY MINT.
 *   api/family/create-child.ts creates a confirmed Supabase auth user plus a
 *   learners row for ANY caller holding a JWT: it never reads `subscriptions`,
 *   never asks the `hasFamilyPlan` question GET /api/family computes, and
 *   never touches the repo's throttle (codeAttemptThrottle). The only ceiling
 *   is FAMILY_SEAT_CAP, and countUsedSeats counts LIVE rows only — Remove
 *   frees the seat instantly, and (job #376·F D7, deliberately) a removed
 *   child row still mints a sign-in link. So create → remove → create is an
 *   unbounded, email-less, scriptable mint of reachable accounts from one
 *   free sign-up; and because a child holds a real session, a child can be
 *   an owner and mint its own five. No audit row is written for any of it.
 *   CHARACTERIZATION: goes red when create-child gates on the owner's plan,
 *   throttles, counts removed child rows toward a ceiling, or refuses a
 *   child-account owner.
 *
 * SEC0912T-D-02 (MEDIUM) — OUTWARD SEND TO ANY ADDRESS ON A STRANGER'S
 *   SAY-SO. api/family/invite.ts emails whatever address a signed-in caller
 *   supplies, with no plan gate, no throttle, and a deliberate "re-post =
 *   re-send" rule. The subject line opens with the caller's display_name,
 *   which the client writes straight to `learners` (SettingsScreen.vue) and
 *   which safeInviterName only strips when it looks address-shaped — so a
 *   sentence of the attacker's choosing leads the subject of a mail from the
 *   verified sending domain. emailValidation.ts (format + disposable-domain
 *   block) is not used on this path. CHARACTERIZATION.
 *
 * SEC0912T-D-03 (MEDIUM) — ACCOUNT-EXISTENCE ORACLE AND CONSENT-FREE ATTACH.
 *   The same handler returns `attachedNow`, which is true exactly when the
 *   address already belongs to a verified account — an unthrottled "does
 *   this email have an SSi account?" oracle for any signed-in user. And when
 *   it is true the victim has ALREADY been attached to the caller's family
 *   (status 'active') with no act of consent: the caller's GET /api/family
 *   then shows the victim's display_name, and the no-silent-steal rule means
 *   the victim's real family cannot attach them until they find and press
 *   Leave. CHARACTERIZATION.
 *
 * SEC0912T-D-04 (LOW) — THE PARENT'S SIGN-IN MINTER HAS NO VOLUME BOUND AND
 *   NO AUDIT ROW, where the admin equivalent (api/admin/create-signin-link.ts)
 *   has both, failing closed. Ownership and the child-only ceiling ARE
 *   re-verified server-side (cleared below); the missing pieces are the
 *   rate limit and the player_events record. CHARACTERIZATION.
 *
 * SEC0912T-D-05 (LOW) — A TRY-LINK ENTITLEMENT CANNOT BE REVOKED. The token
 *   validate.ts mints is {kind, scope:'all', exp} with no link id, and
 *   deactivate.ts only flips try_links.is_active — so every token already
 *   minted keeps working for up to 30 days after the link is killed. The
 *   code itself is ABC-123 (24³·10³ ≈ 13.8M, ~23.7 bits) where the estate's
 *   privileged codes use a 128-bit share code; the per-IP throttle
 *   (AUTH-CORE-03) is what stands between that keyspace and a scope:'all'
 *   grant. CHARACTERIZATION.
 *
 * SEC0912T-D-06 (MEDIUM, already-known class: TENANCY-07 residue) —
 *   api/invite/create.ts bounds privileged codes by testing
 *   `code_type === 'school_admin_join'`, a value validCodeTypes REJECTS, so
 *   the branch is dead and a `school_admin` code (the type actually minted,
 *   which redeems to educational_role 'school_admin') is written with the
 *   caller's expires_at / max_uses as-is — unlimited-use and never-expiring
 *   when omitted. The 2026-08-25 reconciliation recorded TENANCY-07 as
 *   STILL LIVE for govt_admin + school_admin_join; govt_admin has since been
 *   added, the school_admin half has not. CHARACTERIZATION: goes red when
 *   'school_admin' joins the isPrivileged set.
 *
 * Also here, as SECURE ASSERTIONS on things this audit checked and cleared:
 * remove/leave ownership, removal revoking cover, no cross-family attach,
 * the service-role-only posture of family_members and try_links, the
 * env-only email origin, the whitespace-free email regex, validate.ts's
 * fixed error string and learner-free response, and welcome/played's
 * self-only write.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { countUsedSeats, FAMILY_SEAT_CAP } from '../_utils/familyMembership'
import { safeInviterName, renderFamilyInviteEmail } from '../_utils/familyInviteEmail'
import { generateCode, generateShareCode } from '../_utils/codeGen'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../..')
const read = (rel: string) => readFileSync(join(repoRoot, rel), 'utf-8')
/** The file with its block and line comments stripped — negative matches must not trip on prose. */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const CREATE_CHILD = 'api/family/create-child.ts'
const SIGNIN_LINK = 'api/family/signin-link.ts'
const INVITE = 'api/family/invite.ts'
const REMOVE = 'api/family/remove.ts'
const LEAVE = 'api/family/leave.ts'
const FAMILY_INDEX = 'api/family/index.ts'
const MEMBERSHIP = 'api/_utils/familyMembership.ts'
const ACCESS = 'api/_utils/familyAccess.ts'
const ADMIN_SIGNIN = 'api/admin/create-signin-link.ts'
const TRY_CREATE = 'api/try-link/create.ts'
const TRY_DEACTIVATE = 'api/try-link/deactivate.ts'
const TRY_LIST = 'api/try-link/list.ts'
const TRY_VALIDATE = 'api/try-link/validate.ts'
const INVITE_CREATE = 'api/invite/create.ts'
const WELCOME = 'api/welcome/played.ts'
const SCHEMA = 'supabase/schema.sql'
const SETTINGS_SCREEN = 'packages/player-vue/src/components/SettingsScreen.vue'

// ── D-06 needs a stub client for api/invite/create.ts. Mocks are file-wide but
// nothing else imported here calls createClient or verifyAuthToken at import
// time, so the pure helpers above are unaffected.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let stubLearnerRow: any = null
let stubInserted: Array<{ table: string; obj: any }> = []
vi.mock('../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: 'ssi-admin-1' })),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: any = {
        select: () => b,
        eq: () => b,
        is: () => b,
        insert: (obj: any) => { stubInserted.push({ table, obj }); return b },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => {
          if (table === 'learners') return Promise.resolve({ data: stubLearnerRow, error: null })
          return Promise.resolve({ data: { id: 'code-1', code: 'X' }, error: null })
        },
        then: (r: any) => r({ data: [], error: null }),
      }
      return b
    },
  }),
}))

/** A family_members stub: `rows` is the whole table for one owner. */
function familyStub(rows: Array<{ removed_at: string | null }>) {
  return {
    auth: {},
    from: (table: string) => {
      expect(table).toBe('family_members')
      const b: any = {
        select: () => b,
        eq: () => b,
        is: (_col: string, _val: null) => Promise.resolve({ data: rows.filter((r) => r.removed_at === null), error: null }),
      }
      return b
    },
  }
}

describe('SEC0912T-D-01 — create-child is an unbounded, plan-gate-free identity mint', () => {
  const src = code(CREATE_CHILD)

  it('never asks whether the caller holds a Family plan (no subscriptions read, no plan name)', () => {
    expect(src).not.toContain("from('subscriptions')")
    expect(src).not.toContain('SSi Family')
    expect(src).not.toContain('hasFamilyPlan')
    expect(src).not.toContain('isEffectivelySubscribed')
    // …while the sibling read-side endpoint DOES compute the answer.
    expect(read(FAMILY_INDEX)).toContain("ownSub.plan_name === 'SSi Family'")
  })

  it('does not throttle — the repo primitive is never imported, and no attempt row is written', () => {
    expect(src).not.toContain('codeAttemptThrottle')
    expect(src).not.toContain('isIpOverLimit')
    expect(src).not.toContain('possession_mint_attempts')
    expect(src).not.toContain("from('player_events')")
  })

  it('the seat cap counts LIVE rows only, so Remove refunds the seat (pure, over the real helper)', async () => {
    const five = Array.from({ length: FAMILY_SEAT_CAP - 1 }, () => ({ removed_at: null }))
    expect(await countUsedSeats(familyStub(five) as any, 'owner')).toBe(FAMILY_SEAT_CAP)
    // Remove all five: the owner is back to one seat used, whatever was minted.
    const removed = five.map(() => ({ removed_at: '2026-09-12T00:00:00Z' }))
    expect(await countUsedSeats(familyStub(removed) as any, 'owner')).toBe(1)
    // And the helper's own filter says so.
    expect(read(MEMBERSHIP)).toMatch(/liveFamilyRows[\s\S]*?\.is\('removed_at', null\)/)
  })

  it('a removed child still mints a sign-in link, so removed accounts stay reachable — the mint has no ceiling', () => {
    const signin = read(SIGNIN_LINK)
    // The membership lookup deliberately carries no removed_at filter.
    const lookup = signin.slice(signin.indexOf("from('family_members')"), signin.indexOf('.maybeSingle()'))
    expect(lookup).not.toContain('removed_at\', null')
    expect(signin).toContain('A REMOVED child row still mints')
  })

  it('a child account may itself be an owner — nothing checks the caller is not a child', () => {
    // The string appears once — the insert payload — and is never READ against the caller.
    const occurrences = src.split('is_child_account').length - 1
    expect(occurrences).toBe(1)
    expect(src).toContain('is_child_account: true,')
  })

  it('the sign-in link is handed back in the JSON body, so the whole chain is scriptable without an inbox', () => {
    expect(src).toContain('signInLink: linkData.properties.action_link')
    expect(src).toContain('email_confirm: true')
  })
})

describe('SEC0912T-D-02 — family/invite emails any address on any signed-in caller\'s say-so', () => {
  const src = code(INVITE)

  it('the recipient is the request body, the gate is verifyAuthToken alone, and there is no plan check', () => {
    expect(src).toContain('const rawEmail = (req.body || {}).email')
    expect(src).toContain('address: normalizedEmail')
    expect(src).not.toContain("from('subscriptions')")
    expect(src).not.toContain('SSi Family')
    expect(src).not.toContain('codeAttemptThrottle')
  })

  it('re-posting a live invite re-sends the mail by design, so one address can be mailed without limit', () => {
    expect(read(INVITE)).toContain('AN INVITE THAT ALREADY EXISTS IS RE-SENT, NOT REFUSED')
    expect(src).toContain('resent = true')
    // The send is unconditional on `resent`.
    const sendBlock = src.slice(src.indexOf('sendFamilyInviteEmail({'), src.indexOf('emailed = sendResult.sent'))
    expect(sendBlock).not.toContain('resent')
  })

  it('the caller\'s display_name leads the subject, and the client writes display_name to learners directly', () => {
    const name = 'Urgent action is needed on your account'
    expect(safeInviterName(name)).toBe(name)
    const mail = renderFamilyInviteEmail({ address: 'x@example.com', inviterName: safeInviterName(name), hasAccount: false })
    expect(mail.subject.startsWith(name)).toBe(true)
    expect(read(SETTINGS_SCREEN)).toContain('.update({ display_name: name })')
  })

  it('emailValidation.ts is not on this path — a private regex, no disposable-domain block', () => {
    expect(src).not.toContain('emailValidation')
    expect(src).toContain('const EMAIL_RE = ')
  })
})

describe('SEC0912T-D-03 — invite returns an account-existence signal and attaches without consent', () => {
  const src = read(INVITE)

  it('the response carries attachedNow, true iff a verified account exists for that address', () => {
    expect(src).toContain(".contains('verified_emails', [normalizedEmail])")
    expect(src).toMatch(/res\.status\(200\)\.json\(\{[\s\S]*?attachedNow,/)
  })

  it('the attach flips the victim to status active in the same request, with no act by the victim', () => {
    expect(src).toContain('attachPendingInvitesForEmail(supabase, candidate.id as string, normalizedEmail)')
    expect(read(MEMBERSHIP)).toContain("update({ member_learner_id: learnerId, status: 'active'")
  })

  it('the owner then reads the victim\'s display_name, and the one-family rule blocks their real family', () => {
    expect(read(FAMILY_INDEX)).toContain("select('id, display_name')")
    expect(read(MEMBERSHIP)).toContain('if (await isInAnyLiveFamily(supabase, learnerId)) return { attached: 0 }')
  })
})

describe('SEC0912T-D-04 — the parent sign-in minter has no volume bound and no audit row', () => {
  const family = read(SIGNIN_LINK)
  const admin = read(ADMIN_SIGNIN)

  it('admin/create-signin-link rate-limits (failing closed) and audits every mint', () => {
    expect(admin).toContain('PER_ADMIN_LIMIT')
    expect(admin).toContain("event_type', 'admin_signin_link_minted'")
    expect(admin).toContain('fail CLOSED')
  })

  it('family/signin-link does neither', () => {
    const body = code(SIGNIN_LINK)
    expect(body).not.toMatch(/_LIMIT|isIpOverLimit|rateErr|throttle/i)
    expect(body).not.toContain("from('player_events')")
    expect(body).not.toContain('possession_mint_attempts')
    expect(family).toContain("type: 'magiclink'")
  })
})

describe('SEC0912T-D-05 — a minted try-link entitlement cannot be revoked; ABC-123 keyspace', () => {
  const validate = read(TRY_VALIDATE)

  it('the token names no link (no id / jti), only kind, scope and exp', () => {
    expect(validate).toContain("JSON.stringify({ kind: 'try', scope: 'all', exp: expMs })")
    const minter = validate.slice(validate.indexOf('function mintEntitlementToken'), validate.indexOf('export default'))
    expect(minter).not.toMatch(/\bid\b|jti|link/)
    // And the call site passes only the expiry — the link row never reaches the minter.
    expect(validate).toContain('mintEntitlementToken(expMs)')
  })

  it('deactivate only flips is_active — nothing it does can reach an already-minted token', () => {
    const deact = code(TRY_DEACTIVATE)
    expect(deact).toContain('.update({ is_active: false })')
    expect(deact).not.toMatch(/entitlement|revok|ENTITLEMENT_TOKEN_SECRET|jti/i)
  })

  it('try codes come from generateCode (ABC-123, ~23.7 bits), not the 128-bit share code privileged codes use', () => {
    expect(read(TRY_CREATE)).toContain('const candidate = generateCode()')
    expect(generateCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ]{3}-\d{3}$/)
    const keyspaceBits = Math.log2(24 ** 3 * 1000)
    expect(keyspaceBits).toBeLessThan(24)
    expect(generateShareCode().length).toBeGreaterThanOrEqual(22) // 16 random bytes, base64url
    // The 30-day life the unrevocable token carries.
    expect(validate).toContain('TRY_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000')
  })
})

describe('SEC0912T-D-06 — invite/create never bounds a school_admin code (TENANCY-07 residue)', () => {
  const src = read(INVITE_CREATE)

  it('isPrivileged tests a code_type that validCodeTypes rejects, so the branch is dead for school_admin', () => {
    const valid = src.match(/const validCodeTypes = \[([^\]]+)\]/)![1]
    expect(valid).not.toContain("'school_admin_join'")
    expect(valid).toContain("'school_admin'")
    const priv = src.slice(src.indexOf('const isPrivileged ='), src.indexOf('if (isPrivileged)'))
    expect(priv).toContain("code_type === 'school_admin_join'")
    expect(priv).not.toContain("code_type === 'school_admin'")
  })

  it('BEHAVIOUR: an ssi_admin minting a school_admin code with no limits gets an unbounded row', async () => {
    vi.resetModules()
    stubInserted = []
    stubLearnerRow = { platform_role: 'ssi_admin' }
    const handler = (await import('../invite/create')).default
    const req = { method: 'POST', body: { code_type: 'school_admin' }, headers: { authorization: 'Bearer t' } } as unknown as VercelRequest
    const res: any = {}
    res.status = vi.fn((c: number) => { res.statusCode = c; return res })
    res.json = vi.fn((b: any) => { res.body = b; return res })
    res.setHeader = vi.fn()
    res.getHeader = vi.fn()
    res.end = vi.fn()
    await handler(req, res as VercelResponse)
    expect(res.statusCode).toBe(201)
    const row = stubInserted.find((r) => r.table === 'invite_codes')!.obj
    expect(row.code_type).toBe('school_admin')
    // CHARACTERIZATION: both undefined = never expires, unlimited uses.
    expect(row.expires_at).toBeUndefined()
    expect(row.max_uses).toBeUndefined()
  })

  it('and school_admin redeems to educational_role school_admin (the prize is real)', () => {
    expect(read('api/code/redeem.ts')).toContain("codeType === 'school_admin'")
  })
})

describe('checked and cleared — secure assertions', () => {
  it('signin-link re-verifies the member against the CALLER\'s family and refuses adults', () => {
    const s = read(SIGNIN_LINK)
    expect(s).toContain('membership.owner_learner_id !== ownerLearnerId')
    expect(s).toContain('if (!membership.is_child_account)')
    // The e-mail the link is minted for comes from auth admin, never the body.
    expect(s).toContain('email: childUser.user.email')
    expect(s).not.toContain('req.body || {}).email')
  })

  it('remove is owner-filtered; leave is self-only from the JWT, never a body id', () => {
    expect(read(REMOVE)).toContain(".eq('owner_learner_id', ownerLearnerId)")
    const l = code(LEAVE)
    expect(l).toContain(".eq('member_learner_id', learnerId)")
    expect(l).not.toMatch(/\bmember_id\b/)
    expect(l).not.toContain('req.body')
  })

  it('removal revokes cover: the resolver requires status active AND removed_at null', () => {
    const a = read(ACCESS)
    expect(a).toContain(".eq('status', 'active')")
    expect(a).toContain(".is('removed_at', null)")
  })

  it('create-child cannot attach a child to another family — owner is the caller, always', () => {
    expect(read(CREATE_CHILD)).toContain('owner_learner_id: ownerLearnerId,')
    expect(read(CREATE_CHILD)).not.toContain('owner_learner_id: req')
  })

  it('family_members and try_links: RLS on, service_role the only grantee, no policies', () => {
    const schema = read(SCHEMA)
    for (const t of ['family_members', 'try_links', 'try_link_visits']) {
      expect(schema).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`)
      expect(schema).toContain(`GRANT ALL ON TABLE public.${t} TO service_role;`)
      expect(schema).not.toMatch(new RegExp(`GRANT [A-Z, ]+ ON TABLE public\\.${t} TO (anon|authenticated)`))
      expect(schema).not.toMatch(new RegExp(`CREATE POLICY [^\\n]* ON public\\.${t}\\b`))
    }
  })

  it('try-link create/list/deactivate are admin-gated; validate is throttled and leaks no learner', () => {
    for (const f of [TRY_CREATE, TRY_LIST, TRY_DEACTIVATE]) {
      expect(read(f)).toContain("learner.platform_role !== 'ssi_admin' && learner.educational_role !== 'god'")
    }
    const v = read(TRY_VALIDATE)
    expect(v).toContain('isIpOverLimit(supabase, ipHash, REDEEM_PER_IP_LIMIT)')
    expect(v).toContain("select('id, code, label, expires_at, is_active')")
    expect(v).not.toContain('created_by')
    expect(v).toContain("res.status(500).json({ error: 'Internal server error' })")
  })

  it('the emailed origin is env-only (no Host header), and the regex bans whitespace so CRLF cannot reach Resend', () => {
    const origin = read('api/_utils/sendInviteEmail.ts')
    expect(origin).toMatch(/export function inviteEmailOrigin\(\): string \{[\s\S]*?INVITE_EMAIL_ORIGIN[\s\S]*?saysomethingin\.app/)
    expect(origin.slice(origin.indexOf('export function inviteEmailOrigin'), origin.indexOf('export function toInviteEmailUrl'))).not.toContain('headers')
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    expect(re.test('a@b.com\r\nBcc: c@d.com')).toBe(false)
    expect(read('api/_utils/resendMail.ts')).toContain('to: [message.to]')
  })

  it('welcome/played writes only the caller\'s own row and is idempotent', () => {
    const w = read(WELCOME)
    expect(w).toContain(".eq('user_id', authResult.userId)")
    expect(w).toContain(".is('welcome_played_at', null)")
  })

  it('invite/create takes no email address — it is a code minter, not a sender', () => {
    const s = read(INVITE_CREATE)
    expect(s).not.toMatch(/\bemail\b/)
    expect(s).not.toContain('Resend')
  })
})

beforeEach(() => {
  stubLearnerRow = null
  stubInserted = []
})
