// @vitest-environment node
/**
 * LIVE verification walk — the self-explaining dashboard's noticing rules
 * against the REAL IME Demo Programme tree on deployed dev
 * (docs/self-explaining-dashboard.md §5; evidence run 2026-07-27).
 *
 * Gated: runs only with IME_LIVE=1 (network + a real possession redemption).
 *
 *   IME_LIVE=1 pnpm --filter player-vue exec vitest run src/explainer/verifyIme.live.test.ts
 *
 * Auth is the product's own front door: the IME Programme Leader PERSONAL
 * link (docs/the-view/ime-invite-pack.md, code QJM-868) — the link IS the
 * login, repeatable until revoked. The walk redeems it, fetches the same
 * /api/groups/:id/home payloads the dashboard renders at programme, region,
 * school and class depth, and runs the SHIPPED evaluator + pack over each —
 * asserting every rule's fire/no-fire agrees with the live data it read.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { evaluateRules, nodeKindOf, type NoticingRule, type Invitation } from './evaluateRules'
import pack from './pack.json'

const BASE = process.env.IME_BASE || 'https://ssi-learning-app-git-dev-zenjin.vercel.app'
const CODE = 'QJM-868'
const RULES = pack.rules as NoticingRule[]
const live = process.env.IME_LIVE === '1'

describe.skipIf(!live)('IME live walk — noticing rules over real demo payloads', () => {
  let token = ''
  const homes: { name: string; kind: string; payload: any; invitations: Invitation[] }[] = []

  beforeAll(async () => {
    const redeem = await fetch(`${BASE}/api/auth/possession-redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: CODE, linkAuth: true }),
    }).then((r) => r.json())
    expect(redeem.success, `redeem failed: ${redeem.error}`).toBe(true)
    token = redeem.session.access_token

    const auth = { Authorization: `Bearer ${token}` }
    const tree = await fetch(`${BASE}/api/groups/tree`, { headers: auth }).then((r) => r.json())
    const roots: any[] = tree.tree || tree.roots || tree.nodes || []
    const flat: any[] = []
    const walk = (n: any) => { flat.push(n); (n.children || []).forEach(walk) }
    roots.forEach(walk)
    expect(flat.length, 'leader sees a non-empty subtree').toBeGreaterThan(0)

    const fetchHome = async (id: string, qs = '') =>
      fetch(`${BASE}/api/groups/${id}/home${qs}`, { headers: auth }).then((r) => r.json())

    // Every group/school node the leader can see (the whole IME subtree)…
    for (const node of flat) {
      const payload = await fetchHome(node.id)
      if (payload.node) homes.push({ name: node.name, kind: nodeKindOf(payload), payload, invitations: [] })
    }
    // …plus every class under the programme root (the classes lens).
    const lens = await fetchHome(flat[0].id, '?lens=classes')
    for (const cls of (lens.classes || []).slice(0, 12)) {
      const payload = await fetchHome(cls.id)
      if (payload.node) homes.push({ name: `class:${cls.name}`, kind: nodeKindOf(payload), payload, invitations: [] })
    }
    expect(homes.length).toBeGreaterThanOrEqual(3)
    for (const h of homes) h.invitations = evaluateRules(RULES, h.payload, 'leader', true)
  }, 120000)

  it('payloads carry every field the rules read', () => {
    for (const h of homes) {
      expect(h.payload.node?.id, h.name).toBeTruthy()
      expect(h.payload.classPractice, `${h.name} classPractice`).toBeTruthy()
      if (h.kind === 'class') expect(Array.isArray(h.payload.students), `${h.name} students`).toBe(true)
      else expect(Array.isArray(h.payload.children), `${h.name} children`).toBe(true)
    }
  })

  it('every rule fire/no-fire agrees with the live data it read', () => {
    const report: string[] = []
    for (const h of homes) {
      const fired = new Set(h.invitations.map((i) => i.ruleId))
      const cp = h.payload.classPractice || {}
      if (h.kind === 'class') {
        expect(fired.has('silent-class'), `${h.name} silent-class`).toBe(cp.totalSessions > 0 && cp.weekSessions === 0)
        const quiet = (h.payload.students || []).filter((s: any) => s.week_minutes === 0 && s.practice_hours > 0).length
        expect(fired.has('students-quiet-week'), `${h.name} students-quiet-week`).toBe(cp.totalSessions > 0 && quiet >= 1)
      } else {
        expect(fired.has('quiet-subtree'), `${h.name} quiet-subtree`).toBe(cp.classCount > 0 && cp.sessions7d === 0)
        const teacherless = (h.payload.children || []).filter((c: any) => c.hasSchool && c.rollup?.teacherCount === 0)
        expect(h.invitations.filter((i) => i.ruleId === 'school-no-teachers').length, `${h.name} school-no-teachers`)
          .toBe(Math.min(3, teacherless.length))
      }
      report.push(`${h.name} [${h.kind}] → ${h.invitations.length ? h.invitations.map((i) => `${i.ruleId}(${i.to || 'in-page'})`).join(', ') : 'no invitations (all healthy)'}`)
    }
    // The walk's evidence — printed so the run log records what actually fired.
    console.log('\nIME live walk:\n  ' + report.join('\n  '))
  })

  it('every fired invitation interpolated fully and resolved a member-scoped link', () => {
    for (const h of homes) {
      for (const inv of h.invitations) {
        expect(inv.text, `${h.name}/${inv.ruleId}`).not.toMatch(/\{[\w.]+\}/)
        if (inv.to) expect(inv.to.startsWith('/schools/org/'), `${h.name}/${inv.ruleId} member link: ${inv.to}`).toBe(true)
      }
    }
  })
})
