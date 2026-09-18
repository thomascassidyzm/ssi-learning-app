# Draft note — teachers who taught a class from their own account

**NOT SENT.** Nothing here has been inserted into `admin_messages` or `user_messages`,
nothing is queued, and no code path in this job can send it. It is a draft for Tom to edit.

**Who it goes to:** two people. leejames at St Alban's RC High School, Pontypool, and
hughesr310 at Ysgol Gyfun Tredegar. Not all teachers. The evidence for each is in the
companion list. Mrs Ruttley is deliberately not on it: her own-account play was a different
course, and she has already had a note from the September sweep.

---

## The message

**Title**

> Starting a lesson on the class, not on you

**Body**

> We have noticed that some of your lessons have been running while you were signed in as
> yourself rather than as the class. That is an easy thing to do, and nothing about it was
> obvious from the screen, so it is on us rather than on you.
>
> It matters for one reason. The class has a brain of its own that decides what to practise
> next and when to bring a phrase back, and it can only see what happens on the class's own
> account. Everything you played while signed in as yourself is safely yours, but the class
> cannot learn from it, so the class is further back than the lessons you have actually
> taught.
>
> The fix takes one tap from now on. Open the class and press **Play as class** rather than
> pressing play in your own library, and everything the class hears from then on lands on
> the class.
>
> We are leaving what you have played exactly where it is. Nothing has been moved, nothing
> has been copied, and nothing you have done has been lost.

**The three replies, as the teacher sees them**

| Button | What it does |
|---|---|
| **Understood** | One tap, no typing. Stamps the message as answered so Tom knows it landed. |
| **Show me** | Opens the Handbook at *Play as class from the class page*, which offers the clip. |
| **Reply to the team** | The free-text box already under every message from SSi. Opens a support thread that cards to Tom. |

The button words are mine, not Tom's — his note said "Understood. / Something like that / Or
show me - points to the clip / Or reply to the team", which gives the shape. Overrule any of
the three. "Show me" is the one I would most expect him to change; "Have a look" and
"Show me how" are both in the running.

**If he wants it shorter:** cut the second paragraph to one sentence — "The class has a brain
of its own, and it can only see what happens on the class's own account" — and the note drops
to three short paragraphs without losing the mechanism or the reassurance.

## Which clip "Show me" points at

`class-page-play-and-manage`, reached through the Handbook entry
`play-as-class-from-the-class-page`, anchored on `class-page-play` in `NodeHomeView.vue`.

Two other walks were candidates and neither is right for this note.
`playing-as-yourself` is about the banner that warns you mid-lesson — that is the diagnosis
the teacher has already lived through, not the remedy. `practice-on-your-own-account` is
about the line on My Classes that accounts for own-account minutes after the fact — useful,
but it is bookkeeping rather than the thing to do differently on Monday. The note says
"press Play as class", so the clip should show the Play as class button on the class page,
and that is `class-page-play-and-manage`.
