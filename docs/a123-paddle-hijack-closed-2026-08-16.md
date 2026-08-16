# A-123 — the Paddle £15 hijack, actually closed

**16 August 2026.** Your ruling was *"A123 - schedule fix - making sure no-one's access is removed"*, so this is the real fix, built with your condition as the thing everything else bends around. No live database was touched, no Paddle traffic was sent, nothing was promoted to production.

---

## What the hole was

Somebody buys one legitimate £15 seat. At the Paddle checkout they type **your school admin's email address** instead of their own. They pay with their own card.

The webhook then asks Paddle "who paid?", gets that email back, looks it up, finds your admin, finds your school — and writes the buyer's billing pointers onto it. Your school's subscription id, customer id, seat count, status and expiry are now theirs. When they cancel their own £15 subscription a month later, your school is marked cancelled and goes dark.

The August 11th fix was real but it moved the lock rather than closing it. It stopped the browser naming the victim school directly; it replaced that with an email — and an email is just another thing the buyer types. The prerequisite went from *know the school's internal UUID* to *know the head teacher's email address*, which is on the school website.

## What changed

**Who paid is now settled before the money moves, not guessed afterwards.**

When an admin opens a school or organisation checkout, the app first asks the server to prepare it. The server works out which school or org that person actually runs — from their signed-in session, using the same admin-only rule that already governs seat changes, so a plain teacher can't touch their school's billing — and then signs a small statement saying "this checkout is for that node". The buyer never gets to name the node, and the statement can't be edited or faked, because it's signed with a key that only lives on the server.

The webhook now only accepts an address it can actually trust, in this order:

1. **The school's own existing subscription.** This is every renewal, seat change and cancellation for everyone already paying today.
2. **The signed statement** from the checkout the server prepared.
3. **The Paddle customer record** the server bound.
4. **A verified email** — the old path, now allowed only to touch a node that holds no live access at all.

Anything else is refused, logged for a human, and nothing is written.

Rung 4 is the channel the attack used. It can no longer reach anything that has something to lose. Rung 3 is fenced the same way, because Paddle may attach a checkout to an existing customer record when the buyer types a matching address — which would have re-keyed the same attack a third time, and that is now shut too.

If preparing the checkout fails, the app **doesn't open it**. A failure costs a retry, never a payment nobody can attribute.

---

## Your condition: nobody loses access

This is the part I gave the most care, and it's tested rather than promised. Three properties, each with its own test that fails if the property breaks.

**1. A refusal writes nothing.** If the webhook can't work out who a payment belongs to, it writes *nothing at all* — never "cancelled", never a shortened expiry, never fewer seats, never a wiped billing pointer. The test that matters most drives a **cancellation** that can't be resolved and asserts zero writes, because that is the exact event where a sloppy refusal would take someone's dashboard away.

**2. One subscription can never overwrite another's.** If a payment resolves to a school that is still live under a *different* subscription, the write is refused and logged for a human instead. That single guard is what removes the payoff: the attacker's later cancellation has nothing to land on. It also protects an honest school that accidentally buys twice — they keep what they have, and a person sorts it out.

The same guard is on the individual-learner lane, which had the same shape of problem keyed on an account id rather than an email. A stranger can no longer take a paying learner's premium away.

**3. Every existing subscriber is grandfathered — and this is the important one.** Every school, org and learner paying today subscribed before this endpoint existed, so none of them has a binding created by it. If the webhook had simply started demanding one, their next renewal would have stopped resolving and their billing state would have quietly stopped tracking — which is precisely the access removal you ruled out.

They don't need one. **Rung 1 is untouched**: their school already carries its own subscription id from when they subscribed, so every renewal, seat change and cancellation resolves exactly as it does today. And every one of those events re-writes the customer pointer as it goes, so legacy rows quietly acquire the new binding on their first event without anybody doing anything.

**Expected coverage:** every school, org and group that has ever had a subscription event processed — which is every current subscriber — is on rung 1 from their next event onward. **The residue** is a node that paid but whose *first* subscription event was never successfully processed, so it holds no subscription id at all. Those would now be refused with a loud log rather than resolved by email. I have no live database access, so I can't count them; my honest expectation is zero or near-zero, because such a node would already be showing as unsubscribed despite paying. Anything in that state was already broken and is now loudly broken instead of quietly wrong.

**One deliberate trade-off, so you can overrule it.** A school still inside its free trial, upgrading from a browser running *stale cached JavaScript* (so it sends no signed statement), is refused rather than bound — because allowing it would reopen exactly the "flip a trialling school dark" attack. They keep their trial, nothing is removed, and the log says what to do. Fresh clients are unaffected, and dev auto-updates its service worker. If you'd rather take that risk than have any legitimate purchase refused, say so and I'll invert it.

---

## What I did not do

- **No live database writes, no migration.** None was needed — the fix uses columns that already exist.
- **No Paddle traffic, no payment, no production deploy, no promotion to `main`.**
- **The Paddle question is still open, and it's one console visit, not a code change.** The severity of the original finding rests on whether Paddle proves someone owns a mailbox before the subscription webhook fires. Nothing in our code does. I sent no Paddle traffic by rule, so this is unverified either way — the fix doesn't depend on the answer, but the answer tells you how urgent the deploy is.
- **SEC15-03** (the audio proxy returning its internal storage key in an error) is untouched — you scheduled the webhook, not that. Noting it only so it stays on the record.

## Checks

Everything green on my branch: **1,240 API tests** across 109 files (was 1,213 across 106 — 27 new), **2,217 player tests**, both typecheck gates, and `eslint src` clean.

Two honest notes. The repo-wide `eslint .` reports 4 errors — all of them in other agents' untracked scratch files in `e2e/`, none in anything I touched or that a clean checkout would contain. And the audit flagged a date-dependent test as a time bomb; it passed today, so it hasn't gone off yet.

Five tests the audit wrote to *characterize* the vulnerability were deliberately converted to assert the fixed behaviour instead. That's noted in the commit messages so nobody later reads it as a weakened test.

---

**Landing:** three commits on `fix/a123-paddle-customer-binding-2026-08-16`, pushed. Not merged, not deployed — a money-path change is yours to promote.
