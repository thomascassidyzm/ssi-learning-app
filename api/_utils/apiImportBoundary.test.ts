/**
 * NO SERVERLESS FUNCTION IMPORTS RUNNABLE CODE FROM packages/player-vue.
 *
 * `packages/player-vue/package.json` declares `"type": "module"`; the repo root
 * and `packages/core` do not. A Vercel function that TRACES a file inside that
 * package is loaded under the wrong module system and dies with
 * FUNCTION_INVOCATION_FAILED — on EVERY request, not just the new code path.
 * Seen live on staging 2026-09-16 (job #32): `api/org/vad.ts` imported
 * `summariseVad` from `packages/player-vue/src/insight/data/vadUptake`, and
 * both the Insights read and the admin board's read answered 500 while
 * typecheck, the unit suites and the local build were all green. The summary
 * now lives in `packages/core/src/audio/vadSummary.ts`, which a dozen routes
 * already import from safely.
 *
 * A TYPE import is fine and stays allowed: it is erased before anything runs,
 * which is why `api/courses/[code]/bundle.ts` may keep its wire types.
 *
 * Seen RED on the pre-fix `api/org/vad.ts` and GREEN after.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API_DIR = join(process.cwd(), 'api')

function everyTsFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) everyTsFile(full, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full)
  }
  return out
}

describe('the api → packages import boundary', () => {
  it('no function imports RUNNABLE code from packages/player-vue', () => {
    const offenders: string[] = []
    for (const file of everyTsFile(API_DIR)) {
      const src = readFileSync(file, 'utf8')
      // `import … from '…packages/player-vue…'`, on one line, type imports aside.
      for (const line of src.split('\n')) {
        if (!line.includes('packages/player-vue')) continue
        if (!/^\s*(import|export)\b/.test(line)) continue          // a comment, a path in prose
        if (/^\s*(import|export)\s+type\b/.test(line)) continue    // erased before it runs
        offenders.push(`${file.replace(process.cwd() + '/', '')}: ${line.trim()}`)
      }
    }
    expect(offenders, 'move the shared code to packages/core/src/** — see this file’s header').toEqual([])
  })
})
