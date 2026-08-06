# Co-teaching: the three follow-ups

*6 August 2026. Answers to the three questions asked of the co-teaching build (A-74).*

---

## 1. Where the co-teaching work actually is

**It is on `dev`, and nowhere else. Nothing leaked to staging or to production.**

This was checked properly rather than assumed. Thirteen co-teaching commits were
found by name on the dev branch. Each one was then tested for patch-equivalence
against both staging and production — that is, asking git not merely "is this
commit here?" but "is an equivalent change here under any other identity?", which
is the check that catches a cherry-pick or a re-application. All thirteen came
back absent from staging and absent from production. Searching those two branches
directly for co-teaching commits returns nothing at all.

So the promotion train is intact: the work is sitting on the rapid-integration
branch waiting for you to promote it, exactly as intended. Two further commits
landed today as part of these follow-ups; both went to dev the same way.

---

## 2. Self-teaching coverage for the new abilities

**The standing rule holds: anything the app can newly DO gets a short
compile-gated clip.** Co-teaching shipped without any, so three were built.

The pipeline already existed and was followed rather than reinvented: the clips
are hand-authored, then a compiler checks every step against the live interface
and refuses to build if a step points at something that is no longer on screen —
so a clip can never quietly start lying about the product. Destructive or
irreversible buttons are point-at-only; a clip can never click one for you.

The three new clips, each under five steps:

- **Share a class with a colleague** (4 steps) — adding a co-teacher from the
  class page: who you can add, and what they get when you do.
- **Invite a teacher who isn't here yet** (3 steps) — the class-scoped link that
  brings a colleague straight into this one class, and how it differs from a
  student join code.
- **Hand a class over to another teacher** (3 steps) — passing the lead, what
  changes when you do, and what does not.

All three are offered to teachers on the class page. The compile gate passes with
them in: nine clips, thirty-three steps in total across the product.

---

## 3. The permission ruling — who may add a co-teacher

Your ruling: *"any group leader or the current teacher of the class can add the
co-teacher I think."*

**What shipped was both wider and narrower than that at the same time, and both
halves are now fixed.**

**Too wide:** any teacher of the class could recruit. A co-teacher you had
invited into your class could then invite further co-teachers of their own, hand
the lead away, or remove a colleague — none of which your ruling gives them.

**Too narrow:** the only leader who could do it was the school's own admin. An
organisation or group leader sitting above that school in the hierarchy — a
council, say — could not add a co-teacher to a class inside their own patch.

**Now:** the class's current lead teacher, or any group leader above the class —
its school admin, or a leader of the school's group or of any parent group above
it — and, as always, an SSi platform admin for support. Not every teacher of the
class, and not every teacher in the school.

One deliberate exception, because it is not managing anybody else: a co-teacher
can still remove themselves, that is, leave a class they were added to. The
button says *Leave* rather than *Remove* when that is what it does.

The same rule now governs both routes into a class, which previously disagreed:
adding a colleague directly from the staff list, and minting a class-scoped
co-teacher link. Both ask one shared question in one place, so they cannot drift
apart again. Day-to-day teaching is untouched — a co-teacher still creates
student join codes, adds learners, and runs sessions exactly as before. Only the
question *who teaches here* narrowed.

### The database had the same hole, and it is closed

A permission rule enforced only in the app is not enforced at all if the database
will accept the write directly from a browser. It would have.

A change made earlier the same day — correctly, for a different reason — let a
co-teacher edit class membership records so they could remove a student from the
roster. That permission was not restricted to student records, so it also let a
co-teacher reinstate a removed co-teacher or delete the lead teacher's own
record, straight from the browser, going around the rule entirely.

That is now narrowed to student records only. The lead teacher and the school
admin keep full authority.

This was applied by the mandatory canary method rather than a bare migration: the
change is made inside a transaction, the old hole is proven to be genuinely open,
the fix is applied, and then every legitimate path is re-tested as a real user
before anything is committed. Eight checks, all green — the hole reproduced
beforehand and closed afterwards; a co-teacher still able to remove a student;
the lead teacher and the school admin still able to manage teachers; an unrelated
stranger still able to write nothing. It was committed only on that result.

**Nobody lost anything they use today.** Checked against live data first: no class
in the system currently has more than one teacher. Co-teaching is new and unused,
so the rule lands before the first real co-teacher does, rather than being taken
away from someone mid-term.

---

## One thing to know that is not ours

While running the full test suite after merging, one unrelated test on the
dev branch fails — a timeout in the schools top-bar play-as-class check. It fails
identically on dev without any of this work applied, so it arrived with a
different change earlier today and belongs to whoever owns that area. Flagged
rather than fixed, because silently patching another lane's test hides it.

---

*All of the above is on dev. Promotion to staging and production remains on your
hold, untouched.*
