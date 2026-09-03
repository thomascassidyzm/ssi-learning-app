import { describe, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { scanTemplateLiterals } from './scanTemplateLiterals'
const ROOT = path.resolve(__dirname, '..')
const DIRS = ['components', 'components/auth', 'components/learner', 'components/me', 'components/shared', 'views', 'views/me', 'views/onboarding']
describe('inv', () => { it('dump', () => {
  const rows: string[] = []
  for (const d of DIRS) {
    const full = path.join(ROOT, d)
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('.vue')) continue
      const src = fs.readFileSync(path.join(full, f), 'utf8')
      for (const l of scanTemplateLiterals(src)) rows.push(`${d}/${f}:${l.line}\t${l.kind}\t${l.text}`)
    }
  }
  fs.writeFileSync('/tmp/cs-df95453a-60e3-4f33-bcbe-b144dafd9145/lits.txt', rows.join('\n'))
  console.log('TOTAL', rows.length)
})})
