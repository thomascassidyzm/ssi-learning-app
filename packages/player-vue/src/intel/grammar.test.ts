/**
 * THE GRAMMAR, AS TESTS — design §3.7: "one way to do each thing, tested by
 * the one-route-per-question rule and the one-metric-one-page rule; the same
 * shape meaning the same thing everywhere, tested by the hex-literal grep;
 * consistent placement, tested by the five-part layout component; and a
 * stated number of taps, one to any answer, two to any named thing, walked
 * by a test." The five-part layout is questionPageTemplate.test.ts; the one
 * tap to any answer is AdminTopBar.test.ts. The rest is here.
 *
 * A rule that lives only in a document is broken by the next agent within a
 * fortnight. These are the rules as code.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import type { RouteRecordRaw } from 'vue-router'
import router from '@/router/index'
import { QUESTIONS, questionBySlug, questionPath } from './questions'
import { FOSSILS, fossilIsDead, fossilLanding } from './fossils'
import { METRICS, metric } from './metrics'
import ScopeRail from './ScopeRail.vue'

const SRC = join(process.cwd(), 'src')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')
const vueFilesIn = (rel: string) => readdirSync(join(SRC, rel)).filter((f) => f.endsWith('.vue')).map((f) => `${rel}/${f}`)

// ---------------------------------------------------------------------------
// ONE ROUTE PER QUESTION, AND NOTHING ELSE RENDERS UNDER /admin BUT THE TREES,
// THE TOOLS DOOR, THE REDIRECTS, AND A FOSSIL WHOSE QUESTION IS NOT BUILT YET.
// ---------------------------------------------------------------------------
const adminChildren = (router.options.routes.find((r) => r.path === '/admin')?.children ?? []) as RouteRecordRaw[]
const intelChildren = (router.options.routes.find((r) => r.path === '/intel')?.children ?? []) as RouteRecordRaw[]

/** The two trees a named thing lives in, and the node surfaces under them. */
const SCOPE_PICKERS = ['', 'structure', 'users', 'handbook']
/** The chores that are not questions, behind the Tools door in the bar. */
const TOOLS = ['release-notes', 'invites', 'methodology', 'pod-auditioner']

describe('one route per question', () => {
  it('has exactly ten question routes under /intel, generated from the one list', () => {
    const paths = intelChildren.filter((r) => !r.redirect).map((r) => `/intel/${r.path}`)
    expect(paths.sort()).toEqual(QUESTIONS.map(questionPath).sort())
    expect(paths).toHaveLength(10)
  })

  it('renders nothing under /admin but the scope pickers, the Tools door, redirects, and fossils still waiting for their question', () => {
    for (const r of adminChildren) {
      if (r.redirect) continue
      if (SCOPE_PICKERS.includes(r.path) || TOOLS.includes(r.path)) continue
      const fossil = FOSSILS.find((f) => f.path === r.path)
      expect(fossil, `/admin/${r.path} renders but is not a scope picker, a tool, a redirect or a registered fossil — a sixth way`).toBeDefined()
      expect(fossilIsDead(fossil!), `/admin/${r.path} still renders but every question it served is built — it must redirect now`).toBe(false)
    }
  })

  it('redirects every dead fossil into the question it served', () => {
    for (const f of FOSSILS) {
      const r = adminChildren.find((x) => x.path === f.path)
      expect(r, `fossil /admin/${f.path} has no route at all`).toBeDefined()
      if (fossilIsDead(f)) expect(r!.redirect, `/admin/${f.path} is dead and must be a redirect`).toBeDefined()
      else expect(r!.component, `/admin/${f.path} is alive and must render`).toBeDefined()
    }
  })

  it('every fossil names real questions, and a dead one lands on one of them with scope preserved', () => {
    for (const f of FOSSILS) {
      for (const slug of f.questions) expect(questionBySlug(slug), `fossil ${f.path} names unknown question ${slug}`).toBeDefined()
      for (const slug of Object.values(f.boards ?? {})) expect(questionBySlug(slug)).toBeDefined()
      const landing = fossilLanding(f, { course: 'spa_for_eng', board: Object.keys(f.boards ?? {})[0] })
      expect(landing.path.startsWith('/intel/')).toBe(true)
      expect(landing.query?.course).toBe('spa_for_eng')
    }
  })

  it('sends an old user page to the person question with the person preserved', () => {
    const user = FOSSILS.find((f) => f.path === 'users/:learnerId')!
    expect(fossilLanding(user, {}, { learnerId: 'abc' })).toEqual({ path: '/intel/person', query: { person: 'abc' } })
  })

  it('sends each old stats board to the question that took its job', () => {
    const stats = FOSSILS.find((f) => f.path === 'stats')!
    expect(fossilLanding(stats, { board: 'health' }).path).toBe('/intel/working')
    expect(fossilLanding(stats, { board: 'scoreboard' }).path).toBe('/intel/courses')
    expect(fossilLanding(stats, { board: 'friction' }).path).toBe('/intel/losing-people')
  })
})

// ---------------------------------------------------------------------------
// ONE METRIC, ONE PAGE.
// ---------------------------------------------------------------------------
describe('one metric, one page', () => {
  it('every metric is owned by a real question, and every built question owns at least one', () => {
    for (const [id, m] of Object.entries(METRICS)) {
      expect(questionBySlug(m.question), `metric ${id} is owned by unknown question ${m.question}`).toBeDefined()
    }
    for (const q of QUESTIONS.filter((x) => x.built)) {
      const owned = Object.values(METRICS).filter((m) => m.question === q.slug)
      expect(owned.length, `built question ${q.slug} shows no registered number`).toBeGreaterThan(0)
    }
  })

  it('a page may only name metrics its own question owns', () => {
    for (const file of vueFilesIn('views/intel')) {
      const src = read(file)
      const owner = src.match(/questionBySlug\('([a-z-]+)'\)/)?.[1]
      const named = [...src.matchAll(/metric\('([A-Za-z]+)'/g)].map((m) => m[1])
      if (!named.length) continue
      expect(owner, `${file} names metrics but does not name its question with questionBySlug('…')`).toBeDefined()
      for (const id of named) {
        expect(METRICS[id as keyof typeof METRICS]?.question, `${file} names metric ${id}, owned by another question`).toBe(owner)
      }
    }
  })

  it('refuses a metric asked for by the wrong page at the call site', () => {
    expect(() => metric('practisedThisWeek', 'weak-points')).toThrow(/one metric, one page/)
    expect(metric('practisedThisWeek', 'pulse').unit).toBe('people')
  })
})

// ---------------------------------------------------------------------------
// NO HEX LITERALS — the same shape means the same thing because every colour
// is a token, and the four tones are the only status colours.
// ---------------------------------------------------------------------------
describe('no hex literals on the intelligence surface', () => {
  const files = [
    ...vueFilesIn('intel'),
    ...vueFilesIn('views/intel'),
    'components/admin/AdminTopBar.vue',
    'containers/AdminContainer.vue',
  ]
  for (const file of files) {
    it(`${file} paints only with tokens`, () => {
      const src = read(file)
      expect(src, `${file} carries a hex literal`).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(src, `${file} carries an rgb literal`).not.toMatch(/\brgba?\(\s*\d/)
    })
  }

  it('the four tones alias existing schools tokens and introduce no value of their own', () => {
    const css = readFileSync(join(SRC, 'styles/schools-design.css'), 'utf8')
    const block = css.match(/\.schools-surface\.intel-surface \{([\s\S]*?)\}/)?.[1] ?? ''
    for (const tone of ['good', 'watch', 'alarm', 'quiet']) {
      expect(block, `--intel-${tone} is missing`).toMatch(new RegExp(`--intel-${tone}:\\s*var\\(--schools-[a-z0-9-]+\\);`))
    }
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

// ---------------------------------------------------------------------------
// TWO TAPS FROM ANY ANSWER TO A NAMED PERSON, COURSE OR NODE.
// ---------------------------------------------------------------------------
vi.mock('vue-router', async (orig) => ({
  ...(await orig<typeof import('vue-router')>()),
  useRoute: () => ({ path: '/intel/weak-points', query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

describe('two taps to any named thing', () => {
  it('the rail offers every course as one tap, and both trees as one tap, from any answer', () => {
    const w = mount(ScopeRail, {
      props: { courses: [{ code: 'spa_for_eng', name: 'spa_for_eng' }, { code: 'cym_n', name: 'cym_n' }], courseScopable: true },
      global: { stubs: { 'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
    })
    const names = w.findAll('.rail-name').map((el) => el.text())
    // One tap: a course. One tap: the organisation tree, where any node is
    // one more tap. One tap: the people list, where any person is one more.
    expect(names).toContain('spa_for_eng')
    expect(names).toContain('cym_n')
    expect(names).toContain('Organisations')
    expect(names).toContain('People')
    expect(w.text()).toContain('Everyone')
  })
})
