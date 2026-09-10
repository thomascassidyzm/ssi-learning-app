/**
 * THE FOSSILS — every old admin page that a question replaces, and the rule
 * for when it dies.
 *
 * Design §3.1: "the URL of every old admin page redirects into the question
 * it served with its scope preserved. A test asserts that no admin route
 * other than the ten, the Tools door and the redirects renders." The first
 * slice noted the honest exception: redirecting a working page to a question
 * that is not built yet would be a worse surface, not a smaller one. So a
 * fossil renders WHILE any question it serves is unbuilt, and the moment the
 * last of them is built it becomes a redirect — decided here, by code, and
 * enforced by intel/grammar.test.ts, so building a question without killing
 * its fossil fails the build rather than adding a sixth way.
 *
 * `boards` on /admin/stats maps each old board to the question that took its
 * job, so a bookmarked board lands on its answer rather than on the first
 * question. Boards with no world-scope question — rate compare, voice and
 * pause, coverage — live on at node scope on the node insights page, which
 * is the org dashboard's and stays exactly as it is.
 */
import { QUESTIONS, questionPath, questionBySlug } from './questions'

/**
 * Whether the Discovery feed's findings are shown as cards on the question
 * they concern. The feed page dies when they are — see QuestionFindings.vue.
 */
export const FINDINGS_ON_QUESTIONS = true

export interface Fossil {
  /** Path under /admin, as the router writes it. */
  path: string
  /** The questions this page served. Empty when it is replaced by the findings cards. */
  questions: string[]
  /** Where a bookmark lands once the fossil is dead — defaults to the first question. */
  landing?: string
  /** For /admin/stats: old ?board= id → the question slug that took its job. */
  boards?: Record<string, string>
  /** One line on what died and what took over, for the reader of this file. */
  note: string
}

export const FOSSILS: readonly Fossil[] = [
  {
    path: 'analytics',
    questions: ['pulse'],
    note: 'Platform Analytics, five tabs of hand-rolled charts. Its Overview and Growth tabs asked the pulse.',
  },
  {
    path: 'board',
    questions: ['pulse'],
    note: 'The living board report: real learners in thirty days, minutes, schools total. The pulse is that number with its population shown.',
  },
  {
    path: 'attention',
    questions: ['leaving'],
    note: 'Needs attention: subscribers with no practice in seven days or a period ending. Question 2, ranked by recency and regularity.',
  },
  {
    path: 'courses',
    questions: ['courses'],
    note: 'Course tiles with enrolment and practice stats. Question 5, one ranking, real people only.',
  },
  {
    path: 'activity',
    questions: ['working'],
    note: 'The live timeline. Question 7 answers "is it working right now" with the failure rate by build and device.',
  },
  {
    path: 'users/:learnerId',
    questions: ['person'],
    landing: '/intel/person',
    note: 'The 2,100-line user detail page. Question 6 keeps everything on it that answers a support call, in the five-part shape.',
  },
  {
    path: 'stats',
    questions: ['leaving', 'losing-people', 'weak-points', 'courses', 'working'],
    boards: {
      lifecycle: 'leaving',
      difficulty: 'leaving',
      friction: 'losing-people',
      scoreboard: 'courses',
      health: 'working',
    },
    note: 'Eight Insight Engine boards driven by hand. Each board maps to the question that took its job; the node-scoped boards stay on node insights.',
  },
  {
    path: 'insights',
    questions: [],
    note: 'The Discovery feed as a page. The engine stays; the findings become cards at the top of the question each concerns.',
  },
] as const

/** True once every question a fossil served is built — the day it redirects. */
export function fossilIsDead(f: Fossil): boolean {
  if (f.questions.length === 0) return FINDINGS_ON_QUESTIONS
  return f.questions.every((slug) => questionBySlug(slug)?.built === true)
}

/** Where a dead fossil's URL lands, scope preserved where the old URL carried one. */
export function fossilLanding(f: Fossil, query: Record<string, unknown> = {}): { path: string; query?: Record<string, string> } {
  const first = questionBySlug(f.questions[0] ?? 'pulse') ?? QUESTIONS[0]
  let path = f.landing ?? questionPath(first)
  const board = typeof query.board === 'string' ? query.board : null
  if (f.boards && board && f.boards[board]) {
    const q = questionBySlug(f.boards[board])
    if (q) path = questionPath(q)
  }
  const course = typeof query.course === 'string' ? query.course : null
  return course ? { path, query: { course } } : { path }
}
