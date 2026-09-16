# Swedish course — the two things the learner reported, checked against the live data and the live audio

Report `f1f368b7`, 16 September 2026, learner `3YD1-4F2N`, green belt, Swedish for English speakers.

Short version. She is right twice, and neither fault is in the app. One clip in the course says a
different word from the one written beside it, and it is the one she named. And the run of phrases
where the English and the Swedish do not say the same thing is real — it sits in the very basket she
had just reached. Nothing in the player mis-binds audio to text: every clip the player fetched was
the clip the row named.

---

## What she actually met

She said "seed 74". The chunk she named — **lära dig, "to learn yourself"** — is introduced two
sentences further on, at sentence 75. Her reported position, "to understand / förstå", is sentence
74. So she was moving through 74 into 75 and reported from where she stood. Everything below is
about sentence 75 and the sentences either side of it.

## Claim A — "about three phrases shortly after did not correspond to the written text"

**CONFIRMED, but not as an audio fault.**

I pulled every clip in the lära dig basket and the two baskets after it — 84 Swedish clips and 26
English clips, 110 in all — downloaded each one from the live audio service and transcribed it.
**Every single clip says exactly what its text row says.** Nothing is mis-minted, nothing is
mis-bound. The player reads the audio id straight off the phrase row, so there is no lookup that
could go wrong, and none did.

What does not correspond is the **English and the Swedish of the same phrase**. In the lära dig
basket there are three of them, which is her "about three phrases":

| She was shown | She was taught | What the Swedish actually says |
|---|---|---|
| you started to learn | du ville lära dig | *you wanted to learn* |
| it's fun to learn by yourself | det är roligt att lära dig svenska | *it's fun to learn Swedish* |
| you want to learn | vill du lära dig | *do you want to learn* — a question, not a statement |

Two more sit in the next basket along: "are you satisfied with **your** Swedish now?" is given as
"är du nöjd med svenska nu?" with the *your* missing, and "she's very satisfied with what she's
**done**" is given as "vad hon **gör**" — what she *does*.

So the mismatch she saw is between the two halves of the phrase, not between sound and screen. From
her seat those are the same experience: she hears an English sentence, and the Swedish she is then
shown means something else.

### Her aside — "although she already done that"

**Also right, and it is a separate fault.** "lära dig" was already introduced at sentence 20, glossed
"you learn". At sentence 75 it is introduced again, glossed "to learn yourself". Both are marked as
new, so the course debuts the same Swedish chunk to her twice.

This is not a one-off. **75 of the 616 debuts in the Swedish course re-introduce a chunk that has
already been debuted** — one debut in eight. "var" is debuted four times, "börjar", "klara", "säga"
and "träffas" three times each.

## Claim B — "the listening section brings up a sentence ending in svaret, and the voice says something else"

**CONFIRMED. I found the clip.**

> **"vet du var svaret är?"** — *do you know where the answer is?*
> The first voice says **"vet du vad svaret är?"** — *do you know **what** the answer is.*

It is the female voice, Sofie. The male voice on the very same phrase says "var", correctly. So the
two recordings of one sentence disagree with each other, which is what makes this certain rather
than a matter of my ear: the transcriber heard "vad" on the first clip and "var" on the second, at
both model sizes, and still heard "vad" when it was explicitly primed to expect "var". Both clips
were minted on 11 April 2026.

This phrase sits at sentence 70 — just behind her — and it is a USE phrase, which means it stays in
rotation in the listening exercise forever. That is her "regularly brings up". It does not end on
*svaret* quite, it ends "…svaret är", which is near enough to how anyone would describe it.

I also checked the other reading of "listening section" — the Swedish listening pods. **There is no
sentence containing *svaret* anywhere in the live Swedish pod**, so the pods are not the source.
Every other *svaret* sentence she could have reached — thirteen of them, across sentences 17, 20, 66,
70 and 76, both voices, plus the English — transcribes correctly.

---

## Where the defect lives

**Content, not app.** Both faults are in the data and the recordings, which is the course-creation
side of the house. The player binds audio by id straight from the phrase row — I read the resolution
path and there is no text-based audio lookup anywhere on the learner path — and all 130 clips I
pulled were the clips their rows named. The "vad/var" clip is a bad mint: no row anywhere in the
Swedish course carries the text "vet du vad svaret är", so it is not two rows swapped, it is one
recording made from the wrong words. The English-versus-Swedish disagreements are authoring errors
in the phrase rows themselves. Nothing here is fixed by a code change.

## How wide is this

Wider than one basket, on both counts.

**Recordings.** One bad clip in the 130 I checked — call it under one percent, from a sample too
small to put a real number on. But the reason nobody caught it is measurable: **of 20,847 Swedish
clips, 331 have ever had a veracity check run on them.** That is 1.6%. Estate-wide it is no better —
every large course sits under two percent. The gate that would have caught "vad" for "var" at mint
time effectively does not run.

**Phrase text.** I read a random 45 build and use phrases from the green belt band by hand. Five are
clearly defective — about one in ten:

- "I started to understand everything better" / "jag började bli bättre på allt" — *I started to get better at everything*
- "writing a letter to him" / "skriva ett brev till hans vän" — *to his friend*
- "I want to give you something interesting" / "något intressanta" — wrong agreement
- "she's looking for something different" / "något olika" — not Swedish
- "how do you feel today?" / "hur må du idag?" — should be *mår*

Two more are marginal. So roughly one phrase in ten in this band has either an English–Swedish
disagreement or a Swedish grammar error. That is the rate she is walking into, and it is why she is
noticing.

**What a full check would cost.** The Swedish course is 20,847 clips and 16 hours 23 minutes of
audio. On this machine, transcribing at the fast model setting ran at 3.6 seconds of wall clock per
clip, so the whole course is about **21 hours on one box**, or roughly 5 hours across four. The
accurate model is six times slower and is only worth spending on the shortlist the fast pass throws
up. I have not run it.

## What I would do

1. **Re-record the one clip.** "vet du var svaret är?", first voice. It is in the listening rotation
   for every Swedish learner at green belt and above, and it teaches the wrong word.
2. **Fix the five phrases in the lära dig basket and the two beside it** — these are what she hit.
3. **Run the fast transcription pass over the whole Swedish course.** It is one overnight, it needs
   no decision, and at the observed rate it will find clips nobody knows about. Confirm the hits with
   the accurate model before touching anything.
4. **The veracity gate is the real hole.** It has run on 1.6% of Swedish clips and under 2% anywhere.
   A bad mint currently has nothing standing between it and a learner. That is worth a decision of
   its own, separate from this report.
5. **The duplicate debuts** — one in eight — are a course-generation question, not a repair job.
   Something in the decomposition is not checking whether a chunk has already been taught.

*Diagnosis only. No content changed, no code changed.*
