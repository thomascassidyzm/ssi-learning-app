/**
 * EVERY ROUTE THE CLIENT CALLS ANSWERS A PREFLIGHT. This test fails if the
 * player names an `/api/...` route whose handler answers no `OPTIONS`, or
 * builds an `/api/` URL nobody can statically resolve.
 *
 * It is DERIVED, not censused: the client's own source is the list of routes
 * that matter, so a `fetch('/api/…')` added next month is measured the day it
 * lands rather than the day somebody remembers to re-audit. (A one-off census
 * goes stale silently; that is how another invariant in this estate degraded
 * from 1.9% to 34.5%.)
 *
 * Proven in both directions: the first case scans the real trees and expects
 * zero gaps; the later cases feed the same scanner synthetic content
 * containing each failure class and expect it to go RED. A verifier only ever
 * seen green is not a verifier.
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  describeApiRoutes,
  findClientApiCalls,
  findPreflightGaps,
  resolveRoute,
  type ScanFile,
} from './scanClientApiCalls'

// vitest runs with the package root as cwd (vitest.config.ts lives there).
const SRC = resolve(process.cwd(), 'src')
const API = resolve(process.cwd(), '../../api')

function collect(dir: string, root: string, keep: (rel: string) => boolean, out: ScanFile[] = []): ScanFile[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      collect(abs, root, keep, out)
      continue
    }
    const rel = relative(root, abs)
    if (!keep(rel)) continue
    out.push({ path: rel, content: readFileSync(abs, 'utf8') })
  }
  return out
}

/** Client source: real app code only. Tests quote fixture URLs by the hundred. */
function isClientSource(rel: string): boolean {
  if (!/\.(ts|js|vue)$/.test(rel)) return false
  if (/\.(test|spec)\.(ts|js)$/.test(rel)) return false
  if (rel.startsWith('test/') || rel.includes('__tests__/')) return false
  return true
}

/** API handlers: everything routable. `_utils` is shared code, not a route. */
function isApiHandler(rel: string): boolean {
  if (!/\.[tj]s$/.test(rel)) return false
  if (/\.(test|spec)\.[tj]s$/.test(rel)) return false
  if (rel.split('/').some((s) => s.startsWith('_'))) return false
  return true
}

describe('preflight coverage of the routes this client calls', () => {
  it('every API route the client names answers an OPTIONS preflight', () => {
    const clientFiles = collect(SRC, SRC, isClientSource)
    const apiFiles = collect(API, API, isApiHandler)
    // Sanity: both walks found the real trees, not empty directories.
    expect(clientFiles.length).toBeGreaterThan(300)
    expect(apiFiles.length).toBeGreaterThan(80)

    const gaps = findPreflightGaps(clientFiles, apiFiles)
    const report = gaps.map((g) => `${g.path}:${g.line}  [${g.kind}] ${g.raw}\n    → ${g.why}`)
    expect(report).toEqual([])
  })

  it('the derivation is non-trivial: the client really does name many routes', () => {
    const clientFiles = collect(SRC, SRC, isClientSource)
    const apiFiles = collect(API, API, isApiHandler)
    const routes = describeApiRoutes(apiFiles)
    const named = new Set(
      findClientApiCalls(clientFiles)
        .filter((c) => c.resolvable)
        .map((c) => resolveRoute(c.route, routes)?.file)
        .filter((f): f is string => !!f)
    )
    // If this ever collapses, the scanner has stopped seeing the client and
    // the green above would be green for the wrong reason.
    expect(named.size).toBeGreaterThan(30)
  })

  it('goes red when a client call lands on an uncovered route', () => {
    const apiFiles: ScanFile[] = [
      { path: 'widgets/index.ts', content: 'export default async function h(req, res) { res.json({}) }\n' },
      { path: 'widgets/[id].ts', content: "if (req.method === 'OPTIONS') return res.status(204).end()\n" },
    ]
    const gaps = findPreflightGaps(
      [{ path: 'composables/useWidgets.ts', content: "await fetch('/api/widgets')\n" }],
      apiFiles
    )
    expect(gaps.map((g) => g.kind)).toEqual(['uncovered'])
    expect(gaps[0].why).toContain('api/widgets/index.ts')

    // ...and stays green for the sibling that does answer one.
    const ok = findPreflightGaps(
      [{ path: 'composables/useWidgets.ts', content: 'await fetch(`/api/widgets/${id}`)\n' }],
      apiFiles
    )
    expect(ok).toEqual([])
  })

  it('goes red when the client builds an /api/ URL nobody can resolve', () => {
    const gaps = findPreflightGaps(
      [{ path: 'composables/useThing.ts', content: 'await fetch(`/api/${section}/list`)\n' }],
      [{ path: 'thing/list.ts', content: "import { applyCors } from '../_utils/cors'\n" }]
    )
    expect(gaps.map((g) => g.kind)).toEqual(['unresolvable'])
  })

  it('counts applyCors and a hand-rolled OPTIONS branch alike', () => {
    const routes = describeApiRoutes([
      { path: 'a.ts', content: "import { applyCors } from './_utils/cors'\n" },
      { path: 'b.ts', content: "if (req.method === 'OPTIONS') { res.status(204).end() }\n" },
      { path: 'c.ts', content: 'export default function h() {}\n' },
    ])
    expect(routes.map((r) => r.how)).toEqual(['applyCors', 'hand-rolled', 'none'])
  })

  it('ignores comment lines and doc examples', () => {
    const calls = findClientApiCalls([
      { path: 'doc.ts', content: " * The proxy is at `/api/audio/<id>` and it is fine.\n// see '/api/nope'\n" },
    ])
    expect(calls).toEqual([])
  })
})
