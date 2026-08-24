# For Deborah — the organisation dashboard fix is now on staging

**6 August 2026**

## What changed

When you logged in last night, the app treated your account as if you ran a *school*, so the only thing it offered you was a "Schools dashboard" — and there was no way to get to your organisation at all.

That's fixed. The app now recognises that you lead an **organisation**, not a school, and sends you to the right place.

## Where to test

**staging.saysomethingin.app**

Please use this one from now on — not the longer temporary address you were given last night. That was a stopgap while the fix waited its turn, and it's no longer the one to test against.

## What you should see with your `+1@` account

Sign in as usual with **euskiwicymraeg+1@gmail.com**.

Open **Settings** — the cog at the bottom right — and scroll to the **Dashboards** section. You should see:

> **Organisation Dashboard**
> Your people, invites and progress

Tap it, and you land on **Deborah Testing**, your own organisation page — with your free-trial notice at the top, your practice hours, your learners, and the buttons to invite a person, get a shareable link, or add a group.

You should **not** see a "Schools dashboard" entry any more. That was the wrong door, and it's gone for your account.

The same Organisation Dashboard card also appears on the Library screen, so you can get there from either place.

## About your `+mgr@` account

Your **euskiwicymraeg+mgr@gmail.com** account currently shows **no organisation door**. That is correct, not a bug: that account doesn't manage anything at the moment, so there's no organisation for it to open.

Whether that account should be given something to manage again is a separate question Tom is still thinking through. Nothing is broken there — please just leave it as-is for now and test with `+1@`.

## If something looks wrong

If the Organisation Dashboard doesn't appear, try a hard refresh first — your phone may still be holding the old version of the app. If it still doesn't show up after that, say so and we'll look straight away.

---

*Verified working on staging in a real browser on 6 August 2026 at 23:11, on build `2cb4e8e`.*
