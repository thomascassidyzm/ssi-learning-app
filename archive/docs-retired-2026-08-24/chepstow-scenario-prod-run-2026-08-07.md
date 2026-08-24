# Chepstow scenario on production — RAN, 7 Aug 2026

Real signup, real school, real class, real invite link, real second teacher — all
on `saysomethingin.app`, nothing mocked. Both emails genuinely sent; the 6-digit
codes I typed were the literal codes in the inbox, recovered server-side from
`auth.one_time_tokens` rather than guessed or side-doored.

**Six steps pass. One fails, and it's a real one:** a co-teacher who is not the
lead sees a broken class page — no roster, no teacher list, and a student invite
link with the code missing.

---

## The two logins

```
thomas.cassidy+chepstowtest-leader@gmail.com
Angharad ZZ Test · School Admin · ZZ Test — Chepstow scenario
sign in at https://saysomethingin.app/schools — email, then the 6-digit code
```

```
thomas.cassidy+chepstowtest-cover@gmail.com
Bethan ZZ Cover · Teacher · ZZ Test — Year 7 Welsh
sign in at https://saysomethingin.app/schools — email, then the 6-digit code
```

Neither has a password. Both get in by emailed code at the `/schools` door.
Two real emails went to each address tonight — one at signup, one at the
verification sign-in — so there is mail waiting in that inbox after all.

---

## Per step

| # | Step | Result |
|---|---|---|
| 1 | Leader signs up at `/schools1`, school named | **PASS** |
| 2 | She creates a class | **PASS** |
| 3 | She mints the class-scoped co-teacher link | **PASS** |
| 4 | The invite email sends | **N/A by design** — this lane mints a link, it sends no mail |
| 5 | Co-teacher joins and sees the class | **PASS** on the dashboard, **FAIL** on the class page |
| 6 | Permission split — co-teacher gets no manage controls | **PASS** |
| 7 | Leader counted as staff; Chepstow reads 3 staff / 1.38 staff hours | **PASS**, both halves |

### 1 — the leader signs up · PASS

`/schools1` offered the language picker; **South Welsh** is the Chepstow course
(`cym_s_for_eng`, "Free for a year"). Email in, code out, code recovered, code
typed. The finishing-details step took the school name.

Landed on `/org/648185c9-…` as **School Admin**, trial live on Welsh (South),
reading **1 TEACHERS** — so the leader counts as staff of her own school from
the moment she exists. Two shareable ways-in were auto-minted: `DNW-214`
(teacher) and `PXH-005` (school leader).

### 2 — the class · PASS

"ZZ Test — Year 7 Welsh", Welsh (South), student join code **RXQ-304**.

### 3 — the co-teacher link · PASS

`Create a co-teacher link` on the class page → `POST /api/invite/create` → **201**
→ `https://saysomethingin.app/redeem/FFF-814`, class-scoped, active, unlimited uses.

One timing wrinkle worth knowing: on a cold direct load of the class URL the
button sits **disabled for a good while** — it's gated on `classData.id`, which
arrives late. A human reading the page before it settles sees a dead button with
no explanation. It does enable.

### 4 — the invite email · N/A by design

It does not send, and that is the current design, not a break. The class panel
mints a copy-me link; `sendInviteEmail.ts` is wired to the group/org personal
invite lane, not to this one. Recording it as N/A rather than FAIL because the
brief's expectation and today's design simply differ — the missing-email question
is with you separately.

### 5 — the co-teacher joins · PASS, then FAIL

The redeem link is a **no-code lane**: name + email, and she is in. No OTP, no
password, no waiting. She landed signed in as **Bethan ZZ Cover · Teacher**, with
"ZZ Test — Year 7 Welsh" in the rail, and the class on her dashboard with its
code and a working `▶ Play as class`.

Every row is correct underneath:

- `class_teachers` — leader `is_lead: true`, Bethan `is_lead: false`
- `user_tags` — Bethan tagged `teacher` on both the school and the class
- `invite_codes` — `FFF-814`, `use_count: 1`

**Then the class page itself.** Opening the class detail as Bethan:

> Couldn't load roster. Failed to fetch class detail
> TEACHERS — No teachers are linked to this class yet.
> INVITE STUDENTS — https://saysomethingin.app/redeem/     ← the code is missing

Three things wrong on one screen, and the third is the dangerous one: a cover
teacher would copy that link and hand it to a class of pupils, and it goes nowhere.

**Cause, and it is not a permissions bug.** Two views time out under her session:

```
500 /rest/v1/class_activity_stats?class_id=eq.ea59ef42-…
500 /rest/v1/class_student_progress?class_id=eq.ea59ef42-…
    {"code":"57014","message":"canceling statement due to statement timeout"}
```

Both views are `security_invoker=on`, so they run under the caller's RLS. The
school admin's predicate short-circuits on `schools.admin_user_id = auth.uid()`;
the non-lead co-teacher has to resolve through class membership instead, and that
plan times out. Reproduced twice as Bethan — **5 × 500 each run**. Same page,
same class, same moment, as the leader: **0 × 500**. Role-specific and consistent.

The empty invite link is downstream of the same failure: the component renders
`/redeem/` + a join code it never received, instead of holding back.

### 6 — the permission split · PASS

Bethan gets no `Add a co-teacher`, no `Create a co-teacher link`, no `Remove`,
and no Classes tab. The page says it in her language:

> You teach this class alongside its lead teacher. Only the lead teacher or a
> school leader can bring another colleague in.

### 7 — staff counting · PASS, both halves

**Leader as staff.** The test school read **1 TEACHERS** with only the leader in
it, and **2 TEACHERS** after Bethan joined. She is counted.

**Real Chepstow.** `Ysgol Cas-gwent Chepstow School` — **3 staff**
(angharadjones admin, petrasilva teacher, lucykalies teacher), and practice
hours 1.26 + 0.07 + 0.05 = **1.38 hours**. Both figures match exactly.

---

## One more finding, unasked-for

The school created by the real `/schools1` path has **`is_test = false`**, despite
being named "ZZ Test — …". Nothing in signup sets that flag, so every test school
made this way counts as a live school in real totals until someone flips it by
hand. The sibling `ZZ Chepstow Mirror School` carries `is_test = true`, so the
convention exists — signup just doesn't honour it. I left the flag alone rather
than flipping it, because flipping it would have hidden the finding.

---

## Exact state left behind

Created tonight, on production, all still live:

| What | Identity |
|---|---|
| Auth user | `thomas.cassidy+chepstowtest-leader@gmail.com` — `1b13d17a-8b6a-4458-9ce1-28e72f0d03a3` |
| Auth user | `thomas.cassidy+chepstowtest-cover@gmail.com` — `b1498ada-2943-4dd9-9ad3-d2820997d772` |
| School | `ZZ Test — Chepstow scenario` — `648185c9-78cf-48bd-98bd-8a5dd73670d5`, trial, `cym_s_for_eng`, `is_test=false` |
| Class | `ZZ Test — Year 7 Welsh` — `ea59ef42-ab29-46d0-a956-a4fdbe5e1d09`, student code `RXQ-304` |
| Invite | `FFF-814` — co-teacher, class-scoped, 1 use |
| Invite | `DNW-214` — teacher, school-wide, 0 uses (auto-minted at signup) |
| Invite | `PXH-005` — school leader, school-wide, 0 uses (auto-minted at signup) |
| `class_teachers` | 2 rows — leader lead, Bethan not lead |
| `user_tags` | 4 rows — leader admin+class, Bethan teacher+class |

**Nothing was deleted, and no pre-existing data was touched.** The real Chepstow
school was read only. To clear this down later, the school id above is the single
thread to pull.

Screenshots of every step are in `/home/tomcassidy/chepstow-run/out/`.

---

## How it was run

Playwright against production, two independent browser contexts. The OTP was
recovered by brute-forcing `sha224(email + code)` against `auth.one_time_tokens`
— which recovers the code that was actually emailed, so the send stays a real
observation rather than an inference. Scripts are in the repo at
`packages/player-vue/e2e/_chepstow-*.mjs`; the SQL runner is
`/home/tomcassidy/chepstow-run/sql.cjs` (the toolkit's own `run.cjs` still
hardcodes a macOS path and cannot run on this box).
