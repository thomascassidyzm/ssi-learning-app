// Live drift-gate run for the explanation compiler (tools/explainer/compile.mjs)
// — the same idiom the walkthrough pack already uses (walkthrough/compileGate.test.ts):
// one --check run on every `pnpm test`, so a hand-edit of the compiled pack, a
// renamed surface verb, or a rule over a vanished payload field fails CI
// instead of silently rotting.
//
// This gate is why the org explanations now live in tools/explainer/rulings/*.md:
// they had been hand-edited into pack.json, so the next compile would have
// dropped them (found 2026-08-03).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const ROOT = join(__dirname, '..', '..', '..', '..')

describe('explainer compile gate', () => {
  it('the real compiler passes --check against the live surfaces', () => {
    const run = spawnSync('node', [join(ROOT, 'tools/explainer/compile.mjs'), '--check'], { encoding: 'utf8' })
    expect(`${run.stdout}${run.stderr}`).not.toMatch(/COMPILE FAILED/)
    expect(run.status).toBe(0)
  }, 30000)

  it('the checked-in pack is the compiled output, not a hand-edit', () => {
    const pack = JSON.parse(readFileSync(join(ROOT, 'packages/player-vue/src/explainer/pack.json'), 'utf8'))
    const run = spawnSync('node', [join(ROOT, 'tools/explainer/compile.mjs'), '--check'], { encoding: 'utf8' })
    expect(run.stdout).toContain(`pack version would be ${pack.version}`)
  }, 30000)
})
