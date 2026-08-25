# Handler map — the API surface as it stands on `dev`, 2026-08-25

Regenerated for this audit by walking every `export default` handler under `api/` (excluding
`_utils`, `_security` and tests) and recording which auth helper each one references. It supersedes
the equivalent map in the 2026-08-11 audit, which is fourteen days and four commits' worth of
surface out of date and lives on an unmerged branch.

## Headline counts

| | 2026-08-11 | **2026-08-25** |
|---|---|---|
| HTTP handlers under `api/` | 105 | **109** |
| …constructing a `SUPABASE_SERVICE_ROLE_KEY` client | 102 | **106** |
| …referencing no auth helper at all | 17 | **7** |

The middle row is the one to keep in mind while reading every finding in this audit: **97% of the
API surface talks to Supabase as the service role, which bypasses RLS entirely.** That is the
architecture CLAUDE.md declares deliberately — "RLS answers exactly one question, *is this my row?*
… ALL hierarchy/cross-user authz lives in server-mediated endpoints with tests". It is defensible,
and it means a missing scope check in a handler is **not a weakened check, it is no check**.

The third row moved for two reasons, and only one of them is real. The 2026-08-11 count was
produced by grepping for a fixed list of helper names, and the codebase has since grown two new
resolvers — `resolveGroupTreeCaller` / `callerCanSeeGroup` (`_utils/groupTreeAuth.ts`) and
`resolveVadCaller` (`_utils/vadVisibility.ts`). Adding those to the grep reclassifies five handlers
that were never actually unauthenticated: `groups/table.ts`, `groups/tree.ts`, `groups/[id]/home.ts`,
`groups/[id]/invites.ts` and `admin/vad-prosody.ts`. The genuinely new fact is that the four
`courses/[code]/*` content endpoints — bundle, cycles, infplay-cycles — now reference
`resolveServerCourseAccess`, which the 2026-08-11 map explicitly flagged as an open question
("they hold the *whole course*, which is the paid product; entitlement checking is worth confirming
against the business model"). Three of the four are now gated. The fourth is `round-map.ts`, and it
is the subject of SEC25-X-01 below.

## The 7 handlers with no auth helper, and whether that is correct

| Handler | Gate that is actually there | Verdict |
|---|---|---|
| `api/sw-config.ts` | none | correct — static config, no data, no DB client |
| `api/courses/available.ts` | none | correct — public catalogue, by design |
| `api/audio/[audioId].ts` | `resolveAudioEntitlement` (inlined via `_utils/audioAccess`) | false positive of the grep; entitlement *is* applied |
| `api/courses/[code]/round-map.ts` | none | public by design, but see **SEC25-X-01** and **SEC25-X-02** |
| `api/board/snapshot/[code].ts` | an unguessable share `code` from the URL | capability-URL by design; entropy + enumeration remain the standing question (2026-08-11 residue, still open — see area C) |
| `api/teacher/by-code.ts` | an unguessable `code` from the URL | same |
| `api/teacher/wise-webhook.ts` | RSA+SHA256 signature over the **raw** body | correct pattern; false positive of the grep |

So the residue is unchanged from 2026-08-11: **the two `by-code` capability endpoints**, whose only
protection is that a code is unguessable, which reduces to code entropy plus rate limiting.

## Full map

| Handler | lines | service-role | auth helpers referenced |
|---|---|---|---|
| `api/access/claim.ts` | 197 | yes | `auth.getUser` |
| `api/access/grant-emails.ts` | 185 | yes | `verifyAdmin` |
| `api/access/list-grants.ts` | 56 | yes | `verifyAdmin` |
| `api/account/delete.ts` | 122 | yes | `verifyAuthToken` |
| `api/account/reset-progress.ts` | 125 | yes | `verifyAuthToken` |
| `api/admin/attention.ts` | 192 | yes | `verifyAdmin` |
| `api/admin/board-metrics.ts` | 40 | yes | `verifyAdmin` |
| `api/admin/board-snapshot.ts` | 192 | yes | `verifyAdmin` |
| `api/admin/codes.ts` | 138 | yes | `verifyAuthToken` |
| `api/admin/create-govt-admin.ts` | 149 | yes | `verifyAdmin`, `possession` |
| `api/admin/create-school.ts` | 157 | yes | `verifyAdmin` |
| `api/admin/create-signin-link.ts` | 144 | yes | `verifyAdmin` |
| `api/admin/create-staff.ts` | 141 | yes | `verifyAdmin` |
| `api/admin/demo-leaf.ts` | 109 | yes | `verifyAdmin` |
| `api/admin/demo-schools.ts` | 313 | yes | `verifyAdmin` |
| `api/admin/grant-entitlement.ts` | 98 | yes | `verifyAuthToken` |
| `api/admin/invites.ts` | 467 | yes | `verifyAuthToken` |
| `api/admin/revoke-entitlement.ts` | 97 | yes | `verifyAuthToken` |
| `api/admin/set-trial.ts` | 124 | yes | `verifyAdmin` |
| `api/admin/update-school.ts` | 196 | yes | `verifyAdmin`, `verifyAuthToken` |
| `api/admin/update-user-role.ts` | 156 | yes | `verifyAdmin`, `courseAccess` |
| `api/admin/users.ts` | 380 | yes | `verifyAdmin` |
| `api/admin/vad-prosody.ts` | 87 | yes | `resolveVadCaller` |
| `api/admin/view-as.ts` | 109 | yes | `verifyAdmin` |
| `api/audio/[audioId].ts` | 223 | no | **none** |
| `api/audio/batch-urls.ts` | 161 | no | `verifyAuthToken` |
| `api/auth/cascade-user-id.ts` | 130 | yes | `verifyAuthToken` |
| `api/auth/possession-redeem.ts` | 430 | yes | `possession` |
| `api/billing/bind-customer.ts` | 210 | yes | `verifyAuthToken` |
| `api/board/snapshot/[code].ts` | 60 | yes | **none** |
| `api/code/redeem.ts` | 921 | yes | `verifyAuthToken`, `operatorGuard`, `possession` |
| `api/code/validate.ts` | 422 | yes | `verifyAuthToken`, `possession` |
| `api/courses/[code]/bundle.ts` | 801 | yes | `courseAccess` |
| `api/courses/[code]/cycles.ts` | 1010 | yes | `courseAccess` |
| `api/courses/[code]/infplay-cycles.ts` | 439 | yes | `courseAccess` |
| `api/courses/[code]/round-map.ts` | 158 | yes | **none** |
| `api/courses/available.ts` | 52 | yes | **none** |
| `api/cron/expire-demo-schools.ts` | 86 | yes | `CRON_SECRET` |
| `api/cron/teacher-payouts.ts` | 344 | yes | `CRON_SECRET` |
| `api/email/verify.ts` | 127 | yes | `getAuthUserId`, `possession` |
| `api/entitlement/create.ts` | 199 | yes | `verifyAdmin`, `codeGuard` |
| `api/entitlement/grant.ts` | 169 | yes | `verifyAdmin` |
| `api/entitlement/grants.ts` | 52 | yes | `verifyAdmin` |
| `api/entitlement/list.ts` | 70 | yes | `verifyAuthToken` |
| `api/entitlement/offline-lease.ts` | 311 | yes | `verifyAuthToken`, `familyAccess` |
| `api/entitlement/user.ts` | 140 | yes | `verifyAuthToken` |
| `api/family/create-child.ts` | 125 | yes | `verifyAuthToken` |
| `api/family/index.ts` | 85 | yes | `verifyAuthToken` |
| `api/family/invite.ts` | 126 | yes | `verifyAuthToken` |
| `api/family/leave.ts` | 64 | yes | `verifyAuthToken` |
| `api/family/remove.ts` | 71 | yes | `verifyAuthToken` |
| `api/family/signin-link.ts` | 93 | yes | `verifyAuthToken` |
| `api/govt/create-school.ts` | 122 | yes | `verifyAuthToken` |
| `api/govt/school-links.ts` | 117 | yes | `verifyAdmin`, `verifyAuthToken` |
| `api/groups/[id].ts` | 285 | yes | `verifyAdmin`, `verifyAuthToken` |
| `api/groups/[id]/demo-mint.ts` | 320 | yes | `verifyAdmin`, `verifyAuthToken` |
| `api/groups/[id]/demo-refresh.ts` | 58 | yes | `verifyAdmin` |
| `api/groups/[id]/home.ts` | 693 | yes | `resolveGroupTreeCaller`, `callerCanSeeGroup` |
| `api/groups/[id]/invites.ts` | 614 | yes | `resolveGroupTreeCaller`, `callerCanSeeGroup`, `possession` |
| `api/groups/[id]/rate-compare.ts` | 774 | yes | `verifyAdmin`, `verifyAuthToken`, `resolveVisibleScope` |
| `api/groups/index.ts` | 245 | yes | `verifyAdmin`, `verifyAuthToken` |
| `api/groups/table.ts` | 99 | yes | `resolveGroupTreeCaller` |
| `api/groups/tree.ts` | 113 | yes | `resolveGroupTreeCaller`, `callerCanSeeGroup` |
| `api/invite/create.ts` | 305 | yes | `verifyAuthToken`, `codeGuard`, `classTeacherAuth` |
| `api/me/engaged-time.ts` | 109 | yes | `verifyAuthToken` |
| `api/me/legos-learnt.ts` | 119 | yes | `verifyAuthToken` |
| `api/me/phrases-spoken.ts` | 112 | yes | `verifyAuthToken` |
| `api/me/profile.ts` | 351 | yes | `verifyAuthToken` |
| `api/me/subscription.ts` | 59 | yes | `verifyAuthToken`, `familyAccess` |
| `api/me/teaching-context.ts` | 195 | yes | `verifyAuthToken` |
| `api/onboarding/profile.ts` | 114 | yes | `verifyAuthToken` |
| `api/onboarding/provision.ts` | 580 | yes | `verifyAuthToken`, `operatorGuard`, `possession` |
| `api/org/subscription.ts` | 142 | yes | `verifyAuthToken` |
| `api/org/update-seats.ts` | 137 | yes | `verifyAuthToken` |
| `api/org/vad.ts` | 184 | yes | `resolveVisibleScope`, `resolveVadCaller` |
| `api/player-events.ts` | 213 | yes | `verifyAuthToken` |
| `api/school/class-practice-7d.ts` | 117 | yes | `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/class-progress.ts` | 473 | yes | `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/daily-activity.ts` | 114 | yes | `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/delete-class.ts` | 93 | yes | `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/group-summary.ts` | 118 | yes | `verifyAdmin`, `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/portal.ts` | 79 | yes | `verifyAuthToken` |
| `api/school/rate-compare.ts` | 434 | yes | `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/remove-staff.ts` | 248 | yes | `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/rename-class.ts` | 82 | yes | `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/roster.ts` | 356 | yes | `verifyAuthToken`, `resolveVisibleScope` |
| `api/school/subscription.ts` | 250 | yes | `verifyAuthToken` |
| `api/school/update-profile.ts` | 145 | yes | `verifyAuthToken` |
| `api/school/update-seats.ts` | 185 | yes | `verifyAuthToken` |
| `api/subscription/cancel.ts` | 91 | yes | `verifyAuthToken` |
| `api/subscription/index.ts` | 119 | yes | `getAuthUserId`, `familyAccess` |
| `api/subscription/portal.ts` | 83 | yes | `verifyAuthToken` |
| `api/sw-config.ts` | 30 | no | **none** |
| `api/teacher/by-code.ts` | 225 | yes | **none** |
| `api/teacher/class-teachers.ts` | 221 | yes | `verifyAuthToken`, `actAsGuard`, `classTeacherAuth` |
| `api/teacher/classes.ts` | 303 | yes | `verifyAuthToken` |
| `api/teacher/commissions.ts` | 206 | yes | `verifyAuthToken` |
| `api/teacher/create-class-join-code.ts` | 172 | yes | `verifyAuthToken`, `actAsGuard` |
| `api/teacher/create-class-learner.ts` | 150 | yes | `verifyAuthToken`, `actAsGuard` |
| `api/teacher/me.ts` | 186 | yes | `verifyAuthToken` |
| `api/teacher/paddle-webhook.ts` | 2116 | yes | `Paddle-Signature` |
| `api/teacher/payout-recipient.ts` | 150 | yes | `verifyAuthToken` |
| `api/teacher/portal.ts` | 104 | yes | `verifyAuthToken` |
| `api/teacher/wise-webhook.ts` | 260 | yes | **none** |
| `api/try-link/create.ts` | 107 | yes | `verifyAuthToken` |
| `api/try-link/deactivate.ts` | 66 | yes | `verifyAuthToken` |
| `api/try-link/list.ts` | 104 | yes | `verifyAuthToken` |
| `api/try-link/validate.ts` | 133 | yes | `CRON_SECRET` |
| `api/welcome/played.ts` | 64 | yes | `verifyAuthToken` |
