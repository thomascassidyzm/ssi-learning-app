# What Deborah should see — the Organisation Dashboard

**Short version:** she was right, and she should not have had to ask. The app was
looking at her account, seeing the word "manager" in the same box it uses for school
staff, and offering her the only door it knew: Schools Dashboard. It now recognises an
organisation and gives her an **Organisation Dashboard** door instead.

---

## What she does — nothing different

She logs in exactly as before: same app, same email address, same six-digit code. No
special URL, no separate sign-in.

## What she'll see

Open the app, tap the **settings** (gear) icon, and scroll to the **Dashboards** block.
Where it used to say only "Schools Dashboard", it now says:

> **Organisation Dashboard**
> Your people, invites and progress

Tap it and she lands on **Deborah Testing** — her organisation's own page: the people
she has invited, the invites she has created, and their practice.

The same door also appears on the **Browse** screen, as a card just above where the
Schools Dashboard card used to be.

**She will no longer be offered a Schools Dashboard at all.** She doesn't run a school,
so it was never her door. If someone genuinely runs both a school and an organisation
they'll see both entries — that case is handled deliberately, not by accident.

---

## Which of her two accounts this works for — please read

She has two test accounts, and they are not in the same state:

| Account | Leads an organisation? | What she'll see |
|---|---|---|
| `euskiwicymraeg+1@gmail.com` | **Yes** — leads "Deborah Testing", created 5 Aug, holds her test learner and their practice | **Organisation Dashboard** → her org |
| `euskiwicymraeg+mgr@gmail.com` | **No** — it led the duplicate empty org that was removed this morning | No organisation door, because it now leads nothing |

The `+mgr@` account lost its leader seat when we removed the duplicate empty "Deborah
Testing" org this morning — that was a deliberate call and its cost was accepted at the
time. So if "Test Manager email address" means `+mgr@`, the app is telling her the
truth: that account is not the manager of anything any more. Reinstating it as a
manager of the surviving org is a one-row change we can make on request — it just
needs saying, because it reverses this morning's decision.

---

## What was actually wrong

When someone creates an organisation, we mark their account `govt_admin` — the same
mark a government or schools administrator carries. The app's only question was "does
this person have a staff role?", which was true for both, so both got sent down the
schools corridor. There was no Organisation entry anywhere in that menu.

The app now asks a second, better question: **what kind of thing do you actually lead?**
That answer comes from the organisation record itself, checked on our servers against
her own login — an organisation, not a school region. An organisation leader gets the
organisation door.

---

## Where this is live

**On the dev build now**, and verified there. It is **not yet on staging** — staging is
currently 50 commits behind dev on unrelated work (player changes, listening mode, the
schools permissions work), and pushing all of that across to unblock one link would put
unvetted work in front of the whole test team. That promotion is Tom's call.

Dev build (works the same as staging, same database, same accounts):
`https://ssi-learning-app-git-dev-zenjin.vercel.app`
