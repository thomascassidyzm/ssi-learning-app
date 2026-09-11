/**
 * The ORG question set — what a school or group leader is asked on their own
 * node's insights lens, written down once.
 *
 * Tom, 2026-09-10: "this intelligence in the dashboard is great for ssi admin /
 * but why not make it for orgs as well / they have the same basic needs apart
 * from the marketing side of things of ssi as a product / They still need to
 * know adherence, drop-off places / which users do what, after when and for
 * how long etc."
 *
 * These are NOT routes and NOT a second registry of numbers. The ten admin
 * questions in ./questions.ts each generate a /intel route and count the whole
 * estate behind verifyAdmin; a leader's three are answered on the lens they
 * already have (/org/:id/insights and its admin twins) by ONE server read,
 * GET /api/org/intel, which decides scope from the caller's own identity. Each
 * question below names the admin question it mirrors so the two surfaces can
 * be read side by side, and the need in Tom's words that it serves.
 *
 * What is deliberately NOT here: paying, organisations, courses-as-business,
 * where-and-what, working. Those are a vendor's questions, and several are
 * about other people's schools.
 */

import type { Question } from './questions'

export interface OrgQuestion {
  /** Anchor id on the lens, and the key of the payload section it reads. */
  slug: 'practising' | 'quiet' | 'journey'
  /** The question a leader would say out loud. */
  question: string
  /** The need in Tom's own words. */
  need: string
  /** The admin question this mirrors, by slug. */
  mirrors: Question['slug']
}

export const ORG_QUESTIONS: readonly OrgQuestion[] = [
  {
    slug: 'practising',
    question: 'How many of your classes practised together this week, and is that more or fewer than last week?',
    need: 'adherence — are people actually doing it; which users do what, when and for how long',
    mirrors: 'pulse',
  },
  {
    slug: 'quiet',
    question: 'Which classes have gone quiet, and which have never started?',
    need: 'who is not doing it',
    mirrors: 'leaving',
  },
  {
    slug: 'journey',
    question: 'How far through the course have your classes got, and where do they stop?',
    need: 'drop-off places',
    mirrors: 'losing-people',
  },
] as const

export function orgQuestionBySlug(slug: OrgQuestion['slug']): OrgQuestion {
  return ORG_QUESTIONS.find((q) => q.slug === slug)!
}
