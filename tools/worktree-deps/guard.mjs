#!/usr/bin/env node
/**
 * preinstall guard — an install in a git worktree must not write through a symlinked
 * node_modules into the shared checkout that every other live session is using.
 *
 * The hazard, demonstrated 2026-09-05: `command-surface/worktree.js` symlinks a new worktree's
 * node_modules at the shared checkout's tree. pnpm 8.15 then offers "The modules directory at
 * /home/tomcassidy/ssi-learning-app/node_modules will be removed and reinstalled from scratch.
 * Proceed? (Y/n)". Answer yes and the shared tree is wiped and rebuilt from THIS worktree's
 * lockfile, under every other session, while the symlink survives — so the damage is silent.
 *
 * The predicate is exactly one condition: node_modules is a SYMLINK whose real target lies
 * OUTSIDE this install root. Everything else allows, including every error: wrongly blocking
 * costs the estate its ability to install anything, wrongly allowing costs one install.
 */

import fs from 'node:fs'
import path from 'node:path'

export const OVERRIDE_ENV = 'SSI_ALLOW_SHARED_NODE_MODULES'

/**
 * @returns {{action:'allow'|'block', reason:string, target?:string}}
 */
export function inspect(root, env = process.env) {
  const nm = path.join(root, 'node_modules')
  let st
  try {
    st = fs.lstatSync(nm)
  } catch (err) {
    if (err && err.code === 'ENOENT') return { action: 'allow', reason: 'no node_modules (clean checkout / CI)' }
    return { action: 'allow', reason: `could not stat node_modules (${err && err.code}) — failing open` }
  }
  if (!st.isSymbolicLink()) return { action: 'allow', reason: 'node_modules is a real directory' }

  let target, realRoot
  try {
    target = fs.realpathSync(nm)
    realRoot = fs.realpathSync(root)
  } catch (err) {
    return { action: 'allow', reason: `could not resolve the symlink (${err && err.code}) — failing open` }
  }
  if (target === realRoot || target.startsWith(realRoot + path.sep)) {
    return { action: 'allow', reason: 'node_modules links inside this tree', target }
  }
  if (env[OVERRIDE_ENV] === '1') {
    return { action: 'allow', reason: `OVERRIDE: ${OVERRIDE_ENV}=1 — installing THROUGH the shared tree on purpose`, target }
  }
  return { action: 'block', reason: 'node_modules is a symlink into another checkout', target }
}

export function blockMessage(root, target) {
  return [
    '',
    '  ✋ INSTALL STOPPED — this would destroy another checkout\'s node_modules.',
    '',
    `  ${path.join(root, 'node_modules')}`,
    `      is a symlink to  ${target}`,
    '',
    '  That target is the SHARED checkout, live under every other worker session on this box.',
    '  pnpm/npm would remove and rebuild it from THIS worktree\'s lockfile, breaking them all',
    '  mid-turn — and the symlink survives, so nothing would look wrong afterwards.',
    '',
    '  YOU PROBABLY DO NOT NEED TO INSTALL. The shared tree is already wired up: node, vitest,',
    '  eslint and the workspace packages all resolve here right now. Just run your command.',
    '',
    '  If you genuinely need your OWN dependencies (you changed package.json, or you are on a',
    '  branch with a different lockfile), run this instead — it never touches the shared tree:',
    '',
    '      node tools/worktree-deps/unshare.mjs && pnpm install',
    '',
    `  To undo afterwards and go back to sharing:  node tools/worktree-deps/unshare.mjs --relink`,
    `  To override deliberately (you will damage other sessions):  ${OVERRIDE_ENV}=1 pnpm install`,
    '',
  ].join('\n')
}

function main() {
  const root = process.cwd()
  let verdict
  try {
    verdict = inspect(root)
  } catch (err) {
    console.error(`[worktree-deps guard] threw (${err && err.message}) — failing open, install continues.`)
    return
  }
  if (verdict.action === 'allow') {
    if (verdict.reason.startsWith('OVERRIDE') || verdict.reason.includes('failing open')) {
      console.error(`[worktree-deps guard] ${verdict.reason}`)
    }
    return
  }
  console.error(blockMessage(root, verdict.target))
  process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
