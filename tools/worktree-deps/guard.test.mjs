/**
 * Guard tests — `pnpm test:worktree-deps` (node's built-in runner, no config, no deps).
 *
 * Both directions are locked: the ONE case that must block, and every case that must fail open.
 * A guard proven only in the direction it is meant to fire is an untested guard on the lever.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspect, OVERRIDE_ENV } from './guard.mjs'

const tmps = []
function scratch() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'))
  tmps.push(d)
  return fs.realpathSync(d)
}
process.on('exit', () => tmps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

test('blocks: node_modules symlinked into another checkout', () => {
  const box = scratch()
  const shared = path.join(box, 'shared'); fs.mkdirSync(path.join(shared, 'node_modules'), { recursive: true })
  const wt = path.join(box, 'wt'); fs.mkdirSync(wt)
  fs.symlinkSync(path.join(shared, 'node_modules'), path.join(wt, 'node_modules'))

  const v = inspect(wt, {})
  assert.equal(v.action, 'block')
  assert.equal(v.target, path.join(shared, 'node_modules'))
})

test('allows: no node_modules at all (clean checkout / Vercel CI)', () => {
  const v = inspect(scratch(), {})
  assert.equal(v.action, 'allow')
  assert.match(v.reason, /no node_modules/)
})

test('allows: node_modules is a real directory (the shared checkout itself)', () => {
  const box = scratch()
  fs.mkdirSync(path.join(box, 'node_modules'))
  const v = inspect(box, {})
  assert.equal(v.action, 'allow')
  assert.match(v.reason, /real directory/)
})

test('allows: symlink whose target is inside this same tree', () => {
  const box = scratch()
  fs.mkdirSync(path.join(box, 'deps'))
  fs.symlinkSync(path.join(box, 'deps'), path.join(box, 'node_modules'))
  const v = inspect(box, {})
  assert.equal(v.action, 'allow')
  assert.match(v.reason, /inside this tree/)
})

test('allows: dangling symlink (realpath fails) — fails open and says so', () => {
  const box = scratch()
  fs.symlinkSync(path.join(box, 'nowhere'), path.join(box, 'node_modules'))
  const v = inspect(box, {})
  assert.equal(v.action, 'allow')
  assert.match(v.reason, /failing open/)
})

test('allows: the deliberate override, loudly', () => {
  const box = scratch()
  const shared = path.join(box, 'shared'); fs.mkdirSync(path.join(shared, 'node_modules'), { recursive: true })
  const wt = path.join(box, 'wt'); fs.mkdirSync(wt)
  fs.symlinkSync(path.join(shared, 'node_modules'), path.join(wt, 'node_modules'))

  const v = inspect(wt, { [OVERRIDE_ENV]: '1' })
  assert.equal(v.action, 'allow')
  assert.match(v.reason, /^OVERRIDE/)
})

test('allows: a non-1 value of the override does NOT unlock it', () => {
  const box = scratch()
  const shared = path.join(box, 'shared'); fs.mkdirSync(path.join(shared, 'node_modules'), { recursive: true })
  const wt = path.join(box, 'wt'); fs.mkdirSync(wt)
  fs.symlinkSync(path.join(shared, 'node_modules'), path.join(wt, 'node_modules'))

  assert.equal(inspect(wt, { [OVERRIDE_ENV]: 'true' }).action, 'block')
})
