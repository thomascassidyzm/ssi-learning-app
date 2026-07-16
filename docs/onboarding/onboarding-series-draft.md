# Onboarding series — draft for Tom (2026-07-16)

> **Status: DRAFT COPY + DESIGN. Nothing here is wired up to send.** This doc is written to be
> edited by hand — every message is a self-contained block (subject / preheader / body) you can
> rewrite without touching anything else. Voice notes and rationale are marked so they're easy to
> delete once you've made the calls.

## Two flags before anything else

1. **Price.** The brief said "£5/mo personal premium". The live app charges **£15/mo direct
   consumer** (paywall copy in `LearningPlayer.vue`, `useCheckout.ts`); £5/mo is the
   **via-school channel price** and £10/mo the via-tutor price (locked commercial model,
   `docs/commercial-model.md`). All draft copy below says **£15/month** to match what the app
   actually shows. If personal premium is moving to £5, that's a one-word edit per message —
   but the paywall and Paddle prices would need to move with it.
2. **Sender.** The brief said "Resend on contact.saysomethingin.app". There is **no Resend (or
   any email-sending) code anywhere in this repo** — the only mail today is Supabase's built-in
   OTP pool, and `docs/schools/email-deliverability-plan.md` (2026-07-15) recommends Postmark on
   a dedicated subdomain. If a Resend account on contact.saysomethingin.app exists, it lives
   outside this codebase. The implementation sketch below treats "transactional sender" as one
   config slot — Resend and Postmark are interchangeable there; the DNS/reputation work in the
   deliverability plan applies either way.

---

## 1. The series arc

Design principles (from the codebase, not invented):

- **Email reaches the absent; in-app reaches the present.** Deliverability is structurally shaky
  for part of our audience (school mail gateways — see the deliverability plan). So nothing
  *functional* may depend on an email arriving. Email = verification, re-engagement, billing.
  Feature discovery (turbo, listening, offline, skipping) happens **in-app**, where the learner
  demonstrably is.
- **No streak guilt, ever.** `docs/gamification-done-right.md` is explicit: streaks, visible
  points, "you're falling behind" framing are toxic. Every absence nudge below is framed as
  *the door is open*, never *you broke something*.
- **Don't duplicate Aran's coaching.** The in-player meta-commentary already teaches the method
  (speak out loud, mistakes are fine) in situ during the first rounds. Emails point at the
  method; they don't re-teach it.
- **Progress = what you can say**, never numbers. Position is the last LEGO played, shown as its
  own content in both languages (owner ruling). The day-7 email pulls the learner's actual
  latest phrase — that's the whole punch of it.
- **Few messages, each earning its place.** Seven total. Anyone active and verified gets as few
  as three emails in their first fortnight.

### The arc at a glance

| # | When | Trigger | Channel | Message |
|---|------|---------|---------|---------|
| 1 | Day 0, ~1h after signup | `needs_verification` still true | **Email** | Verify your email (REQUIRED — signal being built by another worker) |
| 2 | Day 1 | time-based, everyone | **Email** | Welcome / the one rule (say it out loud) |
| 3 | Day 3 | **no session since signup** | **Email** | Gentle re-open — "ten minutes is a real session" |
| 4 | Session 3–4, in-player | ≥3 sessions AND never used listening mode | **In-app** | Listening mode tip |
| 5 | Session 5+, in-player | ≥5 sessions AND playback speed never changed | **In-app** | Speed / turbo tip |
| 6 | Day 7 | ≥2 sessions in week 1 | **Email** | "Here's what you can already say" — their actual latest phrase |
| 7 | Approaching end of yellow (~seed 17+), or on first paywall hit | behaviour | **Email** (+ existing in-app paywall) | What premium is, warmly, before the wall |

Deliberately **not** in the series:

- **Offline-mode nudge** — offline is premium-only; pitching it to a free-trial learner is a
  paywall ad dressed as a tip. It belongs *inside* message 7 and in the post-subscribe welcome
  (out of scope here — worth a follow-up "you're in, here's everything you unlocked" email).
- **Skipping-around tip** — real feature, but a new learner in week one has nowhere to skip *to*.
  Belongs in a later "returning learner" surface, not onboarding.
- **Belt-promotion emails** — belts already celebrate themselves in-app at the moment they
  happen; an email hours later is noise. (And per the gamification doc, we show results, not
  mechanics.)

### Channel rationale per message

- **1 (verify) = email by definition** — it's proving the inbox works.
- **2 (welcome) = email** — it's the one durable artifact of "what is this thing I signed up
  for"; also lands in the inbox they just verified, reinforcing the sender.
- **3 (re-open) = email only makes sense** — the learner isn't in the app to see anything else.
  Sent *only* to the not-yet-played; someone who played on day 2 never sees it.
- **4, 5 (feature tips) = in-app only** — a tip about a button belongs next to the button, at
  the moment it's usable. Email about UI is where onboarding series go to die.
- **6 (what you can say) = email** — its job is to be read *away* from the app and pull the
  learner back with proof. It's also the emotional core of the series.
- **7 (premium) = email before the wall** — hitting a paywall cold feels like a trap; an email
  a couple of days early ("heads up, here's the deal, here's why") makes the wall a known
  thing. The in-app paywall itself already exists and stays as-is.

---

## 2. Draft copy

Voice notes (delete after reading): studied from the live paywall/offline-lock copy ("nothing is
lost", "You can always learn online for free", "Cancel anytime"), the onboarding flow, and the
gamification doc's core line — *"We help them notice that they're becoming someone they didn't
think they could be."* Warm, direct, short sentences, zero corporate polish, British English.
No "unlock your potential", no "we miss you!", no emoji, no fake urgency. Sender name suggestion:
**"Aran at SSi"** or plain **"SSi"** — one human-ish sender for the whole series.

---

### Message 1 — Verify your email
**Channel:** Email · **Trigger:** ~1 hour after signup, `needs_verification` still true.
**Resend:** once more at 24h if still unverified, then stop.

**Subject:** One tap to secure your SSi account

**Preheader:** So your progress is yours on any device.

**Body:**

> Hi,
>
> You're in — your course is ready and nothing is blocking you from learning right now.
>
> One small thing: tap below to confirm this email address. It's how we make sure your
> progress belongs to you — so you can pick up exactly where you left off on any phone,
> tablet or computer, and get back in if you ever lose a device.
>
> **[Confirm my email]**
>
> That's it. No account settings to fill in, no profile to build. Go and say some things
> out loud instead.
>
> — the SSi team

*(Design note: copy deliberately says learning is NOT blocked — possession-onboarded accounts
work fine unverified; the verify is framed as protecting progress, which is the true stake.)*

---

### Message 2 — Welcome / the one rule
**Channel:** Email · **Trigger:** Day 1, everyone (verified or not).

**Subject:** The only rule at SSi

**Preheader:** Say it out loud. Everything else is optional.

**Body:**

> Hi,
>
> Welcome to SSi. Before the usual "getting started" tips, here's the only one that
> actually matters:
>
> **Say it out loud.** Not in your head. Out loud.
>
> The app plays you a phrase in English, gives you a pause, and you speak — before you
> hear the answer. That pause is where the learning happens. It will feel too soon. It's
> supposed to. Wrong, half-right, mumbled into your coffee — all of it counts, all of it
> works.
>
> A few things you don't have to do:
>
> - You don't have to remember anything. The course brings everything back at the right
>   moment — that's its job, not yours.
> - You don't have to keep a streak. Miss a day, miss a week — the app waits exactly
>   where you left it.
> - You don't have to "study". No grammar tables, no vocabulary lists. Just press play
>   and speak.
>
> Ten minutes today is a real session. See you in there.
>
> — the SSi team
>
> **[Continue learning]**

---

### Message 3 — Gentle re-open (not-yet-played only)
**Channel:** Email · **Trigger:** Day 3, zero sessions since signup. Never sent to anyone
who has played.

**Subject:** Your course is still sitting there, ready

**Preheader:** Ten minutes counts. No catching up required.

**Body:**

> Hi,
>
> You signed up a few days ago and haven't had a chance to start yet — which is fine.
> Life does that.
>
> Just so you know what's actually waiting: no setup, no placement test, no lesson plan.
> You press play, hear a phrase, and say it out loud. Ten minutes in you'll have said
> your first sentences in a new language — actually said them, with your mouth.
>
> There's nothing to catch up on. The course starts wherever you are.
>
> **[Press play]**
>
> — the SSi team
>
> *(If you've decided this isn't for you, that's fine too — you won't get a stream of
> these. This is the only nudge.)*

*(Design note: that last line is a promise the trigger model keeps — message 3 fires once,
ever. It's the anti-Duolingo move and worth stating outright.)*

---

### Message 4 — Listening mode tip
**Channel:** In-app (dismissible card on the player resting state, before a session starts).
**Trigger:** ≥3 completed sessions AND listening mode never activated.

**Copy (card, ~2 lines + button):**

> **For the times you can't speak out loud**
> Listening mode replays what you've learned while you do something else — walking,
> driving, washing up. No pauses, no pressure. It's in the mode tray, next to play.
>
> [Try listening mode] · [Not now]

*(Design note: matches the existing in-app description "Passive review — let phrases wash over
you while you relax". "Not now" dismisses permanently — a tip that re-nags is a nag.)*

---

### Message 5 — Speed / turbo tip
**Channel:** In-app (same card surface). **Trigger:** ≥5 completed sessions AND playback
speed never changed AND turbo never used.

**Copy:**

> **Feeling comfortable? Make it harder.**
> If the pauses are starting to feel roomy, nudge the speed up in Settings — or try
> Turbo in the mode tray. Struggling to keep up is the point; comfortable means ready
> for more.
>
> [Okay] · [Not now]

---

### Message 6 — What you can already say
**Channel:** Email · **Trigger:** Day 7, ≥2 sessions in the first week. Personalised: pulls
the learner's **latest LEGO played**, both languages, plus minutes practised.

**Subject:** A week ago you couldn't say this

**Preheader:** {{target_phrase}}

**Body:**

> Hi,
>
> One week in. Here's the most recent thing your course handed you — and you said:
>
> > **{{target_phrase}}**
> > *{{known_phrase}}*
>
> Read that again. A week ago that was noise. Now it's yours — not memorised, not
> revised, just built up from everything underneath it, said out loud in a pause that
> felt too short.
>
> That's the whole method, and it keeps working exactly like this: what you can say
> keeps growing, sentence by sentence, whether or not it feels like it's going in.
>
> You've put in {{minutes_practised}} minutes so far. Keep going exactly as you are.
>
> **[Continue learning]**
>
> — the SSi team

*(Design note: this is the "position is the last LEGO played, displayed as its own content"
ruling made into an email. No seed numbers, no percentages, no belt mechanics — the phrase IS
the progress report. If the latest LEGO's text isn't cleanly fetchable server-side at send
time, this message is not worth sending in a degraded numbers-only form — hold it until the
data path exists.)*

---

### Message 7 — Before the wall (premium)
**Channel:** Email · **Trigger:** progress reaches ~seed 17 (two seeds before the free preview
ends at end-of-yellow), OR immediately after first paywall hit if they got there before the
email fired. Sent once. Never sent to already-subscribed, school-channel, or code-holding
learners.

**Subject:** You're about to finish the free part

**Preheader:** Here's exactly what happens next — no surprises.

**Body:**

> Hi,
>
> You've nearly finished the free preview — which, given where you started, is worth
> pausing on. That's real spoken language you didn't have a few weeks ago.
>
> Here's the honest picture of what happens next:
>
> - **The free preview ends** at the end of the yellow belt. You'll hit a subscribe
>   screen in the app when you get there.
> - **Premium is £15/month.** That's every course we have — 65+ languages — plus
>   downloads so you can learn offline, with new courses added all the time. Cancel
>   anytime, and everything you've learned stays yours.
> - **Not ready? Also fine.** Your progress doesn't expire. Come back next month or
>   next year and you'll be exactly where you left off.
>
> No discount countdown, no "offer ends Friday". The price is the price and the course
> will wait.
>
> **[Go Premium — £15/month]**
>
> — the SSi team

*(Design note: "no discount countdown" is a voice bet — it reads as trustworthy and very SSi,
but it does close the door on ever running intro offers to this cohort. Your call.)*

---

## 3. The trigger model

**Hybrid: time-gated behaviour checks, evaluated by one daily cron.** Pure time-based drip
ignores what the learner did; pure behaviour-triggered needs event infrastructure we don't
have. The cheap composite: a daily sweep asks, per learner in their first ~30 days, "which
messages are due AND condition-true AND not yet sent?"

Signals — **all already exist in the DB** except the first:

| Signal | Source |
|---|---|
| `needs_verification` | being built by another worker (message 1 depends on it) |
| signup moment | `learners.created_at` |
| has played / session count / minutes | `player_events` (+ `daily_contributions` for cheap day-grain) |
| latest LEGO played + its text | progress tables → `course_legos` (the position ruling's `highest_completed_lego_id` path) |
| listening / turbo / speed usage | `player_events` payloads (mode + `playbackSpeed` already logged) |
| approaching end of yellow | progress vs belt threshold (yellow ends at seed 19) |
| subscribed / channel / code-holder | entitlement + subscription state (`api/me/subscription.ts` logic) |

Idempotency rule: **one row per (learner, message) in a send log; presence = never send
again.** This is also what makes message 3's "this is the only nudge" promise true, and makes
the cron safe to re-run.

In-app messages (4, 5) don't go through the cron at all — the client already knows session
count and mode usage; a composable evaluates the same predicates locally and shows/dismisses
cards, with dismissals persisted per-learner (localStorage + a learner column or the same send
log via a lightweight endpoint, so dismissing on the phone dismisses on the laptop).

Unsubscribe scope: messages 2, 3, 6 are marketing-ish → honour an `email_opt_out` flag and
include an unsubscribe link. Messages 1 (verification) and 7 (billing-consequence notice) are
transactional and always send.

---

## 4. Implementation sketch — what's missing to send these

Nothing in this repo sends email today. The full gap list, cheapest-first:

| Piece | What it is | Effort |
|---|---|---|
| **Transactional sender config** | Resend or Postmark account + API key in Vercel env + DNS (SPF/DKIM/DMARC on a dedicated subdomain — the deliverability plan §3C has the exact records). Config + DNS, not code. If the Resend/contact.saysomethingin.app account from the brief exists, this is already half-done — needs confirming outside the repo. | ~½ day + DNS propagation |
| **`learner_messages` send-log table** | `(learner_id, message_key, sent_at, channel)`, unique on (learner_id, message_key). Service-role-only posture per the RLS doctrine. Doubles as the in-app dismissal store. | ~½ day incl. migration |
| **Sender module** | `api/_utils/sendEmail.ts` — one function, provider behind it, templates as plain TS string functions in `api/_utils/emails/` (7 small functions, easy to hand-edit — no template service, no MJML; simple HTML + text part). | ~1 day |
| **Daily cron** | `api/cron/onboarding-messages.ts` + one line in `vercel.json` `crons` (pattern already exists: `teacher-payouts`). Sweeps learners with `created_at > now()-35d`, evaluates §3 predicates, sends due messages, writes the log. Excludes test learners via the existing canonical test-learner set. | ~1–2 days incl. predicate queries + tests |
| **Message-6 data path** | Server-side "latest LEGO + text for learner X" query. The position model defines it; needs a clean server util (may partially exist in the schools progress endpoints). | ~½–1 day |
| **In-app tip surface** | One dismissible card component on the player resting state + `useOnboardingTips` composable (predicates + dismissal persistence). No notification centre, no store — two tips don't justify one (the parked first-boot doc's "tips surface" idea agrees: deferred, dismissible, not at first boot). | ~1–2 days |
| **`needs_verification`** | In flight with another worker — message 1 blocks on it; everything else doesn't. | external |

**Total: roughly 4–6 working days** for the whole pipeline, and it's severable — the sender
config + send log + cron with just messages 2/3/7 is a shippable first slice (~2–3 days);
message 1 lands when the verification signal does; 4/5/6 follow independently.

Explicitly not built (BSC: no consumer yet): template-service integration, A/B machinery,
open-rate tracking beyond the provider's built-in dashboard, a generic notification centre.
