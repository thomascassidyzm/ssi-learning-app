// @vitest-environment node
/**
 * ListeningOverlay is plain `<script setup>` (no lang="ts"), so neither
 * vue-tsc nor the repo's eslint config sees a reference to a name that is
 * not in scope. Staging build 3004383 shipped two of them (job #339):
 *   - `effectiveRate` was a try-scoped const read after the try, so the
 *     first clip's per-clip audio_play row threw ReferenceError and
 *     Listening Mode playback stopped after one clip;
 *   - the belt-jump strip's :ref callback assigned to the const ref
 *     binding itself, "Assignment to constant variable" on every render.
 * This test compiles the SFC the way the production build does (inline
 * template) and lints the result for exactly those two failure classes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import { Linter } from 'eslint'
import globals from 'globals'

function compiledSetup(file: string): string {
  const source = readFileSync(resolve(__dirname, file), 'utf8')
  const { descriptor } = parse(source, { filename: file })
  return compileScript(descriptor, { id: 'scope-test', inlineTemplate: true }).content
}

function scopeProblems(file: string) {
  const linter = new Linter()
  return linter.verify(compiledSetup(file), {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.browser, ...globals.es2021 } },
    rules: { 'no-undef': 'error', 'no-const-assign': 'error' },
  }).map((m) => `${m.ruleId} L${m.line}: ${m.message}`)
}

describe('ListeningOverlay: every name in the compiled setup is in scope', () => {
  it('has no undefined references and no assignment to a const binding', () => {
    expect(scopeProblems('ListeningOverlay.vue')).toEqual([])
  })
})
