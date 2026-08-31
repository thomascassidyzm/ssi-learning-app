# The schools journey, walked end to end

**31 August 2026.** I signed up a brand-new school on **production** (saysomethingin.app),
named it, invited staff, made a class, got a pupil in, and watched that pupil learn Welsh.
Everything below is what actually happened on screen, not a reading of the code.

Test school: *ZZ Journey School (delete me)*, class *Blwyddyn 7*, pupil *Cai Morgan*, all
real rows on the live database, all named for deletion.

---

## The journey as it stands

**12 screens. About 17 taps and 5 typed fields for the head teacher.** Then the link leaves
the app — there is no way to send it from inside — and the pupil's own part is 2 taps and
typing their name.

Signup door → code → optional details → dashboard → wizard step 1 → 2 → 3 → 4 → dashboard →
classes → class page (scroll to the bottom for the link) → *out of the app* → pupil's join
screen → pupil is learning.

The whole thing works. A pupil really does end up saying *dw i'n moyn* into a Chromebook.
But three moments in it are bad enough to lose a school.

### The three worst moments

**1. Minute two: the wizard's first step fails, and eats the school's name with it.**
"Region" was a free-text box. It writes a column that is a foreign key to a fixed list of ten
region codes, so anything a head actually types — *Carmarthenshire*, or even *Wales* —
violated the constraint, rolled the whole write back, and returned **"Failed to update
school"**. Her school's name went down with the region. Nothing on screen says which field
is wrong, because as far as the page knows nothing is.

FIG:09-wizfail-01-fail.jpg

**2. The eleventh child in the class cannot join, and is told the link is invalid.**
The only way pupils get in is one shared link, opened by thirty Chromebooks on one school
wifi within a few minutes. Merely *opening* that link calls the code-validation endpoint,
which was budgeted at **10 attempts per IP per 15 minutes** — while the redemption behind it
was deliberately raised to 120 for exactly this traffic. So the eleventh child got a refusal,
and so did everyone after them for the rest of the window, including the ones already in who
reloaded. The screen they got said **"Invalid Code"** with a red cross and offered "Try
another code" — sending a class of children hunting for a link that was right all along.

I reproduced this live, twice: a worker walking the pupil leg tripped it inside twenty opens
and was still locked out fifteen minutes later, and a plain twelve-request probe against
production returns 429 on every single one.

**3. There is no way to add a class of pupils from the register.**
No CSV, no paste-a-list, no "add pupil by name" anywhere in the product. A school's actual
artefact — a spreadsheet of thirty names — is unusable. The class list is built by children
typing their own names into a free-text box, which is also the only proof of who joined. And
until today the link they need was the **last** card on the class page, below the teachers
panel, the roster, the course journey, the belt chart and the benchmark.

FIG:17-class-01-class-detail.jpg

### The rest of the friction, worst first

4. **Finishing the wizard doesn't change the dashboard.** It still said "Get started — set up
   your school in four quick steps: name it, invite your teachers, choose your courses…"
   after she had done all four. This is Chepstow's exact case: three classes made, no pupil
   ever invited, told for three weeks to do the thing she had already done.
5. **Step 3 of the wizard is a dead end for a trial school.** One course, unticked, Continue
   greyed out, nothing saying why — and the raw code `cym_s_for_eng` printed under the name.

   FIG:13-wiz-01-s3.jpg
6. **The school is called "My school" until she types otherwise — and the name step is
   marked "optional".** The placeholder was stored as a *confirmed* name, so a head who closed
   the tab at that step owned a school called "My school" for ever with nothing ever asking.
7. **A new teacher lands nowhere.** A colleague who joins on the head's invite link sees "No
   classes yet — create your first class". Her school's actual class is invisible to her until
   a leader puts her on it, and nothing tells either of them that. The head gets no signal at
   all that someone joined and is waiting.
8. **"+ Invite students" printed "Open a class to share it" and stopped** — a button whose
   entire answer is the name of somewhere else, with no way there, shown to a teacher with no
   class to open.
9. **Right after signing up, the first tap on Schools drops you into the player** — a Chinese
   lesson — because the role cache still says "learner". The second attempt lands correctly.
10. **Typing faster than the fetch gets you "No school context — try signing back in."**
    Nothing is wrong with the session.
11. **Returning to your own signup link restarts the signup**: "Which language will you
    teach?", with no way out but picking one again.
12. **"1 students"**, on the first pupil a school ever gets.
13. **The classes table scrolls sideways on a phone** — a swipe, on a surface where tap is
    meant to be the only affordance.

---

## What I fixed and shipped

All on branch `fix/schools-journey-2026-08-31`, merged to **dev** and verified on the dev
site. Full check suite green (2,665 player tests, 1,459 API tests, typecheck, lint).

| # | Fixed | Verified |
|---|---|---|
| 1 | Region field cut from the wizard; the endpoint now drops a region it doesn't recognise instead of losing the school's name with it | Named a school on dev — saves clean, no Region box |
| 2 | Class-join validation now uses the wide per-IP budget (120/15min), the same one redemption and try-links already use | 15 straight opens on dev all pass; the same probe on production 429s every time |
| 2b | A throttle refusal no longer says "Invalid Code" — it says "Too many people at once… your link is fine, wait a few minutes" | Copy + unit test |
| 3 | On an empty class the invite link leads the page instead of trailing it | Measured on dev: link at 1008px, roster at 1620px |
| 4 | Once a class exists the banner says the truth — "the last step is your pupils" — and points at the classes | Test flipped deliberately; the old one asserted the Chepstow behaviour |
| 5 | Step 3 pre-ticks what the school has; raw course code gone | Continue live on arrival, on dev |
| 6 | A placeholder name is no longer a confirmed one, so "What's your school called?" now appears for a head who skipped it | Fresh signup on dev, skipped the step, card appeared |
| 7 | A teacher with no classes is told a leader has to put her on one | Copy |
| 8 | "+ Invite students" goes to the classes page, where every row has its own copy-link | Copy + nav |
| 10 | "Still loading your school — give it a moment" instead of "try signing back in" | Copy |
| 12 | "1 student" | Copy |

FIG:36-devnew-01-dash.jpg

And the end of the journey, working — a pupil who joined thirty seconds earlier, mid-cycle:

FIG:23-pupil-audio-01-playing.jpg

---

## Forks — yours, one line each

1. **Bulk pupils.** Genuinely absent. My recommendation: a paste-a-list box on the class page
   that mints one single-use code per name and prints as a strip of slips — the register
   becomes the roster, and you know who is who.
2. **Unverified teacher accounts.** A teacher link grants a teacher account on any typed name
   and email, no code (your 2026-07-20 ruling: the link is the credential). My recommendation:
   keep it for pupils, require the emailed code for teacher and leader links, because those
   carry other people's children's data.
3. **Seats.** A second teacher joining silently puts a one-seat school over its allowance,
   surfaced only later on the checkout page as a fait accompli. Recommendation: tell the head
   the moment it happens.
4. **A new teacher waiting.** Nothing tells the head someone joined and needs putting on a
   class. Recommendation: one line on the dashboard, "Sam joined last night — put them on a
   class".
5. **Trial denied after the school is made.** When a trial is refused (same email twice), the
   school row already exists, so the head is left with a school whose card reads "Trial" with
   a blank where the language should be — Chepstow's symptom exactly. Recommendation: resolve
   the trial before creating the school.
6. **Region.** I cut it rather than build a picker for ten codes nothing reads. If school
   region is wanted for reporting, it needs to come back as a picker with a consumer.
7. **The classes table on a phone.** Recommendation: tappable cards, not a sideways table.
8. **"Add a group"** is offered to a head with no group above her. Recommendation: hide it.

---

## Gaps, stated plainly

- **The fixes are on `dev`, not on `main`.** The journey was walked on main; the fixes were
  verified on the dev site against the same live database. Promotion is yours.
- **The join-throttle fix is verified on dev by probe, not by a real class of thirty.** The
  constant is the same one the sibling endpoints already use.
- One worker reported pupils being silently redirected off the join screen to a default
  Chinese course within 600ms. **I could not reproduce it** later on production; it may have
  been the rate limiter it sat next to. Unresolved.
- I did not walk the money path, the co-teacher invite, or Insights in depth.
- Four test schools and one test pupil now exist on the live database, all named
  "ZZ … (delete me)". Say the word and I'll remove them.
