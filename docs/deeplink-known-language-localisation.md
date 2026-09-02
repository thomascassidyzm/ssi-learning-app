# Deep links now speak the visitor's language

Aran asked for it, and it is live on staging.

## What a visitor experiences now

Someone follows a link to **English for Hindi speakers**. Before today they
landed on an English page about learning English. Now the page is in Hindi
from the first paint — the heading, the belt name, the speed switch, the
course subtitle, all of it.

The signal we use is the course's **known** language: the one the learner
already speaks. Someone who clicks a link for exactly that pairing has told us
more about what they read than any browser setting could.

## The rule

A deep link **infers** a language. It never **overrides** a choice.

- No stored preference — the link sets it. This is the common case: new or
  anonymous visitors.
- An explicit preference, picked in Settings — untouched. The link is ignored.
- A previous link's guess — replaceable by a later link, because a guess was
  never a decision.

Making that work needed a distinction the app did not have. The interface
language was one string in the browser with no record of where it came from,
so "they chose Welsh" and "we guessed Welsh" were indistinguishable. There is
now a second value recording which, and a locale stored before this existed is
read as chosen — until today the only thing that could write one was the
Settings picker, so every value already out there is a real decision.

## The coverage number

This is the constraint Tom will want, and it is good news.

**We ship 22 interface languages.** English, Welsh, Irish, Spanish, French,
German, Italian, Portuguese, Arabic, Japanese, Korean, Chinese, Hindi, Bengali,
Gujarati, Punjabi, Urdu, Tamil, Sinhala, Azerbaijani, Lithuanian, Yoruba.

**87 of 90 courses** have a translated interface for their known language —
97%. The three that do not are Kannada, Marathi and Telugu. For those, the
honest behaviour is what now happens: the page stays in English rather than
half-translating.

Every course in the catalogue has a known language set — no gaps, nothing to
backfill. The 21 non-English interfaces carry between 297 and 333 of English's
365 strings, so a handful of newer strings still read in English inside an
otherwise translated page. "Save Progress" is the most visible one. That is a
translation backlog, not a bug, and it is separate from this work.

## Both entry shapes

A link that lands straight on the course page works, and so does one that goes
via sign-in or sign-up. The round trip is free rather than fragile: the
language is settled and stored the moment the visitor lands, before anything
else happens, and signing in is a six-digit code typed on the same page — there
is no navigation away to survive.

## Two things found on the way

**A guess was being promoted to a choice.** The browser check caught what every
unit test passed through: on the next page load, the app re-saved the stored
language as part of starting its download, and that re-save recorded it as
"chosen". So one page load after any inferred language, the visitor's guess had
hardened into a decision, and every later link was refused on the grounds of
protecting a choice nobody made. Fixed, with three tests holding the boot path.

**Devanagari headings were rendering as empty boxes.** On a Hindi interface the
course name came out as tofu while every other string on the same screen was
fine. The app already switches to a full-coverage typeface for languages the
brand font cannot spell, but the switch reached body text and not headings.
This was true before today — it was just unreachable, because a Hindi interface
previously required finding it in Settings. One line, in the rule that already
existed.

Tamil, Bengali, Arabic, Hangul and Chinese characters rely on the phone's own
fonts by design, which is documented and deliberate; they render as boxes only
on the headless Linux box used for testing, not on a real device.

## Where it is

Live on staging: **https://staging.saysomethingin.app/?course=eng_for_hin**

Try `?course=eng_for_tam` (Tamil), `?course=spa_for_eng` (nothing should
change), and `?course=eng_for_kan` (Kannada — no interface, correctly stays
English). Set a language in Settings first and the links should all leave it
alone.

Merged to dev and staging. Not on main — it soaks first, per the learner-app
release train.
