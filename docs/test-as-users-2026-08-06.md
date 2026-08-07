# Testing tonight's org/school changes as the users see them

**For Tom, 6 Aug 2026.** Everything below is verified against the live dev build and the live database, not just the code.

---

## Start here — two paths, and you need both

There is no admin "view as" any more, so to see tonight's changes you have to be a real user. Two of the four features work with ready-made accounts; the other two need you to sign yourself up, which takes about a minute.

**Everything is on dev. Use this one URL for all of it:**

https://ssi-learning-app-git-dev-zenjin.vercel.app

---

## Path A — ready-made accounts (co-teaching, and the account area)

These three accounts exist now and I have confirmed all three sign in.

```
URL:       https://ssi-learning-app-git-dev-zenjin.vercel.app
Password:  SsiTest2026!

School leader   thomas.cassidy+zz.chepstow.leader@gmail.com
Teacher one     thomas.cassidy+zz.chepstow.t1@gmail.com
Teacher two     thomas.cassidy+zz.chepstow.t2@gmail.com
```

**How to sign in:** tap **Save Progress**, enter the email, then tap **"Use password instead"** and enter the password. The `/schools` door itself only offers the emailed code, so go in by the main door first and it will let you straight through.

**To test the co-teaching panel:** sign in as **teacher one**, who leads a class called **6S**. Open that class and add **teacher two** as a co-teacher. That exercises tonight's work directly — who is allowed to add, and the invite button that lane was missing. Then sign in as teacher two in a private window to see the class from the co-teacher's side.

**To test the "Your account" area:** it's reachable from the school leader's home, permanently — that's the point of it. Password and install both live there now.

---

## Path B — sign yourself up (the org manager, and the onboarding)

**The ready-made leader above is a school leader with no organisation above her, so she will not show you the Organisation Dashboard.** For that you need to be an org leader, and there's a self-serve door for it. Free, no card, about a minute:

https://ssi-learning-app-git-dev-zenjin.vercel.app/orgs

It asks what your organisation is called, then your email, then a 6-digit code it emails you. Use a plus-address so it's a clean account and the mail still reaches you:

```
thomas.cassidy+orgtest1@gmail.com
```

That lands you on your own **Organisation Dashboard** — which is the fix itself, an org leader getting an org dashboard rather than a schools one.

**Then, for the two new onboarding beats:** tap **Add** (a group or a learner). The **password step** fires there — a hard gate on the first add, no skip, deliberately. The **install prompt** follows, dismissible and non-nagging.

---

## Where each change is right now

| What | dev | staging | production |
|---|---|---|---|
| Org-manager dashboard fix | **yes** | yes | no |
| Leader onboarding — password + install | **yes** | no | no |
| Co-teaching panel | **yes** | no | no |
| Permanent "Your account" area | **yes** | no | no |

Staging has only the org-dashboard fix. Production has none of tonight's work. I confirmed all four are in the code the dev site is actually serving.

---

## Is there an admin "view as"?

**No — you removed it yourself on 18 July** ("too complicated… should probably go"). What replaced it is the admin drill-in, which lets you read any school, class or learner under your own session.

**It is the wrong tool for tonight.** The drill-in deliberately switches off every write control and every onboarding prompt — the add buttons, the join cards, the guided walk-throughs. Those are exactly what you want to look at. So it would show you a school's data and none of tonight's changes.

---

## Three things worth knowing

**"Your account" was stuck, and I unstuck it.** It had been built and pushed but never reached dev — its automatic merge failed on a clash in the walkthrough files. Both sides had only *added* walk-throughs, so the answer was to keep all eleven rather than pick one side. Merged, full check suite green, confirmed live. An hour ago it wasn't testable at all.

**The test school is a copy of Chepstow, and it is empty on purpose — but three oddities in it look like real product bugs, not copying artefacts:** the school card says "Trial" with no language after it; the Subscribe page offers one seat at £15/month while three teachers already hold accounts; and Insights names the course by its raw code "Cym_s_for_eng" where Classes correctly says "Welsh (South)". Worth a look when you're not testing something else. Nothing was written to the real school.

**One honest gap:** the ready-made accounts don't cover the org-manager dashboard — that's why Path B exists rather than a fourth credential. And the co-teacher pairing isn't pre-made; you create it yourself as teacher one, which is the better test anyway since adding the co-teacher *is* the feature.
