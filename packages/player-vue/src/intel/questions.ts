/**
 * The ten questions — the whole frame of the delivery-side intelligence
 * surface, in one list.
 *
 * docs/delivery-side-intelligence-surface.md §1 names them and §3.1 makes them
 * checkable: one route per question, ten routes, every one of them one tap from
 * the top bar. This file is the single place they are written down, so the top
 * bar, the router and the tests all read the same list and cannot drift.
 *
 * `built: false` means the page has not been built yet and the route renders the
 * honest not-yet card. That is a deliberate state, not a placeholder to be
 * quietly filled: the frame is ten and the surface says so from the first day.
 */

export type QuestionGroup = 'Learners' | 'Content' | 'Business'

export interface Question {
  /** 1-10, the number used in the design document. */
  n: number
  /** Route segment under /intel. */
  slug: string
  /** Short name in the top bar. */
  tab: string
  /** The question a person would say out loud. */
  question: string
  group: QuestionGroup
  built: boolean
}

export const QUESTIONS: readonly Question[] = [
  {
    n: 1,
    slug: 'pulse',
    tab: 'Pulse',
    question: 'How many real people practised this week, and is that more or less than last week?',
    group: 'Learners',
    built: true,
  },
  {
    n: 2,
    slug: 'leaving',
    tab: 'Leaving',
    question: 'Who is about to leave, and who has already gone quiet?',
    group: 'Learners',
    built: true,
  },
  {
    n: 3,
    slug: 'losing-people',
    tab: 'Losing people',
    question: 'Where is each course losing people?',
    group: 'Content',
    built: false,
  },
  {
    n: 4,
    slug: 'weak-points',
    tab: 'Weak points',
    question: 'Which bits of a course make people stumble, skip or retry?',
    group: 'Content',
    built: true,
  },
  {
    n: 5,
    slug: 'courses',
    tab: 'Courses',
    question: 'Which courses are worth our attention, and which are people actually finishing?',
    group: 'Content',
    built: true,
  },
  {
    n: 6,
    slug: 'person',
    tab: 'One person',
    question: "What is this one person's story, and what has gone wrong for them?",
    group: 'Learners',
    built: false,
  },
  {
    n: 7,
    slug: 'working',
    tab: 'Working now',
    question: 'Is the app working right now, and did my last fix land?',
    group: 'Business',
    built: true,
  },
  {
    n: 8,
    slug: 'where-and-what',
    tab: 'Where and what',
    question: 'Where in the world are people using us, and on what?',
    group: 'Business',
    built: false,
  },
  {
    n: 9,
    slug: 'paying',
    tab: 'Paying',
    question: 'Who is paying us, through which door, and who has stopped?',
    group: 'Business',
    built: false,
  },
  {
    n: 10,
    slug: 'organisations',
    tab: 'Organisations',
    question: 'Which organisations and schools are alive, which trials are about to end, and which have gone dark?',
    group: 'Business',
    built: false,
  },
] as const

export const QUESTION_GROUPS: readonly QuestionGroup[] = ['Learners', 'Content', 'Business'] as const

export function questionPath(q: Question): string {
  return `/intel/${q.slug}`
}

export function questionBySlug(slug: string): Question | undefined {
  return QUESTIONS.find((q) => q.slug === slug)
}
