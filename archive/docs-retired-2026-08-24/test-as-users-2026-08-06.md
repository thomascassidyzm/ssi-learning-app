# Testing tonight's org/school changes as the users see them

**For Tom, 6 Aug 2026.** Everything below is verified against the live dev build, not just the code.

---

## 1. Is there an admin "view as / login as"?

**No. Not any more — and you removed it yourself.**

There used to be one. It was taken out of the product UI on 18 July on your ruling ("too complicated… should probably go"). What replaced it is the admin drill-in: as an ssi_admin you can open any school, group, class or learner and read their dashboard under your own session.

**But the drill-in is exactly the wrong tool for tonight.** It deliberately hides every write control and every onboarding prompt — the add buttons, the join cards, and the guided walk-throughs are all switched off in admin view by design. Those are the things you want to look at. So the drill-in will show you a school's *data* and none of tonight's *UX*.

The audit-logged impersonation harness still exists on the server as an internal support tool, but it has no UI and no way in from a phone.

**So: to see tonight's changes as a user, you need to be a real user.** Which turns out to be easy — see below.

---

## 2. The simplest safe path — sign yourself up, it takes about a minute

You don't need credentials from me for the org lane. **There is a self-serve org signup door, and it is live on dev.** Creating an org is free, takes no card, and the signup itself *is* the leader onboarding you want to review.

**Go here:** https://ssi-learning-app-git-dev-zenjin.vercel.app/orgs

It asks three things: what your organisation is called, your email, then a 6-digit code emailed to you. Use a plus-address so it's a clean new account and the mail still reaches your normal inbox:

```
thomas.cassidy+orgtest1@gmail.com
```

That lands you on your own Organisation Dashboard.

**Then, to trigger the two new onboarding beats:** tap **Add** (a group or a learner) on that dashboard.

- The **password step** fires there. It's a hard gate on the first add, with no skip — that's deliberate. Set any password you'll remember.
- The **install prompt** comes straight after. It's dismissible and won't nag.

Once you've set that password, that account can sign in with email + password from then on.

**One thing worth knowing about signing in later:** the `/schools` and `/org` doors only offer the emailed-code route, no password box. To use your password, sign in at the main app door first — there's a **"Use password instead"** toggle under the email field — then navigate to the org or schools area, which will let you straight through.

### The co-teacher

A co-teacher can't self-serve — by design, they have to be invited by the lead teacher or a leader above them. So do it in this order:

1. From your org, create a school and a class, which makes you the lead teacher.
2. On the class page, use the co-teacher invite (the button that lane was missing is part of tonight's work).
3. Open that invite in a private/incognito window and accept it as a second plus-address, e.g. `thomas.cassidy+coteach1@gmail.com`.

You'll then have both sides — lead teacher and co-teacher — under emails you control.

---

## 3. Where each change is right now

**Everything from tonight is on dev. Only one of the four has reached staging. None are on production.**

| What | dev | staging | production |
|---|---|---|---|
| Org-manager dashboard fix | **yes** | yes | no |
| Leader onboarding — password + install | **yes** | no | no |
| Co-teaching panel (A-74) | **yes** | no | no |
| Permanent "Your account" area | **yes** | no | no |

**So test all four here — one URL, everything on it:**

https://ssi-learning-app-git-dev-zenjin.vercel.app

Staging (https://staging.saysomethingin.app) has only the org-dashboard fix, so testing the rest there will show you last week's app. Production has none of it.

I confirmed all four are actually in the code the dev site is serving right now, not just merged in principle.

---

## Two things you should know

**"Your account" was stuck and I unstuck it.** It had been built and pushed but never made it onto dev — its automatic merge failed on a three-way clash in the walkthrough files. Both sides had simply added new walk-throughs, so the fix was to keep all of them rather than pick. I merged it, ran the full check suite green, and confirmed it's live on dev. That's why it's testable tonight; an hour ago it wasn't.

**One gap, stated plainly:** I could not send a mid-flight instruction to one of the two helpers I had working on this, because that dispatch system has no message-in endpoint. It didn't change the outcome — the finding I wanted to pass on was already in its brief — but you should know the channel is one-way once a job starts.
