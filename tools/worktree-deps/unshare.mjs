#!/usr/bin/env node
/**
 * The tool that satisfies the guard (tools/worktree-deps/guard.mjs).
 *
 * Gives this worktree its OWN node_modules so a real `pnpm install` can run without writing
 * through the shared checkout. It only ever unlinks a SYMLINK — it refuses to touch a real
 * directory, and it never follows the link. pnpm's content-addressed store is on the same
 * filesystem, so the private install hardlinks and costs seconds and almost no disk.
 *
 *   node tools/worktree-deps/unshare.mjs            # symlink -> empty real dir, then pnpm install
 *   node tools/worktree-deps/unshare.mjs --relink   # go back to sharing the main checkout's tree
 */

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const nm = path.join(root, 'node_modules')
const relink = process.argv.includes('--relink')

function lstat(p) {
  try { return fs.lstatSync(p) } catch { return null }
}

function fail(msg) {
  console.error(`unshare: ${msg}`)
  process.exit(1)
}

// Where the main checkout is, for --relink: taken from the link we replaced, remembered here.
const memo = path.join(root, '.worktree-deps-origin')

if (relink) {
  const st = lstat(nm)
  if (st && st.isSymbolicLink()) fail(`${nm} is already a symlink to ${fs.realpathSync(nm)} — nothing to do.`)
  let origin
  try { origin = fs.readFileSync(memo, 'utf8').trim() } catch { origin = '' }
  if (!origin) fail(`no record of the original link (${memo} missing). Re-link by hand:\n  rm -rf node_modules && ln -s <main-checkout>/node_modules node_modules`)
  if (!fs.existsSync(origin)) fail(`the recorded shared tree ${origin} no longer exists.`)
  if (st) {
    if (!st.isDirectory()) fail(`${nm} is neither a symlink nor a directory — refusing.`)
    fs.rmSync(nm, { recursive: true, force: true })   // our own private tree, never the shared one
  }
  fs.symlinkSync(origin, nm)
  fs.rmSync(memo, { force: true })
  console.log(`unshare: re-linked node_modules -> ${origin} (private tree removed).`)
  process.exit(0)
}

const st = lstat(nm)
if (!st) {
  fs.mkdirSync(nm)
  console.log('unshare: there was no node_modules; created an empty one. Now run:  pnpm install')
  process.exit(0)
}
if (st.isDirectory()) {
  console.log(`unshare: ${nm} is already a real directory — this worktree already owns its deps. Nothing to do.`)
  process.exit(0)
}
if (!st.isSymbolicLink()) fail(`${nm} is neither a symlink nor a directory — refusing to touch it.`)

const target = fs.realpathSync(nm)
fs.unlinkSync(nm)                     // unlinks the LINK. The target is untouched.
fs.mkdirSync(nm)
fs.writeFileSync(memo, target + '\n')

console.log(`unshare: replaced the symlink (was -> ${target}) with an empty private node_modules.`)
console.log(`unshare: the shared tree was NOT modified. Now run:  pnpm install`)
console.log(`unshare: to go back to sharing later:  node tools/worktree-deps/unshare.mjs --relink`)
