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

/**
 * A proof row: a plain text link out to a page on saysomethingin.com that
 * shows the thing actually happening to somebody.
 *
 * The label describes the RUN, never a fact off the page — so editing the page
 * can never make the label a lie, and nothing here has to be kept in sync.
 * Every url must be https and on a host the in-app browser will frame, so the
 * learner is never thrown out to Safari mid-session; the test asserts both
 * against canFrame() rather than repeating the allowlist.
 */
export interface ExplainerLink {
  label: string
  url: string
  /** Shown in the in-app browser's header. */
  title: string
}

/**
 * The illustrations, named here and drawn by components — so prose stays in
 * this module and pixels stay in components. Every name in this union must have
 * a component behind it in ExplainerFigure.vue, which holds the map as a
 * Record over exactly this type, so a name no component draws will not compile.
 *
 * · cycle-pill — the still portrait of the player's own phase pill.
 * · three-gaps — three gaps side by side, one arriving, one half arriving, one
 *   coming out wrong, all three carrying the same tick.
 * · spacing-returns — new things arriving along a session line, each coming
 *   back below at visibly widening intervals. Deliberately no days and no grid.
 * · listening-stretch — the speaking rhythm of beats and gaps giving way to one
 *   unbroken stroke. The absence of gaps is the argument.
 * · worn-path — a route worn in by footfalls beside the same route merely read.
 * · climbing-band — one climbing band whose two halves, speaking and deep
 *   listening, swap width at the corner. The same climb as the mountain.
 */
export type ExplainerFigureName =
  | 'cycle-pill'
  | 'three-gaps'
  | 'spacing-returns'
  | 'listening-stretch'
  | 'worn-path'
  | 'climbing-band'

export interface ExplainerBlock {
  heading: string
  /** Paragraphs, rendered as plain text. */
  body: string[]
  /** Optional short list, rendered beneath the paragraphs. */
  points?: string[]
  /** Optional link rows, rendered beneath everything else. */
  links?: ExplainerLink[]
  /** Optional illustration for this block. */
  figure?: ExplainerFigureName
}

export interface ExplainerSection {
  id: 'how-this-works' | 'why-this-works'
  /** The quiet text link, and the panel's own kicker. */
  linkLabel: string
  /** One line at the top of the panel, before the blocks. */
  intro: string
  /**
   * Optional illustration for the section as a whole, drawn under the intro.
   * 'player-screen' is the small tappable shot of the player, which opens
   * full-screen with its four things named — it belongs to the whole section
   * rather than any one block, because the things it names are spread across
   * four of them.
   */
  figure?: 'player-screen'
  blocks: ExplainerBlock[]
}

export const HOW_THIS_WORKS_LEARNER: ExplainerSection = {
  id: 'how-this-works',
  linkLabel: 'How this works',
  intro: 'The whole thing is one button. You press play and it takes it from there.',
  figure: 'player-screen',
  blocks: [
    {
      heading: 'What pressing play does',
      body: [
        'You hear a short phrase in your known language. Then there is a gap. The gap is yours — say your version out loud, out loud, even if it comes out wrong or halfway. Then you hear it said properly, twice, by two different model voices, so you can hear how it really sounds.',
        'Then the next one arrives on its own. There is nothing to tap in between.',
      ],
      // The pill on the player screen is the same shape as the picture here,
      // so the two teach each other. Founder ruling 2026-08-19.
      figure: 'cycle-pill',
    },
    {
      heading: 'What a go is',
      body: [
        "A 'go' is one of those gaps where you opened your mouth and had a crack at it.",
        'Getting it wrong is still a go, and it still does the work. The reaching is the bit that builds the language — whether it arrives is almost beside the point.',
      ],
      // Three ticked gaps now say "that is all it takes to count", so the
      // sentence that said it has gone. Founder ruling 2026-08-19.
      figure: 'three-gaps',
    },
    {
      heading: 'What a session feels like',
      body: [
        'New things arrive one at a time, and things you met earlier come back on their own, just as they start to slip. You never have to keep track of any of that.',
        'You can play as long as you like. Stop at any time and the app picks up exactly where you left off.',
      ],
      figure: 'spacing-returns',
    },
    {
      heading: 'The different ways to use it',
      body: [
        'Speaking is the main one, and it is what you get by default. Easy and Fast are the two paces, and you pick between them on the player screen before you start. Offline lives behind the sliders button at the bottom of the player, and Listening lives in Settings.',
      ],
      points: [
        'Listening is audio only, with no speaking — for when your mouth is busy walking the dog, driving or doing the washing-up.',
        'Fast is the standard pace. Easy gives you about double the thinking time and says each phrase twice over.',
        'Offline downloads a chunk of the course onto your phone, so it plays with no signal at all.',
      ],
    },
    {
      heading: 'What the listening stretches ask of you',
      body: [
        'Every so often the speaking gives way to a stretch of listening, introduced by a quiet now just listen for a while.',
        'Let it come at you without effort but with attention, the way you would listen to birdsong. The words are on screen if you want them.',
      ],
      figure: 'listening-stretch',
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
        'So we ask you to produce it first, out loud, every time.',
      ],
      // The drawing carries "recognising feels easier and does less" and
      // "nothing to revise, nothing to memorise", so the prose stops saying so.
      figure: 'worn-path',
    },
    {
      heading: 'What happens at around thirty hours',
      body: [
        'The first thirty hours are tough. We would rather say so than pretend otherwise. After them it really does get a lot easier — not finished and not fluent, but fun and playful in a way that first stretch honestly is not. Three things you will be able to check for yourself:',
      ],
      points: [
        'You will be getting into conversations.',
        'You will be moving towards more listening work.',
        'You will be noticing how much surfaces easily that was genuinely impossible before.',
      ],
    },
    {
      // The pace block. It names Easy and Fast, because the settings and the
      // spread are the same argument, and it leads with the recommendation
      // rather than the menu. The two setting names are fixed — founder ruling
      // 2026-08-19, "we're not going to change the wording on it" — so they are
      // never renamed, subtitled or held at arm's length here.
      heading: 'The best way to spend thirty hours',
      body: [
        'If we had to tell you one thing about how to spend the thirty hours, it is this. Start with a big stretch, then settle into a rhythm. A whole day of it, then an hour a day, then another whole day when you can.',
        'That is not because rushing teaches you more. It does not. Thirty hours spread thin gives your brain far more time to settle in between, and Easy hands you about double the thinking time and says each phrase twice over. Taken steadily, that really is the better learning, and we would not pretend otherwise.',
        'It is that five minutes a day for a year is a much harder thing to actually do than it sounds, and for most of that year you would not feel much happening. A burst at the start changes that. You get a first conversation out of it, and the faith that this works on you, months before the gentle road would hand you either.',
        'And there is one plain advantage to going fast. You get there sooner, and you can start using the language sooner.',
      ],
    },
    {
      heading: 'Speaking first, deep listening later',
      body: [
        'For the first thirty hours or so it is mostly speaking, with listening folded in around it. After that the balance tips, and longer listening deep dives on harder material become the thing that carries you forward.',
        'That second part is what we are most confident about — but it only works once you have enough of your own language to hang it on, which is what the speaking builds.',
      ],
      figure: 'climbing-band',
    },
    {
      heading: 'Why there are no streaks and no points',
      body: [
        'We do not count days in a row, and we never will. The app does know when you were last here — every session is stamped with its time, which is how it picks up exactly where you left off. We simply never turn that into something you have to keep up, because pressure is the opposite of what makes this work, and we would like this to be fun.',
        'There are no points, no score and no leaderboard either. The thing worth measuring is what you can actually say, and you can check that yourself in any conversation you fancy.',
        'Turn up when it suits you. This is glad to see you whenever you do.',
      ],
    },
    {
      heading: 'Where all this comes from',
      body: [
        'None of it is a hunch. SSi has been running this as action research since 2009 — real learners, real conversations, and the method changed whenever the evidence said it should. Most recently Aran worked through Croatian an hour a day, which gave the clearest picture yet of what happens and when.',
        'Which means you do not have to take a view on the method, or work out how to study, or build a plan. You just press play.',
        'If you want to watch it happening to somebody, it is all on our website.',
      ],
      links: [
        {
          label: 'An hour a day of Croatian, filmed all seventy-five days',
          url: 'https://www.saysomethingin.com/intensive-croatia',
          title: "Aran's 75 days of Croatian",
        },
        {
          // The broadcast is the receipt for this row: Iris Aniar, RTÉ Raidió
          // na Gaeltachta, Tue 4 Nov 2025 — Aran Jones, John Geraint, Tom
          // Cassidy and Kai Saraceno, after ten days learning Irish in An
          // Cheathrú Rua. The clip is at
          // https://www.rte.ie/radio/rnag/clips/22557598/ and is recorded here
          // as a source, not linked: rte.ie sends X-Frame-Options SAMEORIGIN,
          // so a link would throw the learner out of the app to Safari. The
          // row goes to our own page, which carries the interview.
          label: 'Ten days of Irish, ending in a live interview on RTÉ Raidió na Gaeltachta',
          url: 'https://www.saysomethingin.com/intensive-ireland',
          title: 'Ten days of Irish',
        },
        {
          label: 'Ten days of Japanese',
          url: 'https://www.saysomethingin.com/intensive-japanuary',
          title: 'Ten days of Japanese',
        },
        {
          label: 'Thirty days of Welsh from a standing start',
          url: 'https://www.saysomethingin.com/intensive-welsh-tom',
          title: "Tom's 30 days of Welsh",
        },
        {
          label: 'The folk we have taught on telly',
          url: 'https://www.saysomethingin.com/celebrity-coaching',
          title: 'On telly',
        },
      ],
    },
  ],
}
