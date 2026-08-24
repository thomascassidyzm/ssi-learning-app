# Answer for Deborah — why your Manager screen said nobody had practised

Short version: **you did everything right, and the app recorded every bit of it.** The
practice was there the whole time. The org screen was looking in the wrong place, and it
then stated the wrong conclusion as a fact. That's our defect, not your test.

There's also a second thing worth knowing, which is why Tom couldn't find a Manager: you
now have **two orgs with the identical name**, and only one of them is the real one.

---

## What actually got recorded

Your Test Learner's session is all there:

- They opened Chinese first at **9:35**, listened for about three minutes, then switched.
- They started **German at 9:38**, and got as far as the third building block of the first
  sentence.
- The app logged **two practice sessions**, thirty separate playback events, and both
  courses as enrolled — with German last practised at **9:39**.

So when you said you'd chosen German and listened to a few phrases, that is exactly what
the data shows. Nothing was lost, and nothing needs re-doing.

---

## Why the screen still said nobody had practised

Up to now, the org dashboard could only count practice that arrives **through a class,
inside a school**. That's how every school we'd set up was built: school → class →
students, and the practice total is added up class by class.

Your org isn't built that way, and it didn't need to be. You created an org and invited a
person straight into it — no school, no class. That's a perfectly sensible way to test, and
it's a shape we want to support. But the practice counter had no class to look in, so it
came back with **zero hours** every single time, no matter how much anyone practised.

Then a second thing made it worse. There's a helpful message that appears when a group has
people in it but zero hours on the clock — it reads *"…none of them has practised yet"*.
Because the hours could never be anything but zero for your org, that message was
guaranteed to appear forever, and it said it as a plain statement of fact. Refreshing could
never have helped.

**Both halves are now fixed.** Practice by people invited directly into a group is counted
towards the group's hours, so your German session will show up and that message will stop
appearing once anybody has practised.

---

## The two orgs — which one is yours

You have two orgs, both called **"Deborah Testing"**. They look identical on screen, so
there's no way to tell them apart by looking. The difference is **which account you sign in
with**:

| Sign in as | What's in it |
|---|---|
| **euskiwicymraeg+1@gmail.com** (Sra Deborah) — created Tuesday evening | Your Test Learner, your invite link, all the practice |
| **euskiwicymraeg+mgr@gmail.com** (Deb Test Manager) — created this morning | Empty. No people, no links, no data |

**Use the first one — the one you sign in to as euskiwicymraeg+1@gmail.com.** That's where
your Test Learner lives and where the German practice is.

The second one appeared because of how the app works today: when someone signs in as a
leader for the first time and doesn't have an org, the app gives them a brand-new one
automatically. So creating the "+mgr" account to play the Manager didn't join your existing
org — it silently started a second one with the same name. Nothing you did wrong; the app
should have made that visible, and we're flagging it.

We are **not deleting anything** — that's Tom's call. Our recommendation to him is to keep
the first org and remove the empty one, because the first holds the only data that can't be
recreated.

While both exist, one more thing was going wrong that's now fixed: because they share a
name, the app was treating them as the same org in its counts, so each one was showing the
other one's people. That's why the numbers wouldn't have made sense either way.

---

## "Who is the Manager?"

You *are* the Manager of your org — the app knows it, which is why you can see the org at
all and why you were able to send an invite.

But there's a gap: the org page doesn't currently show **who leads it** anywhere. The
leader is recorded behind the scenes for permissions, and never displayed. So when Tom
looked at your org to find the Manager, there was genuinely nothing on screen to find, even
though you were right there in the records. We're putting that to Tom as a change to make —
we haven't changed it yet, because where it should appear and what it should be called is
his call.

---

## One thing that will look wrong but isn't

On the list of invite links, the one you sent your Test Learner shows **0 uses**. Ignore
it. When you create a personal link for a named person, the app adds that person to your
org straight away — they're a member from the moment you create the link, before they've
clicked anything. The counter only moves for the older style of shared join code. So "0
uses" next to someone who is clearly in and practising is the counter being useless here,
not a sign they haven't joined. We've flagged that wording too.

---

## What to do now

1. **Sign in as euskiwicymraeg+1@gmail.com** and work in that org from now on. Ignore the
   other one until Tom decides what to do with it.
2. **The practice-hours fix is not live yet.** It's written, tested and handed over, but it
   still has to be released. So if you look right now, you'll still see the old message —
   that's expected, not a new fault. Tom will tell you when it's out.
3. **Once it's out**, open your org page and you should see roughly **0.1 hours** of
   practice recorded, and the "none of them has practised yet" note should be gone.
4. If you'd like to test the more usual school shape as well, create a school and a class
   inside your org and put a learner in it — that path was already working and is worth
   confirming alongside the direct-invite path you've just been through.

If anything else doesn't match what you saw, tell us what you did and what the screen said
— your account of it has been right both times, and it's the fastest way in.
