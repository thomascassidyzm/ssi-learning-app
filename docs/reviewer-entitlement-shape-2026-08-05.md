# Reviewers can't reach round 90 — the shape

**2026-08-05.** Tom's addendum to the deep-link job: *"the session should carry the logged-in Popty admin credentials (or equivalent entitlement) so ANY round is playable — not just up to the end of the free content."*

**Verdict: genuinely separate from the deep-link hotfix — but the fix is data, not code, and the mechanism already exists.** Reporting the shape as asked; nothing granted.

---

## Why it's separate

The launcher URL and the player session are both already correct and are not involved. What blocks a reviewer is the **entitlement gate**, which lives in a different place entirely and is the same gate that decides what a paying customer sees.

Free preview ends at **seed 19 = round 64 of 1,395** in `deu_for_eng`. A reviewer without entitlement is walled out of **95% of the course**.

And the failure looks *exactly like the bug we just fixed*: an unentitled reviewer opening round 698 lands back at **`S0001L01`, White Belt**, with the paywall. Verified live. So to eight of our people, the deep link will still look broken.

Tom's own account is `ssi_admin`, so his repro tonight was the genuine deep-link bug — correctly diagnosed and now fixed. This is a second, independent wall behind it.

---

## The mechanism already exists and nobody has it

There is already a platform role built for exactly this — **`popty_user`** — with the whole chain in place:

- it's permitted by the `learners_platform_role_check` constraint;
- setting it fires the `trg_auto_entitle_popty_user` trigger, which writes a `user_entitlements` row of `access_type='full'`;
- the entitlement gate honours that and opens the whole course.

**Currently held by: nobody.** (12 `ssi_admin`, 5 `tester`, 0 `popty_user`.)

Proven end-to-end on a throwaway synthetic account against production:

| | round-698 content | entitlements |
|---|---|---|
| plain reviewer | **HTTP 403** | none |
| after `platform_role='popty_user'` | **HTTP 200** | `full` |

One column update. No code, no deploy, no migration.

**It is also correctly sized.** `popty_user` appears in *zero* privilege gates — it is not `ssi_admin`, grants no admin console, no user management, no codes, no school access. It is entitlement and nothing else. Using `ssi_admin` here would badly over-grant; `popty_user` is the role someone already designed for this exact need.

---

## Who is actually blocked — 8 real people

| role | who | |
|---|---|---|
| admin | beunollyn@gmail.com | has learner row |
| editor | Eoghan.OCruadhlaoich@oireachtas.ie | has learner row |
| editor | erikwallis@icloud.com | has learner row |
| editor | meredith.cane@gmail.com | has learner row |
| editor | noah@altun.cc | has learner row |
| editor | sasha.wanasky@gmail.com | has learner row |
| editor | torbyrne@gmail.com | **no learner row** — must open the app once first |
| recorder | catrinlliar@gmail.com | has learner row |

Five dashboard users are already fine. Five more are test/dummy accounts and should be left alone.

---

## The second half — identity does not travel

Worth being straight about: granting the role is necessary but **not sufficient**.

`popty.app` and `saysomethingin.app` are different origins, so the Popty login session does not reach the player. A reviewer clicking launch arrives at the learning app as whoever they are signed in as *there* — usually nobody.

Three ways to close that:

1. **Reviewer signs in once on `saysomethingin.app` with their Popty email.** Zero code. One-time per person per browser, and the session persists. Combined with the role grant, everything then just works.
2. **Launcher mints a token into the URL.** I'd argue against: it puts a live credential into a URL that gets shared, logged by every proxy, and kept in browser history — a real security regression to save one sign-in.
3. **Shared auth cookie.** Not possible; different registrable domains.

**Recommendation: (1) plus the role grant.** Better (reviewers reach any round), simpler (no new code on either side, no new credential surface), cheaper (a data change and a one-time sign-in, nothing to maintain).

---

## What commissioning this actually involves

1. Set `platform_role='popty_user'` on the learner rows of the seven blocked people who have one; ask torbyrne@gmail.com to open the app once, then set theirs.
2. Tell the eight to sign in on `saysomethingin.app` with the same email they use for Popty.
3. Optionally, keep the two in step by having Popty's own admin screen offer "give this dashboard user full course access" — so the next editor added doesn't quietly hit the same wall. That part *is* code, and is the only part that is.

Step 3 is the durable version; steps 1-2 fix it today.

**Not done, by design** — it grants paid content to eight real people, which is Tom's call, and he asked for the shape rather than the action.
