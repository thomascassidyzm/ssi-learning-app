# Remediation notes — the items that are NOT straightforward fixes

Companion to `README.md` and `area-c-reconciliation.md`. Written during the 2026-08-25 remediation
pass (branch `security/remediation-2026-08-25`). These are the three findings the brief singled out as
needing a named decision rather than a silent skip, plus the evidence gathered on each.

---

## SEC25-D-02 — CLOSED LIVE, with the canary run recorded here

Migration: `supabase/migrations/20260825_sec25_d02_practice_minutes_gate.sql`.
Canary: `supabase/secfix-toolkit/canary_practice_minutes_gate.cjs` — **12 assertions, 12 green, COMMITTED**.

The pre-state probe confirmed the finding against the live database rather than against the checked-in
dump: **an `anon` role calling `admin_practice_minutes_by_course()` with no argument returned 75 rows of
platform-wide practice minutes grouped by course.** No login, no learner UUID, no prior knowledge — exactly
as the audit described it.

After the migration, verified in a fresh connection outside the applying transaction:

| Probe | Before | After |
|---|---|---|
| `anon` → `admin_practice_minutes(ids)` | allowed | **permission denied** |
| `anon` → `admin_practice_minutes_by_course()` | **75 rows** | **permission denied** |
| `authenticated` → `admin_practice_minutes(ids)` | allowed | **permission denied** |
| signed-in non-admin → `_by_course()` no-arg | allowed | **`Forbidden: admin required`** |
| `service_role` → `admin_practice_minutes(ids)` | rows | same rows, byte-identical |
| signed-in non-admin → `_by_course(ids)` | rows | same rows, byte-identical |
| `ssi_admin` → `_by_course()` no-arg | rows | same rows, byte-identical |
| `service_role` → `_by_course()` no-arg | rows | same rows, byte-identical |

Why `authenticated` keeps EXECUTE on `_by_course` but loses it on `admin_practice_minutes`: the call sites
were checked, not assumed. `admin_practice_minutes` has **only** service-role server callers behind
`verifyAdmin()` (`api/admin/users.ts:213`, `api/admin/attention.ts:112`). `_by_course` has **four browser
callers** on the authenticated client — `admin/useAdminCourses.ts:91` (no argument: the platform-wide
aggregate, an ssi_admin page), `admin/useAdminUserDetail.ts:184`, `schools/useAnalyticsData.ts:196` and
`schools/StudentProgressView.vue:77`. A blanket `is_ssi_admin()` gate would have blacked out the schools
analytics dashboard for every teacher and school admin. So the gate is on the NULL-argument path only.

**Residual, stated rather than papered over:** a signed-in user can still call `_by_course` with a learner
UUID they already know. Closing that means repointing the schools composables at a server endpoint on the
`resolveVisibleScope` pattern — that is CLAUDE.md's own "client org-table reads repointed" condition, a
separate pass, and it is not made worse by this fix.

---

## INPUT-01 / `ENTITLEMENT_ENFORCE` — narrowed, and the gap is smaller than three audits have assumed

The unresolved question is unchanged and is **not settleable from this box**: whether
`ENTITLEMENT_ENFORCE=strict` is set in Vercel production. The CLI is installed (`vercel 59.5.0`) and this
session is **logged out**; no interactive login was attempted, because crossing an auth boundary is outside
these rules.

**One command settles it, and it is Tom's or an operator's to run:**

```
vercel env ls production | grep ENTITLEMENT_ENFORCE
```

**What this pass did add — two pieces of evidence that shrink the finding:**

1. **The bulk path is already closed to anonymous callers, regardless of the env var.**
   `api/audio/batch-urls.ts:145` does `if (entitlement.gated && !(await hasVerifiedSession())) { denied.push(id); return }`
   — the shared resolver fails open, and the bulk endpoint closes it behind a verified session anyway. So
   the reconciliation's headline framing of INPUT-01 ("anonymous **bulk** premium-audio extraction") does
   not hold on the bulk endpoint today. The residual is the **per-clip proxy** `api/audio/[audioId].ts`,
   which does fail open.

2. **The per-clip proxy cannot be closed the same way without locking out real paying learners, and this is
   why the fail-open is still there.** `packages/player-vue/src/cache/AudioCache.ts:281` fetches
   `/api/audio/<id>` with a bare `fetch()` that attaches **no** Authorization header and no `?et=` token. So
   a legitimate, paid, signed-in learner's audio request arrives at the proxy looking exactly like an
   anonymous one. Flipping `ENTITLEMENT_ENFORCE` to `strict` today, or copying the batch-urls
   verified-session check onto the per-clip proxy, would 403 real learners mid-session. The code's own
   comment states this precondition: *"do not regress live playback before the client attaches tokens"* —
   and the client still does not attach them.

**So INPUT-01 is not one decision, it is a sequence:** the client must attach entitlement to per-clip audio
requests first; only then can the proxy be closed. Until then the residual exposure is "an anonymous caller
who **already holds** premium audio UUIDs can fetch them one at a time" — and the three
`courses/[code]/*` endpoints that would hand out those UUIDs in bulk (`bundle`, `cycles`, `infplay-cycles`)
already gate on `resolveServerCourseAccess` and return `403 Subscription required`.

**Nothing was flipped.** Locking real learners out of audio is a product decision, not an agent's call.

---

## SEC25-D-03 — cross-repo hand-off to Popty/dashboard, now with the evidence that makes it cheap

Five tables have RLS off with `GRANT ALL` to `anon`, INSERT/UPDATE/DELETE included: `audio_clips`,
`audio_clip_promotions`, `audio_convergence_log`, `language_canonical`, `relink_refusals`. None is
referenced anywhere in `ssi-learning-app`, so there is no learner-facing impact from this repo — which is
why the audit ranked it low here and handed it on.

**This pass checked the other side of the hand-off rather than leaving it unknown.** In
`ssi-dashboard-v7-clean`:

| Table | Files referencing it | Browser-side (`src/**`) references |
|---|---|---|
| `audio_clips` | 74 | **0** |
| `audio_clip_promotions` | 1 | **0** |
| `audio_convergence_log` | 62 | **0** |
| `language_canonical` | 74 | **0** |
| `relink_refusals` | 8 | **0** |

Every reference is in server code or scripts, which run on the service key. **Zero browser-side reads or
writes.** That is the fact that makes tightening these safe and cheap — a `REVOKE … FROM anon` plus RLS
enable would, on this evidence, break nothing on the dashboard side. It breaches this repo's own RLS
doctrine rule 7 ("every new table gets an explicit posture at creation — never Supabase's grant-open
default"), and the write grants are the sharp end: `anon` can currently INSERT and UPDATE the recording
pipeline's clip tables.

**Not changed from here**, deliberately — a posture change on another repo's tables should be applied by
someone who can see that repo's canary go green, not inferred from a grep. Handed over as a one-migration
job with the call-site evidence above already done.
