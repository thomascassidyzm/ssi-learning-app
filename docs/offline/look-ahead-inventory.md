# What the app downloads ahead of you

*1 September 2026. Plain-English inventory of the look-ahead cache, written because Tom asked to see the sequence and check his judgement that it is basically correct.*

---

## The idea in one paragraph

The app never waits for the whole course. It keeps a **rolling buffer** of the next stretch of play on the device, topped up quietly in the background while you learn, and it refuses to fight the audio you are actually listening to — one download at a time, only things it hasn't already got, and it stands aside the moment anything more important wants the connection. Separately, if you deliberately turn **Offline** on, it does a proper bulk download with a progress ring. Those are the only two mechanisms. Everything below is about what order they fetch things in.

---

## What kinds of content there are

| | What it is | How much of it | Roughly what it weighs |
|---|---|---|---|
| **Rounds** | The ordinary practice cycles — your prompt, the two target voices, every build and review phrase | Spanish: 1,475 LEGOs, 16,325 practice phrases | The LEGO audio alone is about **48 MB**; the practice phrases are several times that again |
| **Listening — the pod** | The dialogue scenes you listen through, including the per-sentence breakdown renders | Spanish: 231 sentences across 22 scenes = **1,067 clips, 61 minutes** | **~43 MB** |
| **Listening — Layer 1** | The comprehensible-input sandwiches built from seeds you've already drained | Spanish: **1,334 clips, 80 minutes** | **~57 MB** |
| **Commentary** | The spoken encouragements, instructions and the welcome | A small fixed set per course | Under a megabyte |

So **all the listening together is about 2,401 clips, two and a half hours, ~100 MB** on Spanish.

**That is a real number and you should have it before you settle this.** I gave you ~28.7 MB earlier and it was wrong twice over — I'd assumed a bitrate about three times too low, and I'd missed the per-sentence breakdown renders. The corrected figure is checked two ways: the audio corpus median is 12.36 bytes per millisecond (~99 kbps, so a 2.5-second clip is about 30 KB), and 103 clips read straight out of a real device's storage averaged 30,073 bytes each. The whole course corpus is roughly 1.6 GB, so the listening is still a small fraction of it — but 100 MB pulled down early, ahead of most of your course, is a meaningful amount of someone's mobile data. Your call, and it is easy to scope down if you'd rather.

*(One clarification worth having: the pod table also holds retired pods and a music pod. The app only ever serves one pod per course, so those are never fetched. "All the listening" means everything the app can actually play, not everything sitting in the table.)*

---

## Sequence 1 — the quiet background top-up (runs while you play)

This is the one that matters most, because it is the one running when your signal disappears without warning. It builds a single ordered shopping list and works down it, skipping anything already on the device.

**Before**

1. Every practice clip in the next stretch of play ahead of you
2. The next listening pod lap — **but only if one happened to fall inside that stretch**
3. Any Layer-1 listening cups falling inside that stretch

**After**

1. **The next three rounds** — enough to carry on practising immediately
2. **All the listening — the whole pod and the whole Layer-1 pool**
3. The rest of the practice clips in the stretch ahead
4. The pod lap and Layer-1 entries as before, unchanged

**What gets pushed later:** only the *remainder of the rounds in the look-ahead stretch* — rounds four onwards. Nothing is removed and nothing else changes place. That is the right thing to yield, because you cannot reach those rounds until you have played the first three, and because the listening is a fixed ~28.7 MB while the round buffer grows with the course.

**Why it needed changing:** listening was last, and it was only ever fetched if a listening exercise was already due. Lose signal before your first one, and there was **no listening on the device at all** — which is what made "play what you have" mean "play almost nothing".

---

## Sequence 2 — the deliberate Offline download (you tap the switch)

1. Work out the full script to the depth you chose on the slider
2. Fetch every practice clip to that depth
3. Then commentary, pods, Layer 1 and the listening metadata
4. Save the round structure, stamp the 30-day offline licence, mark it Ready

**The same one change** has been made here: the listening now rides directly behind the first few rounds instead of sitting behind every round of the course. The *set* of things downloaded is identical, so the totals, the progress ring and "Ready ✓" all mean exactly what they meant before — only the order differs. It matters because a download can be interrupted: signal goes, app closes, you walk away. Whatever landed before that is what you actually have, and before this it reliably had none of the listening.

---

## The rules the sequence obeys

- **Never starve the audio you're hearing.** The background top-up fetches one file at a time and stands aside completely while a bulk download is running.
- **Only fetch what's missing.** Everything is checked against the device first.
- **Fill deeper than the next few seconds.** The list is built well ahead of the playhead, not just to the edge of the current round.
- **A clip that won't come is skipped, never retried into a wall.** Offline the app now refuses to even ask for something it hasn't got.
- **Readiness is a threshold, not perfection.** 99.9% cached is a playable course; the last few clips keep retrying in the background.

---

## The judgement you asked me to check

Your read was that the sequence is basically correct, and I agree — the structure is sound and the reasoning behind it holds up. The ordering principle ("position in the list *is* the priority, drain it front to back") is simple and right, and the protections around not starving live playback are well thought through.

The one thing genuinely wrong was where listening sat, and that is now fixed. The cost is **~100 MB fetched earlier than before** on a Spanish-sized course — two and a half hours of material a learner can loop through the moment new content stops arriving.

I am not going to tell you that is cheap. It is a small slice of a 1.6 GB course, and it is the slice that makes offline actually work, but it is also a hundred megabytes arriving before most of the practice content a learner is heading towards. It is built as you ruled it — all of the listening, promoted — with the number stated rather than the set quietly trimmed to make the claim comfortable. If you want it scoped (the served pod alone is ~43 MB; the core pod clips without the breakdown renders are ~32 MB), that is one line to change.
