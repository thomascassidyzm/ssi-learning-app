/**
 * The browser may write exactly one column of `classes`, and the database
 * grant must say the same thing.
 *
 * THE HOLE (confirmed 2026-09-11, closed by
 * supabase/migrations/20260911_classes_writes_server_mediated.sql). Course
 * entitlement for a class is decided in api/school/create-class.ts on the
 * service-role key; the database itself only ever asked "is this my row?".
 * With `authenticated` holding INSERT and whole-table UPDATE on `classes`, a
 * teacher JWT could open a premium class straight through PostgREST, or flip
 * a heritage class's course_code to a premium one, and classCoverage.ts would
 * hand that course to every student in the class. The migration revokes both
 * and re-grants UPDATE on the one column the browser legitimately writes: the
 * Class Play resume point, last_lego_id.
 *
 * What this test guards is the OTHER failure: dev, staging and main share one
 * database, so a browser write to a column the grant does not name would fail
 * silently on production the moment it shipped — and the grant is column-
 * scoped precisely so that nothing else can be written. So this pins the
 * two together. Add a browser UPDATE of a new column and this fails naming
 * it; the repair is to extend the grant (a new migration, canaried) or to
 * route the write through a service-role endpoint, never to widen silently.
 *
 * Honest limit: a vitest test cannot exercise a PostgreSQL grant. The proof
 * that the database refuses the bypass write is the canary,
 * supabase/secfix-toolkit/canary_classes_writes_server_mediated.cjs, run
 * against the live database. This test fails when the migration is absent
 * and passes once it is present and consistent with the browser's writes.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = join(__dirname, '..')
const MIGRATION = join(
  __dirname, '..', '..', '..', '..',
  'supabase', 'migrations', '20260911_classes_writes_server_mediated.sql',
)

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full)
  }
  return out
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

// `.from('classes')` … `.update({ … })`, chained across lines as the sources do.
const CLASSES_UPDATE = /\.from\(\s*['"`]classes['"`]\s*\)[\s\S]{0,200}?\.update\s*\(\s*\{([\s\S]*?)\}\s*\)/g

/** Column names written by every browser `classes` UPDATE, with the file each came from. */
function browserUpdateColumns(): Map<string, string[]> {
  const cols = new Map<string, string[]>()
  for (const file of sourceFiles(SRC_DIR)) {
    const src = stripComments(readFileSync(file, 'utf8'))
    for (const m of src.matchAll(CLASSES_UPDATE)) {
      for (const part of m[1].split(',')) {
        const key = part.trim().split(':')[0].trim().replace(/^['"`]|['"`]$/g, '')
        if (key) cols.set(key, [...(cols.get(key) ?? []), file.replace(SRC_DIR, 'src')])
      }
    }
  }
  return cols
}

function migration(): string {
  return readFileSync(MIGRATION, 'utf8')
}

describe('classes writes are server-mediated at the database', () => {
  it('the migration takes INSERT and whole-table UPDATE away from the browser role', () => {
    const sql = migration()
    expect(sql).toMatch(/REVOKE INSERT ON TABLE public\.classes FROM authenticated;/)
    expect(sql).toMatch(/REVOKE UPDATE ON TABLE public\.classes FROM authenticated;/)
    expect(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true)
  })

  it('every column the browser UPDATEs on classes is named in the column grant, and nothing else is', () => {
    const grant = migration().match(/GRANT UPDATE \(([^)]+)\) ON TABLE public\.classes TO authenticated;/)
    expect(grant, 'column-scoped UPDATE grant missing from the migration').not.toBeNull()
    const granted = new Set(grant![1].split(',').map((c) => c.trim()))

    const written = browserUpdateColumns()
    expect(written.size, 'scanner found no browser classes UPDATE at all — is the pattern stale?').toBeGreaterThan(0)

    const ungranted = [...written].filter(([col]) => !granted.has(col))
    expect(
      ungranted,
      `browser writes columns the grant does not allow (would fail silently on production): ${
        ungranted.map(([c, files]) => `${c} in ${files.join(', ')}`).join('; ')}`,
    ).toEqual([])

    const unused = [...granted].filter((col) => !written.has(col))
    expect(unused, `grant names columns no browser code writes: ${unused.join(', ')}`).toEqual([])
  })
})
