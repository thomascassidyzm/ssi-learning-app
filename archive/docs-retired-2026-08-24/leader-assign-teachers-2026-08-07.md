# The leader's empty Classes tab, and assigning teachers to classes

2026-08-07. Written for Tom after his staging test hour as **Harbour Leader**
(School Admin, Harbour View School, Visakhapatnam).

---

## 1. What the empty Classes tab actually was

Not a UI bug. A database permission bug, and a silent one.

Your Dashboard tab and your Classes tab read the class list through **two
different doors**. The dashboard's "below this" list is fetched by the server
under a service key, so it saw all three classes — Grade 6B, Grade 7A, Y7
English. The Classes tab reads the `classes` table **straight from the
browser**, so it goes through row-level security.

The rule there says you may see a class if you are its teacher, or if you are
"an admin of its school". That second test asked exactly one question: *are you
the `admin_user_id` pointer on the school row?* You are not — that pointer is
Ashwin, the founding admin. You are a school admin by **tag**, which is what
the invite path writes for every admin after the first.

So all the tests came back false, the read returned **zero rows with no error**,
and the screen reported that emptiness as "No classes yet — create your first
class". An empty state is an assertion about the world, and this one was a lie.

**It was never just you.** Six live school-admin tags belong to someone who is
not their school's pointer admin. Every one of them was blind to their own
school's classes.

### The second layer

Fixing that one function let you see the three classes — and every card said
**0 students**, with a flat activity sparkline. Same bug, one table down: four
other places had the same "are you the pointer?" test *copied out by hand*, so
fixing the function didn't fix them. Those covered the class rosters, the
session history, the staff and student lists, and your "Invite a person" button.

All of them now route through the one shared test. The bar was **parity, not
new access**: a tag admin sees exactly what the pointer admin sees, and nothing
more. Proved live — you and Ashwin now read identical counts on Harbour View
(3 classes, 40 roster rows, 66 sessions, 50 tags), while an ordinary member of
staff and a stranger still read nothing, and you still read nothing from any
other school.

---

## 2. What you can now do

**Assign a teacher to classes, from the people side.** On the Teachers surface,
each teacher row now has **"Assign to a class"**. It opens a picker listing your
school's classes as checkboxes, with the ones that teacher is already on
**pre-ticked**. Tick, untick, confirm — and the difference is applied. So
"move Anjali off 6B and onto 7A" is one interaction, not two, and putting a
supply teacher on four classes at once is four ticks.

If some of it fails, it says **which class** failed and **why**, in the server's
own words. Never a blanket "done".

**One default I chose, so you can overrule it:** when you add a teacher to a
class that already has a teacher, they join as a **co-teacher** — the existing
lead keeps the lead. Only a class with nobody on it makes the assignee its lead.
Handing the lead over stays where it already is, the "Make lead" button on the
class page. Say the word if you want assigning to take over the lead instead.

**The supply teacher can then actually teach.** Verified against the real
database: once you assign them, signing in on **their own login** they get both
classes in their own Classes tab, each with its **own** resume point (Grade 7A
was at S0005L02, Grade 6B at S0006L01 — separate, as they should be), they can
play each one as that class, and they can save the class's progress and start a
class session. That last part matters: a teacher who can play but can't save
would have been a half-shipped feature.

---

## 3. Something you need to know

While this was being fixed, **a second agent was working the same bug at the
same time**, in the same repo folder, with live database access. It reached the
same diagnosis independently — which is reassuring about the diagnosis, and
alarming about the process.

It applied its version of the fix to the live shared database. Its version
rewrote the rule governing who may edit user tags, and **dropped the guard
clause** on it. Postgres fails open there: with that clause gone, any signed-in
user could have run one command to promote themselves to school admin.

That hole was live for a matter of minutes. It was spotted, proved open, closed,
and proved closed again. The check that catches it is now a **permanent
assertion** in the verifier, so it cannot come back quietly. The other agent's
migration file has been corrected in the repo too — otherwise replaying it would
have re-opened the hole.

Nothing suggests it was exploited: the window was minutes, on a staging-hours
database, and the demo tenants were the only ones being touched.

The real lesson is not about the SQL. **Two agents on one task, both able to
apply schema changes to the one shared database, is how you get a
half-applied security rule.** Worth a rule about it.

---

## 4. Still open

- **`schools_update` is still pointer-only.** A tag admin may not be able to
  edit school settings from the browser. Deliberately left alone — it's a write
  widening your request didn't need, and I hadn't verified whether that screen
  writes directly or through the server. Easy to finish if you hit it.
- **Any govt admin can view any learner's data.** The rule has a blanket
  "is this caller a govt admin at all?" clause with no group scoping. That
  **predates** today's work and I haven't touched it — but I found it while
  reading, and you should know.
- **Promotion is yours.** All of this is on `dev`. It is not on staging.

---

## 5. How to check it yourself

```
node supabase/secfix-toolkit/verify_school_admin_tag_parity.cjs
```

Read-only, always rolls back, safe any time. It proves parity across four
tables, no widening, no cross-tenant read, and no self-escalation. 9/9 green as
of this writing.
