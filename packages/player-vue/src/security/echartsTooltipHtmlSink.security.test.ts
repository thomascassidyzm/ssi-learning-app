/**
 * SEC0905-X-04 / X-05 — the ECharts surface in the insight & admin boards.
 * (docs/security-audit-2026-09-05/area-x-coordinator.md)
 *
 * TWO findings, both about the same dependency, both green today and both
 * written to go RED when the situation changes rather than when it is fixed.
 *
 * X-04 (INFO) — `echarts@5.6.0` is the ONLY advisory in the whole dependency
 *   tree that ships to a learner's browser: CVE-2026-45249, XSS, CVSS 6.1,
 *   GHSA-fgmj-fm8m-jvvx, fixed in 6.1.0. Its preconditions are a `lines`
 *   series + a tooltip + no custom formatter + an HTML-bearing
 *   `series.data[i].name`. The app uses no `lines` series, so it is NOT
 *   reachable. The spec below pins that precondition: add a `lines` series
 *   while still on echarts 5.x and this goes red.
 *
 * X-05 (LOW, latent) — ECharts renders a tooltip `formatter`'s returned
 *   string as HTML (renderMode defaults to 'html'; the string reaches an
 *   innerHTML sink). Six widget formatters interpolate a `name` into that
 *   string unescaped. Safe TODAY only because every name reaching them is a
 *   hardcoded literal or a fixed server constant — not because anything
 *   escapes. Point one of those widgets at a per-class or per-school
 *   breakdown and it becomes stored XSS in a govt_admin's session.
 *
 * These specs deliberately do NOT assert the fix. Nothing here changes
 * production behaviour; the audit writes findings, not patches.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// Anchor on the package root regardless of where vitest was invoked from
// (memory: vitest-import-meta-url-happy-dom — fileURLToPath is unusable here).
const cwd = process.cwd()
const pkgRoot = cwd.endsWith('packages/player-vue') ? cwd : join(cwd, 'packages/player-vue')
const read = (rel: string) => readFileSync(join(pkgRoot, rel), 'utf-8')

const WIDGETS = 'src/insight/widgets'

describe('SEC0905-X-04 — echarts CVE-2026-45249 preconditions', () => {
  it('echarts is a shipped production dependency, not a devDependency', () => {
    const pkg = JSON.parse(read('package.json'))
    // If this ever moves to devDependencies the finding evaporates; if it
    // stays, the version bump to ^6.1.0 is the recommendation that stands.
    expect(pkg.dependencies.echarts).toBeDefined()
    expect(pkg.devDependencies?.echarts).toBeUndefined()
  })

  it('CHARACTERISATION: still on the vulnerable 5.x major', () => {
    const pkg = JSON.parse(read('package.json'))
    // Goes RED on the bump to ^6.1.0, which is the fix. Delete this spec then.
    expect(pkg.dependencies.echarts).toMatch(/^\^?5\./)
  })

  it('NO `lines` series exists anywhere — this is what makes the CVE unreachable', () => {
    // The single assertion that matters. Adding `type: 'lines'` while still on
    // echarts 5.x turns an unreachable advisory into a live XSS, and turns
    // this test red on the same commit.
    let out = ''
    try {
      out = execFileSync(
        'git',
        ['grep', '-nI', "-e", "type: 'lines'", '-e', 'type: "lines"', '--', 'src'],
        { cwd: pkgRoot, encoding: 'utf-8' },
      )
    } catch {
      out = '' // git grep exits 1 on no match
    }
    // One known-safe hit, named so it cannot hide a new one: demo.ts's
    // `COURSES.map(c => ({ label: c.name }))`, where COURSES is a hardcoded
    // literal array of course display names (src/insight/data/demo.ts:77).
    const hits = out
      .split('\n')
      .filter(Boolean)
      .filter((l) => !l.startsWith('src/insight/data/demo.ts:') || !l.includes('COURSES.map'))
    expect(hits).toEqual([])
  })
})

describe('SEC0905-X-05 — tooltip formatters that return unescaped HTML', () => {
  // The six formatters named in the report, each with the interpolation that
  // makes it an HTML sink. Pinned by file so a rename cannot silently drop one.
  const SINKS: [string, RegExp][] = [
    ['Treemap.vue', /return `\$\{params\.name\}: /],
    ['Funnel.vue', /return `\$\{params\.name\}: \$\{params\.value\}`/],
    ['RankedBar.vue', /`\$\{params\.name\}: \$\{formatValue\(params\.value\)\}`/],
    ['Map.vue', /`\$\{params\.name\}: \$\{formatValue\(params\.value\)\}`/],
    ['CohortGrid.vue', /`\$\{yL\} · \$\{xL\}: <b>/],
    ['Distribution.vue', /<span style="[^"]*">\$\{arr\[0\]\?\.name \?\? ''\}<\/span>/],
  ]

  it.each(SINKS)('CHARACTERISATION: %s interpolates a name into tooltip HTML with no escaping', (file, re) => {
    const src = read(join(WIDGETS, file))
    expect(src).toMatch(re)
    // and does so with no escape helper in sight — that is the finding.
    expect(src).not.toMatch(/escapeHtml|encodeHTML|\besc\(/)
  })

  it('Distribution.vue proves the sink is HTML, not text — it emits tags on purpose', () => {
    const src = read(join(WIDGETS, 'Distribution.vue'))
    expect(src).toContain('<span style=')
    expect(src).toContain('<br/>')
    // No `renderMode: 'text'` anywhere would make these safe.
    expect(src).not.toContain("renderMode: 'text'")
  })

  it('SECURE-ASSERTION: the two widgets fed by real entity names use SAFE formatters', () => {
    // RateTrend takes NodeRateEngine's `node.name` (a school/class name an
    // admin controls) but uses trigger:'axis' with only a valueFormatter, so
    // ECharts' own built-in formatter builds and escapes the markup.
    const rateTrend = read('src/insight/components/RateTrend.vue')
    expect(rateTrend).toContain("trigger: 'axis'")
    expect(rateTrend).toContain('valueFormatter:')
    // If someone adds a custom `formatter:` here, that safety is gone.
    expect(rateTrend).not.toMatch(/tooltip: \{[^}]*\n\s*formatter:/)

    // SovereignComparison interpolates the entity label into an AXIS-LABEL
    // rich-text formatter ({style|text}), which is canvas-rendered and does
    // not parse HTML; its tooltip formatter takes params.value only.
    const sovereign = read(join(WIDGETS, 'SovereignComparison.vue'))
    expect(sovereign).toMatch(/formatter: \(v: string\) => v === selfLabel/)
    expect(sovereign).toMatch(/formatter: \(params: \{ value: number \}\)/)
  })

  it('CHARACTERISATION: no DB-sourced entity name reaches the six sinks today', () => {
    // The insight data layer builds the labels those six widgets receive.
    // Every one is a literal or a fixed constant. This is the assumption the
    // whole "safe today" verdict rests on, so it is pinned: wire a
    // `class_name` / `school.name` into a RankedBar or Treemap feed and the
    // grep below starts matching.
    let out = ''
    try {
      out = execFileSync(
        'git',
        ['grep', '-nIE', 'label: [a-z_]+\\.(class_name|school_name|name)\\b', '--', 'src/insight/data'],
        { cwd: pkgRoot, encoding: 'utf-8' },
      )
    } catch {
      out = ''
    }
    // One known-safe hit, named so it cannot hide a new one: demo.ts's
    // `COURSES.map(c => ({ label: c.name }))`, where COURSES is a hardcoded
    // literal array of course display names (src/insight/data/demo.ts:77).
    const hits = out
      .split('\n')
      .filter(Boolean)
      .filter((l) => !l.startsWith('src/insight/data/demo.ts:') || !l.includes('COURSES.map'))
    expect(hits).toEqual([])
  })
})
