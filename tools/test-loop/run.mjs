#!/usr/bin/env node
// FITNESS: DOES THE SUITE CATCH A DEFECT A REAL LEARNER WOULD FEEL?
// The loop may ADD and STRENGTHEN checks. It may NEVER weaken, delete, skip or
// retire a check to make a run pass, nor lower a threshold to fit observed data.
// An inconvenient red stays red. Only Tom or Watson retires a test.
// This is measurement, never permission to promote. It cannot edit source checks.
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, readdirSync, symlinkSync, existsSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (!process.env.CS_SCRATCH) throw new Error('CS_SCRATCH required; never use /tmp')
const root = realpathSync(process.env.CS_SCRATCH)
const out = mkdtempSync(join(root, 'tmp', 'test-loop-'))
const scratch = join(out, 'checkout')
const report = { sourceCommit: command('git', ['rev-parse', 'HEAD'], source).stdout.trim(), started: new Date().toISOString(), scratch, build: 'not-run', entries: [] }
let preview
function command(bin, args, cwd = scratch, timeout = 120000) {
  return spawnSync(bin, args, { cwd, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, CS_SCRATCH: out, BASE_URL: 'http://localhost:4173' } })
}
function requireOK(r, label) {
  if (r.status !== 0) throw new Error(`${label}: ${r.error?.message || r.stderr || r.stdout}`)
  return r
}
function clean() {
  const r = requireOK(command('git', ['status', '--porcelain']), 'status')
  if (r.stdout.trim()) throw new Error(`Scratch tree not clean: ${r.stdout}`)
}
function dependencies(pkg) {
  const dest = join(scratch, 'packages', pkg, 'node_modules')
  mkdirSync(dest, { recursive: true })
  for (const name of readdirSync(join(source, 'packages', pkg, 'node_modules'))) {
    if (name.startsWith('.') && name !== '.bin') continue
    if (name === '@ssi') {
      mkdirSync(join(dest, name)); symlinkSync(join(scratch, 'packages/core'), join(dest, name, 'core'))
    } else symlinkSync(realpathSync(join(source, 'packages', pkg, 'node_modules', name)), join(dest, name))
  }
}
function probe(name) {
  console.log(`A serial, niced ${name} browser control measures the audio instrument without accounts or external traffic.`)
  const r = command('nice', ['-n', '15', 'node', `packages/player-vue/e2e/release-${name}-control.mjs`], scratch, 20000)
  let evidence = null
  const path = join(out, 'tmp', `release-${name}-control`, 'result.json')
  if (existsSync(path)) evidence = JSON.parse(readFileSync(path))
  return { exit: r.status, error: r.error?.message, stdout: r.stdout, stderr: r.stderr, evidence }
}
try {
  // A new disposable clone has its own index. No mutation ever targets source.
  console.log('A local scratch clone isolates deliberate breakages from every working checkout; no download is needed.')
  requireOK(command('git', ['clone', '--shared', '--quiet', '--no-checkout', source, scratch], source), 'clone')
  requireOK(command('git', ['checkout', '--detach', report.sourceCommit]), 'checkout')
  if (!realpathSync(scratch).startsWith(root + '/')) throw new Error('Scratch escaped CS_SCRATCH')
  mkdirSync(join(out, 'tmp'), { recursive: true })
  symlinkSync(realpathSync(join(source, 'node_modules')), join(scratch, 'node_modules'))
  dependencies('core'); dependencies('player-vue')
  clean()
  if (!process.argv.includes('--controls-only')) {
    console.log('Serial, niced core and player builds establish a local preview from the measured commit; this is not a release verification.')
    for (const args of [['--filter', '@ssi/core', 'exec', 'tsup', '--no-dts'], ['--filter', 'player-vue', 'build']]) {
      const r = command('nice', ['-n', '15', 'pnpm', ...args], scratch, 180000)
      writeFileSync(join(out, `build-${args[1].replace('@ssi/', '')}.log`), (r.stdout || '') + (r.stderr || ''))
      requireOK(r, 'scratch build')
    }
    preview = spawn('nice', ['-n', '15', 'pnpm', '--filter', 'player-vue', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: scratch, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''; preview.stdout.on('data', b => { log += b; process.stdout.write(b) }); preview.stderr.on('data', b => { log += b })
    preview.on('error', e => { log += e.message })
    for (let i = 0; i < 100 && !log.includes('http://127.0.0.1:4173'); i++) {
      if (preview.exitCode !== null) throw new Error(`Preview failed: ${log}`)
      await new Promise(r => setTimeout(r, 100))
    }
    if (!log.includes('http://127.0.0.1:4173')) throw new Error(`Preview not ready: ${log}`)
    const response = await fetch('http://127.0.0.1:4173', { signal: AbortSignal.timeout(3000) })
    if (!response.ok || !(await response.text()).includes('<html')) throw new Error('Preview did not serve HTML')
    report.build = 'built and served on 127.0.0.1:4173; controls stub routes, so this is NOT an app journey pass'
  }
  clean()
  const baseline = probe('blob')
  report.positiveBaseline = baseline
  const ids = JSON.parse(readFileSync(join(scratch, 'tools/test-loop/breakages/index.json')))
  for (const id of ids) {
    clean()
    const entry = JSON.parse(readFileSync(join(scratch, 'tools/test-loop/breakages', id + '.json')))
    const row = { id, status: 'GAP', applied: false, check: entry.check }
    report.entries.push(row)
    let original, target
    try {
      if (entry.patch.kind !== 'fixture') {
        target = resolve(scratch, entry.patch.file)
        if (relative(scratch, target).startsWith('..') || realpathSync(target) !== target) throw new Error('Mutation target escaped scratch or is a symlink')
        original = readFileSync(target, 'utf8')
        const count = original.split(entry.patch.before).length - 1
        if (count !== entry.patch.count) throw new Error(`Patch drift: expected ${entry.patch.count}, found ${count}`)
        writeFileSync(target, original.split(entry.patch.before).join(entry.patch.after))
        row.applied = true
      }
      if (entry.gap) { row.reason = entry.gap; continue }
      if (baseline.exit !== 0) { row.reason = 'Positive baseline did not pass; no catch may be credited'; continue }
      row.run = probe(entry.mode)
      if (entry.patch.kind === 'fixture') row.applied = row.run.evidence?.clock > 0.05
      if (row.run.exit === 2 || row.run.exit === null || !row.run.evidence || row.run.evidence.clock <= 0.05) {
        row.reason = 'Control could not run or playback did not advance'
      } else if (entry.mode === 'silence') {
        // Deliberately inverted: red qualification means the SUITE WAS FOOLED.
        row.status = row.run.exit === 1 ? 'MISS' : 'CATCH'
      } else row.status = row.run.exit === 1 ? 'CATCH' : 'MISS'
    } finally {
      if (original !== undefined) writeFileSync(target, original)
      clean()
      row.reverted = true
    }
  }
  report.positiveAfter = probe('blob')
  if (report.positiveAfter.exit !== 0) throw new Error('Restored positive control failed')
} catch (e) { report.error = e.message; process.exitCode = 2 }
finally {
  if (preview?.pid) { try { process.kill(-preview.pid, 'SIGTERM') } catch {} }
  report.finished = new Date().toISOString()
  writeFileSync(join(out, 'cycle.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`REPORT ${join(out, 'cycle.json')}`)
  for (const e of report.entries) console.log(`${e.status} ${e.id}: ${e.reason || ''}`)
  if (report.error) console.error(report.error)
  process.exitCode ||= report.entries.some(e => e.status === 'GAP') ? 2 : report.entries.some(e => e.status === 'MISS') ? 1 : 0
}
