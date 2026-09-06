# Identity model for the India Android launch

2026-09-03. Branch `india-identity-model`, cut from `dev`. Written for Tom first, then for
whoever builds the India Android client against it — the Play-billing half assumes you know
Google Play and does not assume you know this codebase.

India has no users yet. That is the whole reason this document exists now: it is the one
chance this estate gets to fix identity *before* a population exists to migrate. Every
choice below is anchored to that window. Where a choice is right for India but expensive
for the existing estate, it says so explicitly and chooses the India-right answer.

---

## 1. What an account IS

**An account is one row in `learners`. Its canonical name is its set of proven email
addresses (`learners.verified_emails`). Everything else — Google, Apple, Facebook, Play,
a password, an OTP code, an invite link — is a DOOR: a mechanism that ends in a verified
session attesting one address.**

Two sentences that look contradictory are both load-bearing, and the whole model hangs on
where the line between them sits:

- Tom's ruling: **email is the account.**
- `api/billing/bind-customer.ts` (written after a real hijack): **"An email is not an
  identity. A verified SESSION is."**

The reconciliation: **email is the NAME of an account; a verified session is the only
PROOF of it.** Knowing an address gets you nothing — typing `victim@example.com` into a
checkout, an OTP form, or a support ticket must never move anything. Holding a session
that a door minted by actually proving control of that address gets you the account that
address names. Every rule below is an application of this one sentence.

Consequences that fall straight out:

1. An account can have **many names** — `verified_emails` is a set, and this is not an
   accident but the mechanism. It already exists, is already provenance-guarded at the
   database layer (migration `20260811_lock_learner_identity_columns.sql`: a browser
   session can only place an address that Supabase auth already attests for that account;
   everything else goes through the OTP round-trip in `api/email/verify.ts`), and it is
   the spine of the Hide My Email answer in §5.
2. **Any door proving any name in the set lands on the same account.** This is the
   sentence that kills the support-load problem: ~90% of SSi support load is people not
   knowing which social login they used. Under this model, the question dissolves — there
   is no Google-shaped account to be distinct from an email-shaped one. The residue that
   can still go wrong is a door proving an address the account has never proven (§5, §6.2).
3. A door is **added from inside a session, never guessed from outside.** Linking a second
   sign-in method to an account is an act performed while signed in to that account, or by
   proving the new address with an OTP. There is no operation anywhere in the model that
   attaches identity based on an address someone merely typed.

### What each of the four systems maps to

| System | What it thinks a person is | What it maps to in this model |
|---|---|---|
| **Supabase auth** | An auth uid + one email | A **door**. `auth.uid()` is a login token, translated once at the edge to `learners.id` (the repo's standing rule) and never used downstream. One account may accumulate several auth uids over its life; the current one is `learners.user_id`. |
| **Google Play billing** | A Google account, which owns the purchase | **Outside the model entirely.** The purchase belongs to a Google identity we do not control and cannot read. We never treat the Google account's email as a name of our account. Play's job is: deliver the purchase token, and honour "Restore purchases" on any device signed into that Google account. That restore path is our safety net for the buy-anonymously-then-reinstall case (§6.5) — it is Google's problem to solve, and they have solved it. |
| **RevenueCat** | An `app_user_id` string, chosen by us | **A ledger keyed by OUR identifiers, never an identity authority.** RevenueCat resolves ENTITLEMENT given an identity; it has no opinion on whether two app_user_ids are the same human, and must never be asked to have one. The app_user_id is always one of ours: `anon:<uuid>` before sign-in, `learner:<learners.id>` after. See §7 for the seam and the one direction in which vendor-side aliasing is permitted. |
| **The legacy estate (10–15 yrs)** | Its own user record, named by an email, proven by its own password | A **door**, exercised lazily: the first successful authentication against the old system proves that the person holds that legacy account, and (with one guard, §8) lands them on the Supabase account its email names, creating it if absent. No batch migration, no cutover — Tom's ruling. |

---

## 2. The derivation — what the rulings REQUIRE

This section exists so that a case nobody anticipated can be decided without asking anyone.
A rule with its reason survives contact; a rule without one does not.

**From "email is the account":**

- (D1) There can be no such thing as "a Google account in our system". Therefore the
  database must never grow a `provider` + `provider_user_id` pair that functions as an
  account key. Provider ids may be *recorded* (they are useful merge evidence, §5), but
  nothing may ever *resolve* through them.
- (D2) Since doors are many and the account is one, the account must tolerate an
  **open-ended set of proofs**. `verified_emails` as a set, plus multiple auth uids over
  time, is the minimum shape. This already exists; nothing new is required.
- (D3) An address that the person cannot recognise (an Apple relay) or that does not exist
  as an inbox (the `invite.saysomethingin.app` placeholder) can still NAME an account —
  naming is a database fact, not a UX fact. What it must never do is be *displayed* as
  "your email". The placeholder file's ruling generalises: **display identity and
  canonical identity are different layers** (§5).
- (D4) Matching must be **conservative in action, generous in suggestion**. The exact
  proven address (lowercased, trimmed) is the only key that ever *does* anything
  automatically. Looser equivalences — gmail dot/plus folding, as
  `canonicaliseEmailForBurn` already does for trial-abuse keys — may *suggest* "is this
  also you?" but never act. Reason: a wrong automatic merge is the one irreversible-shaped
  operation in the system, and `a+home@gmail.com` vs `a+work@gmail.com` being one inbox is
  a fact about Gmail, not a proof that one human intends them as one account.

**From "buy first, alias instantly":**

- (D5) Payment must be possible with **zero identity**: therefore an anonymous id must
  exist before any account does, and the purchase attaches to it. The repo already has the
  primitive (`ssi-guest-id`, a `guest-<uuid>` in localStorage); India formalises it.
- (D6) The sign-in offer comes on the screen **immediately after purchase confirmation** —
  not before payment (that is the till-blocking this ruling exists to kill) and not three
  sessions later (that is the nag screen it also kills). Declining is a first-class
  outcome that costs nothing now: Play restore covers the reinstall case.
- (D7) The instant-alias flow implies the person may sign in to an account that *already
  exists and already has purchases* while holding an anonymous id that *also* has a
  purchase. So the model must have a worked answer for two-sided merges before launch,
  not as a later patch (§6.6).
- (D8) Buy-first means the purchase can never be held hostage by identity failure. Every
  failure path in the state machine (§4) must leave the entitlement PLAYABLE on the device
  it was bought on. A sign-in error, a declined merge, a crashed alias call — none of them
  may interrupt access to what was paid for.

**From treating merge as irreversible:**

- (D9) **Alias and merge are different operations and the model refuses to blur them.**
  - An **ALIAS** attaches an anonymous id to an account. The anon side is not a person:
    it has no name, no email, no other door, and nobody else can ever arrive through it.
    Aliasing is therefore safe to perform with one tap and is effectively lossless.
  - A **MERGE** joins two *named* accounts — two rows that each have at least one proven
    email. Merges are never automatic, always offered ("is this also you?" — one tap,
    which makes the merge *attributable*, which is exactly what a detector needs), always
    audited with enough state to reconstruct both sides, and always undoable by a named
    operation (§9).
- (D10) "Undetectable counts as irreversible", so detection cannot depend on a human
  complaining. Every merge writes tripwires as well as an audit row (§9).
- (D11) The vendor ledger must never contain a mapping our database cannot reverse.
  RevenueCat's alias/transfer operations are (per their published behaviour — Ivan/Imdad
  to confirm against current docs, flagged in §11) not reversible. Therefore vendor-side
  aliasing is permitted in exactly ONE direction: `anon:<uuid>` → `learner:<id>` at
  first sign-in, which is the one mapping that is *conceptually* one-way anyway (D9).
  Two named accounts are NEVER aliased or transferred on the vendor side; if two of our
  accounts merge, entitlement union is computed on OUR side from our own mapping table,
  and each RevenueCat app_user_id keeps existing untouched. This is what makes merge-undo
  actually possible rather than aspirational.

**From the clean-sheet window:**

- (D12) India-right beats estate-cheap. Two places this bites: the merge-audit table and
  the `previous_user_id` history (§9) are *new* infrastructure that the existing estate's
  live email-match relink (§10) does not have — the India path gets them from day one, and
  retrofitting the estate's relink onto the same primitive is recommended but is a
  separate, Tom-gated piece of work.

---

## 3. The buy-first / alias-instantly path, concretely

The Android client's first-run experience, in order:

1. **Install → anonymous id.** On first launch the app mints `anon-<uuid>` and persists it
   in app-local storage. **Install-scoped, not device-scoped** (taste-safe default from
   the brief, flagged in §11): it survives app updates, dies with an uninstall-with-data
   or a wipe, and never pretends to be a person. It is also handed to RevenueCat as the
   app_user_id. No account exists. No screen mentions accounts.
2. **Learning happens.** Progress is local (and may sync to a server-side anonymous
   learner-shaped store later — NOT decided here; for launch, local-only matches the
   existing guest behaviour and loses nothing that signing in wouldn't have saved).
3. **Purchase.** The person taps buy. Play billing runs entirely against their Google
   account. RevenueCat validates the purchase and attaches the entitlement to
   `anon-<uuid>`. **Nobody was asked to create an account.** The entitlement is live from
   this second, on this install, unconditionally (D8).
4. **The offer — immediately, on the confirmation screen.** "You're all set. Add an email
   so your purchase and progress are safe if you change phones." One field (or one Google
   button — on Android the Google door is the overwhelmingly likely one). **Skippable in
   one tap**, and skipping is respected: no repeat nag on a timer; at most one quiet
   entry-point in Settings ("Protect your purchase").
5. **Sign-in → alias.** The door proves an address; the server resolves it:
   - Address names an existing account → session lands on that account.
   - Address names nothing → an account is created, named by it (exactly what
     `ensureLearnerExists` does today).
   Then the client calls the alias endpoint: `anon-<uuid>` and its purchases attach to
   `learners.id`. RevenueCat is told to alias `anon:<uuid>` → `learner:<id>` (the one
   permitted direction, D11). Our side writes the alias record regardless, so our DB —
   not the vendor — remains the authority on who owns what.
   - If the account the person signed into **already has its own purchases** and the anon
     id **also** has purchases, this is the two-sided case: §6.6. Short version: the alias
     is still offered, its consequences are stated on the screen, and it is audited like
     a merge.
6. **Every failure lands soft.** Sign-in abandoned → step 3's state persists; the purchase
   plays. Alias call fails after sign-in → retried in background; the purchase STILL
   plays, because entitlement resolution on-device checks both the anon id and the
   session (belt and braces until the alias confirms).

The precedent this is built on, deliberately: `api/auth/possession-redeem.ts` already
mints a real session server-side from possession of a valid invite code, no email sent.
The anonymous purchase id is the same primitive — **possession of a paid install is the
credential** — and the implementation should be recognisably the same shape: server-side
validation, session mint, audit row, rate limits, refuse-on-doubt.

---

## 4. The identity state machine

States a single human's presence in the system moves through. `learners` rows and anon
ids are the nouns; doors cause the transitions.

```
                       ┌────────────────────────────────────────────┐
                       │                                            │
  install              ▼            purchase                        │ reinstall
 ────────▶ ANONYMOUS ──────────▶ ANONYMOUS_PURCHASED                │ (anon id lost;
            (anon-<uuid>,          (entitlement on anon id)         │  Play restore
             local progress)              │                         │  re-attaches to
                │                         │ confirmation screen     │  the NEW anon id)
                │ sign-in                 ▼                         │
                │ (rare here)      SIGN_IN_OFFERED ──skip──▶ ANONYMOUS_PURCHASED ──┘
                │                         │
                │                         │ door proves address E
                ▼                         ▼
          ┌──────────────────────────────────────────┐
          │ resolve E:                               │
          │  E names account A ──▶ land on A         │
          │  E names nothing  ──▶ create A, name=E   │
          └──────────────────────────────────────────┘
                                          │
                     ┌────────────────────┴─────────────────────┐
                     │ anon has purchases AND A has purchases?  │
                     │   no  ──▶ ALIAS (automatic, audited)     │
                     │   yes ──▶ ALIAS OFFERED (one tap,        │
                     │           audited like a merge)          │
                     └────────────────────┬─────────────────────┘
                                          ▼
                                       ALIASED
                          (anon id retired, recorded on A;
                           RevenueCat anon:<uuid> → learner:<A>)

  Later, from inside any session on A:
    ADD DOOR (link Google/Apple/password/second email via OTP) → A gains a name/proof
    OFFERED MERGE with account B (both named)                  → MERGED (audited, undoable)

  Failure transitions (all deliberate):
    sign-in fails/abandoned      → previous state, entitlement unaffected (D8)
    alias call fails             → SIGNED_IN_UNALIASED, background retry, dual-check playback
    merge declined               → both accounts persist, offer not repeated on a timer
    merge undone (§9)            → both accounts restored from the audit record
```

Named invariants, checkable in code:

- **I1**: at every state, a completed purchase is playable on the install it was made on.
- **I2**: no transition ever attaches identity from a typed-but-unproven address.
- **I3**: an anon id appears in at most one alias record, ever.
- **I4**: after any merge, entitlements(surviving) ⊇ entitlements(A) ∪ entitlements(B) —
  asserted at merge time AND re-checkable later (a tripwire, §9).
- **I5**: every merge and every two-sided alias has an audit row from which both prior
  states can be reconstructed.

---

## 5. Hide My Email — the specific answer

This is the case Tom named as the crux, so it gets the full treatment rather than a
paragraph. The scenario: Sign in with Apple, and the person chooses "Hide My Email".
Apple mints a relay address like `k9x2fq7wpn@privaterelay.appleid.com`.

**What Apple actually gives you, and what is stable:**

- The relay address is **stable per (Apple ID, app)** — the same person signing in with
  Apple to SSi always yields the same relay. It genuinely forwards mail (as long as the
  person hasn't disabled forwarding, which they can, silently, at any time).
- Apple's token also carries a **stable `sub`** — the Apple user identifier, constant for
  your developer team. It is the one signal that survives everything Apple lets the
  person change.
- What you do NOT get, by explicit design: any link to the person's real address. The
  relay is unlinkable to their gmail. **This is not a bug to be beaten — it is the
  privacy feature working, and the model must be honest that no amount of cleverness
  bridges it automatically.**

**The answer, in five rules:**

1. **The relay is a real name of the account.** It goes into `verified_emails` like any
   proven address (the Apple door proved it — Apple attests it, and Supabase records it in
   `auth.identities`, which the provenance trigger already accepts). Same human returning
   through the Apple door proves the same relay and lands on the same account, forever.
   The within-door case is therefore fully solved with zero new machinery.
2. **The relay is never DISPLAYED as "your email".** This generalises the existing
   placeholder ruling (`placeholderEmail.ts`: never in display, never derived into a
   display name). A relay is a different animal from the placeholder — it is real and
   receives mail, so unlike the placeholder it DOES belong in `verified_emails` — but it
   shares the display rule: the UI says "Signed in with Apple", never
   `k9x2fq7wpn@privaterelay...`. One client-side predicate, `isRelayEmail()` (built,
   §12), spots `@privaterelay.appleid.com` alongside the existing placeholder check.
3. **The bridge is offered from inside the session, at the natural moment.** Immediately
   after a first Apple sign-in (and on the post-purchase screen if that's where it
   happened): *"Add an email you use, so you can sign in any way you like later."* The
   added address is proven by the existing OTP round-trip (`api/email/verify.ts`) and
   joins `verified_emails`. From that moment the Google door, the OTP door, and the Apple
   door all land on this account, and the Hide My Email problem is over for this person,
   permanently. This offer is the single highest-value screen in the whole model and it
   costs one optional field.
4. **The Apple `sub` is recorded as merge EVIDENCE, never as a key** (D1). If the person
   later re-signs-in with Apple but Apple hands us a different relay (the person deleted
   the app's Apple ID connection and re-created it — the one way the relay rotates), the
   stable `sub` is what lets support, or an offered-merge suggestion, say "these two
   accounts were the same Apple ID" with actual evidence. Nothing resolves through it;
   it makes offers smarter and support honest.
5. **The residue, stated honestly.** A person who signed in with Apple + relay, never
   added a recognisable email, and later arrives through the Google door proving their
   gmail: **cannot be matched automatically, and should not be.** They get a fresh
   account (correct: the system has zero proof these are one human). Their recovery
   paths, in order of preference:
   - **Self-serve, no support:** they still hold the Apple door. Sign in with Apple →
     they are back in the original account → add the gmail from inside (rule 3). Two
     minutes, nobody at SSi involved. The UI's job is to make this discoverable: when a
     fresh account is created through door X and the install has history suggesting a
     prior account (e.g. a local flag that an Apple sign-in happened here before), show
     "Used a different sign-in before? Try it — your stuff is still there."
   - **Purchase-anchored, via support:** they can produce a Play/App Store order id or
     receipt → support resolves it to a RevenueCat app_user_id → to our alias record →
     to the account, and triggers an **offered merge** the person confirms from their
     current session. Support never types an email into anything (I2 holds even for
     staff).
   - What does NOT exist: any flow where typing "but my email is X" moves anything.

**India-launch note:** on Android, Sign in with Apple is possible (web flow) but will be
rare; the dominant door is Google, where the proven email is a real gmail and this whole
section rarely fires. The section matters because the model is estate-wide and the iOS
population is where relays live. Nothing in the Android build needs to special-case it —
the rules above are door-generic.

---

## 6. The failure-case catalogue, worked

Each case: what happens, why, and what the person experiences.

**6.1 Same human, two doors, same address.** Signs in with Google (proves
`ravi@gmail.com`), later uses email OTP with the same address. Exact-match on a proven
name → same account, automatically, no ceremony. This is the 90%-of-support-load case
and it is dissolved by construction. *(Already live today via `find_learner_by_email` +
`claim_learner`; §10 for what that path still lacks.)*

**6.2 Same human, two doors, two addresses.** Google proves `ravi@gmail.com`; months
later, a new phone and an OTP to `ravi@work.in`. No proven overlap → fresh account.
Correct behaviour, not a failure of matching (the alternative — guessing — is how wrong
merges happen). Recovery: sign in with the old door once and add the new address from
inside (D2/rule 3 in §5); or an offered merge if both accounts end up used. The
*prevention* is the add-a-second-email offer at natural moments — every address added
halves the chance this case ever fires.

**6.3 Hide My Email relay.** §5 in full.

**6.4 Play purchase under a Google account whose email the person never uses.** Common in
India: the phone's Play account is `oldname2009@gmail.com`, functionally write-only; the
person's real address is elsewhere. Under this model it simply doesn't matter: the
purchase attaches to the anon id (then to whatever account they alias into), and the Play
Google account is never treated as a name (§1 mapping). The Google account matters for
exactly one thing — "Restore purchases" finds the payment on any device signed into it —
and that is a strength: it means the *billing* recovery anchor and the *identity* are
decoupled, each recoverable without the other.

**6.5 Buys anonymously, never signs in, reinstalls.** The anon id is gone (install-scoped
and that is the honest cost of the scoping choice, flagged in §11). The purchase is NOT
gone: Restore purchases → Play re-presents the token under the same Google account →
RevenueCat re-validates → entitlement attaches to the NEW anon id. Progress is lost
(it was local-only, and the person declined the one screen that would have saved it —
the model's answer is that the post-purchase offer in §3 step 4 exists precisely to make
this rare, not that the loss is painless). Support cost: zero; the restore path is
Google's, self-serve.

**6.6 The genuinely hard one: signs into an account that has purchases, while the anon id
also has purchases.** Person bought course A anonymously on this phone, then signs into
their existing account which already owns course B (or another copy of A).
- This is still an **alias** by D9 (the anon side is unnamed), but it is the one alias
  whose consequences aren't trivially safe — the phone may be shared (family devices are
  the norm, not the exception, in the launch market), and the person signing in may not
  be the buyer.
- So it is **OFFERED, never silent** (taste-safe default, flagged §11): *"This phone has
  a purchase that isn't attached to any account yet — add it to THIS account?"* One tap.
  Accept → alias proceeds, audited with the two-sided flag set, undoable (§9). Decline →
  the purchase stays on the anon id, playable on this install (I1), recoverable later by
  the actual buyer via Play restore or a later accept. **Nobody's purchases are ever
  swallowed silently by someone else's sign-in — that is the coercive-merge failure the
  brief names, and the offer is what prevents it.**
- Duplicate purchase (same course on both sides): the alias still proceeds if accepted;
  entitlement union is idempotent. Refund routing for the duplicate is Play's flow, not
  identity's problem; the audit row is what support uses to see what happened.

**6.7 Legacy user whose old-system email collides with a new Supabase account.** §8.

**6.8 A wrong merge.** Two named accounts merged; days later it emerges they were two
humans (or one human who wanted them separate). Detection and undo in §9 — the summary:
the dead-side tripwire fires when anything tries to use the absorbed identity, the audit
row reconstructs both sides, and `merge-undo` re-points every moved row back by recorded
id. What is genuinely not restorable: activity that accrued to the merged account
*after* the merge belongs to whoever did it and stays with the surviving account —
the undo restores the boundary, not the interleaved history; the audit row's timestamp
is the knife.

**6.9 Two humans, one device.** The reason 6.6 is offered rather than automatic, and the
reason the anon id "never pretends to be a person". A shared phone can hold: one anon id
with purchases, plus serial sign-ins by different family members. Every identity-affecting
action happens inside a session (attributable) or via an explicit tap on an offer
(attributable). The anon id itself never auto-follows a sign-in.

---

## 7. The RevenueCat / Play seam (definition, not integration)

No SDK is added by this work. The seam the India client plugs into:

- **app_user_id vocabulary:** `anon:<uuid>` (pre-alias) and `learner:<learners.id>`
  (post). Nothing else, ever. The prefix makes misuse visible in any log.
- **One permitted vendor-side alias:** `anon:<uuid>` → `learner:<id>`, once, at alias
  time (D11). Never learner→learner. Merge entitlement union is computed OUR side.
- **Our DB is the authority.** The alias record (`identity_merges` audit table doubles as
  the alias ledger — a one-sided alias is just an audit row with `kind='alias'`) is
  written before/regardless of the vendor call succeeding; a vendor-call failure is a
  retry, not a lost fact.
- **Webhook direction:** RevenueCat webhooks arrive keyed by app_user_id; the resolver
  maps `learner:<id>` directly and `anon:<uuid>` through the alias ledger, refusing
  (and logging for manual remediation) anything unrecognised — the same
  refuse-don't-guess posture `paddle-webhook.ts` already takes. **Paddle is untouched by
  all of this**: India Android money moves through Play/RevenueCat; the existing Paddle
  webhook's strictness (refuses to bind a first payment to an unverified address) keeps
  governing the web estate unchanged. Said loudly because the brief asks: nothing in this
  model changes `api/teacher/paddle-webhook.ts`.

---

## 8. Lazy migration on login (the legacy door)

Ruling: authenticate against the old system once, create the Supabase record, mark
migrated. The seam (the old system is NOT touched by this work):

1. "I already have an account" → person enters legacy email + password.
2. Server-side call to a legacy-auth adapter (interface defined; implementation is a
   later, credentialed piece of work) → success returns the legacy user id + the legacy
   account's email.
3. **What that success actually proves: control of the legacy ACCOUNT — not control of
   the mailbox.** This distinction decides the collision case. If the legacy system never
   verified emails (unknown — open question §11), a legacy account may carry an address
   its holder doesn't own, and landing that session directly on the Supabase account the
   address names would be account takeover via a 12-year-old typo.
4. So, the guarded landing:
   - Address names **no** Supabase account → create one, named by it, `needs_verification`
     semantics exactly as the possession path sets them (never proved mailbox receipt),
     legacy user id recorded on the row, marked migrated. This is the overwhelmingly
     common case and it is one screen with zero extra friction.
   - Address names an **existing live** Supabase account → one OTP to that address before
     landing (proving the mailbox, which resolves the ambiguity in the only honest way).
     If the existing account is an empty **shell**, adopt it instead — the exact
     five-condition shell test `possession-redeem.ts` already enforces, reused not
     reinvented.
5. Marked migrated = the legacy door is thereafter skipped for this account; the legacy
   system is never written to (prohibition honoured: this design reads it once per
   person, through an adapter, and this branch doesn't even build the adapter).

This is buy-first-alias-instantly's twin, as Tom noted: in both, the person's first proof
is what creates their record.

---

## 9. Merge detection and merge undo

The brief's bar: a wrong merge must be detectable without a human complaining, and
undoable by a named operation. Confidence is explicitly not the deliverable.

**The audit record** (table `identity_merges`, migration written and PARKED — see §12):

- `id`, `created_at`, `kind` (`alias` | `two_sided_alias` | `merge` | `legacy_land`),
  `initiated_by` (the session's auth uid — every merge is attributable because every
  merge is an in-session tap, D9),
- `from_identity` / `to_learner_id`: the absorbed side snapshotted in full JSON —
  learner row, verified_emails, auth uid(s), anon id, RevenueCat app_user_id,
  entitlement list at merge time,
- `moved_rows`: per-table arrays of row ids re-pointed (the undo's shopping list),
- `evidence`: what justified it (door + address proven, offer accepted at timestamp,
  Apple `sub` match, support ticket ref),
- `undone_at` / `undone_by` — the undo is a first-class column, not a tombstone hack.

**Detection — three tripwires, none waiting on a complaint:**

1. **Dead-side activity** (the strong one): any sign-in attempt, OTP request, or webhook
   event that resolves to an absorbed identity (absorbed auth uid, absorbed address used
   as a fresh door, absorbed app_user_id) → matched against `identity_merges` → flagged
   loudly. A truly-same human never animates the dead side; a wrong merge almost
   immediately does, because the other human is still out there trying to log in.
2. **Entitlement conservation (I4):** at merge time the union is asserted and stored;
   any later resolution producing LESS than the stored union for the surviving account
   flags. This is the "somebody lost their purchases" detector running before anybody
   notices.
3. **Invariant scan:** on-login (cheap, incremental — this estate's lazy-on-login
   pattern, again): no rows still pointing at an absorbed learner id, alias ledger 1:1
   (I3), every merge row's moved-rows still owned by the survivor. Any violation flags.

**Undo — `merge-undo`, the named operation:**

1. Reactivate/recreate the absorbed learner row from the snapshot.
2. Re-point every row in `moved_rows` back — by recorded id, not by re-deriving.
3. Restore `verified_emails` partition as snapshotted; cascade auth uids back
   (the `previous_user_id` history the `cascade-user-id.ts` header wished for is exactly
   this, and the parked migration adds it).
4. Vendor side: nothing to undo, by construction — D11 kept named-account mappings out of
   RevenueCat, so both app_user_ids still exist and our restored ledger immediately
   resolves them correctly again.
5. Post-merge accrual stays with whoever did it (§6.8); the audit timestamp is the cut.
6. The undo writes its own audit row. Undo is not delete; history is append-only.

---

## 10. Verdict on the existing email-match relink (`useAuth.ts` → `claim_learner`)

The brief asks directly: does it satisfy the model or violate it?

**Its semantics satisfy the model.** A new auth uid whose door proved an address in an
existing learner's `verified_emails` is re-pointed onto that learner — that is exactly
"any door proving any name in the set lands on the same account" (§1.2), and the
SECURITY DEFINER gate (JWT email ∈ verified_emails) honours I2. The orphan-guard on
`cascade-user-id` is a real safety property of the right shape.

**Its mechanics violate three of the model's requirements:**
1. **No audit record.** The merge-shaped event is a `console.log` in a browser. Both
   prior states are unreconstructable one page-load later (violates I5).
2. **No undo**, and the `previous_user_id` gap its own header names is still open.
3. **Non-atomic, fails half-way politely.** `claim_learner`, `relink_user_tags`, and the
   `govt_admins` cascade are three independent calls, each warn-and-continue; a network
   blip mid-sequence leaves an identity straddled across two auth uids with nothing
   recording that it happened.

**Recommendation (estate-touching, therefore Tom-gated — D12):** keep the semantics, wrap
the mechanics: route it through the same `identity_merges` audit write the India path
gets, server-side and atomic. Not done on this branch — it is a change to live login
machinery for the whole estate and belongs in its own reviewed pass.

---

## 11. Open questions for Tom — each answerable in a word or a sentence

1. **Anon id scope: install-scoped, as built?** (Taste-safe default applied per the
   brief.) *Recommendation: yes — survives updates, dies with a wipe, never pretends to
   be a person; Play restore covers the loss case.*
2. **Two-sided alias (§6.6): offered, as designed?** (Taste-safe default applied.)
   *Recommendation: yes — one tap makes it attributable, and shared family phones make
   silent swallowing genuinely dangerous in this market.*
3. **Did the legacy system verify email addresses?** Decides whether the legacy door may
   land directly on an existing Supabase account or needs the one-OTP guard (§8.4).
   *Recommendation: assume unverified until someone checks; the guard costs one code in
   the rare collision case only.*
4. **Is a phone number ever a NAME of an account for India?** Email-is-the-account is the
   ruling and this model holds to it; India is phone-first, so the question will arrive.
   *Recommendation: no for launch; a phone-OTP door proving an email-named account is
   fine later, a phone-named account is a second naming system and re-opens everything.*
5. **RevenueCat alias irreversibility:** the model assumes vendor aliasing can't be
   undone (D11) and is designed so it never needs to be. Ivan/Imdad to confirm current
   RevenueCat transfer/alias semantics; if RevenueCat turns out to allow clean splits,
   nothing changes — D11 just becomes belt-and-braces rather than load-bearing.
6. **Post-purchase offer for free users too?** The offer screen exists at purchase; should
   a lighter "save your progress" version appear for non-payers at some milestone?
   *Recommendation: one quiet Settings entry only, for launch; measure before adding
   anything louder.*
7. **Estate retrofit of §10:** wrap the live relink in the audit primitive? *Recommendation:
   yes, as its own pass after India lands the primitive.*

---

## 12. What was built on this branch (and what deliberately wasn't)

Built — pure decision logic, unit-tested, no vendor SDK, no live-DB writes:

- `api/_utils/identity/emailCanon.ts` — the canonicalisation ruling as code:
  `canonicalEmail()` (the exact key that may ACT), `emailEquivalenceKey()` (the loose key
  that may only SUGGEST — gmail dot/plus folding, consistent with
  `canonicaliseEmailForBurn`), `isAppleRelayEmail()`, `isPlaceholderEmail()` (server-side
  twin of the client util), `emailDisplayClass()` (which addresses may be displayed —
  D3/§5 rule 2).
- `api/_utils/identity/aliasDecision.ts` — the state machine's decision function:
  given (session identity, anon-id summary, target-account summary) returns
  `auto_alias` / `offer_alias` / `land_only` / `refuse` with the reason — D5–D9 as one
  pure function the client and server both call.
- `api/_utils/identity/mergeAudit.ts` — `buildMergeRecord()` (the §9 audit shape from
  both sides' snapshots) and `deriveUndoPlan()` (the undo's shopping list from a record),
  pure, so the eventual endpoints are thin.
- `supabase/migrations/20260903_identity_merges.sql` — the audit table +
  `learners.previous_user_ids`, **GATED/PARKED, not applied** (header says so loudly):
  dev/staging/prod share one DB and applying schema is a canaried, deliberate act under
  this repo's doctrine, not a branch side-effect.

Deliberately not built, with the reason each time:
- The alias/merge/undo **endpoints** — they write tables that don't exist until the parked
  migration is deliberately applied; endpoints against absent tables are theatre.
- Any RevenueCat/Play/legacy **adapter** — no SDK in the repo by prohibition; the seam
  (§7, §8) is the deliverable.
- The **post-purchase screen** — it is India-client (Android) UI; this repo's Vue client
  isn't where it ships, and building it here would be building it twice.
- The §10 estate retrofit — Tom-gated (open question 7).
