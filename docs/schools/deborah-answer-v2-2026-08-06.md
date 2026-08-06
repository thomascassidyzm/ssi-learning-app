# Answer for Deborah — the practice, the missing Manager, and the two orgs

Short version: **you did everything right, and the app recorded every bit of it.** Three
separate faults on our side combined to make it look like nothing had happened. All three
are now fixed, and you are now shown as the Manager of both your orgs.

---

## 1. Your test learner's practice was recorded — all of it

- They opened Chinese at **9:35** and listened for about three minutes.
- They started **German at 9:38** and got to the third building block of the first sentence.
- Two practice sessions, thirty playback events, both courses enrolled, German last
  practised at **9:39**.

Exactly what you said you did. Nothing was lost and nothing needs re-doing.

## 2. Why the screen said nobody had practised

The org dashboard could only count practice that arrives **through a class, inside a
school**. Your org isn't built that way — you invited a person straight in, no school, no
class — so the practice counter had no class to look in and returned **zero hours** every
time. A message then appears automatically whenever a group has people but zero hours:
*"none of them has practised yet"*. Because the hours could never be anything but zero,
that message was guaranteed to show forever. Refreshing could never have helped.

Fixed: practice by people invited directly into a group now counts.

## 3. Why there was no Manager — and why that was the strangest part

You were right that something was off, and the ledger on that same screen was the clue: it
showed your name, **Sra Deborah**, against the link you'd created. So the app plainly knew
who you were — and still listed no Manager at all.

Here's what was happening. When you create an org, we recorded you as its leader in the
part of the system that decides **what you're allowed to do** — which is why you could see
the org and send invites at all. But we never recorded you as a **member** of it, and the
member list is what the page actually displays. You ended up running an org you weren't
in. There wasn't even a line saying "no manager"; the space was simply blank, which is
why it was easy to miss.

Two things are fixed:

- **From now on, whoever creates a group or org is automatically its first Manager** — as a
  member, not just as a permission.
- **The org page now names its Manager**, reading "Led by …" under the org name. If an org
  genuinely has no manager it now says "No group leader yet" out loud, instead of showing
  nothing at all.

**And we've repaired your two existing orgs by hand: you are now the Manager of both.** We
added three membership records and logged every one, so it can be undone cleanly if Tom
wants it differently. We did **not** delete, merge or change anything else.

## 4. Why the link said "USES 0"

Also not what it looked like. Your link is a **personal** link — made for one named person,
Test Person 1. That kind of link works differently from a shared class join code: the
person is added to your org the moment you create the link, and the link then acts as
their way back in, again and again. It's never "used up", so the uses counter sat at 0
permanently. It could never have moved, even though your learner had in fact signed in
through it **twice**.

Fixed: personal links now show how many times that person has actually signed in, and say
**"Not yet"** rather than a bare 0 when they haven't. Shared join codes are unchanged and
still count real joins.

## 5. Your two orgs — which one to use

You have two orgs, both named **"Deborah Testing"**. They look identical, so the only way
to tell them apart is **which account you sign in with**:

| Sign in as | What's in it |
|---|---|
| **euskiwicymraeg+1@gmail.com** (Sra Deborah) — created Tuesday evening | Your Test Learner, your invite link, all the practice |
| **euskiwicymraeg+mgr@gmail.com** (Deb Test Manager) — created this morning | Empty — no people, no links, no data |

**Use the first one.** That's where your Test Learner and the German practice are.

The second one appeared because of how the app worked: when someone signs in as a leader
and has no org, we gave them a brand-new one automatically. So creating the "+mgr" account
to play the Manager didn't join your existing org — it silently started a second one with
the same name. That's on us, not you.

We are **not deleting anything** — that's Tom's decision. Our recommendation is to keep the
first and remove the empty one, because the first holds data that can't be recreated.

One consequence worth knowing: you are now **shown** as Manager of both, but signing in to
the second one still means using the "+mgr" account, because the app currently allows one
person to hold the leader's seat of only one org. That limit is on Tom's list.

While both orgs existed with the same name, they were also being treated as the same org
in the counts, so each was showing the other's people. That's fixed too.

---

## What to do now

1. **Sign in as euskiwicymraeg+1@gmail.com** and work in that org.
2. **None of this is live for you yet.** All four fixes are written, tested and handed
   over, but they still have to be released. If you look right now you'll see the old
   screens — expected, not a new fault. Tom will say when it's out.
3. **Once it's out**, your org page should show **"Led by Sra Deborah"** under the name,
   about **0.1 hours** of practice, the "none of them has practised yet" note gone, and the
   link showing your learner's sign-ins instead of "0".
4. Worth testing next, if you'd like: create a school and a class inside your org and put
   a learner in it. That's the more usual shape and is worth confirming alongside the
   direct-invite route you've just been through.

If anything doesn't match what you see, tell us what you did and what the screen said —
your account has been right every time, and it's the fastest way in.
