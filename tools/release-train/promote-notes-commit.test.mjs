/**
 * The promote's notes-commit step, pinned — `pnpm test:promote-notes`.
 *
 * 2026-09-07 (#184 ship): the notes for 2026-09-07 were finalised, written into the promote
 * worktree, and then NOT committed onto main — the player's "What's new" on production stayed a
 * ship behind, which is exactly the failure Tom ruled loudly against on 2026-08-29. The cause is
 * one line: `git diff --quiet -- <path>` compares the INDEX to the working tree for TRACKED files
 * and says nothing at all about an UNTRACKED one. Every notes file for a NEW date is untracked in
 * a worktree cut from main, so the guard reported "no change" and the add/commit never ran; only
 * a re-finalise of an existing file would have landed.
 *
 * The test drives the real promote.sh snippet in a throwaway repo with a brand-new notes file.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

/** A repo with a committed notes dir, plus ONE brand-new (untracked) notes file. */
function repoWithNewNotesFile() {
  const dir = mkdtempSync(join(tmpdir(), 'promote-notes-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'thomas.cassidy+zm@gmail.com')
  git(dir, 'config', 'core.hooksPath', join(dir, '.githooks-none'))
  git(dir, 'config', 'user.name', 'test')
  mkdirSync(join(dir, 'tools/release-train/notes'), { recursive: true })
  writeFileSync(join(dir, 'tools/release-train/notes/2026-08-29.md'), '# an earlier ship\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'seed')
  writeFileSync(join(dir, 'tools/release-train/notes/2026-09-07.md'), '# this ship\n')
  return dir
}

const OLD_GUARD = `
  if ! git diff --quiet -- tools/release-train/notes/; then
    git add -- tools/release-train/notes/
    git commit --quiet -m notes
  fi
`
/** The shipped snippet, lifted out of promote.sh so the test cannot drift from it. */
const shippedGuard = () => {
  const sh = readFileSync(join(HERE, 'promote.sh'), 'utf8')
  const m = sh.match(/# NOTES-COMMIT-BEGIN\n([\s\S]*?)# NOTES-COMMIT-END/)
  assert.ok(m, 'promote.sh must mark its notes-commit step with NOTES-COMMIT-BEGIN/END')
  // The script addresses the worktree with `-C "$WT"`; the test runs inside it.
  return m[1].replaceAll('git -C "$WT" ', 'git ')
}

const notesCommitted = (dir) =>
  git(dir, 'log', '--oneline', '--', 'tools/release-train/notes/2026-09-07.md').trim() !== ''

test('the OLD guard silently drops a brand-new notes file (the 2026-09-07 miss)', () => {
  const dir = repoWithNewNotesFile()
  execFileSync('bash', ['-c', OLD_GUARD], { cwd: dir })
  assert.equal(notesCommitted(dir), false)
})

test('the SHIPPED guard commits a brand-new notes file', () => {
  const dir = repoWithNewNotesFile()
  execFileSync('bash', ['-c', shippedGuard()], { cwd: dir })
  assert.equal(notesCommitted(dir), true)
})

test('the SHIPPED guard commits nothing when the notes are unchanged', () => {
  const dir = repoWithNewNotesFile()
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'notes already in')
  const before = git(dir, 'rev-parse', 'HEAD')
  execFileSync('bash', ['-c', shippedGuard()], { cwd: dir })
  assert.equal(git(dir, 'rev-parse', 'HEAD'), before)
})
