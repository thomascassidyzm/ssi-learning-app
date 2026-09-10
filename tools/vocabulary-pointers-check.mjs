#!/usr/bin/env node
/**
 * vocabulary-pointers-check.mjs — walk tools/vocabulary-pointers.json and
 * report every pointer that no longer resolves.
 *
 * A pointer resolves when the file exists, has that line, and that line's
 * trimmed text is byte-identical to the recorded `quote`. Nothing else is
 * checked: this is a pointer checker, not a prose reviewer.
 *
 * Exit 0 = every pointer resolves. Exit 1 = at least one does not.
 * `--json` prints the failures as JSON for a job to consume.
 *
 * Node built-ins only, no dependencies, so it runs anywhere the repo does.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const dataPath = join(here, 'vocabulary-pointers.json')

const doc = JSON.parse(readFileSync(dataPath, 'utf8'))
const failures = []
let pointerCount = 0

for (const entry of doc.entries) {
  for (const p of entry.pointers) {
    pointerCount++
    const abs = join(repoRoot, p.file)
    const where = `${entry.term} → ${p.file}:${p.line}`
    if (!existsSync(abs)) {
      failures.push({ term: entry.term, file: p.file, line: p.line, reason: 'file-missing' })
      console.error(`MISSING FILE  ${where}`)
      continue
    }
    const lines = readFileSync(abs, 'utf8').split('\n')
    const actual = lines[p.line - 1]
    if (actual === undefined) {
      failures.push({ term: entry.term, file: p.file, line: p.line, reason: 'line-past-end' })
      console.error(`PAST END      ${where} (file has ${lines.length} lines)`)
      continue
    }
    if (actual.trim() !== p.quote.trim()) {
      // Cheap repair hint: has the line simply moved?
      const moved = lines.findIndex((l) => l.trim() === p.quote.trim())
      failures.push({
        term: entry.term, file: p.file, line: p.line, reason: 'quote-mismatch',
        found: actual.trim(), movedTo: moved >= 0 ? moved + 1 : null,
      })
      console.error(`MISMATCH      ${where}`)
      console.error(`  expected: ${p.quote.trim()}`)
      console.error(`  found:    ${actual.trim()}`)
      if (moved >= 0) console.error(`  the recorded line now sits at line ${moved + 1}`)
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ pointerCount, failures }, null, 2))
}

if (failures.length === 0) {
  console.log(`OK — ${pointerCount} pointers across ${doc.entries.length} terms all resolve.`)
  process.exit(0)
}
console.error(`\n${failures.length} of ${pointerCount} pointers no longer resolve.`)
process.exit(1)
