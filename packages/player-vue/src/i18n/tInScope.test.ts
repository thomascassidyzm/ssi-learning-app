import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

/**
 * A component whose template calls t(...) but whose script never puts `t` in
 * scope throws "_ctx.t is not a function" on first render — and because that
 * throw happens during render, the WHOLE component renders blank, in every
 * language including English.
 *
 * This shipped twice during the 2026-09 i18n sweep (BrowseScreen — the entire
 * Library sheet — and CourseExplorer). Typecheck, lint and the unit suite were
 * all green through it: nothing type-checks a template identifier against
 * <script setup> bindings, so only a static scan or a browser catches it.
 */

const SRC = resolve(__dirname, '..')

function vueFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) vueFiles(full, acc)
    else if (entry.endsWith('.vue')) acc.push(full)
  }
  return acc
}

/** t( used as a call in the template — mustache, or inside a bound attribute. */
const TEMPLATE_T_CALL = /(?:\{\{[^}]*|["'{(,\s]|^)\bt\s*\(\s*['"`]/

/** any of the ways `t` legitimately gets into scope in <script setup>. */
const T_IN_SCOPE = [
  /const\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useI18n\s*\(/, // const { t } = useI18n()
  /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*useI18n['"]/, // import { t } from '.../useI18n'
  /(?:const|let|function)\s+t\s*[=(]/, // locally defined t
]

function splitBlocks(source: string) {
  const templateMatch = source.match(/<template[^>]*>([\s\S]*)<\/template>/)
  const scripts = [...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n')
  return { template: templateMatch?.[1] ?? '', script: scripts }
}

describe('i18n: t() is in scope wherever a template calls it', () => {
  it('has no component that renders t(...) without binding t', () => {
    const offenders: string[] = []

    for (const file of vueFiles(SRC)) {
      const source = readFileSync(file, 'utf8')
      const { template, script } = splitBlocks(source)
      if (!template) continue

      // strip comments so a commented-out t('…') can't flag a file
      const cleanTemplate = template.replace(/<!--[\s\S]*?-->/g, '')
      const usesT = cleanTemplate.split('\n').some((line) => TEMPLATE_T_CALL.test(line))
      if (!usesT) continue

      const bound = T_IN_SCOPE.some((re) => re.test(script))
      if (!bound) offenders.push(relative(SRC, file))
    }

    expect(offenders, `these templates call t(...) but never bring t into scope — they will render BLANK:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})
