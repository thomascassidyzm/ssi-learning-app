# How SSi should prove a person belongs to a school

2026-09-09. Design only, no code changed. Job #707 on branch `cs/707-school-belonging-what-channel-pr`, not merged.
Every claim about current behaviour was read from the code on `origin/dev` at `494d437a`, and the counts were read from the live database today. Where a claim is a guess it says so.

---

## The answer in four lines

1. **Belonging is not a property of an email address.** It is an act by the person who already holds the school: the admin. We already record that act twice, with no message to any mailbox: the admin hands over the link, and the admin puts the teacher on classes.
2. **The channel is the school's own channel to its staff.** Teams, WhatsApp, a slip of paper, a voice across the staffroom. We never have to get through their gateway because nothing travels from us to the teacher. It travels from the admin to the teacher, and the admin is already in the building.
3. **Nothing is stamped at the door.** Anyone with the link gets in first time, as today. They become a member of the school when the admin gives them a class, or hands them a code with their name on it. Until then the account can learn Welsh and can see no pupil.
4. **Recommendation: replace the arrival attestation with the admin's assignment as the one record of belonging, and turn the domain match into a sorting hint on the roster that carries no weight.** Then forging it buys nothing, and there is nothing left to forge.

---

## The frame

Today's frame, implicit in the code: *belonging is a string match between the address the arriving person typed and a domain the school claimed, tested once, at the door, and stored where the person being tested can rewrite it.* Every weakness follows from that shape, not from a bug in it. The address is chosen by the person under test. The comparison happens once. The record lives in `user_metadata`. And the whole thing stands in for a mailbox nobody can send to.

The frame this document proposes: **belonging is a relationship, and the only party who reliably knows it is the school's admin.** The design question is not "how do we prove the address" but "what makes the admin's vouch cheap enough that a non-technical head of department does it without noticing, and visible enough afterwards that a stranger cannot hide in the roster."

Two facts from the live database make this frame the honest one rather than the clever one:

| What the live data says today | Count |
|---|---|
| Schools that have claimed any email domain | 6 |
| Schools with a founding admin on record | about 50 |
| Teachers holding a school tag | 102 |
| Of those, already given at least one class by their admin | 74 |
| Of those, currently marked "Unverified address" | 3 |

The domain mechanism covers roughly one school in eight. The admin's class assignment already covers three teachers in four, and nobody had to be told to do it, because a teacher without classes cannot use the product. **The vouch we are looking for is already happening. We just do not record it as a vouch.**

## What the hole actually buys, sized honestly

The commission said "anyone who can sign up can grant themselves school access." Read against the code, that overstates it.

- School access itself comes from **holding the invite link**. `api/code/redeem.ts` writes the school tag and the teacher role from the link's `grants_school_id`, whatever `arrival` says. A forged arrival grants no access that the link did not already grant.
- What a forged `arrival: 'on_domain'` does buy, for someone who already holds a leaked link and typed an off-domain address: the admin's "Unverified address" pill disappears from the Teachers page, and the unproved address is written into `learners.verified_emails`.
- That second effect is the one real widening. `verified_emails` is the key that `api/access/grant-emails.ts` and `api/access/claim.ts` use to apply free-access grants addressed to an email. So a stranger with a leaked teacher link could type a third party's personal address, forge the flag, and pick up any access grant addressed to that address. It needs a leaked link and a guess at an address with a pending grant. Small, real, and worth closing.

Tom's sizing was right: smaller than suspected, important nonetheless.

**The one-line narrow fix.** Move the attestation from `user_metadata` to `app_metadata`, which only the service role can write, as `shellClaim.ts` and `unclaimedMint.ts` already do for their own markers. That closes the forgery in an afternoon and should happen whatever else is decided. It is not the answer to the question, because it makes an attestation unforgeable that only six schools can produce and that proves nothing about who owns the mailbox even when it is genuine.

---

## Three mechanisms

### A. Belonging is the admin's assignment. Nothing is proved at the door.

Keep the one-tap multi-use link exactly as it is. Anyone arriving on it gets an account with the teacher role, and appears on the admin's Teachers page in a section headed **Not yet given classes**. The moment the admin ticks a class for them, in the button that already exists, the server writes a service-role-only record: vouched by whom, when. That record is the membership. The "Unverified address" pill goes. The domain match survives only as a quiet sort key on that pending list, so the admin's eye lands first on the arrivals who look like strangers.

- **Costs the school:** nothing new. The admin already assigns classes, because a teacher with no class has nothing to teach. If they never do it, the arrival stays pending forever, sees no pupil, and the admin can remove them with the button that already exists.
- **Costs the learner:** nothing at the door. A teacher who arrives before their admin has assigned them sees an empty dashboard, which is today's behaviour already.
- **Students:** unchanged. A pupil enters by the class code the teacher gave out, with no email at all, and belongs to that class because the teacher can see and remove them. That is already reconciliation, and it already works.
- **What it deletes:** the arrival attestation, the write to `verified_emails` at the door, and the schools use of `needs_verification`. The domain claims table stays but stops being load-bearing.

### B. Named seats. The admin vouches before the person arrives.

The admin types a name, not an address, and the product hands back an 8-character code for that person. The teacher spends the code, on any device, with any address or none, and arrives already vouched, attached to the name the admin typed. This is the existing access-code machinery in `api/school/staff-signin-link.ts`, which today only works for a teacher who is already in. The change is letting it mint for a seat that is not yet filled.

- **Costs the school:** one act per teacher: type a name, read out or paste a code. That is the same act as handing over the link, done once per person instead of once per staffroom. A head of department who will not do it falls back to A, so the failure mode is "unvouched, pending", never "locked out".
- **Costs the learner:** typing eight characters instead of tapping a link. For a teacher who joins mid-year, this is also their way back in if a gateway ever eats a code, which the estate has already ruled is the standing return route.
- **What it buys over A:** a teacher can be vouched and given classes on the same day they arrive, and the admin's record of belonging predates the account rather than following it. It also names the person, which A cannot do until they have typed a display name.

### C. Co-presence. A code that only exists in the room.

A frame-breaker, included because it is a genuinely different channel: the admin opens a page during a staff meeting, and it shows a short code that changes every few minutes and dies when the page is closed. Everyone in the room types it. Belonging is proved by having been in the room with the admin.

- **Costs the school:** one page open for ten minutes at a meeting. Nothing to type per person.
- **Costs the learner:** type a short code within the window.
- **Why it is not the recommendation:** it does not cover the teacher who joins in November, a teacher on the day they are absent, or a school that never holds a meeting with laptops out. Every one of those falls back to A or B, so C is a pleasant front end on B rather than a mechanism that can stand alone. Build it later if admins ask for it.

---

## Recommendation

**A as the spine, with B's named code as the one-act way to get a specific person in and vouched at the same time.** Reason: A costs the school nothing they are not already doing, and the live data shows they are already doing it for three teachers in four. B is already three-quarters built. Together they carry the fact of belonging over the school's own channel, and leave nothing at the door that a forgery could improve.

Better, Simpler, Cheaper, honestly: better because membership becomes a named human act instead of a string match that six schools can use; simpler because it deletes the attestation, the door-time `verified_emails` write, and the pill, and reuses two buttons that exist; cheaper because there is no channel to maintain, no deliverability to engineer, and no list of tenants to keep right. The shared-tenant rule stops being needed for belonging at all, because a domain never vouches for anyone. It can stay as a sort hint without any of its consequences.

This holds the standing shape: working first time still outranks security in chronology. Nobody is stopped at the door. The stranger is made visible and removable, not refused.

## What I am not sure of

- **Whether admins assign classes promptly enough for "pending" to be short.** The live count says 28 of 102 teachers have no class today, and I do not know how many of those are recent arrivals versus long-dormant accounts. Free check: the build worker reads `user_tags.created_at` against `class_teachers` for those 28 and reports the age distribution before deciding whether pending needs a nudge.
- **Whether a teacher with no class truly sees no pupil data on every route.** `api/_utils/schoolScope.ts` states that a teacher's scope is the classes they teach and nothing school-wide, and I read that header, not every endpoint. A build worker should confirm it with one probe as a signed-in unassigned teacher before A is trusted to make the door harmless.
- **Whether the six schools that claimed a domain will mind it stopping being load-bearing.** I suspect not, since it never blocked anyone and only three teachers in the estate carry the pill, but Tom knows those heads and I do not.
- **What a pending arrival who is genuinely staff should be told on their empty dashboard.** One sentence naming their admin is my guess. That is copy in Tom's voice, not mine.
- **Whether `verified_emails` should ever be written by a schools path at all.** Under A it is not. If a teacher wants their personal address on the account for recovery, the Settings "Verify now" code already does it and reaches a personal address because it is not behind the gateway. That is where email survives, as a corroborating signal for the learner's own recovery, never as proof of belonging.

## The second finding, in one line

Not mine and not designed here. Tom read it as a process fix, and nothing above touches `api/org/enrol.ts`.

---

## Supporting notes, for the build worker

- **Files read:** `api/auth/possession-redeem.ts` lines 1-80 and 400-500, `api/code/redeem.ts` lines 320-400 and the school-tag writes at 650-700, `api/_utils/schoolDomain.ts` header, `api/_utils/unclaimedMint.ts` header, `api/_utils/shellClaim.ts` header, `api/school/staff-signin-link.ts` header, `api/_utils/schoolScope.ts` and `schoolStaff.ts` headers, `api/access/grant-emails.ts`, `packages/player-vue/src/views/schools/TeachersView.vue` handbook comments and the pill at line 414. The retired deliverability investigation is at `archive/docs-retired-2026-08-24/schools/email-deliverability-plan.md` and its findings about allow-list gateways are the reason no mechanism above sends anything.
- **The verification of the hole** is job #703's published note, confirmed at code level and not live-exploited.
- **Live counts** came from one read-only query over `user_tags`, `class_teachers`, `learners` and `school_identity_claims` on 2026-09-09. They will drift; re-run before quoting.
- **The contest rule** in `unclaimedMint.ts` deliberately does not sweep schools mints, because a teacher's password is theirs. A carries that forward unchanged: nothing in A destroys a credential.
- **Where the vouch record should live:** a service-role-only column or a row keyed to the school tag, written by the class-assignment endpoint and by the named-code mint. Not `user_metadata`. Not a client write. The Teachers page reads it through the existing server endpoint.
- **What comes out:** the `arrival` write in `possession-redeem.ts`, the `onDomain` branch in `code/redeem.ts`, the pill in `TeachersView.vue`, and its handbook sentence, rewritten in the same edit as the rule in `CLAUDE.md` requires.
