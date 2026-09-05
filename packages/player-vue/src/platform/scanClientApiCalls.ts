/**
 * scanClientApiCalls — a pure scanner that DERIVES which API routes this
 * client actually calls, and whether each of those routes answers a CORS
 * preflight.
 *
 * WHY THIS EXISTS. Inside the Android WebView every `/api/...` request becomes
 * cross-origin (see `apiBase.ts`), and every one carrying an `Authorization`
 * header is preflighted. A route that answers no `OPTIONS` simply fails there,
 * with a browser console message that looks nothing like the actual cause —
 * and works perfectly on the web, so nobody notices until a learner does.
 *
 * A one-off census of "which routes answer OPTIONS" goes stale the moment
 * somebody adds the next `fetch('/api/…')`. So this is not a census. It is a
 * derivation, run as a test: take the routes the CLIENT SOURCE actually names,
 * intersect them with the routes that answer a preflight, and fail on anything
 * in the first set that is missing from the second.
 *
 * The scanner is a separate pure function from the test on purpose — the same
 * discipline as `scanPlatformDoors.ts`: the test feeds it SYNTHETIC content
 * containing a gap and asserts it goes RED, so the detector is proven in both
 * directions rather than only ever seen passing.
 *
 * TWO FAILURE CLASSES, both real:
 *   1. UNCOVERED — the client names a route whose handler answers no preflight.
 *      Fix: add `applyCors` from `api/_utils/cors.ts` at the top of the handler.
 *   2. UNRESOLVABLE — the client builds an `/api/` URL whose FIRST segment is
 *      interpolated, so no static reader (this one included) can tell which
 *      route it hits. That is its own defect: it makes the coverage question
 *      unanswerable. Fix: name the route literally and interpolate below it.
 */

export interface ScanFile {
  path: string
  content: string
}

export interface ClientApiCall {
  /** Source file, relative to the scan root. */
  path: string
  line: number
  /** Path segments after `/api/`, with interpolated ones as `:param`. */
  route: string[]
  /** The literal as written, for the failure message. */
  raw: string
  /** False when the first segment is interpolated — see UNRESOLVABLE above. */
  resolvable: boolean
}

/** Lines that are prose rather than code. Same rule as scanPlatformDoors. */
function isCommentLine(line: string): boolean {
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')
}

/** `/api/foo/${bar}?x=1` → ['foo', ':param']. Query and hash dropped. */
function toRouteSegments(raw: string): { route: string[]; resolvable: boolean } {
  let body = raw.slice('/api/'.length)
  // Everything from the first query/hash/template-tail is not part of the path.
  body = body.split('?')[0].split('#')[0]
  const segments = body
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const route = segments.map((s) => (s.includes('${') ? ':param' : s))
  const resolvable = route.length > 0 && route[0] !== ':param'
  return { route, resolvable }
}

/**
 * Every `/api/...` path literal in these files. Callers exclude tests before
 * calling; comment lines are skipped here.
 */
export function findClientApiCalls(files: ScanFile[]): ClientApiCall[] {
  const hits: ClientApiCall[] = []
  // A quoted (single, double or backtick) string that starts `/api/`. Stops at
  // the closing quote of the same kind.
  const LITERAL = /(['"`])(\/api\/[^'"`]*)\1?/g
  for (const file of files) {
    const lines = file.content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (isCommentLine(line)) continue
      LITERAL.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = LITERAL.exec(line)) !== null) {
        const raw = m[2]
        const { route, resolvable } = toRouteSegments(raw)
        if (route.length === 0) continue
        hits.push({ path: file.path, line: i + 1, route, raw, resolvable })
      }
    }
  }
  return hits
}

export type PreflightSource = 'applyCors' | 'hand-rolled' | 'none'

export interface ApiRoute {
  /** Handler file, relative to `api/`, e.g. `courses/[code]/bundle.ts`. */
  file: string
  /** Route pattern segments, e.g. ['courses', '[code]', 'bundle']. */
  pattern: string[]
  answersPreflight: boolean
  how: PreflightSource
}

/**
 * Turn handler files into routes. Vercel's file routing: `index.ts` is the
 * directory itself, `[x]` matches one segment, `[...x]` matches the rest.
 */
export function describeApiRoutes(files: ScanFile[]): ApiRoute[] {
  return files.map((file) => {
    const withoutExt = file.path.replace(/\.[tj]s$/, '')
    const parts = withoutExt.split('/').filter(Boolean)
    if (parts[parts.length - 1] === 'index') parts.pop()
    const how = preflightSourceOf(file.content)
    return { file: file.path, pattern: parts, answersPreflight: how !== 'none', how }
  })
}

function preflightSourceOf(content: string): PreflightSource {
  if (/from\s+['"][^'"]*_utils\/cors['"]/.test(content)) return 'applyCors'
  if (/['"]OPTIONS['"]/.test(content)) return 'hand-rolled'
  return 'none'
}

/** Does this concrete client route hit this handler's pattern? */
export function patternMatches(route: string[], pattern: string[]): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]
    if (p.startsWith('[...')) return route.length >= i
    if (i >= route.length) return false
    if (p.startsWith('[') && p.endsWith(']')) continue
    if (p !== route[i]) return false
  }
  return route.length === pattern.length
}

/** The handler a client route resolves to, or null if nothing matches. */
export function resolveRoute(route: string[], routes: ApiRoute[]): ApiRoute | null {
  // Prefer the most literal match: a static segment beats a `[param]` one.
  const matches = routes.filter((r) => patternMatches(route, r.pattern))
  if (matches.length === 0) return null
  matches.sort((a, b) => dynamicCount(a.pattern) - dynamicCount(b.pattern))
  return matches[0]
}

function dynamicCount(pattern: string[]): number {
  return pattern.filter((p) => p.startsWith('[')).length
}

export interface CoverageGap {
  kind: 'uncovered' | 'unresolvable'
  path: string
  line: number
  raw: string
  why: string
}

/**
 * THE CHECK. Every route the client names must answer a preflight, and every
 * `/api/` URL the client builds must be statically resolvable to a route.
 *
 * A client literal that matches NO handler on disk is not reported — those are
 * doc examples, fixtures and dead paths, and policing them is a different job
 * from this one.
 */
export function findPreflightGaps(clientFiles: ScanFile[], apiFiles: ScanFile[]): CoverageGap[] {
  const routes = describeApiRoutes(apiFiles)
  const gaps: CoverageGap[] = []
  const seen = new Set<string>()
  for (const call of findClientApiCalls(clientFiles)) {
    if (!call.resolvable) {
      gaps.push({
        kind: 'unresolvable',
        path: call.path,
        line: call.line,
        raw: call.raw,
        why: 'the first path segment is interpolated, so no reader can tell which route this hits — name the route literally',
      })
      continue
    }
    const route = resolveRoute(call.route, routes)
    if (!route || route.answersPreflight) continue
    const key = route.file
    if (seen.has(key)) continue
    seen.add(key)
    gaps.push({
      kind: 'uncovered',
      path: call.path,
      line: call.line,
      raw: call.raw,
      why: `api/${route.file} answers no OPTIONS preflight, so this call fails inside the native WebView — add applyCors from api/_utils/cors.ts at the top of the handler`,
    })
  }
  return gaps
}
