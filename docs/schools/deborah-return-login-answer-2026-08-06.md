# Logging in next time, and the Verify Email button

Answering Deborah's two questions from testing with a real test learner.

## How does a learner log in after the first time?

**Most of the time they won't have to.** The app keeps them signed in on that device
and browser, and quietly renews the session in the background. On a phone that has
the app added to the home screen, a learner who came in through the emailed link will
just open it and be straight back in their course — no login screen at all. That is
the normal experience and it's what nearly every learner will actually see.

They only meet a login screen in three situations: they sign out on purpose, they clear
their browser data, or they pick up a different device.

**When that happens, here's what they do.** They open the app and are asked for their
email address. They type the same address the invite was sent to — that address is
their account. We email them a six-digit code, they type it in, and they're back in.
There's no password to remember and nothing to have set up in advance. That is the
default route and it works for every learner from day one.

**There's also a third route that's worth knowing about, and it's the easiest one to
give people: the original invite link keeps working.** It isn't single-use. Until it's
revoked or expires, clicking the same link in that same email signs them straight back
in. If a learner asks "what do I do next time", "keep the email and tap the link again"
is a true and very short answer.

**About the password you set.** It works, and it took effect straight away — but only
on the learner side of the app, where the sign-in screen offers "Use password instead"
next to the email-code box. The **school dashboard sign-in screen doesn't offer a
password box at all** — it's email-and-code only, by design, and it says so on the page:
we don't store student passwords. So if you set a password and then try to sign in at
the dashboard, you'll find nowhere to type it. That's not your account misbehaving.
Whether the dashboard should offer a password is a product question we're putting to
Tom rather than quietly changing.

For now, the honest guidance for a school: **the email code is the route that works
everywhere.** A password is a convenience on the learner app only.

So the short answer you can give an administrator: *their email address is their
account. Most of the time they'll still be logged in. If they're ever asked, they enter
that email and we send them a code — or they tap the original invite link again.*

One thing worth telling learners up front: it has to be the **same email address the
invite went to**. A different address would start a brand-new, empty account rather
than finding their progress.

## The Verify Email button

**It was broken, and it's now fixed.** You were right that it wasn't doing anything.

The button is a small tidy-up, not a gate: because your learner came in by clicking a
link rather than by typing a code we'd emailed them, we'd never actually proved their
inbox could receive our mail. The button exists to close that loop — press it, we send
a code, you type it back, and the "unverified" note disappears. Nothing about the
account depends on it. Progress, courses and logging in all work exactly the same
whether it's been pressed or not.

What went wrong was a mix-up in our own checks. The app had already quietly recorded
that address against the account when the learner first signed in, and the button then
refused to send a code because it thought the address was already on file — which was
the one address it was supposed to be verifying. It said so in a small message that
appeared further down the page, below the fold on a phone, so from where you were
sitting the button simply did nothing.

Both halves are fixed. The button now sends the code as intended, and whatever it has
to say — "code sent, enter it below", or any error — now appears right next to the
button you pressed, where you can see it.

## What to re-test

1. In Settings, press **Verify now** next to the email address again. You should see
   "Code sent — enter it below" appear immediately under the address, and a six-digit
   code should arrive by email within a minute or so. Type it into the box that opens
   below and the "unverified" tag should go away.
2. Sign out, then sign back in by entering your email and typing the code we send. This
   is the route most learners will actually use, so it's the one worth being confident
   about — and it's the only one offered on the dashboard sign-in screen.
3. Tap the original invite link in the first email again, and check it takes you back in
   rather than starting something new. If that works, it's the simplest instruction to
   give a whole class.
4. If you want to try the password: do it on the learner side of the app, not the
   dashboard, where the sign-in screen shows "Use password instead".

If the code from step 1 doesn't arrive, that's a mail delivery question rather than a
button question, and it's worth telling us which email provider the address is on —
school mail systems in particular sometimes hold our messages back.
