/**
 * Partner doors — the copy for a shareable, unlinked landing page aimed at one
 * partner's own network.
 *
 * A partner door sells the EXISTING tutor model (£15/mo to teach, students
 * £10/mo, £5 back per completed student-month) to people who already trust the
 * partner. It is NOT an affiliate/introducer offer — that lane is undecided
 * (founder exploration 2026-08-03) and no partner door may state one until it
 * is ruled on. The only CTA is the live tutor door at /tutors.
 *
 * Copy discipline, same rule as Onboarding.vue's proof pane: every claim here
 * is either the live site's own wording, or a fact verified against this repo /
 * the live catalogue. Nothing is invented, no testimonials, no audio-coverage
 * claim (unverified as of 2026-08-03). Re-verify before editing; never soften a
 * number or add a new one without a source.
 *
 * Verified 2026-08-03 against GET /api/courses/available on staging: exactly 19
 * `eng_for_*` courses exist (ara ben deu fra guj hin ita jpn kan kor mar pan por
 * sin spa tam tel urd zho), all premium tier, all selectable at the tutor door.
 * Three carry new_app_status 'live' (kan, mar, tel); the other sixteen are
 * 'beta' — which is why the page says "in use" rather than "finished".
 */

export interface PartnerDoorCopy {
  /** URL slug, also the key used by the route. */
  slug: string
  /** Partner's own name, as they write it. */
  partner: string
  /** Small line above the headline. */
  kicker: string
  headline: string
  /** The single hard number, and what it says. */
  proof: {
    eyebrow: string
    num: string
    headline: string
    line: string
    /** Full sentence for screen readers — the number pane is decorative. */
    label: string
  }
  /** One declarative paragraph under the proof. */
  stance: string
  /** The thing the partner's people can't do unaided — the live page's hook. */
  hook: string
  /** The deal, stated plainly — three lines, no adjectives. */
  deal: { label: string; value: string; note: string }[]
  /** The worked example. Arithmetic only, no projection. */
  example: string
  /** What a tutor actually teaches. */
  teach: { heading: string; body: string; languages: string[] }
  /** How it runs, in order. */
  steps: { title: string; body: string }[]
  /** The small print people actually want. */
  practicalities: string[]
  /** Why there are no testimonials — said plainly, not omitted. */
  honesty: string
  cta: { label: string; href: string; note: string }
}

const ENGLISH_FROM: string[] = [
  'Arabic',
  'Bengali',
  'Chinese',
  'French',
  'German',
  'Gujarati',
  'Hindi',
  'Italian',
  'Japanese',
  'Kannada',
  'Korean',
  'Marathi',
  'Punjabi',
  'Portuguese',
  'Sinhala',
  'Spanish',
  'Tamil',
  'Telugu',
  'Urdu',
]

export const PARTNER_DOORS: Record<string, PartnerDoorCopy> = {
  znotes: {
    slug: 'znotes',
    partner: 'ZNotes',
    kicker: 'For the ZNotes community',
    headline: 'You already teach. This is a way to be paid for it.',
    proof: {
      // Independent Cardiff University study, 2024 — the same wording the
      // school and tutor signup doors lead with (Onboarding.vue panelProof).
      eyebrow: 'Independently evaluated — Cardiff University',
      num: '1 in 2',
      headline: 'pupils in the top 10%',
      line: 'of possible marks — from five minutes of speaking practice a week',
      label:
        'Independent Cardiff University study, 2024: one in two pupils scored in the top ten percent of possible marks, from five minutes of speaking practice a week',
    },
    stance:
      'The method does the teaching. You do the part a person has to do — showing up, keeping someone going, answering the question they were too embarrassed to ask. You do not need to be a trained teacher, and you do not need to speak your student’s first language.',
    // The live /tutors page's own hook — "The bit you can't do yourself: teach
    // absolute beginners, in any language." Kept because it is the thing a
    // ZNotes student genuinely cannot do unaided, and it is the site's claim,
    // not one written here.
    hook: 'Your students learn English in their own language, so a complete beginner can start with you on day one. You keep teaching in English. You do not need to learn twenty languages — that is the part SSi does.',
    deal: [
      { label: 'You pay', value: '£15 a month', note: 'to teach — and you get the full course yourself' },
      { label: 'Your students pay', value: '£10 a month', note: 'each, directly — you never handle their money' },
      { label: 'You get back', value: '£5 a month', note: 'for every student, for every month they stay — paid once your balance passes £100' },
    ],
    // Break-even framing, lifted from the live /tutors page ("Three students at
    // £10 a month covers your £15 subscription — everyone after that is
    // profit"). Arithmetic only, no projection.
    example:
      'Three students cover your £15. Everyone after that is profit — ten students who stay the month is £50 back. It is per completed student-month, so it keeps coming for as long as they keep learning.',
    teach: {
      heading: 'What you teach',
      body:
        'English, to speakers of nineteen first languages. Each one is its own course, built from that language rather than translated into it — so a Tamil speaker learns English from Tamil.',
      languages: ENGLISH_FROM,
    },
    steps: [
      {
        title: 'Sign up as a tutor',
        body: 'Pick the course you want to teach. Thirty days free before anything is charged.',
      },
      {
        title: 'Share your class link',
        body: 'One link. Your students join it, subscribe at £10 a month, and land in your class.',
      },
      {
        title: 'Teach the way you already do',
        body: 'They speak from the first minute. You see who is practising and who has gone quiet.',
      },
      {
        title: 'Get paid',
        // Under-promise, per the founder ruling 2026-08-03: the payout is
        // conditional (threshold + refund window), so the step says so rather
        // than implying a monthly transfer regardless of balance.
        body: 'Every completed student-month accrues £5 to you. Paid monthly by bank transfer once your balance passes £100 and the refund period has completed.',
      },
    ],
    practicalities: [
      // Verified: tutor lane is monthly-only since 2026-08-02 (lib/paddle.ts).
      'Monthly, both sides. You or your students can stop any time.',
      // Verified: hold_until = paid_at + 1 month + 30 days (paddle-webhook.ts).
      'Rebates are held until the student’s month is complete, then released thirty days after that — so refunds settle before money moves.',
      // Verified: PAYOUT_THRESHOLD_PENCE = 10000 (api/teacher/commissions.ts).
      'Payouts go by bank transfer once your balance passes £100.',
      // Verified: TUTOR_SEAT_CAP = 20 (api/teacher/by-code.ts).
      'A class holds up to twenty students.',
      // Live /tutors' own promise, verbatim in substance: "No streaks, no owls,
      // no shame loops, no dark patterns at cancellation… they can leave with
      // one click and keep access to the end of their billing cycle."
      'Your students can cancel with one click and keep access to the end of their billing cycle. No streaks, no shame loops, no dark patterns — you are putting your name on this.',
    ],
    // The live /tutors page says this in its own voice, and it is the reason
    // there are no testimonials here: "we'd rather tell you that than invent
    // testimonials."
    honesty:
      'The teacher programme is new, and we would rather tell you that than invent testimonials. What we can show you is the Cardiff study, a method with over 100,000 learners since 2009, and thirty free days to judge it yourself before your name goes anywhere near it.',
    cta: {
      label: 'Start teaching',
      href: '/tutors',
      // Verified: tutor track trial = 30 days, every language (Onboarding.vue).
      // "no card" is the live /tutors page's own promise ("thirty days free, no card").
      note: 'Thirty days free, no card.',
    },
  },
}

export function partnerDoorCopy(slug: string): PartnerDoorCopy | null {
  return PARTNER_DOORS[slug] ?? null
}
