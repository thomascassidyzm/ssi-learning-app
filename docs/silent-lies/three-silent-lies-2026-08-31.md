# Three things the app was telling learners that weren't true

Fixed 2026-08-31. All three had the same shape: the app said something
reassuring, the thing it described had not happened, and nothing anywhere
recorded that it had gone wrong.

---

## 1. The join code that let someone in without letting them in

**What it did to a real person.** A teacher clicks their school's invite link,
types their email, gets the six-digit code, types it in. The modal congratulates
them and closes. They are signed in — and that is genuinely all that happened.
They were never added to the school. They never got the entitlement. If the
redemption had failed a moment earlier, a line went into the browser console
that nobody would ever read, and then the app told them they were in anyway.
There was a second, worse version of the same hole: if the app had no database
connection at that moment, the redemption was skipped entirely and success was
*still* declared.

This is the money path. The place may have been paid for.

**What they see now.** The modal stays open and says:

> You're signed in, but we couldn't add your code to your account. Your code is
> safe — tap Try again.

with a **Try again** button. Their code is still held, so the retry re-runs
only the part that failed — nothing has to be re-typed and nothing is spent.

**What we see now.** A `console.error` at a level production doesn't strip, and
a `code_redemption_failed` row in `player_events` carrying the screen, the
email and a reason. Never the code itself.

The full Redeem Code screen — the twin of this one — has always checked the
result before declaring success. This path now behaves the same way.

---

## 2. The returning learner sent back to lesson one

**What it did to a real person.** Someone three hundred rounds into French
opens the app on a new phone — or after reinstalling, or after clearing their
storage — and the connection is bad. The app tries to fetch the small map that
says which lesson sits at which round. The fetch fails. That failure got quietly
swallowed and read as *"this person is brand new."* So they were put at round
one, at the very first lesson, with nothing on screen to suggest anything had
gone wrong.

Their real progress was never lost. It was sitting safely on the server the
whole time. The app just never told them that, and they had no way to know.

**What they see now.** A failure is now treated as what it is — *we don't know*,
not *they're new*. The app falls back to the older, slower loader that was built
for exactly this case. If that one also can't reach their position, it stops and
says:

> We couldn't load where you got to. Your progress is safe — have another go.

with a **Try again** button, instead of pretending they're starting from scratch.

**Nothing was written anywhere.** Their stored position is forward-only and was
never in danger. This was a display and resolution fault, not a data repair, and
the fix is entirely read-side.

---

## 3. The one missing setting that broke sign-in for everybody

**What it did to a real person.** If a single build-time setting was absent, the
app never created its database connection at all. Every sign-in — every person,
every time — answered *"App not ready. Please try again."* Forever. Trying again
could never work, because nothing was going to change. And there was no log
anywhere: not in the console, not in telemetry. Nobody would know until someone
complained.

**What they see now.**

> Sign-in isn't working at our end right now. This one's on us, not you — please
> try later, or email admin@saysomethingin.com.

It owns the fault, it doesn't send them into a retry loop that cannot succeed,
and it doesn't blame their phone. Two buttons that previously did literally
nothing when tapped — Verify, and Resend — now say the same thing rather than
sitting silent.

**What we see now.** A `console.error` that names the exact missing settings.
A five-second fix instead of a mystery.

---

## The rule underneath all three

None of these messages blames the learner or their device for our fault. Where
the app broke, the app says so.
