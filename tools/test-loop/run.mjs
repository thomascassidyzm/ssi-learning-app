#!/usr/bin/env node
// FITNESS: DOES THE SUITE CATCH A DEFECT A REAL LEARNER WOULD FEEL?
// The loop may ADD and STRENGTHEN checks. It may NEVER weaken, delete, skip or
// retire a check to make a run pass, nor lower a threshold to fit observed data.
// An inconvenient red stays red. Only Tom or Watson retires a test.
// This is measurement, never permission to promote. It cannot edit source checks.
import { spawnSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, readdirSync, symlinkSync, existsSync, rmSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// TEST_LOOP_SOURCE names the checkout whose git objects and node_modules the
// scratch clone borrows; default is the checkout this file lives in.
const source = realpathSync(process.env.TEST_LOOP_SOURCE || resolve(dirname(fileURLToPath(import.meta.url)), '../..'))
if (!process.env.CS_SCRATCH) throw new Error('CS_SCRATCH required; never use /tmp')
const root = realpathSync(process.env.CS_SCRATCH)
const out = mkdtempSync(join(root, 'tmp', 'test-loop-'))
const scratch = join(out, 'checkout')
// --ref <remote/branch> makes the TESTED commit explicit: the remote branch is
// fetched into source and its tip is measured, whatever source has checked out.
// Without it, source's HEAD is measured. The report records both.
const refIndex = process.argv.indexOf('--ref')
const ref = refIndex >= 0 ? process.argv[refIndex + 1] : null
if (refIndex >= 0 && !/^[\w.-]+\/[\w./-]+$/.test(ref || '')) throw new Error('--ref needs <remote>/<branch>')
if (ref) requireOK(command('git', ['fetch', '--quiet', ...ref.split('/', 1), ref.slice(ref.indexOf('/') + 1)], source, 60000), 'fetch ref')
const report = { ref: ref || 'HEAD of source', sourceCommit: requireOK(command('git', ['rev-parse', ref || 'HEAD'], source), 'rev-parse').stdout.trim(), started: new Date().toISOString(), scratch, build: 'not-run', entries: [] }
// The repo pins pnpm through corepack; a bare `pnpm` may be absent from a
// non-login shell (systemd, this runner's own spawn). Prefer the pinned one.
const PNPM = spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).status === 0 ? ['pnpm'] : ['corepack', 'pnpm']
let preview
function stopPreview() {
  if (preview?.pid) { try { process.kill(-preview.pid, 'SIGTERM') } catch {} }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopPreview(); process.exit(2) })
function command(bin, args, cwd = scratch, timeout = 120000) {
  const r = spawnSync(bin, args, { cwd, detached: true, encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, CS_SCRATCH: out, BASE_URL: 'http://localhost:4173' } })
  if (r.error && r.pid) { try { process.kill(-r.pid, 'SIGTERM') } catch {} }
  return r
}
function requireOK(r, label) {
  if (r.status !== 0) throw new Error(`${label}: ${r.error?.message || r.stderr || r.stdout}`)
  return r
}
function clean() {
  const r = requireOK(command('git', ['status', '--porcelain']), 'status')
  if (r.stdout.trim()) throw new Error(`Scratch tree not clean: ${r.stdout}`)
}
// The player build's prebuild step recompiles the walkthrough/handbook packs
// and stamps today's date into three tracked files, so on any day after the
// last committed compile the scratch tree is dirty before the first entry.
// Restore those files (the built dist already holds the compile), record it,
// and throw if the build changed anything beyond a generation date.
function restoreBuildStamps() {
  const changed = requireOK(command('git', ['status', '--porcelain']), 'status').stdout.trim().split('\n').filter(Boolean).map(l => l.slice(3))
  if (!changed.length) return
  const diff = requireOK(command('git', ['diff', '-U0', '--', ...changed]), 'diff').stdout
  const lines = diff.split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l))
  if (!lines.length || !lines.every(l => /generated(At)?\b.*\d{4}-\d{2}-\d{2}/.test(l))) throw new Error(`Build modified tracked files beyond a generation date:\n${diff}`)
  requireOK(command('git', ['checkout', '--', ...changed]), 'restore build stamps')
  report.buildRewroteDateStamps = changed
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
  const path = join(out, 'tmp', `release-${name}-control`, 'result.json')
  rmSync(path, { force: true }) // Never reuse a previous run's evidence after a crash.
  const r = command('nice', ['-n', '15', 'node', `packages/player-vue/e2e/release-${name}-control.mjs`], scratch, 20000)
  let evidence = null
  if (existsSync(path)) evidence = JSON.parse(readFileSync(path))
  // The audible control runs three cases; the silence case is the one this
  // loop scores. Lift its clock and verdict so the scoring below reads one shape.
  if (evidence?.results) {
    const silence = evidence.results.find(c => c.id === 'silence') || {}
    evidence = { ...evidence, clock: silence.clock ?? 0, silenceVerdict: silence.verdict ?? 'cannot-run', silenceHeard: silence.heard ?? null, silenceLevel: silence.level ?? null }
  }
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
      const r = command('nice', ['-n', '15', ...PNPM, ...args], scratch, 180000)
      writeFileSync(join(out, `build-${args[1].replace('@ssi/', '')}.log`), (r.stdout || '') + (r.stderr || ''))
      requireOK(r, 'scratch build')
    }
    preview = spawn('nice', ['-n', '15', ...PNPM, '--filter', 'player-vue', 'exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: scratch, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
    restoreBuildStamps()
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
      row.run = probe(entry.mode === 'silence' ? 'audible' : 'blob')
      if (entry.patch.kind === 'fixture') row.applied = row.run.evidence?.clock > 0.05
      if (![0, 1].includes(row.run.exit) || !row.run.evidence || row.run.evidence.clock <= 0.05) {
        row.reason = 'Control could not run or playback did not advance'
      } else if (entry.mode === 'silence') {
        // Scored on the silence case alone: 'wrong' means the detector reported
        // zero PCM as heard, so the SUITE WAS FOOLED. A wrong verdict on the
        // click or real-clip case turns the control red without scoring here;
        // it is still recorded in run.evidence and must be read.
        const v = row.run.evidence.silenceVerdict
        row.status = v === 'wrong' ? 'MISS' : v === 'correct' ? 'CATCH' : 'GAP'
        if (row.status === 'GAP') row.reason = 'Silence case inconclusive (cannot-run)'
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
  stopPreview()
  report.finished = new Date().toISOString()
  writeFileSync(join(out, 'cycle.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`REPORT ${join(out, 'cycle.json')}`)
  for (const e of report.entries) console.log(`${e.status} ${e.id}: ${e.reason || ''}`)
  if (report.error) console.error(report.error)
  process.exitCode ||= report.entries.some(e => e.status === 'GAP') ? 2 : report.entries.some(e => e.status === 'MISS') ? 1 : 0
}
