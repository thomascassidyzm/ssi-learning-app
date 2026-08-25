# Security & vulnerability audit — 2026-08-25

Run as reset-eve spare-capacity work on branch `security/audit-2026-08-25`.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no fix
was applied, nothing was promoted, no money moved, and no email or OTP was sent. Production contact
is itemised in §5 — if that section says "none", none was made.

---

## 0. Why this audit exists, given there have been three already

This is the **fourth** security audit of this repo in fourteen days. Re-running the earlier
partitions would have produced a fourth copy of the same findings, so the partition was chosen
specifically against what the earlier three left behind.

| Audit | Where it lives | State |
|---|---|---|
| 2026-08-11 | `docs/security-audit-2026-08-11/` (6 area reports, ~1,100 tests) | **branch `sec/audit-2026-08-11`, still UNMERGED** |
| 2026-08-18 | `docs/security/api-audit-2026-08-18.md` (5 deliberately-red specs) | on `dev`; specs run only by `pnpm run test:security-audit`, **not a CI gate** |
| 2026-08-22 | `docs/security-audit-2026-08-22/` (SEC22-01…05) | **merged into `dev`** |

That table is itself the audit's first observation, and it drove the whole partition:

> **The 2026-08-11 audit is not on `dev`.** Its six reports and its ~1,100 tripwire tests — including
> two findings it rated **critical** — exist only on a branch nobody has merged. On the branch that
> actually ships, those findings have no document, no test, and no way to go red. A finding that
> cannot regress-fail is not a finding, it is a memory.

So this audit's four areas are the four things the earlier three could not or did not do:

| Area | Question | Worker |
|---|---|---|
| **A** | The API delta since 2026-08-22 — new endpoints nobody has ever audited | #467 |
| **B** | The client surface — least-audited area, and its own report is on the unmerged branch | #468 |
| **C** | **Reconciliation** — of the 2026-08-11 findings, which are still live on `dev` *today*? | #469 |
| **D** | DB posture, repo hygiene, and the integrity of the security-test machinery itself | #470 |

The coordinator additionally regenerated the handler map (`handler-map.md`) and took the one thread
no area owned: the ungated `courses/[code]/round-map.ts` (SEC25-X-01, SEC25-X-02).

---

## 1. Findings

*(filled from the area reports — see §6 for the per-area files)*

---

## 2. The handler map

Regenerated against today's `dev`: **109 handlers, 106 of them service-role, 7 with no auth helper.**
Full table and the verdict on each of the 7: [`handler-map.md`](./handler-map.md).

The number to carry into every finding below: **97% of the API surface talks to Supabase as the
service role, which bypasses RLS entirely.** That is deliberate architecture, and it means a missing
scope check in a handler is not a weakened check — it is no check.

One thing genuinely closed since 2026-08-11: that audit flagged the `courses/[code]/*` content
endpoints as an open question, since "they hold the *whole course*, which is the paid product".
Three of the four — `bundle`, `cycles`, `infplay-cycles` — now gate on `resolveServerCourseAccess`
and return `403 Subscription required`. That is pinned by a passing test so it stays true.

---

## 3. Coordinator findings — `courses/[code]/round-map.ts`

The fourth content endpoint is ungated, and this audit's verdict is that **that is defensible**: it
projects `round_index, lego_id, seed_number` and nothing else — no known text, no target text, no
audio id, no presigned URL. An anonymous caller learns a paid course's *shape*, not its content. A
test pins that projection, so if a future change adds text or audio columns the endpoint silently
becomes an anonymous read of the paid product and the suite goes red.

Two low findings sit on it:

### SEC25-X-01 — the 503 branch hands an anonymous caller an internal relation name and its DDL · **LOW**

```ts
res.status(503).json({
  error: 'round map not yet materialised, run REFRESH MATERIALIZED VIEW course_round_index',
})
```

Reachable unauthenticated. It names an internal object and the exact statement to run against it.
Every comparable handler returns a fixed string and logs the detail server-side —
`api/board/snapshot/[code].ts` returns `'Internal server error'`. Same family as SEC22-03 (2026-08-22),
which is the tell that the convention is not being carried by anything mechanical.

**Suggested fix (not applied):** fixed caller-safe string in the body; relation name and remedy to
`console.error` only.

### SEC25-X-02 — a missing service-role key degrades silently to the anon key · **LOW**

```ts
createClient(supabaseUrl, supabaseServiceKey || (process.env.VITE_SUPABASE_ANON_KEY || …).trim())
```

A missing or mistyped `SUPABASE_SERVICE_ROLE_KEY` does not fail the request. It **silently swaps the
identity the query runs as**, moving the endpoint's read authority from "the handler decided" to
"whatever RLS on `course_round_index` happens to be". The failure is invisible in both directions: if
RLS permits the read, the swap is undetectable; if it denies it, the handler reports
`503 not yet materialised`, pointing an operator at entirely the wrong cause.

On this endpoint the swap is **undetectable in practice**, which is what makes it worth recording
rather than filing as a style note: `supabase/schema.sql:21033` grants `course_round_index` to
`anon`, so a service key that has gone missing produces byte-identical responses. Nothing outside
notices, and nothing inside the handler notices either.

The same shape is in `_utils/audioAccess.createServiceSupabaseClient()` —
`supabaseServiceKey || supabaseAnonKeyFallback` — which is the client behind **both**
`audio/[audioId].ts` and `audio/batch-urls.ts`, the two endpoints that decide audio entitlement.
Same pattern, higher stakes, which is why it is pinned rather than left as a note.

The convention it diverges from has a quorum: `access/claim.ts`, `family/remove.ts`, `groups/tree.ts`
and 20-odd others return `500 Server misconfigured`.

**Suggested fix (not applied):** fail closed on a missing service key, matching the majority.

Tests: `api/courses/roundMap.security.test.ts` — 8 passing, 2 `todo`.

---

## 4. Gaps (explicit)

*(consolidated from the area reports)*

---

## 5. Production contact

*(itemised; "none" if none)*

---

## 6. Files

| File | Contents |
|---|---|
| `README.md` (this file) | Synthesis, coordinator findings, gaps |
| `handler-map.md` | The 109-handler map and the verdict on each unauthenticated one |
| `area-a-api-delta.md` | New endpoints since 2026-08-22 |
| `area-b-client.md` | Client surface — XSS, secrets, service worker, headers |
| `area-c-reconciliation.md` | Live-status verdict on every 2026-08-11 finding |
| `area-d-db-and-hygiene.md` | Schema posture, repo hygiene, test-machinery integrity |

**Test convention** (inherited from 2026-08-11 and 2026-08-22, unchanged): a control that holds is
locked with an ordinary passing test. A real vulnerability is recorded as a **characterization** test
that asserts today's insecure behaviour and therefore **passes today**, carrying a
`// SECURITY FINDING <ID>:` comment and a paired `it.todo()` naming the secure behaviour. When
someone fixes the finding the characterization goes **red on purpose** — that is the signal the
finding is closed, and the fixer flips it to the assertion the `it.todo()` names.
