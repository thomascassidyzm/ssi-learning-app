# Direct links for Sarah McAuley's South East Wales schools

2026-09-18, read against live production (Supabase `swfvymspfxmnfhevgdkg`) and verified by calling
`POST /api/code/validate` on `saysomethingin.app` for every code below. Every link in the table
answered `valid: true` with the school name shown here.

---

## The table for Sarah

Each link is the school's **standing teacher link**. A teacher opens it, types their school email
address, and is in — **no code, no email, nothing to wait for**. The links are multi-use and do not
expire. The code beside each one is the same thing typed by hand at `saysomethingin.app/redeem` for
anyone who cannot tap a link.

| School | Direct link | Access code | Notes |
|---|---|---|---|
| Ysgol Cas-gwent Chepstow School | https://saysomethingin.app/redeem/DCV-054 | DCV-054 | Set up by Angharad Jones, 16 Jul. 38 teachers, 34 classes — the furthest along |
| Ysgol Gyfun Tredegar | https://saysomethingin.app/redeem/JEG-362 | JEG-362 | Set up by Rhian Hughes (hughesr310@hwbcymru.net), 10 Sep. 9 teachers, 9 classes. **She is in and has been since 10 Sep** |
| Ysgol Gyfun Tredegar — second copy | https://saysomethingin.app/redeem/JZW-701 | JZW-701 | Set up by Sophie Morris, 4 Sep. 9 teachers, 51 classes. Two Tredegar schools exist; see "Two duplicates" below |
| Ysgol Gyfun Trefynwy / Monmouth Comprehensive | https://saysomethingin.app/redeem/VVH-560 | VVH-560 | Set up by A Aggleton, 3 Sep. 5 teachers, 17 classes |
| St Alban's RC High School, Pontypool | https://saysomethingin.app/redeem/CXK-093 | CXK-093 | Set up by Lee James, 8 Sep. 2 teachers, 13 classes |
| Ysgol Croesyceiliog | https://saysomethingin.app/redeem/EDU-067 | EDU-067 | Set up by J King, 17 Jul. 2 teachers, 3 classes |
| Newport High School | https://saysomethingin.app/redeem/SRC-324 | SRC-324 | Set up by S Vaughan, 16 Jul. 3 teachers, 2 classes |
| Rogiet Primary School | https://saysomethingin.app/redeem/BBM-409 | BBM-409 | Set up by A Parker (hwbcymru address), 1 Sep. No teachers yet beyond the head |
| Rogiet Primary School — second copy | https://saysomethingin.app/redeem/DFQ-683 | DFQ-683 | Set up by the same person on a personal gmail address, 1 Sep, an hour earlier. See "Two duplicates" |
| LA SIS (EAS) — Sarah's own | https://saysomethingin.app/redeem/QMG-091 | QMG-091 | Set up by Sarah, 16 Jul. 1 class, **no teachers have ever joined** |
| NPTC Group | https://saysomethingin.app/redeem/GUW-525 | GUW-525 | Set up by Karen Jones, 7 Sep. Neath Port Talbot, so outside South East — included because it is the same signup wave |

**A school that is not in this list yet:**

| A school not yet set up | https://saysomethingin.app/redeem/lkkEffGa77wVmnrHv-CFsA | — | One link, 25 uses, valid until 17 Dec 2026. The head of Welsh opens it, types their address, names their school, and the school is created. No email, no code. **Do not post this publicly** — each use creates a school |

---

## What is actually going on

**Nobody in Sarah's group is stuck at provisioning.** Every school above exists, is on a
`cym_s_for_eng` trial running to 2027, and every single person named as its admin has signed in
successfully. Rhian Hughes — the teacher in the brief — got in on **10 September at 08:00 UTC**,
ninety seconds after her last code was sent, and has run Ysgol Gyfun Tredegar since.

What people are hitting is **return sign-in**, and the mechanism is the one job #186 proved: Supabase
Auth keeps only ONE pending code per person, so tapping Resend silently kills the code already
sitting in the inbox. Rhian's 3 September attempt was four code requests in nine minutes against four
failed verifies. Amanda Potts at Chepstow had five sends in ninety seconds.

**The links above route around all of it.** They are possession-based: `api/auth/possession-redeem.ts`
mints the session from the link itself and sends no mail at any point.

## The one place the link does not work, and the fix

If a teacher has **already asked for a sign-in code at some point**, an account exists for that
address, and the teacher link answers *"an account already exists for this email"*. That is a
deliberate security fix from 5 September (`api/_utils/shellClaim.ts`, CWE-1188 account
pre-hijacking) and it cannot tell that person apart from an attacker.

Six people in the last fortnight are sitting in exactly that state — an account, never confirmed,
never signed in, attached to no school:

| Address | First asked | Sends | Likely school |
|---|---|---|---|
| hughesr310@**hh**wbcymru.net | 4 Sep 12:40 | 1 | Ysgol Gyfun Tredegar — a typo of her own address, made 90 seconds after two failed sends |
| jonese678@hwbcymru.net | 4 Sep 13:24 | 1 | **Not knowable from the data** — no school, no tag, no invite code touched |
| twinberrowt5@hwbcymru.net | 10 Sep 11:31 | 2, both delivered | **Not knowable from the data.** Asked again 15 Sep and still never got in — the most likely live casualty in the list |
| rebeccawintle@chepstowschool.net | 3 Sep 15:42 | 2, two minutes apart | Chepstow — the second send killed the first code |
| philipwoods@chepstowschool.**n** | 4 Sep 10:59 | 0 | Chepstow — a truncated domain, so no mail could ever arrive |
| aggletona5@monmouthshireschools.wales | 3 Sep 10:16 | 1 | Monmouth — wrong domain; she got in on her hwbcymru address the same morning |

**For these six, the rescue is a per-person Access code**, not the school link: their own school admin
opens the Teachers page, taps **Access code** on that person's row, and reads out the eight
characters. It is single-use and lasts 48 hours, which is why they are not pre-minted in this
document — one minted today is dead by Saturday. The two typo addresses need nothing at all: the
person should simply use the correct address on the school link.

## Two duplicates worth deciding about

- **Ysgol Gyfun Tredegar exists twice.** Sophie Morris's (4 Sep, 51 classes, 9 teachers) and Rhian
  Hughes's (10 Sep, 9 classes, 9 teachers). Delyth Pearsall and Sophie Morris are teachers in
  **both**. One school is being run as two.
- **Rogiet Primary School exists twice**, both created by A Parker on 1 September an hour apart —
  once on `parkera10@hwbcymru.net` and once on `antparker76@gmail.com`. Neither has a second teacher.

Neither is fixed here. Merging schools is not something a link can do.

## Sarah's own position — the honest finding

Sarah is **not a regional leader in the system**. There is no group, org or consortium for LASIS, for
EAS or for Rhanbarth y De Ddwyrain anywhere in the database, no `@lasis.org.uk` address has ever had
an account, and none of the ten schools above is attached to any parent node — every one of them has
a null `group_id`.

What she has is a single ordinary **school** row she named "LA SIS (EAS)", created 16 July on
`mcauleys51@hwbcymru.net`, with one class and no teachers. From it she can see that one school and
nothing else. The schools she has been signing up are, as far as the data is concerned, ten unrelated
strangers.

**What one action would change that:** an SSi admin mints her a `govt_admin` (group leader) code for a
new "Rhanbarth y De Ddwyrain" group, and then each school is re-parented onto it. The first half is a
single mint. The second half — attaching ten already-existing schools to a group — has **no sanctioned
self-serve route**: group attachment happens at school birth, from the invite code
(`api/code/redeem.ts`), so existing schools have to be re-parented deliberately. That is a decision
and a write, and it was out of scope for this job.

## Gaps

- The attempted school for **jonese678@hwbcymru.net** and **twinberrowt5@hwbcymru.net** genuinely
  cannot be recovered. Both went at the OTP door directly; neither touched an invite code, so nothing
  in `possession_mint_attempts`, `user_tags` or `learners` names a school. Sarah is the only person
  who can say who they are.
- Four more shells — `hughes310@hwbcymru.net`, `r.hughes@`, `rhughes@` and `rob.hughes@tredegarschool.cymru`
  — were created within three minutes of each other on 1 September with **no send logged against any of
  them**. That is somebody guessing Rhian Hughes's address from outside the normal flow, not a teacher
  signing up. Left alone.
- Per-teacher Access codes are deliberately **not** pre-minted here: 48-hour, single-use.
- Six of the eleven schools carry no `school_identity_claims` row, because the 8 September backfill
  only reached schools that existed then. This does not block anybody — an off-domain arrival still
  gets in first time — it only means those teachers are flagged "unverified" on the Teachers page.
