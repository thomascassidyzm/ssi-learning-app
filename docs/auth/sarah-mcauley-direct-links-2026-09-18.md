# Sarah McAuley — top-level seat and direct links for her South East Wales schools

2026-09-18, against live production (Supabase `swfvymspfxmnfhevgdkg`). Every link below was verified
by calling `POST /api/code/validate` on `saysomethingin.app` — all of them answered `valid: true`
with the group or school name shown here.

---

## 1. Sarah's own way in — top-level regional seat

**https://saysomethingin.app/group/Cjtp8FwMn3uEmmHO-eh7YA**

She opens it, types **sarah.mcauley@lasis.org.uk**, and she is in. No code, no email, nothing to wait
for — the session is minted from the link itself (`api/auth/possession-redeem.ts` sends no mail at any
point). It lands her as group leader of **SSIW - Rhanbarth y De Ddwyrain**, with all ten schools below
her. Good for 3 uses, valid until 17 December 2026. It is a personal credential: whoever opens it
becomes the leader of that region, so it goes to her and nobody else.

### What was created to make that seat exist

There was no LASIS, EAS or De Ddwyrain org in the database at all, and no `@lasis.org.uk` address had
ever had an account. Three things were created, and nothing else was changed:

1. **A top-level group**, `SSIW - Rhanbarth y De Ddwyrain` (id `9f410d6b-f30f-497e-9dfd-eaa35aef6a7c`,
   type `region`, no parent). Not billed — the schools keep their own trials.
2. **The ten EAS schools attached to it.** Each one had a null `group_id` and a parentless node
   beforehand; both now point at the new group. Before-state and after-state for every row are in
   `tools/` alongside this document. Reversing it is the same two columns set back to null.
3. **Her leader link**, the `govt_admin` invite code above, granting that group.

She will end up with **two accounts**: her existing `mcauleys51@hwbcymru.net`, which is the school
admin of the "LA SIS (EAS)" school row, and this new `sarah.mcauley@lasis.org.uk` one, which is the
regional leader. The leader account sees all ten schools including that one. Worth telling her so the
Hwb login is not a surprise.

**NPTC Group was deliberately left out.** It is Neath Port Talbot, outside EAS, and attaching it would
have put another consortium's college under her.

---

## 2. Straight-in links for each school

One per school, to hand to that school. Multi-use, no expiry. The code beside each is the same thing
typed by hand at `saysomethingin.app/redeem` for anyone who cannot tap a link.

> **These links are for teachers who have NEVER asked us for a sign-in code.** They open the link,
> type their school email address, and are in — no code, no email. But if an account already exists
> for that address, the link stops with *"an account already exists for this email"*, and it does
> that whether or not the account was ever confirmed (`api/auth/possession-redeem.ts`). **Anybody who
> has ever tapped "send me a code" is in that state.** Section 3 says exactly what each of them uses
> instead.

| School | Direct link | Access code | Notes |
|---|---|---|---|
| Ysgol Cas-gwent Chepstow School | https://saysomethingin.app/redeem/DCV-054 | DCV-054 | Set up by Angharad Jones, 16 Jul. 38 teachers, 34 classes — the furthest along |
| Ysgol Gyfun Tredegar | https://saysomethingin.app/redeem/JEG-362 | JEG-362 | Set up by Rhian Hughes, 10 Sep. 9 teachers, 9 classes |
| Ysgol Gyfun Tredegar — second copy | https://saysomethingin.app/redeem/JZW-701 | JZW-701 | Set up by Sophie Morris, 4 Sep. 9 teachers, 51 classes. Two Tredegars exist — see below |
| Ysgol Gyfun Trefynwy / Monmouth Comprehensive | https://saysomethingin.app/redeem/VVH-560 | VVH-560 | Set up by A Aggleton, 3 Sep. 5 teachers, 17 classes |
| St Alban's RC High School, Pontypool | https://saysomethingin.app/redeem/CXK-093 | CXK-093 | Set up by Lee James, 8 Sep. 2 teachers, 13 classes |
| Ysgol Croesyceiliog | https://saysomethingin.app/redeem/EDU-067 | EDU-067 | Set up by J King, 17 Jul. 2 teachers, 3 classes |
| Newport High School | https://saysomethingin.app/redeem/SRC-324 | SRC-324 | Set up by S Vaughan, 16 Jul. 3 teachers, 2 classes |
| Rogiet Primary School | https://saysomethingin.app/redeem/BBM-409 | BBM-409 | Set up by A Parker on his hwbcymru address, 1 Sep. No teachers yet |
| Rogiet Primary School — second copy | https://saysomethingin.app/redeem/DFQ-683 | DFQ-683 | Same person, personal gmail, an hour earlier. See below |
| LA SIS (EAS) — Sarah's own school row | https://saysomethingin.app/redeem/QMG-091 | QMG-091 | Set up by Sarah, 16 Jul. 1 class, no teachers have ever joined |
| NPTC Group | https://saysomethingin.app/redeem/GUW-525 | GUW-525 | Karen Jones, 7 Sep. Neath Port Talbot — **not** under Sarah's group |

**A school that does not exist yet:**

| A new school | https://saysomethingin.app/redeem/lkkEffGa77wVmnrHv-CFsA | — | 25 uses, valid to 17 Dec 2026. The head of Welsh opens it, types their address, names their school, and the school is created **inside Sarah's region**. No email, no code. **Do not post it publicly** — each use creates a school |

---

## 3. What is actually going wrong for teachers

**Nobody is stuck at provisioning.** Every school above exists, runs a `cym_s_for_eng` trial into
2027, and every person named as its admin has signed in successfully. Rhian Hughes — the teacher in
the brief — got in on **10 September at 08:00 UTC**, ninety seconds after her last code was sent, and
has run Ysgol Gyfun Tredegar since.

What people hit is **return sign-in**. Supabase Auth keeps only ONE pending code per person, so
tapping Resend silently kills the code already sitting in the inbox. Rhian's 3 September attempt was
four code requests in nine minutes against four failed verifies; Amanda Potts at Chepstow had five
sends in ninety seconds. Every link in this document routes around that entirely.

### Three doors, and who needs which

| Who they are | What they use | Who can give it |
|---|---|---|
| **A. Never touched SSi.** No account of any kind | The school's link from the table above | Anyone — it is a standing link |
| **B. Has a working account and is already on their school's Teachers page**, but cannot receive a code | **Access code** on their own row on the school's Teachers page — an eight-character code, or `saysomethingin.app/join/ABCD-EFGH`. Single use, 48 hours | Their own school admin, on the spot. Also: a password, if they ever set one, at `saysomethingin.app/schools` |
| **C. Asked for a code once, never got in, and belongs to no school.** Six people, listed below | **Only an SSi admin can help.** `/intel/person` → *"Make a one-off sign-in link"*. It is a magic link, single use, about an hour | SSi, and nobody else |

**Door B is not available to the six people in group C**, and that is the correction worth knowing:
the Teachers-page Access code refuses anyone who is not already staff at that school
(`api/school/staff-signin-link.ts` answers *"That person is not a member of your school"*), and all
six belong to no school — that is exactly what makes them stuck. Their school admin cannot rescue
them; only SSi can.

The six:

| Address | First asked | Sends | Likely school |
|---|---|---|---|
| hughesr310@**hh**wbcymru.net | 4 Sep 12:40 | 1 | Tredegar — a typo of her own address, 90 seconds after two failed sends |
| jonese678@hwbcymru.net | 4 Sep 13:24 | 1 | **Not knowable from the data** |
| twinberrowt5@hwbcymru.net | 10 Sep 11:31 | 2, both delivered | **Not knowable from the data.** Asked again 15 Sep and still never got in — the most likely live casualty |
| rebeccawintle@chepstowschool.net | 3 Sep 15:42 | 2, two minutes apart | Chepstow — the second send killed the first code |
| philipwoods@chepstowschool.**n** | 4 Sep 10:59 | 0 | Chepstow — truncated domain, so no mail could ever arrive |
| aggletona5@monmouthshireschools.wales | 3 Sep 10:16 | 1 | Monmouth — wrong domain; she got in on her hwbcymru address the same morning |

Three of them — the two typos and the wrong-domain one — need **nothing at all**: the person should
use their correct address on their school's link, which has no account behind it and lets them
straight in. The other three need the SSi-minted link. Because it lasts about an hour, it has to be
minted while the person is at their keyboard, not emailed ahead.

**Once signed in that way they are not yet in their school** — they hold a session and nothing else.
They then open their school's link from the table above, and because they already have a session the
page asks them to confirm rather than asking for a credential, and joins them (`RedeemCode.vue`).
Two taps, both while SSi is on the phone with them.

The permanent fix for all of this is job #188 — making the code step idempotent and cooling the
Resend button, so a second code request stops killing the first. Until that ships, the table above
is the whole of what a teacher can actually do today.

## 4. Two duplicates worth deciding about

- **Ysgol Gyfun Tredegar exists twice** — Sophie Morris's (4 Sep, 51 classes) and Rhian Hughes's
  (10 Sep, 9 classes). Delyth Pearsall and Sophie Morris are teachers in **both**. One school is being
  run as two.
- **Rogiet Primary School exists twice**, both created by A Parker on 1 September an hour apart, once
  on `parkera10@hwbcymru.net` and once on `antparker76@gmail.com`.

Neither is merged here. Merging schools is not something a link can do, and it loses somebody's
classes if it is done carelessly.

## 5. Gaps

- The attempted school for **jonese678@hwbcymru.net** and **twinberrowt5@hwbcymru.net** genuinely
  cannot be recovered — both went at the OTP door directly and touched no invite code, so nothing in
  `possession_mint_attempts`, `user_tags` or `learners` names a school. Sarah is the only person who
  can say who they are.
- Four more shells — `hughes310@hwbcymru.net`, `r.hughes@`, `rhughes@` and
  `rob.hughes@tredegarschool.cymru` — were created within three minutes of each other on 1 September
  with **no send logged against any of them**. That is somebody guessing Rhian Hughes's address from
  outside the normal flow, not a teacher signing up. Left alone.
- The seat and the attachments are verified by replicating `schoolsForGroupSubtree`'s own parent_id
  walk against live data: 11 nodes, 10 schools. They have **not** been verified by signing in as
  Sarah — that would mean redeeming her link before she does.
- **Corrected 10:20 on 2026-09-18**, after a cold-check of the first version of this document. The
  new-school link was minted with no group on it, so a school created through it would have landed
  outside Sarah's region; that is fixed and re-verified, and no school had been created through it in
  the meantime. And the first version said the school links get a teacher in without saying loudly
  enough that an existing account stops them — section 3 above is the corrected instruction.
- Six of the eleven schools carry no `school_identity_claims` row, because the 8 September backfill
  only reached schools that existed then. It blocks nobody — an off-domain arrival still gets in first
  time — it only means those teachers show as "unverified" on the Teachers page.
