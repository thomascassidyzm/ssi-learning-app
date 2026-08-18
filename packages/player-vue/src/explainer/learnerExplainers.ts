/**
 * learnerExplainers — the repo-authored prose for the two learner-side
 * explainer sections on the profile. Static data, zero requests.
 *
 * Voice: dog, not dentist (pedagogy-core) — unconditionally warm, brief, never
 * disappointed, never lecturing. British English. No parentheses used as
 * explanation: sentences carry the distinction themselves.
 *
 * Hard content laws, founder rulings 2026-08-03:
 * · No streaks, no days-since, no missed-day or guilt language, anywhere.
 * · No incentive points, no score, no XP, no leaderboard.
 * · The language wall: no internal or non-self-evident technical terminology is
 *   ever learner-facing. The learner reads "a go", "the thing you just said",
 *   "listening deep dives" — never the internal names for any of it.
 * · The thirty-hour promise lives in the "Why this works" section and nowhere
 *   else. It is not a headline; it sits inside the methodology, written with
 *   quiet confidence.
 */

export interface ExplainerBlock {
  heading: string
  /** Paragraphs, rendered as plain text. */
  body: string[]
  /** Optional short list, rendered beneath the paragraphs. */
  points?: string[]
}

export interface ExplainerSection {
  id: 'how-this-works' | 'why-this-works'
  /** The quiet text link, and the panel's own kicker. */
  linkLabel: string
  /** One line at the top of the panel, before the blocks. */
  intro: string
  blocks: ExplainerBlock[]
}

export const HOW_THIS_WORKS_LEARNER: ExplainerSection = {
  id: 'how-this-works',
  linkLabel: 'How this works',
  intro: 'The whole thing is one button. You press play and it takes it from there.',
  blocks: [
    {
      heading: 'What pressing play does',
      body: [
        'You hear a short phrase in English. Then there is a gap. The gap is yours — say your version out loud, out into the room, even if it comes out wrong or halfway. Then you hear it said properly, twice, by two different voices, so you can hear how it really sounds.',
        'Then the next one arrives on its own. There is nothing to tap in between.',
      ],
    },
    {
      heading: 'What a go is',
      body: [
        'A go is one of those gaps where you opened your mouth and had a crack at it. That is all it takes to count.',
        'Getting it wrong is still a go, and it still does the work. The reaching is the bit that builds the language — whether it arrives is almost beside the point.',
      ],
    },
    {
      heading: 'What a session feels like',
      body: [
        'New things arrive one at a time, and things you met earlier come back round on their own, spaced out so you meet them again just as they start to slip. You never have to keep track of any of that.',
        'Ten minutes is a real session. An hour is a proper one. Stop whenever you like and it picks up exactly where you left off.',
      ],
    },
    {
      heading: 'The different ways to use it',
      body: [
        'Speaking is the main one, and it is what you get by default. Easy and Fast are the two paces, and you pick between them on the player screen before you start. Offline lives behind the sliders button at the bottom of the player, and Listening lives in Settings.',
      ],
      points: [
        'Listening is audio only, with no speaking — for when your mouth is busy walking the dog, driving or doing the washing-up.',
        'Fast is the standard pace. Easy gives you about double the thinking time and more repetition, for when you want longer to get the words out.',
        'Offline downloads a chunk of the course onto your phone, so it plays with no signal at all.',
      ],
    },
    {
      heading: 'What the listening stretches ask of you',
      body: [
        'Every so often the speaking gives way to a stretch of listening. It starts on its own, introduced by a quiet now just listen for a while, and then it simply plays.',
        'Nothing is asked of you here. Let it come at you without effort but with attention, the way you would listen to birdsong. The words are on screen if you want them, and the next speaking round arrives by itself afterwards.',
      ],
    },
    {
      heading: 'Changing course',
      body: [
        'The Library button at the bottom left holds everything you have access to. Tap a different course and you are straight into it.',
        'Each course remembers its own place, so you can have a poke at a second language without losing an inch in the first.',
      ],
    },
  ],
}

export const WHY_THIS_WORKS: ExplainerSection = {
  id: 'why-this-works',
  linkLabel: 'Why this works',
  intro: 'Why the app asks you to do it this way, and what to expect from it.',
  blocks: [
    {
      heading: 'Say it before you hear it',
      body: [
        'That gap before the answer is where everything happens. Every time you reach for something and it does not quite come, you are laying down the path that makes it come next time.',
        'Recognising a phrase on a page feels easier and does much less. So we ask you to produce it first, out loud, every time — and that is why there is no vocabulary list to revise and nothing to memorise.',
      ],
    },
    {
      heading: 'What happens at around thirty hours',
      body: [
        'Somewhere around thirty hours in the app, it turns a corner. Not finished and not fluent, but fun, easy and playful in a way the first stretch honestly is not. Three things you will be able to check for yourself:',
      ],
      points: [
        'You will be getting into conversations.',
        'You will be moving towards more listening work.',
        'You will be noticing how much surfaces easily that was genuinely impossible before.',
      ],
    },
    {
      heading: 'Thirty hours, spent however suits you',
      body: [
        'Thirty is the number that matters. How you spread them is entirely yours. An hour a day for a month works. Six hours a day for five days works too, if you have a real burn on and the time to feed it.',
        'Five minutes a day sounds like the gentle option, and it is actually the hardest road of the lot — the most decisions to make, and the least evidence per sitting that any of it is working. If you can give it bigger stretches, give it bigger stretches.',
      ],
    },
    {
      heading: 'Speaking first, deep listening later',
      body: [
        'For the first thirty hours or so it is mostly speaking, with listening folded in around it. After that the balance tips, and longer listening deep dives on harder material become the thing that carries you forward.',
        'That second part is what we are most confident about. Bulk listening is the real difference-maker — but only once you have enough of your own language to hang it on, which is what the speaking builds.',
      ],
    },
    {
      heading: 'Why there are no streaks and no points',
      body: [
        'We do not count days in a row, and we never will. A streak is a lovely thing right up until it ends, and then it quietly becomes a reason to stay away — which is backwards, because the day you turn up again is the most valuable day there is. So the app simply has no way of knowing anything about the time you spend away from it.',
        'There are no points, no score and no leaderboard either. A points total only ever measures the app having an opinion about you. The thing worth measuring is what you can actually say, and you can check that yourself in any conversation you fancy.',
        'Plenty of apps do this differently and plenty of people love them for it. We would just rather build the one that is glad to see you whenever you turn up.',
      ],
    },
    {
      heading: 'Where all this comes from',
      body: [
        'None of it is a hunch. SSi has been running this as action research since 2009 — real learners, real conversations, and the method changed whenever the evidence said it should. Most recently Aran worked through Croatian an hour a day, which gave the clearest picture yet of what happens and when.',
        'Which means you do not have to take a view on the method, or work out how to study, or build a plan. You just press play.',
      ],
    },
  ],
}
